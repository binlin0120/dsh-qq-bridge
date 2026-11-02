import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {bridgeHarness} from './audit-bridge-harness.mjs';import {requestContext} from '../src/short-chain.mjs';import {imagePollError,mediaFailure} from '../src/photo-delivery.mjs';
const owner='private:12345';const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k3ioAAAAASUVORK5CYII=','base64');
const context=(text,id,origin=owner)=>requestContext({eventId:id,actorQQ:12345,ownerQQ:12345,origin,text});
async function fixture(fn,extra={}){const h=await bridgeHarness({config:{ownerQQ:12345,allow:{private:[12345],groups:[45678]},sendDelayMs:0,draw:{baseUrl:'https://fixture.invalid/v1'}},files:{'state/orchestration-mode.json':{enabled:true,shortChain:true}},...extra});try{h.setMode('closed-agent','dafeiyu');h.setReady(true);await fn(h);}finally{await h.close();}}
const decision=(scene='深秋海报',target='current')=>JSON.stringify({reply:'我来准备',actions:[{type:'media',kind:'photo',scene,target}]});
test('actual poster conversation keeps type and creates only one job on followup',()=>fixture(async h=>{
 h.shortChain.model=async(_p,o)=>o.context.text==='给我看看你画的海报'?JSON.stringify({reply:'我手上没有现成的海报。我现在就能给你画一张，你想什么样子的海报？',actions:[]}):decision('窝在沙发上自拍');
 await h.shortChain.accept(context('给我看看你画的海报','offer'));await h.shortChain.accept(context('你想给我看什么海报都行','accept'));
 const jobs=Object.values(h.mediaJobs.data);assert.equal(jobs.length,1);assert.equal(jobs[0].artifactType,'poster');assert.equal(jobs[0].character,false);assert.match(jobs[0].prompt,/海报/);assert.doesNotMatch(jobs[0].prompt,/不是插画|不加文字|手机生活照片|自拍/);
 await h.shortChain.accept(context('你随便给我来一张','follow'));assert.equal(Object.values(h.mediaJobs.data).length,1);assert.match(h.calls.sent.at(-1).text,/排上/);
}));
test('free choice alone after a genuine poster offer does not require a magic phrase',()=>fixture(async h=>{
 h.shortChain.model=async(_p,o)=>o.context.text==='给我看看你画的海报'?JSON.stringify({reply:'我现在就能给你画一张海报，你说想什么样的？',actions:[]}):decision('晚上窗边自拍');
 await h.shortChain.accept(context('给我看看你画的海报','offer'));await h.shortChain.accept(context('你随便给我来一张','any'));
 const job=Object.values(h.mediaJobs.data)[0];assert.ok(job);assert.equal(job.artifactType,'poster');assert.doesNotMatch(job.prompt,/自拍/);
}));
test('an explicit free-choice poster request does not depend on an unexpired prior offer',()=>fixture(async h=>{
 h.shortChain.model=async()=>decision('窗边自拍');await h.shortChain.accept(context('你想给我看什么海报都行','standalone'));
 const job=Object.values(h.mediaJobs.data)[0];assert.ok(job);assert.equal(job.artifactType,'poster');assert.doesNotMatch(job.prompt,/自拍/);
}));
test('an unresolved genuine poster question survives a maintenance delay in the same conversation',()=>fixture(async h=>{
 h.shortChain.model=async(_p,o)=>o.context.text==='给我看看你画的海报'?JSON.stringify({reply:'我现在就能给你画一张海报，你想什么样子的？',actions:[]}):decision('晚上自拍');
 await h.shortChain.accept(context('给我看看你画的海报','offer'));h.shortChain.clock=()=>Date.now()+2*3600000;
 await h.shortChain.accept(context('你随便给我来一张','later'));const job=Object.values(h.mediaJobs.data)[0];assert.ok(job);assert.equal(job.artifactType,'poster');assert.doesNotMatch(job.prompt,/自拍/);
}));
test('greeting cannot authorize a hallucinated image, even in a picture conversation',()=>fixture(async h=>{
 let calls=0;h.shortChain.model=async()=>++calls===1?decision():JSON.stringify({reply:'在呢',actions:[]});await h.shortChain.accept(context('在吗','greeting'));assert.equal(Object.values(h.mediaJobs.data).length,0);assert.equal(h.calls.sent.at(-1).text,'在呢');
}));
test('a completed image never gets rebound or leaves a fresh request hanging',()=>fixture(async h=>{
 h.shortChain.model=async()=>decision('相同画面的海报');const a=context('画张海报给我看看','first');await h.shortChain.accept(a);const old=Object.values(h.mediaJobs.data)[0];h.mediaJobs.update(old,{status:'completed',doneAt:Date.now(),deliveryMessageId:991});h.shortChain.syncMedia(old);
 const b=context('再画张海报给我看看','new');await h.shortChain.accept(b);await h.shortChain.accept(b);
 const jobs=Object.values(h.mediaJobs.data);assert.equal(jobs.length,2);assert.equal(old.chainRequestId,a.id);assert.equal(jobs[1].chainRequestId,b.id);assert.notEqual(jobs[0].requestKey,jobs[1].requestKey);assert.equal(h.shortChain.record(a.id).status,'completed');
}));
test('owner-private photo request queues the explicit allowed group target',()=>fixture(async h=>{
 const original=h.bot.request.bind(h.bot);h.bot.request=async(a,b)=>a==='get_group_list'?{status:'ok',retcode:0,data:[{group_id:45678}]}:original(a,b);
 h.shortChain.model=async()=>decision('书桌前的照片','group:45678');await h.shortChain.accept(context('拍张照片发到45678群','target'));
 const job=Object.values(h.mediaJobs.data)[0];assert.equal(job.target,'group:45678');assert.equal(job.authorization.actor,'12345');assert.equal(h.groupAuthority.memberCount(12345),0);
}));
test('a fresh one-image request after completion creates new work without requiring the word again',()=>fixture(async h=>{
 h.shortChain.model=async()=>decision('海报作品');const first=context('来张海报给我看看','one');await h.shortChain.accept(first);const job=Object.values(h.mediaJobs.data)[0];h.mediaJobs.update(job,{status:'completed',deliveryMessageId:987,doneAt:Date.now()});h.shortChain.syncMedia(job);
 await h.shortChain.accept(context('来一张海报给我看看','two'));assert.equal(Object.values(h.mediaJobs.data).length,2);assert.equal(job.chainRequestId,first.id);
}));
test('a pending poster does not hijack a separate explicit selfie request',()=>fixture(async h=>{
 h.shortChain.model=async(_p,o)=>decision(o.context.text.includes('自拍')?'窗边自拍':'鲸鱼海报');await h.shortChain.accept(context('画张海报给我看看','poster'));await h.shortChain.accept(context('发张自拍给我看看','photo'));
 const jobs=Object.values(h.mediaJobs.data);assert.equal(jobs.length,2);assert.equal(jobs[0].artifactType,'poster');assert.equal(jobs[1].artifactType,'photo');assert.equal(jobs[1].character,true);
}));
test('unknown group target is not silently redirected or allowed',()=>fixture(async h=>{
 h.shortChain.model=async(_p,o)=>o.stage==='decide'?decision('书桌照片','group:56789'):'这次没能发到那个群';await h.shortChain.accept(context('拍张照片发到56789群','bad-target'));assert.equal(Object.values(h.mediaJobs.data).length,0);
}));
test('viewing a completed image forwards the existing file without generation or rebinding',()=>fixture(async h=>{
 h.shortChain.model=async(_p,o)=>o.stage==='decide'?decision('海报作品'):'原图已经发给你啦';const first=context('画张海报给我看看','create');await h.shortChain.accept(first);const job=Object.values(h.mediaJobs.data)[0];
 const dir=path.join(h.WORKSPACE_ROOT,'画的图');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'existing.png');fs.writeFileSync(file,png);h.mediaJobs.update(job,{status:'completed',file,deliveryMessageId:975,doneAt:Date.now()});h.shortChain.syncMedia(job);
 const view=context('你画的图给我看看','view');await h.shortChain.accept(view);const record=h.shortChain.record(view.id);assert.equal(record.status,'completed');assert.equal(record.receipts[0].reusedOriginal,true);assert.equal(record.receipts[0].newGeneration,false);assert.equal(Object.values(h.mediaJobs.data).length,1);assert.equal(job.chainRequestId,first.id);
}));
test('a missing old image cannot trigger generation or a false successful-send reply',()=>fixture(async h=>{
 h.shortChain.model=async(_p,o)=>o.stage==='decide'?decision('海报作品'):'原图已经发给你啦';await h.shortChain.accept(context('画张海报给我看看','create'));const job=Object.values(h.mediaJobs.data)[0];h.mediaJobs.update(job,{status:'completed',file:path.join(h.WORKSPACE_ROOT,'不存在.png'),deliveryMessageId:976});h.shortChain.syncMedia(job);
 const view=context('你画的图给我看看','view');await h.shortChain.accept(view);assert.equal(Object.values(h.mediaJobs.data).length,1);assert.equal(h.shortChain.record(view.id).status,'failed');assert.doesNotMatch(h.calls.sent.at(-1).text,/已经.*发给你/);
}));
test('poll response classification separates permanent errors from original-task retries',()=>{
 for(const status of [401,403,404,400]){const e=imagePollError(status);assert.equal(e.terminal,true);assert.equal(mediaFailure(e,{taskId:'existing'}).retryable,false);assert.equal(mediaFailure(e,{taskId:'existing'}).status,'failed');}
 for(const status of [408,429,500,503]){const e=imagePollError(status);assert.equal(e.terminal,false);assert.equal(mediaFailure(e,{taskId:'existing'}).retryable,true);}
 assert.equal(mediaFailure({code:'IMAGE_SUBMISSION_UNKNOWN',message:'timeout'},{}).status,'uncertain');
});
test('actual artwork worker has no portrait references and fails fast on 401 without resubmission',async()=>{const counts={submits:0,polls:0,references:0};await fixture(async h=>{
 h.shortChain.model=async()=>decision('鲸鱼课程海报');await h.shortChain.accept(context('画张鲸鱼海报给我看看','art'));const job=Object.values(h.mediaJobs.data)[0];await h.mediaJobs.tick(h.processMediaJob);
 assert.equal(job.status,'failed');assert.equal(job.errorCode,'IMAGE_POLL_AUTH');assert.match(job.error,/401/);assert.equal(job.taskId,'captured');
 await h.mediaJobs.tick(h.processMediaJob);assert.equal(counts.submits,1);assert.equal(counts.polls,1);assert.equal(counts.references,0);
},{globals:{process:{...process,env:{...process.env,IMAGE_API_KEY:'fixture-key'}},preparePhotoReferences:async()=>{counts.references++;throw Error('artwork must not load portraits');},submitImageTask:async({payload,update})=>{counts.submits++;assert.equal(payload.input.images,undefined);update({taskId:'captured',submissionState:'acknowledged'});return 'captured';},fetch:async()=>{counts.polls++;return {ok:false,status:401};}}});});
