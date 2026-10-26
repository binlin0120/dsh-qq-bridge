import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {responseHeaders} from './image-download.mjs';
const MAX=20*1024*1024;
const curl=(args,timeout)=>new Promise(resolve=>execFile('curl',args,{timeout,maxBuffer:128*1024},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
const failure=(code,message)=>Object.assign(Error(message),{code});
const validator=h=>h.etag&&!/^W\//.test(h.etag)?h.etag:h['last-modified']||'';
const rangeOf=h=>{const m=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(h['content-range']||'');return m?{start:Number(m[1]),end:Number(m[2]),total:Number(m[3])}:null;};
export function segmentPlan(total,{segments=16}={}){
 if(!Number.isInteger(total)||total<1||total>MAX)throw failure('IMAGE_SIZE_INVALID','图片总长度无效');
 const n=Math.min(Math.max(1,Math.min(128,Math.floor(Number(segments)||16))),Math.ceil(total/16384));
 return Array.from({length:n},(_,index)=>({index,start:Math.floor(index*total/n),end:Math.floor((index+1)*total/n)-1}));
}
export async function parallelDownloadImage(url,tmp,ips,{validate,log=()=>{},run,clock=Date.now,concurrency=4,segments=16,timeoutMs=240000,progress=()=>{}}={}){
 if(!ips.length)throw failure('NO_PUBLIC_IP','图床没有公网IPv4地址');
 const request=run||curl;const host=new URL(url).hostname,deadline=clock()+timeoutMs,dir=tmp+'.segments',manifestFile=dir+'/manifest.json';
 if(path.resolve(dir)===path.parse(path.resolve(dir)).root||dir.length<12)throw Error('Unsafe segment directory');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const base=['-4','-sS','-f','--proto','=https','--connect-timeout','6'];
 const remaining=()=>{const ms=deadline-clock();if(ms<7000)throw failure('DOWNLOAD_BUDGET_EXHAUSTED','下载预算不足，已保存分段进度');return Math.min(60,Math.floor(ms/1000));};
 let previous;try{previous=JSON.parse(fs.readFileSync(manifestFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw failure('CHECKPOINT_INVALID','下载记录损坏，保留文件等待核对');}
 const candidates=previous?.url===url&&previous?.ip?[previous.ip]:ips.slice(0,2);
 const probes=await Promise.all(candidates.map(async(ip,index)=>{
  const header=dir+`/probe-${index}.headers`,body=dir+`/probe-${index}.body`,start=clock();
  try{const r=await request([...base,'--resolve',`${host}:443:${ip}`,'--max-time',String(Math.min(20,remaining())),'--max-filesize','1','-r','0-0','-D',header,'-o',body,url],22000);const h=responseHeaders(fs.existsSync(header)?fs.readFileSync(header,'utf8'):'');const range=rangeOf(h),size=fs.existsSync(body)?fs.statSync(body).size:0;
   return {ip,h,range,size,elapsed:clock()-start,error:r.error};
  }finally{for(const f of [header,body])try{fs.unlinkSync(f);}catch{}}
 }));
 const valid=probes.filter(p=>p.h.status===206&&p.range?.start===0&&p.range.end===0&&p.range.total>0&&p.range.total<=MAX&&p.size===1&&validator(p.h)).sort((a,b)=>a.elapsed-b.elapsed);
 if(!valid.length){const rejected=probes.find(p=>p.h.status>=400);if(rejected)throw failure('IMAGE_HTTP_'+rejected.h.status,'图床返回 HTTP '+rejected.h.status+'，原分段保留');if(probes.some(p=>p.h.status===200||p.h.status===206&&!validator(p.h)))throw failure('PARALLEL_UNSUPPORTED','图床不支持可校验分段');throw failure('TRANSPORT_NO_RESPONSE','图床未提供有效分段响应，原分段保留');}
 const selected=valid[0],total=selected.range.total,version=validator(selected.h),ip=selected.ip;
 if(previous&&(previous.url!==url||previous.total!==total||previous.validator!==version))throw failure('IMAGE_VERSION_CHANGED','图片版本或总长度发生变化，旧分段已保留，不能混拼');
 const plan=previous?.parts||segmentPlan(total,{segments});
 if(plan.length<1||plan.length>128||plan[0].start!==0||plan.at(-1).end!==total-1||plan.some((p,i)=>!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.index!==i||p.end<p.start||(i&&plan[i-1].end+1!==p.start)))throw failure('CHECKPOINT_INVALID','分段边界不连续，保留文件等待核对');
 const manifest={url,total,validator:version,ip,parts:plan,updatedAt:clock()};
 const save=()=>{manifest.updatedAt=clock();fs.writeFileSync(manifestFile+'.new',JSON.stringify(manifest),{mode:0o600});fs.renameSync(manifestFile+'.new',manifestFile);};
 const partPath=p=>dir+`/part-${p.index}`;
 const bytes=()=>plan.reduce((n,p)=>{const f=partPath(p);return n+(fs.existsSync(f)?fs.statSync(f).size:0);},0);
 save();log(`分段下载：${plan.length}段，最多${Math.min(4,Math.max(1,Number(concurrency)||4))}路并发`);
 let next=0,blocked=null;
 const worker=async()=>{while(!blocked&&next<plan.length){const p=plan[next++],file=partPath(p),size=fs.existsSync(file)?fs.statSync(file).size:0,expected=p.end-p.start+1;if(size===expected)continue;
  if(size>expected){blocked=failure('CHECKPOINT_INVALID','分段长度超过计划，禁止拼接');break;}
  const offset=p.start+size,header=file+'.headers',chunk=file+'.chunk';
  try{const time=remaining();const r=await request([...base,'--resolve',`${host}:443:${ip}`,'--max-time',String(time),'--max-filesize',String(expected-size),'-H','If-Range: '+version,'-r',`${offset}-${p.end}`,'-D',header,'-o',chunk,url],(time+2)*1000);
   const h=responseHeaders(fs.existsSync(header)?fs.readFileSync(header,'utf8'):''),range=rangeOf(h),got=fs.existsSync(chunk)?fs.statSync(chunk).size:0;
   if(!Number.isFinite(h.status))throw failure('TRANSPORT_NO_RESPONSE','分段连接中断，已验证内容保留');
   if(h.status!==206||!range||range.start!==offset||range.end!==p.end||range.total!==total||validator(h)!==version||got>expected-size)throw failure('RANGE_RESPONSE_INVALID','图床分段、版本或长度不匹配，未追加，原进度保留');
   if(got){fs.appendFileSync(file,fs.readFileSync(chunk),{mode:0o600});save();progress({downloadedBytes:bytes(),totalBytes:total,segments:plan.length,concurrency:Math.min(4,Math.max(1,Number(concurrency)||4))});}
   if(r.error||got!==expected-size)throw failure('SEGMENT_INCOMPLETE','本段未取完整，已验证内容保留，停止本轮请求');
  }catch(e){blocked||=e;}finally{for(const f of [header,chunk])try{fs.unlinkSync(f);}catch{}}
 }};
 if(run){await Promise.all(Array.from({length:Math.min(4,Math.max(1,Number(concurrency)||4))},worker));}
 else {
  // One curl multi handle keeps its connection cache for the whole task. 100 segments
  // are a queue, not 100 simultaneous TLS handshakes; HTTP/2 reuse is enabled by default.
  const pending=plan.filter(p=>!fs.existsSync(partPath(p))||fs.statSync(partPath(p)).size!==p.end-p.start+1);
  const budget=remaining();const args=['--parallel','--parallel-max',String(Math.min(4,Math.max(1,Number(concurrency)||4)))];
  const accepted=new Set();
  const consume=p=>{if(accepted.has(p.index))return;accepted.add(p.index);const file=partPath(p),oldSize=fs.existsSync(file)?fs.statSync(file).size:0,offset=p.start+oldSize,h=responseHeaders(fs.existsSync(file+'.headers')?fs.readFileSync(file+'.headers','utf8'):''),r=rangeOf(h),got=fs.existsSync(file+'.chunk')?fs.statSync(file+'.chunk').size:0;
   if(h.status===206&&r?.start===offset&&r.end===p.end&&r.total===total&&validator(h)===version&&got>0&&got<=p.end-offset+1){fs.appendFileSync(file,fs.readFileSync(file+'.chunk'),{mode:0o600});save();progress({downloadedBytes:bytes(),totalBytes:total,segments:plan.length,concurrency:Math.min(4,Math.max(1,Number(concurrency)||4))});}
   for(const f of [file+'.headers',file+'.chunk'])try{fs.unlinkSync(f);}catch{}
  };
  for(const [i,p] of pending.entries()){const file=partPath(p),size=fs.existsSync(file)?fs.statSync(file).size:0;if(size>p.end-p.start+1)throw failure('CHECKPOINT_INVALID','分段长度超过计划，禁止拼接');
   if(i)args.push('--next');
   args.push(...base,'--resolve',`${host}:443:${ip}`,'--max-time',String(Math.min(60,budget)),'--max-filesize',String(p.end-p.start+1-size),'-H','If-Range: '+version,'-r',`${p.start+size}-${p.end}`,'-D',file+'.headers','-o',file+'.chunk','-w',`__SEGMENT_${p.index}__ %{http_code} %{size_download} %{exitcode}\n`,url);
  }
  if(pending.length)await new Promise((resolve,reject)=>{
   let output='';const child=spawn('curl',args,{stdio:['ignore','pipe','pipe']});const kill=setTimeout(()=>child.kill('SIGTERM'),Math.max(1,deadline-clock()));
   child.stdout.on('data',chunk=>{output+=chunk.toString();let n;while((n=output.indexOf('\n'))>=0){const line=output.slice(0,n);output=output.slice(n+1);const m=/__SEGMENT_(\d+)__/.exec(line);if(m){const p=pending.find(x=>x.index===Number(m[1]));if(p)try{consume(p);}catch(e){blocked||=e;child.kill('SIGTERM');}}}});
   child.stderr.on('data',()=>{});child.once('error',e=>{clearTimeout(kill);reject(e);});child.once('close',()=>{clearTimeout(kill);for(const p of pending)try{consume(p);}catch(e){blocked||=e;}resolve();});
  });
  if(plan.some(p=>!fs.existsSync(partPath(p))||fs.statSync(partPath(p)).size!==p.end-p.start+1))blocked||=failure('SEGMENT_INCOMPLETE','本轮下载未完成，已校验的分段全部保留，未自动重复生成');
 }

 if(blocked)throw blocked;
 const buffer=Buffer.concat(plan.map(p=>{const b=fs.readFileSync(partPath(p));if(b.length!==p.end-p.start+1)throw failure('SEGMENT_INCOMPLETE','缺失分段，不交付');return b;}));
 if(buffer.length!==total)throw failure('IMAGE_SIZE_INVALID','拼接总长度不一致');validate(buffer);
 fs.writeFileSync(tmp+'.assembled',buffer,{mode:0o600});fs.renameSync(tmp+'.assembled',tmp);manifest.completed=true;manifest.sha256=crypto.createHash('sha256').update(buffer).digest('hex');save();return buffer;
}
