import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import {execFile} from 'node:child_process';
import {selectUploadRoute} from './image-upload-routes.mjs';

export function photoStatusQuestion(text){
 const t=String(text).trim();
 if(/重拍|重新拍|再拍|重发|重新发|再发|停止|取消|别发|不用发|帮我|发到|发给.*(?:群|别人)/.test(t))return false;
 return /^(?:怎么|为什么|为啥)(?:还|又|一直)?没(?:有)?(?:发|传)(?:成功|出来|过来|给我|出|好)?[呀啊呢吗嘛？?！!。\s]*$/.test(t)||/(?:照片|图片|那张|这张).{0,12}(?:怎么|为什么|为啥|到哪|发了没|好了吗|发出来了吗|没发成功|没发出来|没收到)/.test(t);
}
export function photoPublicReply(j){
 if(j.status==='completed')return '那张照片已经发给你啦。';
 if(j.status==='cancelled'||j.chainCancelled)return '好啦，那张照片就先不发了。';
 if(j.phase==='submission_unknown'||j.submissionState==='unknown'||j.status==='uncertain'&&!j.taskId&&!j.file&&!j.resultUrl)return '刚才那张照片还没拿到，等了一会儿就断了，所以没能发给你。';
 if(j.status==='sending'||j.phase==='delivery_unknown')return '那张照片刚才没发顺，我这边还没收到发成功的消息。';
 if(j.file)return '照片已经好了，还没发到你那边。';
 if(j.resultUrl)return '那张照片还没完整传过来，所以暂时没能发给你。';
 if(j.status==='failed')return '那张照片刚才没弄好，还没能发给你。';
 return '照片还没好呢，还得等一小会儿。';
}
export function conversationalFailure(){return '刚才卡了一下，没能接上你的话。我在呢。';}
export function mediaFailure(error,j){
 const code=error.code||'';
 if(code==='IMAGE_UPLOAD_ROUTE_UNAVAILABLE')return {status:'queued',phase:'upload_route_wait',retryable:true,code};
 if(j.chainCancelled||code==='MEDIA_CANCELLED')return {status:'cancelled',phase:'cancelled',retryable:false,code:'MEDIA_CANCELLED'};
 if(code==='IMAGE_SUBMISSION_UNKNOWN'||j.submissionState==='unknown')return {status:'uncertain',phase:'submission_unknown',retryable:false,code:'IMAGE_SUBMISSION_UNKNOWN'};
 if(j.status==='sending'||j.phase==='delivery_unknown')return {status:'uncertain',phase:'delivery_unknown',retryable:false,code:'IMAGE_DELIVERY_UNKNOWN'};
 if(code==='IMAGE_GENERATION_FAILED'||code==='IMAGE_SUBMIT_REJECTED'||code==='IMAGE_REFERENCE_INVALID'||code==='IMAGE_NOT_FOUND'||/HTTP 40[034]/.test(error.message))return {status:'failed',phase:j.phase||'failed',retryable:false,code:code||'IMAGE_REQUEST_REJECTED'};
 const network=/TRANSPORT_NO_RESPONSE|DOWNLOAD_BUDGET_EXHAUSTED|IMAGE_SERVER_UNAVAILABLE|IMAGE_POLL_PENDING/.test(code)||/下载画好的图失败|保留.*断点|fetch failed|超时|timeout|timed out|ECONN|ETIMEDOUT|aborted/i.test(error.message);
 if((j.taskId||j.resultUrl)&&network)return {status:'queued',phase:j.resultUrl?'retry_wait':'poll_wait',retryable:true,code:code||'IMAGE_TRANSPORT_RETRY'};
 return {status:j.taskId||j.resultUrl?'failed':'uncertain',phase:j.phase||'failed',retryable:false,code:code||'IMAGE_FAILED'};
}
export async function preparePhotoReferences({files,cacheDir,scriptPath,validate,run}={}){
 const execute=run||((args)=>new Promise((resolve,reject)=>execFile('python3',[scriptPath,JSON.stringify(args)],{timeout:30000,maxBuffer:64000},(e,out)=>e?reject(Object.assign(Error('角色照片参考准备失败'),{code:'IMAGE_REFERENCE_INVALID'})):resolve(out))));
 const report=JSON.parse(await execute({files,cacheDir}));
 const images=report.references.map(r=>{const actual=fs.realpathSync(r.file);if(!actual.startsWith(fs.realpathSync(cacheDir)+path.sep))throw Error('Reference cache path invalid');const b=fs.readFileSync(actual);if(b.length>768*1024||crypto.createHash('sha256').update(b).digest('hex')!==r.sha256)throw Error('Reference cache integrity check failed');validate?.(b);return 'data:image/jpeg;base64,'+b.toString('base64');});
 if(images.length!==2||images.reduce((n,x)=>n+x.length,0)>513*1024)throw Object.assign(Error('角色照片参考超过上传预算'),{code:'IMAGE_REFERENCE_INVALID'});
 return {images,report};
}
export async function submitImageTask({url,key,payload,job={},update=()=>{},transport=https.request,clock=Date.now,limits={},routeStateFile,routeSelector=selectUploadRoute,log=()=>{}}){
 if(job.taskId)return job.taskId;
 if(['request_sent','unknown','acknowledged'].includes(job.submissionState)||job.status==='uncertain')throw Object.assign(Error('原生图提交结果待核实'),{code:'IMAGE_SUBMISSION_UNKNOWN'});
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('Invalid image submit URL');
 const body=Buffer.from(JSON.stringify(payload));if(body.length>3*1024*1024)throw Object.assign(Error('角色照片请求超过上传预算'),{code:'IMAGE_REFERENCE_INVALID'});
 const save=fields=>{Object.assign(job,fields);update(fields);};
 const route=routeStateFile?await routeSelector({url,stateFile:routeStateFile,bodyBytes:body.length,log}):null;
 if(route)save({uploadIp:route.ip,uploadRouteMeasured:route.measured,uploadRouteCached:route.cached});
 save({status:'submitting',phase:'submitting',submissionState:'request_sent',submissionId:job.submissionId||crypto.randomUUID(),submittedAt:clock(),submitBodyBytes:body.length,submitBodySha256:crypto.createHash('sha256').update(body).digest('hex')});
 return new Promise((resolve,reject)=>{
  let req,ended=false;const timers=new Map();
  const clear=()=>{for(const t of timers.values())clearTimeout(t);};
  const fail=(e,unknown=true)=>{if(ended)return;ended=true;clear();save({status:unknown?'uncertain':'failed',phase:unknown?'submission_unknown':'submission_rejected',submissionState:unknown?'unknown':'rejected',submitEndedAt:clock()});req?.destroy();reject(Object.assign(Error(e.message),{code:unknown?'IMAGE_SUBMISSION_UNKNOWN':'IMAGE_SUBMIT_REJECTED',cause:e}));};
  const timer=(name,ms)=>{clearTimeout(timers.get(name));timers.set(name,setTimeout(()=>fail(Error('图片提交 '+name+' timeout')),ms));};
  timer('connect',limits.connectMs??12000);timer('total',limits.totalMs??150000);
  try{
   req=transport(u,{method:'POST',...(route?{family:4,servername:u.hostname,lookup:(_host,opts,cb)=>cb(null,...(opts?.all?[[{address:route.ip,family:4}]]:[route.ip,4]))}:{}),headers:{authorization:'Bearer '+key,'content-type':'application/json','content-length':body.length,'x-client-request-id':job.submissionId}},res=>{
    if(ended){res.destroy();return;}clearTimeout(timers.get('response'));save({submitHeadersAt:clock(),submitHttpStatus:res.statusCode});let size=0;const chunks=[];
    res.on('data',b=>{size+=b.length;if(size>1024*1024){fail(Error('图片提交响应超过限制'));res.destroy();}else chunks.push(b);});
    res.on('error',e=>fail(e));res.on('aborted',()=>fail(Error('图片提交响应中断')));
    res.on('end',()=>{if(ended)return;const status=res.statusCode||0;if(status<200||status>=300){fail(Error('画图提交被拒 HTTP '+status),status>=500||status===0);return;}let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{fail(Error('图片提交响应无效'));return;}const tid=data.task_id||data.id;if(typeof tid!=='string'||!tid){fail(Error('提交响应缺少任务号'));return;}ended=true;clear();try{save({taskId:tid,status:'running',phase:'polling',submissionState:'acknowledged',submitEndedAt:clock()});resolve(tid);}catch(e){reject(e);}});
   });
   req.on('socket',socket=>{const connected=()=>{if(ended)return;clearTimeout(timers.get('connect'));save({submitConnectedAt:clock()});if(!job.submitUploadedAt)timer('upload',limits.uploadMs??90000);};if(socket.connecting)socket.once('secureConnect',connected);else connected();});
   req.once('finish',()=>{if(ended)return;clearTimeout(timers.get('upload'));save({submitUploadedAt:clock()});timer('response',limits.responseMs??90000);});
   req.on('error',e=>fail(e));req.end(body);
  }catch(e){fail(e);}
 });
}
