import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {writeState,readState,scrubPrivate} from './reliability.mjs';
export const memoryRevision=text=>crypto.createHash('sha256').update(text).digest('hex');
const canonical=s=>s.replace(/^\s*[-*]?\s*(?:\[[^\]]+\]\s*)*/, '').replace(/\s+/g,' ').trim();
const begin='<!-- BRIDGE_FACTS_BEGIN -->',end='<!-- BRIDGE_FACTS_END -->';
const obsolete=/表情发送：多条只认第一条|一次只能塞一个|重置当前会话.*(?:需|要)重建|定时任务绑会话.*重建|让我对别人开口的三步|让其他人也能开口，分三步|照片3张\/天|当前实际只有机主能派活|生图下载慢.*别动|想让别人也有本地工具|cron.*都在凌晨|费用侧.*走.*0[.]1|当前.*走.*0[.]1.*渠道/;
export class MemoryBook{
 constructor({file,dir,facts,resolveSource,clean=scrubPrivate}){Object.assign(this,{file,dir,facts,resolveSource,clean});fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.mkdirSync(dir,{recursive:true,mode:0o700});this.correctionsFile=path.join(dir,'corrections.json');}
 raw(){try{return fs.readFileSync(this.file,'utf8');}catch(e){if(e.code==='ENOENT')return '# 鲸鲸的记忆本\n';throw e;}}
 normalize(text,corrections=readState(this.correctionsFile,[])){
  const a=text.indexOf(begin);if(a>=0){const b=text.indexOf(end,a);if(b<0)throw Error('受管事实区损坏，保留原文件等待修复');text=text.slice(0,a)+text.slice(b+end.length);}
  let lines=text.split('\n').filter(l=>!obsolete.test(l)&&!(/^(?!.*(?:取消|过期|不限|错误|不再)).*(?:说说|空间).*(?:每天|一天|每日).*(?:两条|2条)/.test(l))&&!(/^(?!.*(?:取消|过期|错误|owner|机主)).*(?:群聊|所有群).*(?:不发照片|不能发图|不允许发图)/.test(l)));
  for(const c of corrections){lines=lines.filter(l=>!c.find.some(f=>canonical(l)===canonical(f)));if(c.replacement&&!lines.some(l=>canonical(l)===canonical(c.replacement)))lines.push(c.replacement);}
  const preferred=new Map();for(const l of lines){if(!/^\s*[-*]\s/.test(l))continue;const k=canonical(l);if(!preferred.has(k)||(/待核实/.test(preferred.get(k))&&!/待核实/.test(l)))preferred.set(k,l);}
  const unique=new Set();lines=lines.filter(l=>{if(!/^\s*[-*]\s/.test(l))return true;const k=canonical(l);if(unique.has(k)||preferred.get(k)!==l)return false;unique.add(k);return true;});
  // A correction may remove and re-append the same canonical entry. Collapse the
  // empty lines it leaves behind, otherwise every repair changes the revision.
  const body=lines.join('\n').replace(/\n[ \t]*\n(?:[ \t]*\n)+/g,'\n\n').trimEnd();
  return body+'\n\n'+begin+'\n## 当前机制事实（桥接生成，优先于旧对话）\n'+this.facts().map(s=>'- '+s).join('\n')+'\n'+end+'\n';
 }
 snapshot(){const text=this.raw();return {revision:memoryRevision(text),text,facts:this.facts()};}
 commit(text,expected,{reason='记忆更新',source={type:'maintenance'}}={}){
  const lock=this.file+'.memory-lock';let fd;
  if(fs.existsSync(lock)){let stale=false;try{const owner=JSON.parse(fs.readFileSync(lock,'utf8'));if(Number.isInteger(owner.pid)&&owner.pid>0){try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')stale=true;}}}catch{stale=Date.now()-fs.statSync(lock).mtimeMs>60000;}if(stale)fs.unlinkSync(lock);}
  try{fd=fs.openSync(lock,'wx',0o600);}catch{throw Error('记忆正在写入，稍后重新读取版本再试');}
  try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:Date.now()}));}catch(e){fs.closeSync(fd);fs.unlinkSync(lock);throw e;}
  try{const old=this.raw();if(expected!==memoryRevision(old))throw Error('记忆版本已变化，必须重读后合并，未覆盖新内容');const next=this.normalize(this.clean(text));if(next===old)return {ok:true,unchanged:true,revision:expected};if(next.length>20000||next.split('\n').length>170)throw Error('记忆过长，先整理后提交');
   const id=crypto.randomUUID();writeState(path.join(this.dir,'history',id+'.json'),{id,at:Date.now(),reason:this.clean(reason).slice(0,500),source,before:old,after:next,beforeRevision:expected,afterRevision:memoryRevision(next)});
   fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.'+id+'.tmp';try{fs.writeFileSync(tmp,next,{mode:0o600});fs.renameSync(tmp,this.file);}finally{try{fs.unlinkSync(tmp);}catch{}}
   if(this.raw()!==next)throw Error('记忆回读失败');return {ok:true,revision:memoryRevision(next),historyId:id};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 }
 repair(){const old=this.raw();return this.commit(old,memoryRevision(old),{reason:'同步当前机制及已核实的纠错记录'});}
 correct({revision,find,text='',reason,source,op}){
  const before=this.snapshot();if(revision!==before.revision)throw Error('记忆版本已变化，先重读');const targets=Array.isArray(find)?find:[find];if(!targets.length||targets.length>8||targets.some(x=>typeof x!=='string'||!/^\s*-\s+/.test(x)||x.includes('\n')||x.length>1000))throw Error('需要原记忆的完整单行条目，最多8条');
  if(targets.some(x=>x.includes('BRIDGE_FACTS')||this.facts().some(f=>canonical(f)===canonical(x))))throw Error('当前机制由桥接维护，不能用聊天覆盖');
  const oldLines=before.text.split('\n');if(targets.some(x=>!oldLines.includes(x)))throw Error('原条目已变化，先重读，不能猜测删除');
  const proof=this.resolveSource(source);let replacement=this.clean(String(text)).trim();if(replacement.includes('\n')||replacement.length>500||(!replacement&&op!=='delete'))throw Error('新记忆须为1到500字单行，删除须显式op=delete');
  if(replacement){replacement='- ['+new Date(Date.now()+8*3600000).toISOString().slice(0,10)+'] '+(proof.type==='self_review'?'[助手自查，待核实] ':'')+replacement;}
  const corrections=readState(this.correctionsFile,[]);const c={id:crypto.randomUUID(),find:targets,replacement,reason:this.clean(String(reason||'自主纠正旧记忆')),source:proof,at:Date.now()};
  // Journal intent first; a crash is recoverable by repair(), never loses the superseded entry.
  writeState(this.correctionsFile,[...corrections,c]);
  try{return this.commit(this.normalize(before.text,[...corrections,c]),revision,{reason:c.reason,source:proof});}catch(e){writeState(this.correctionsFile,corrections);throw e;}
 }
 remember({text,source}){const entry=canonical(this.clean(String(text||'')).trim());if(!entry||entry.includes('\n')||entry.length>500)throw Error('记忆须为1到500字单行');const proof=source?this.resolveSource(source):{type:'self_review',note:'无用户确认，不当作用户事实'};const old=this.snapshot();if(old.text.split('\n').some(l=>canonical(l)===entry&&(!/待核实/.test(l)||proof.type==='self_review')))return {ok:true,unchanged:true,revision:old.revision};return this.commit(old.text+'\n- ['+new Date(Date.now()+8*3600000).toISOString().slice(0,10)+'] '+(proof.type==='self_review'?'[助手自记，待核实] ':'')+entry+'\n',old.revision,{reason:'即时记忆',source:proof});}
}
