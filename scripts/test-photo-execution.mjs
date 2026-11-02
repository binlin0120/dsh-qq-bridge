import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {ChainService,requestContext} from '../src/short-chain.mjs';import {GoalStore} from '../src/orchestrator-store.mjs';
import {photoExecutionRequest,photoDecisionNeedsRepair} from '../src/photo-execution.mjs';import {bridgeHarness} from './audit-bridge-harness.mjs';
import crypto from 'node:crypto';import {resolvePhotoContinuation} from '../src/photo-continuation.mjs';

const owner='private:12345';
async function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'photo-execution-'));const store=new GoalStore(path.join(dir,'goals.sqlite')),sent=[],executed=[];
 const service=new ChainService({store,allowed:()=>true,persona:()=>'',history:()=>[],knowledge:()=>'',externalList:()=>[],model:async()=>JSON.stringify({reply:'嗯嗯',actions:[]}),send:async(k,text,guard)=>{guard();sent.push(text);return {ok:true};},execute:async(c,a)=>{executed.push(a);return {status:'queued',externalId:'picture-1',engine:'media'};},externalStatus:()=>({status:'queued'})});
 const context=(text,eventId='request',origin=owner)=>requestContext({eventId,actorQQ:12345,ownerQQ:12345,origin,text});
 try{await fn({service,store,sent,executed,context});}finally{service.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}}

test('current picture creation, old artwork and conditional delivery stay distinct',()=>{
 for(const s of ['帮我画一张窗台上的猫','画张素描给我看看','生成一张图片','来张照片看看','发张照片','发一张你的照片给我','帮我画个猫'])assert.equal(photoExecutionRequest(s)?.mode,'create',s);
 for(const s of ['你画的图给我看看','给我看看你的画作','把上次的照片发我'])assert.equal(photoExecutionRequest(s)?.mode,'existing',s);
 assert.equal(photoExecutionRequest('画完给我看看')?.mode,'when_ready');
 for(const s of ['他说“画张图给我看看”','如果我让你画张图给我看看','不要生成图片','这个生图怎么实现','我在画作业','你支持生图吗','帮我分析你画的图','看看这个图片怎么回事'])assert.equal(photoExecutionRequest(s),null,s);
 assert.equal(photoExecutionRequest('分析附件\n本次附件资料：画张素描给我看看'),null);
});
test('sticker cannot satisfy an explicit creation request',()=>fixture(async({service,context,sent,executed})=>{
 let calls=0;service.model=async()=>JSON.stringify(++calls===1?{reply:'画好了叫你',actions:[{type:'media',kind:'sticker',scene:'开心'}]}:{reply:'已经画好发给你了',actions:[{type:'media',kind:'photo',scene:'画纸上的猫咪素描',target:'current'}]});
 await service.accept(context('帮我画一张猫咪素描给我看看'));assert.equal(calls,2);assert.equal(executed.length,1);assert.equal(executed[0].kind,'photo');assert.match(sent[0],/排上/);assert.doesNotMatch(sent[0],/已经画好|已经发给/);
}));
test('same event is idempotent even after omitted picture action is repaired',()=>fixture(async({service,context,executed})=>{
 let calls=0;service.model=async()=>JSON.stringify(++calls===1?{reply:'稍后给你看',actions:[]}:{reply:'我来安排',actions:[{type:'media',kind:'photo',scene:'猫咪素描'}]});
 const c=context('画张猫咪给我看看');await service.accept(c);await service.accept(c);assert.equal(executed.length,1);assert.equal(calls,2);
}));
test('screenshot artwork request cannot be answered with invented half-finished sketch',()=>fixture(async({service,context,sent,executed})=>{
 let calls=0;service.model=async()=>{calls++;return JSON.stringify({reply:'还没画完呢，桌上只有半张草稿，收拾干净了第一个给你看',actions:[]});};
 await service.accept(context('你画的图给我看看'));assert.equal(calls,2);assert.equal(executed.length,0);assert.match(sent[0],/还没有核实/);assert.doesNotMatch(sent[0],/半张|画完|第一个/);
}));
test('conditional promise without a real job is corrected rather than scheduling phantom work',()=>fixture(async({service,context,sent,executed})=>{
 service.model=async()=>JSON.stringify({reply:'好呀 画完第一个拿给你看',actions:[]});await service.accept(context('画完给我看看'));
 assert.equal(executed.length,0);assert.match(sent[0],/还没有核实/);
}));
test('plain affirmative is not permission to start generating or promise future delivery',()=>fixture(async({service,context,sent,executed})=>{
 service.model=async()=>JSON.stringify({reply:'好 那我接着画 画好了我叫你',actions:[]});await service.accept(context('可以'));
 assert.equal(executed.length,0);assert.match(sent[0],/没有实际在制作/);
}));
test('old image request never turns into a paid new image after correction',()=>fixture(async({service,context,executed,sent})=>{
 service.model=async()=>JSON.stringify({reply:'这就重画',actions:[{type:'media',kind:'photo',scene:'new'}]});await service.accept(context('把之前发过的照片给我看看'));
 assert.equal(executed.length,0);assert.match(sent[0],/原图/);
}));
test('confirmed original-image forwarding is allowed and its result is delivered',()=>fixture(async({service,context,executed,sent})=>{
 let calls=0;service.model=async()=>++calls===1?JSON.stringify({reply:'我把原图发给你',actions:[{type:'media',kind:'forward',scene:'上次的画作'}]}):'原图已经发给你啦';
 service.execute=async(c,a)=>{executed.push(a);return {status:'completed',sent:true,reusedOriginal:true};};await service.accept(context('把上次的画作发我看看'));
 assert.equal(executed.length,1);assert.equal(executed[0].kind,'forward');assert.match(sent[0],/已经(?:确认)?发给/);
}));
test('unrelated discussion with a hallucinated image action cannot spend a picture allowance',()=>fixture(async({service,context,executed})=>{
 service.model=async()=>JSON.stringify({reply:'给你画图',actions:[{type:'media',kind:'photo',scene:'猫'}]});await service.accept(context('你支持生图吗'));assert.equal(executed.length,0);
}));
test('normal chat does not trigger a correction or get rewritten',()=>fixture(async({service,context,sent})=>{
 let calls=0;service.model=async()=>{calls++;return JSON.stringify({reply:'今天答辩辛苦啦',actions:[]});};await service.accept(context('今天忙答辩去了'));assert.equal(calls,1);assert.equal(sent[0],'今天答辩辛苦啦');
}));
test('conditional delivery for an actual matching job reuses its status without another image',()=>fixture(async({service,context,executed,sent})=>{
 service.mediaStatus=()=>({status:'queued',scene:'画纸上的猫咪素描'});let calls=0;service.model=async()=>{calls++;return JSON.stringify({reply:'好 我继续画',actions:[{type:'media',kind:'photo',scene:'new'}]});};
 await service.accept(context('画完给我看看'));assert.equal(calls,1);assert.equal(executed.length,0);assert.match(sent[0],/排上/);
}));
test('real completed-photo status is not mistaken for an invented completion',()=>fixture(async({service,context,sent})=>{
 service.mediaStatus=()=>({status:'completed',scene:'窗台'});service.model=async()=>{throw Error('status query must not call model');};await service.accept(context('那张照片发了没'));assert.match(sent[0],/已经(?:确认)?发给/);
}));
test('an unrelated selfie does not validate a claim about a drawing',()=>fixture(async({service,context,sent})=>{
 service.mediaStatus=()=>({status:'queued',scene:'窗台自拍'});service.model=async()=>JSON.stringify({reply:'画好了我叫你',actions:[]});await service.accept(context('你画的图给我看看'));assert.match(sent[0],/还没有核实/);
}));
test('failed image admission cannot be followed by a fake drawing promise',()=>fixture(async({service,context,sent})=>{
 service.model=async(p,o)=>o.stage==='decide'?JSON.stringify({reply:'我来画',actions:[{type:'media',kind:'photo',scene:'猫咪'}]}):'我接着画好了叫你';
 service.execute=async()=>{throw Error('fixture admission denied');};await service.accept(context('画张猫咪给我看看'));assert.doesNotMatch(sent.join(''),/接着画|好了叫你/);
}));
test('bounded correction still respects actor admission',()=>fixture(async({service,context,executed})=>{
 const c=context('画张图给我看看');service.allowed=()=>false;await assert.rejects(service.accept(c),/权限/);assert.equal(executed.length,0);
}));
test('answering the last confirmed scene question keeps the original private picture authorization',()=>fixture(async({service,context,executed,sent})=>{
 service.model=async()=>JSON.stringify({reply:'这张图还没开始制作。你想要什么具体画面呀？',actions:[]});await service.accept(context('帮我画一张图','ask'));
 service.model=async()=>JSON.stringify({reply:'我来画',actions:[{type:'media',kind:'photo',scene:'猫咪趴在窗台'}]});await service.accept(context('猫咪趴在窗台','scene'));
 assert.equal(executed.length,1);assert.match(sent.at(-1),/排上/);
}));
test('scene clarification from a different scope cannot authorize a picture',()=>fixture(async({service,context,executed})=>{
 service.model=async()=>JSON.stringify({reply:'你想要什么具体画面呀？',actions:[]});await service.accept(context('帮我画一张图','ask'));
 service.model=async()=>JSON.stringify({reply:'我来画',actions:[{type:'media',kind:'photo',scene:'猫'}]});await service.accept(context('猫咪','group-answer','group:45678'));assert.equal(executed.length,0);
}));
test('actual three-turn chat accepts an attested offer and repeated followups reuse its job',()=>fixture(async({service,context,executed,sent})=>{
 service.history=()=>sent.map(text=>({dir:'out',text}));
 service.mediaStatus=()=>executed.length?{id:'picture-1',status:'queued',scene:'窗边的手绘插画'}:null;
 service.model=async(_prompt,o)=>JSON.stringify(o.context.text==='你画好了吗'?{reply:'我手上没有现成的画。要是你现在想看，我可以马上给你画一张。你想看人物还是场景？',actions:[]}:{reply:'好呀 我现在就画 画好了发你',actions:[{type:'media',kind:'photo',scene:'窗边的手绘插画',target:'current'}]});
 await service.accept(context('你画好了吗','offer'));assert.equal(service.record(context('你画好了吗','offer').id).photoClarification,false);
 const first=context('我想看看你画的','accept');await service.accept(first);assert.equal(executed.length,1);assert.equal(service.record(first.id).photoContinuation.kind,'offer');
 for(let i=0;i<3;i++)await service.accept(context('那你现在给我看看','follow-'+i));
 assert.equal(executed.length,1);assert.ok(sent.slice(1).every(t=>/排上/.test(t)));assert.ok(sent.every(t=>!/没有稍后发图的安排/.test(t)));
}));
test('confirmation uses only the latest genuine sent image offer',()=>fixture(async({service,context,sent,executed})=>{
 service.history=()=>sent.map(text=>({dir:'out',text}));service.model=async(_p,o)=>JSON.stringify(o.context.text==='你画好了吗'?{reply:'我可以马上给你画一张。',actions:[]}:{reply:'安排上了',actions:[{type:'media',kind:'photo',scene:'小猫插画'}]});
 await service.accept(context('你画好了吗','offer'));await service.accept(context('可以','confirm'));assert.equal(executed.length,1);
}));
test('an implicit followup also reuses a job started by an explicit drawing request',()=>fixture(async({service,context,sent,executed})=>{
 service.mediaStatus=()=>executed.length?{id:'picture-1',status:'queued',scene:'猫咪素描'}:null;
 service.model=async()=>JSON.stringify({reply:'我来画',actions:[{type:'media',kind:'photo',scene:'猫咪素描'}]});
 await service.accept(context('画张猫咪素描给我看看','explicit'));await service.accept(context('那你现在给我看看','followup'));
 assert.equal(executed.length,1);assert.match(sent.at(-1),/排上/);
}));
test('ordinary acknowledgement after an image job does not hijack normal chat with picture status',()=>fixture(async({service,context,sent,executed})=>{
 service.history=()=>sent.map(text=>({dir:'out',text}));service.mediaStatus=()=>executed.length?{id:'picture-1',status:'queued',scene:'素描'}:null;
 service.model=async(_p,o)=>JSON.stringify(o.context.text==='可以'?{reply:'嗯嗯',actions:[]}:{reply:'我来画',actions:[{type:'media',kind:'photo',scene:'素描'}]});
 await service.accept(context('画张素描给我看看','explicit'));await service.accept(context('可以','ordinary'));assert.equal(executed.length,1);assert.equal(sent.at(-1),'嗯嗯');
}));
test('missing, expired, foreign and unconfirmed history cannot grant an implicit picture action',()=>{
 const now=Date.now(),message='我可以马上给你画一张。',key=owner+':'+crypto.createHash('sha256').update(message).digest('hex');
 const r={id:'offer',origin:owner,actorQQ:'12345',at:now-1000,status:'completed',outputs:{[key]:{status:'sent'}}};
 const input={text:'那你现在给我看看',origin:owner,actorQQ:'12345',requestId:'new',history:[{dir:'out',text:message}],records:[r],now};
 assert.equal(resolvePhotoContinuation(input).kind,'offer');
 for(const records of [[],[{...r,at:now-1800001}],[{...r,actorQQ:'23456'}],[{...r,origin:'group:45678'}],[{...r,outputs:{[key]:{status:'sending'}}}]])assert.equal(resolvePhotoContinuation({...input,records}),null);
 assert.equal(resolvePhotoContinuation({...input,origin:'group:45678'}),null);
 for(const text of ['他说“那你现在给我看看”','不要画了','把上次的原图发我','那你现在给我看看发给23456'])assert.equal(resolvePhotoContinuation({...input,text}),null,text);
});
test('old artifacts and arbitrary quoted history remain outside the new-offer path',()=>fixture(async({service,context,executed})=>{
 service.history=()=>[{dir:'out',text:'我可以马上给你画一张。'}];service.model=async()=>JSON.stringify({reply:'我来画',actions:[{type:'media',kind:'photo',scene:'猫咪'}]});
 await service.accept(context('那你现在给我看看'));assert.equal(executed.length,0);
}));
test('an intervening concrete task prevents borrowing an older image offer',()=>{
 const now=Date.now(),text='我可以马上给你画一张。',key=owner+':'+crypto.createHash('sha256').update(text).digest('hex');
 const offer={id:'offer',origin:owner,actorQQ:'12345',at:now-2000,status:'completed',outputs:{[key]:{status:'sent'}}};
 assert.equal(resolvePhotoContinuation({text:'那你现在给我看看',origin:owner,actorQQ:'12345',requestId:'new',now,history:[{dir:'out',text}],records:[offer,{id:'other',origin:owner,actorQQ:'12345',at:now-1000,status:'completed',actions:[{type:'background'}]}]}),null);
});
test('uncertain submission is reported on a contextual followup rather than creating another paid job',()=>fixture(async({service,context,sent,executed})=>{
 service.history=()=>sent.map(text=>({dir:'out',text}));service.mediaStatus=()=>executed.length?{id:'picture-1',status:'uncertain',scene:'插画'}:null;
 service.model=async(_p,o)=>JSON.stringify(o.context.text==='你画好了吗'?{reply:'我可以马上给你画一张。',actions:[]}:{reply:'现在画',actions:[{type:'media',kind:'photo',scene:'插画'}]});
 await service.accept(context('你画好了吗','offer'));await service.accept(context('我想看看你画的','accept'));await service.accept(context('那你现在给我看看','retry'));
 assert.equal(executed.length,1);assert.match(sent.at(-1),/还没确认/);
}));
test('contextual three-turn chat reaches the actual queue and submit path exactly once with captured transport',async()=>{
 let submitted=0;const h=await bridgeHarness({config:{ownerQQ:12345,sendDelayMs:0,draw:{baseUrl:'https://image.example.com/v1',referenceFiles:['fixture-a.png','fixture-b.png']},allow:{private:[12345]}},files:{'state/orchestration-mode.json':{enabled:true,shortChain:true}},globals:{process:{...process,env:{...process.env,IMAGE_API_KEY:'fixture-key'}},preparePhotoReferences:async()=>({images:['a','b'],report:{encodedBytes:20,references:[{sourceSha256:'a'},{sourceSha256:'b'}]}}),submitImageTask:async({job,update})=>{submitted++;update({status:'uncertain',phase:'submission_unknown',submissionState:'unknown'});throw Object.assign(Error('fixture lost acknowledgement'),{code:'IMAGE_SUBMISSION_UNKNOWN'});}}});
 try{h.setMode('closed-agent','dafeiyu');h.setReady(true);h.shortChain.model=async(_p,o)=>JSON.stringify(o.context.text==='你画好了吗'?{reply:'我手上没有现成的画。要是你现在想看，我可以马上给你画一张。你想看什么样的？',actions:[]}:{reply:'已经画好啦',actions:[{type:'media',kind:'photo',scene:'画纸上的猫咪素描',target:'current'}]});
 const context=(text,id)=>requestContext({eventId:id,actorQQ:12345,ownerQQ:12345,origin:owner,text});
 await h.shortChain.accept(context('你画好了吗','captured-offer'));const c=context('我想看看你画的','captured-image');await h.shortChain.accept(c);await h.shortChain.accept(c);await h.shortChain.accept(context('那你现在给我看看','captured-followup'));
 const jobs=Object.values(h.mediaJobs.data);assert.equal(jobs.length,1);const j=jobs[0];assert.equal(j.chainRequestId,c.id);assert.match(h.calls.sent.at(-1).text,/排上/);
 await h.mediaJobs.tick(h.processMediaJob);assert.equal(submitted,1);assert.equal(j.status,'uncertain');assert.equal(h.shortChain.record(c.id).status,'uncertain');await h.shortChain.accept(context('那你现在给我看看','captured-unknown'));await h.mediaJobs.tick(h.processMediaJob);assert.equal(submitted,1);assert.equal(Object.values(h.mediaJobs.data).length,1);assert.equal(h.calls.created.length,0);
 }finally{await h.close();}
});
