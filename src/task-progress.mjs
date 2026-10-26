import fs from 'node:fs';
import crypto from 'node:crypto';

const active = j => ['queued','starting','running','stopping'].includes(j.status);
export function isLongTask(text) {
  const s=String(text).trim();
  if(!s||/^(?:你能|你会|能不能|可以不可以|什么是|有什么区别)/.test(s))return false;
  if(/明天|下次|以后|等我|让\s*(?:GPT|ChatGPT|别人)/i.test(s)&&!/现在就|立即|马上|开始执行/.test(s))return false;
  if(/桥接|服务器|日志|消息分段|白名单/.test(s)&&/(?:查一下|检查一下|排查一下|修一下|修复一下)/.test(s))return true;
  if(/(?:这几句|这段话|回复我|说的话|说话|口气|人设|真人感|这么官方|不应该写死)/.test(s)&&!/(?:现在|立即|请|帮我|给我).{0,8}(?:修改代码|修复代码|检查代码|排查代码)/.test(s))return false;
  const current=s.split('\n').filter(x=>!/^\s*(?:>|任务：|状态：|当前：|收到，我)/.test(x)).join('\n');
  // Only a present-tense request starts work; a mentioned operation is not authorization.
  return /^(?:你)?(?:现在|立即|马上|直接|先)*(?:帮我|给我|请|麻烦你)?(?:检查|排查|查下|查一下|看看|分析|处理|修改|修复|制作|统计|转换|下载|测速|部署|备份|运行|执行|整理文件|读一下文件)/.test(current);
}
export function ownerTaskResource(text) {
 const s=String(text);
 if(/(?:白名单|群名单|聊天名单|管理员|名单|群规则|权限)/.test(s)&&/(?:加|添|删|移|设|改|启|禁|开|关|允许)/.test(s))return 'conversation_admin';
 if(/^(?:帮我|给我|请|先|你)*(?:测速|检查网络|排查连接|测试连接|查询天气)/.test(s))return 'network_inspection';
 if(/桥接|服务器|日志|网络|连接|运行状态|链路/.test(s)&&/检查|排查|查一下|查看|查询|分析|核对/.test(s)&&!/修复|修改|重启|删除|清理|部署|替换|更新|升级/.test(s))return 'network_inspection';
 return 'workspace';
}
export function independentControlRequest(text){return ownerTaskResource(text)==='conversation_admin'&&!/(?:如果|假如|以后|明天|能不能|可以吗|怎么|为什么|是不是|不对|有问题|好像)/.test(String(text));}
export function progressBlock(text) {
  const m = /【进度：([\s\S]*?)】/.exec(String(text));
  return m ? m[1].trim().slice(0,900) : '';
}
export function withoutProgress(text) { return String(text).replace(/【进度：[\s\S]*?】/g,'').trim(); }
export class TaskProgress {
  constructor(file, {send, allowed, render, onTransition, clock=Date.now}) {
    this.file=file; this.onTransition=onTransition; this.send=send; this.allowed=allowed; this.render=render;this.clock=clock; this.chains=new Map();this.pendingNotices=new Map();
    try { this.data=JSON.parse(fs.readFileSync(file,'utf8')); } catch(e) { if(e.code!=='ENOENT') throw e; this.data={}; }
    for(const j of Object.values(this.data)) if(active(j)) {j.status='interrupted';j.blocked='服务重启，先检查原任务结果，不自动重复执行';}
    this.save();
  }
  save() { const tmp=this.file+'.new';fs.writeFileSync(tmp,JSON.stringify(this.data,null,2),{mode:0o600});fs.renameSync(tmp,this.file); }
  list(key) { return Object.values(this.data).filter(j=>j.key===key).sort((a,b)=>a.at-b.at); }
  current(key) { return this.list(key).filter(j=>j.kind!=='side_chat'&&(active(j)||j.status==='interrupted')).at(-1); }
  create(key,task,extra={}) { const j={id:crypto.randomUUID(),key,task,at:this.clock(),status:'queued',stage:'已接收，等待执行',done:0,failed:0,lastSentAt:0,seq:0,...extra};this.data[j.id]=j;this.save();return j; }
  update(j,patch) {const previous=j.status;Object.assign(j,patch,{updatedAt:this.clock()});this.save();if(j.status!==previous)this.onTransition?.(j,previous);return j;}
  async notify(j,text,{force=false,authored=false,kind='progress',requested=false}={}) {
    if(kind==='progress'&&!requested&&j.progressPolicy!=='automatic')return false;
    if(!authored&&!force&&this.pendingNotices.has(j.id))return this.pendingNotices.get(j.id);
    const prev=this.chains.get(j.id)||Promise.resolve();
    const next=prev.catch(()=>{}).then(async()=>{
      if(!this.allowed(j)||(!authored&&j.kind==='side_chat')||(!force&&j.lastSentAt&&this.clock()-j.lastSentAt<20000))return false;
      const version=JSON.stringify([j.status,j.stage,j.done,j.failed,j.blocked]);
      const facts=typeof text==='string'?{event:text}:text;
      const factsKey=crypto.createHash('sha256').update(version+JSON.stringify(facts)).digest('hex');
      if(!authored&&!force&&j.lastFactsKey===factsKey)return false;
      if(!authored&&j.blockedNarration===factsKey)return false;
      if(!authored)this.update(j,{lastNarrationAttemptAt:this.clock()});
      let output;
      try{output=authored?String(text):this.render?await this.render(j,facts):null;}
      catch(e){this.update(j,{blockedNarration:factsKey,narrationError:String(e.message).slice(0,200)});throw e;}
      if(!output||!this.allowed(j)||(!authored&&JSON.stringify([j.status,j.stage,j.done,j.failed,j.blocked])!==version))return false;
      if(j.sentText===output){this.update(j,{lastFactsKey:factsKey});return false;}
      await this.send(j.key,output,{kind,taskId:j.id,noticeKey:factsKey,requested});
      this.update(j,{lastSentAt:this.clock(),sentText:output,lastFactsKey:factsKey,seq:(j.seq||0)+1});return true;
    });this.chains.set(j.id,next);
    if(!authored){this.pendingNotices.set(j.id,next);next.finally(()=>{if(this.pendingNotices.get(j.id)===next)this.pendingNotices.delete(j.id);}).catch(()=>{});}
    return next;
  }
  report(j) {return `任务：${j.task.slice(0,100)}\n状态：${({queued:'排队中',starting:'准备执行',running:'进行中',stopping:'正在请求停止',completed:'已结束',failed:'未完成',cancelled:'已停止',interrupted:'中断待检查'})[j.status]||j.status}\n已返回工具结果：${j.done}次，报告错误：${j.failed}次\n当前：${j.stage}${j.blocked?'\n阻塞：'+j.blocked:''}${j.next?'\n接下来：'+j.next:''}`;}
  async tick() {
    // Only relay fresh progress authored by the running task. Timer checks never
    // start a second model turn just to narrate unchanged tool state.
    for(const j of Object.values(this.data))if(active(j)&&j.kind!=='side_chat'&&j.progressPolicy==='automatic'&&j.authoredProgress&&j.sentText!==j.authoredProgress)
      await this.notify(j,j.authoredProgress,{authored:true});
  }
}
