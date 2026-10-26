import fs from 'node:fs';import crypto from 'node:crypto';
const statuses=new Set(['planned','in_progress','completed','cancelled','rolled_back','failed','interrupted']);
const states={planned:'计划/尚未开始',in_progress:'进行中',completed:'已完成',cancelled:'已取消',rolled_back:'已回滚',failed:'失败未完成',interrupted:'中断待核实'};
const save=(file,value)=>{fs.writeFileSync(file+'.new',JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(file+'.new',file);};
export const beijingTime=t=>new Date(Number(t)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
export function elapsedTime(now,then){if(!Number.isFinite(Number(then))||Number(then)<=0)return null;const s=Math.max(0,Math.floor((now-then)/1000));return s<60?`${s}秒`:s<3600?`${Math.floor(s/60)}分钟`:`${Math.floor(s/3600)}小时${Math.floor(s%3600/60)}分钟`;}
export function resolveRelativeTime(text,anchor){
 const s=String(text||'');const d=new Date(Number(anchor)+8*3600000);let day=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
 const offset=/前天/.test(s)?-2:/昨天|昨日/.test(s)?-1:/后天/.test(s)?2:/明天|明日/.test(s)?1:0;
 const absolute=/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})/.exec(s);const weekly=/(上|下|本|这)?周([一二三四五六日天])/.exec(s);
 if(absolute)day=Date.UTC(+absolute[1],+absolute[2]-1,+absolute[3]);
 else if(weekly){const target='一二三四五六日'.indexOf(weekly[2]==='天'?'日':weekly[2]);const current=(d.getUTCDay()+6)%7;day+=(target-current+(weekly[1]==='下'?7:weekly[1]==='上'?-7:0))*86400000;}
 else if(/前天|昨天|昨日|今天|今日|明天|明日|后天|上午|下午|晚上|凌晨|中午/.test(s))day+=offset*86400000;
 else return {original:s,anchor:beijingTime(anchor),certainty:'unspecified'};
 const period=/凌晨/.test(s)?[0,6]:/上午|早上|早晨/.test(s)?[6,12]:/中午/.test(s)?[11,14]:/下午/.test(s)?[12,18]:/晚上|夜里/.test(s)?[18,24]:[0,24];
 return {original:s,anchor:beijingTime(anchor),date:new Date(day).toISOString().slice(0,10),periodStart:period[0],periodEnd:period[1],certainty:'date_or_time_window_not_exact_instant'};
}
export const normalizeStatus=status=>({已完成:'completed',完成:'completed','计划/尚未开始':'planned',计划:'planned',待办:'planned',未开始:'planned',进行中:'in_progress',已取消:'cancelled',已回滚:'rolled_back',失败未完成:'failed',中断待核实:'interrupted'}[status]||status);
export function messageTiming(event,receivedAt=Date.now()){
 const raw=Number(event?.time);const source=raw>0?(raw<100000000000?raw*1000:raw):null;
 const invalid=source!==null&&(!Number.isFinite(source)||source>receivedAt+120000);
 return {receivedAt,sourceAt:invalid?null:source,sourceClockWarning:invalid?'消息来源时钟在未来，保留接收时间作为解释基准':null};
}
export class TemporalContext {
 constructor(file){this.file=file;try{this.data=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.data={events:[],preferences:{}};}if(!Array.isArray(this.data.events)||!this.data.preferences)throw Error('时间事件存储损坏，拒绝覆盖');}
 persist(){save(this.file,this.data);}
 add(scope,event){event={...event,status:normalizeStatus(event.status)};if(!statuses.has(event.status)||!scope)throw Error('事件状态或会话无效');const id=event.id||crypto.createHash('sha256').update(JSON.stringify([scope,event.entity,event.status,event.sourceIds,event.reportedAt])).digest('hex');if(this.data.events.some(e=>e.id===id))return null;
  const row={...event,scope,id};this.data.events.push(row);this.persist();return row;
 }
 observe(scope,message){const {text='',id,dir,at}=message;if(!id||!at)return;
  if(dir==='in'){
   const s=String(text).trim();
   if(/温柔|皮一点|黏|粘|说话|语气|回复.*(?:自然|活泼|冷淡|简短|正式)/.test(s)&&!/(?:截图|引用|别人说|如果|假如|机制|逻辑|进度|工具)/.test(s)){
    const current=this.data.preferences[scope];if(!current||at>=current.at){this.data.preferences[scope]={at,sourceId:id,text:s.slice(0,500),scope:'chat_style'};this.persist();}
   }
   // Bootstrap unambiguous completion reports. General events use source-bound
   // structured updates from the existing chat turn, not a per-message model call.
   const done=/(?:改好了|写完了|做完了|弄好了|修好了|已完成|已经完成|提交了|交完了|升级了一下|升级好了|给你改了|给你改了一下)/.test(s);
   const conditional=/(?:引用|截图|他说|她说|以为|其实.*(?:没|未)|[？?]$|如果|假如|要是|等我|等.{0,8}(?:改完|做完|写完)|(?:还没|没有|没能|未能).{0,8}(?:改|做|修|写|升)|准备.{0,8}(?:改|做|修|写|升)|打算)/.test(s);
   if(done&&!conditional&&/(?:我|我们)/.test(s))this.add(scope,{entity:/(?:给你|升级|机制|逻辑|桥接)/.test(s)?'本次系统修改':'用户报告的完成事项',description:s.slice(0,400),status:'completed',actor:'user',reportedAt:at,occurredAt:null,whenText:s.match(/(?:昨天|今天|前天)?(?:上午|下午|晚上)|昨天|今天|前天/)?.[0]||'具体发生时间未明确',sourceKind:'user_report',sourceIds:[id]});
  }
 }
 report(scope,request,lookup){request=request?{...request,status:normalizeStatus(request.status)}:request;if(!request||typeof request.entity!=='string'||!request.entity.trim()||request.entity.length>120||!statuses.has(request.status)||!Array.isArray(request.sourceIds)||!request.sourceIds.length||request.sourceIds.length>4)throw Error('事件需要动作对象、明确状态及本会话来源ID');
  const rows=lookup(request.sourceIds);if(rows.length!==new Set(request.sourceIds).size||rows.some(x=>x.dir!=='in'||!x.id||!x.at))throw Error('事件来源不是当前会话的用户原话');
  const sourceText=rows.map(x=>x.text).join('\n');const at=Math.max(...rows.map(x=>x.at));
  const latest=this.data.events.filter(x=>x.scope===scope&&x.entity===request.entity&&x.actor==='user').at(-1);
  if(latest?.status==='completed'&&['planned','in_progress'].includes(request.status)&&!/(?:重新|重做|再改|再做|回滚|另一|下一|明天|后天|下周)/.test(sourceText))throw Error('完成事项不能无新计划或撤销证据倒退');
  if(/聊天语气|说话偏好|聊天风格/.test(request.entity)){this.data.preferences[scope]={at,sourceId:rows.at(-1).id,text:sourceText.slice(0,500),scope:'chat_style'};this.persist();}
  return this.add(scope,{entity:request.entity,description:String(request.description||sourceText).slice(0,500),status:request.status,actor:'user',reportedAt:at,occurredAt:null,whenText:String(request.whenText||'发生时间以原话为准，未明确具体时刻').slice(0,120),dueText:String(request.dueText||'').slice(0,120),sourceKind:'user_report',sourceIds:request.sourceIds});
 }
 verified(scope,{entity,description,status,at,sourceId,sourceKind='bridge_receipt'}){const latest=this.data.events.filter(x=>x.scope===scope&&x.entity===entity&&x.actor==='bridge').at(-1);if(latest?.status==='completed'&&['planned','in_progress'].includes(status))throw Error('已完成的实际事件不能无回滚证据倒退，新的任务应有新标识');return this.add(scope,{id:crypto.createHash('sha256').update([scope,sourceId,status].join(':')).digest('hex'),entity,description,status,actor:'bridge',reportedAt:at,occurredAt:at,sourceKind,sourceIds:[sourceId]});}
 context(scope,{now=Date.now(),history=[],message=null}={}){const incoming=history.filter(x=>x.dir==='in'),last=incoming.at(-1),previous=incoming.length>1?incoming.at(-2):null,lastOut=history.filter(x=>x.dir==='out').at(-1);const scoped=this.data.events.filter(x=>x.scope===scope);const query=String(last?.text||'');const stop=new Set(['今天','昨天','明天','下午','之前','已经','什么','时候','我们','你们','一下']);const words=[...new Intl.Segmenter('zh-CN',{granularity:'word'}).segment(query)].filter(x=>x.isWordLike&&x.segment.length>=2&&!stop.has(x.segment)).map(x=>x.segment);const relevant=scoped.map(e=>({e,score:words.filter(w=>(e.entity+' '+e.description).includes(w)).length})).filter(x=>x.score).sort((a,b)=>b.score-a.score||b.e.reportedAt-a.e.reportedAt).slice(0,4).map(x=>x.e);const chosen=[...new Map([...scoped.slice(-5),...relevant].map(e=>[e.id,e])).values()];const events=chosen.map(x=>({id:x.id,entity:x.entity,status:states[x.status],description:x.description,sourceKind:x.sourceKind,reportedAt:beijingTime(x.reportedAt),occurredAt:x.occurredAt?beijingTime(x.occurredAt):null,whenText:x.whenText,timeReference:resolveRelativeTime(x.whenText,x.reportedAt),dueReference:x.dueText?resolveRelativeTime(x.dueText,x.reportedAt):null,sourceIds:x.sourceIds}));
  const pref=this.data.preferences[scope];const payload={timeZone:'Asia/Shanghai',now:beijingTime(now),currentMessage:message?{id:message.id,sourceMessageAt:message.sourceAt?beijingTime(message.sourceAt):null,bridgeReceivedAt:beijingTime(message.receivedAt||message.at),dispatchedAt:beijingTime(now),queueElapsed:elapsedTime(now,message.receivedAt||message.at),sourceClockWarning:message.sourceClockWarning||null}:null,latestMessageReceivedAt:last?beijingTime(last.receivedAt||last.at):null,queueOrProcessingElapsed:last?elapsedTime(now,last.at):null,previousIncomingAt:previous?beijingTime(previous.at):null,gapSincePreviousIncoming:previous?elapsedTime(now,previous.at):null,lastReplyAt:lastOut?beijingTime(lastOut.at):null,events,currentState:[...new Map(this.data.events.filter(x=>x.scope===scope).map(e=>[e.actor+':'+e.entity,e])).values()].filter(e=>chosen.some(x=>x.entity===e.entity)).map(e=>({entity:e.entity,actor:e.actor,status:states[e.status],reportedAt:beijingTime(e.reportedAt),sourceKind:e.sourceKind})),currentChatStyle:pref?{text:pref.text,reportedAt:beijingTime(pref.at),sourceId:pref.sourceId}:null};
  return `【当前时间】${beijingTime(now)}（Asia/Shanghai）\n【时间与事件状态】${JSON.stringify(payload)}\n收到时间、事情发生时间、计划时间、实际完成/回滚和送达时间分别理解；“改了/做完了”是已完成，不因“下午”改成将来条件；条件句、否定句、未来计划也不能当完成。已完成事项不无依据退回待办；新说的当前偏好优先于旧机制反馈，但不改写过去。历史生活场景不是此刻仍在发生的事实，不把用户自述冒充桥接核验。没有明确地点/证据时不凭钟点断言天黑、对方在宿舍等现实状态。\n`;
 }
}
export function historicalScene(scene,at,deliveredAt,now=Date.now()){return {scene,occurredAt:beijingTime(at),deliveredAt:deliveredAt?beijingTime(deliveredAt):null,age:elapsedTime(now,at),isCurrent:false,note:'这是此前分享的场景，不代表现在仍在同一地点/动作'};}
