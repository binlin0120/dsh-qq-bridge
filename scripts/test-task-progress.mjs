import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {TaskProgress,progressBlock,withoutProgress} from '../src/task-progress.mjs';
import {bridgeHarness} from './audit-bridge-harness.mjs';
const event=(text,id='m1',uid=12345)=>({message_id:id,user_id:uid,self_id:99999,sender:{nickname:'owner'},message:[{type:'text',data:{text}}]});
const fixture=async fn=>{const h=await bridgeHarness({config:{ownerQQ:12345,sendDelayMs:0,allow:{private:[12345,23456],groups:[45678]}}});try{h.setMode('closed-agent');h.setPresets(['dafeiyu','jingjing-guest','jingjing-memo','jingjing-worker','jingjing-owner-chat']);await fn(h);}finally{await h.close();}};
const settle=()=>new Promise(r=>setTimeout(r,30));
test('durable progress has timed acknowledgement, throttling, dedup, no recipient crossover',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'progress-test-'));let now=100000;const sent=[];
 try{const t=new TaskProgress(path.join(dir,'tasks.json'),{render:async(j,facts)=>JSON.stringify(facts),clock:()=>now,allowed:j=>j.key==='private:1',send:async(k,text)=>sent.push([k,text])});const j=t.create('private:1','检查下载',{progressPolicy:'automatic'});const denied=t.create('private:2','other');
 await t.tick();assert.equal(sent.length,0);now+=3001;t.update(j,{authoredProgress:'已核对连接'});await t.tick();assert.equal(sent.length,1);await t.notify(j,'刚返回结果');assert.equal(sent.length,1);now+=45001;t.update(j,{authoredProgress:'已核对连接，正在检查续传'});await t.tick();assert.equal(sent.length,2);await t.notify(j,sent.at(-1)[1],{force:true,authored:true});assert.equal(sent.length,2);assert.equal(denied.seq,0);
 const restored=new TaskProgress(t.file,{allowed:()=>true,send:async()=>{}});assert.equal(restored.data[j.id].status,'interrupted');assert.match(restored.data[j.id].blocked,/不自动重复/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('failed delivery does not advance progress receipt',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'progress-fail-'));try{const t=new TaskProgress(path.join(dir,'state.json'),{render:async(j,facts)=>JSON.stringify(facts),allowed:()=>true,send:async()=>{throw Error('offline');}});const j=t.create('private:1','task',{progressPolicy:'automatic'});await assert.rejects(t.notify(j,'update',{force:true}));assert.equal(j.seq,0);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('progress markers are separated from final text',()=>{assert.equal(progressBlock('【进度：已读日志；下一步查连接】'),'已读日志；下一步查连接');assert.equal(withoutProgress('【进度：已读日志】\n最终结果'),'最终结果');});
test('owner long task executes in independent session and normal chat still reaches chat session',()=>fixture(async h=>{
 await h.handleIncoming('private',12345,event('检查下载链路为什么这么慢'),h.cfg);await settle();
 const j=h.taskProgress.list('private:12345')[0];assert.ok(j.sessionId);assert.notEqual(h.state.sessions['private:12345'],j.sessionId);assert.ok(h.calls.prompts.some(p=>p.sessionId===j.sessionId));
 h.taskEvent(j.sessionId,{type:'turn/start',data:{turn:1}});
 h.taskEvent(j.sessionId,{type:'tool/call',data:{turn:1,name:'bash',callId:'x'}});
 h.taskEvent(j.sessionId,{type:'tool/result',data:{turn:1,message:{source:{callId:'x'},content:[{type:'text',text:'raw secret result must not be forwarded'}]}}});
 await h.handleIncoming('private',12345,event('进度呢','progress'),h.cfg);assert.match(JSON.stringify(h.calls.sent),/工具已返回/);assert.doesNotMatch(JSON.stringify(h.calls.sent),/raw secret/);
 await h.handleIncoming('private',12345,event('晚上好','chat'),h.cfg);assert.ok(h.state.sessions['private:12345']);assert.notEqual(h.state.sessions['private:12345'],j.sessionId);assert.equal(h.calls.prompts.at(-1).sessionId,h.state.sessions['private:12345']);
 h.taskEvent(j.sessionId,{type:'assistant/message',data:{turn:1,message:{content:[{type:'text',text:'【进度：已检查连接；还需核对续传】\n下载受阻，未完成。'}]}}});
 h.taskEvent(j.sessionId,{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}});await settle();assert.equal(j.status,'completed');assert.match(j.result,/未完成/);assert.doesNotMatch(j.result,/【进度/);
}));
test('duplicate QQ event does not create a duplicate paid or host task',()=>fixture(async h=>{
 await Promise.all([h.handleIncoming('private',12345,event('检查服务器日志','same'),h.cfg),h.handleIncoming('private',12345,event('检查服务器日志','same'),h.cfg)]);await settle();assert.equal(h.taskProgress.list('private:12345').length,1);
}));
test('group members and admins never acquire owner host background capability',()=>fixture(async h=>{
 await assert.rejects(h.launchOwnerTask('private:23456','读取文件','读取文件'),/owner/);
 await assert.rejects(h.launchOwnerTask('group:45678','运行命令','运行命令'),/owner/);assert.equal(Object.keys(h.taskProgress.data).length,0);
}));
test('stop requests actual DSH cancellation and prevents next execution until turn end',()=>fixture(async h=>{
 await h.launchOwnerTask('private:12345','检查日志','检查日志');await settle();const j=h.taskProgress.current('private:12345');
 await h.handleTaskControl('private:12345','先停下');assert.equal(j.status,'stopping');assert.ok(h.calls.cancelled.includes(j.sessionId));
 h.taskEvent(j.sessionId,{type:'turn/start',data:{turn:1}});h.taskProgress.update(j,{status:'stopping'});h.taskEvent(j.sessionId,{type:'turn/end',data:{turn:1,reason:{kind:'cancelled'}}});await settle();assert.equal(j.status,'cancelled');
}));
test('file question waits for this attachment rather than computing an old document',()=>fixture(async h=>{
 await h.handleIncoming('private',12345,event('这篇word显示多少字','words'),h.cfg);assert.equal(h.calls.prompts.length,0);assert.ok(h.pendingFileQuestions.has('private:12345'));assert.match(JSON.stringify(h.calls.sent),/文件版本/);
}));
test('main-session tool work also allows an isolated safe chat reply',()=>fixture(async h=>{
 await h.ensureSession('private:12345');const sid=h.state.sessions['private:12345'];
 const j=h.taskProgress.create('private:12345','主会话工具',{sessionId:sid,status:'running',kind:'chat_tools'});h.turnProgress.set(sid,j);
 await h.handleIncoming('private',12345,event('你还在吗','while-busy'),h.cfg);
 const side=h.taskProgress.list('private:12345').find(x=>x.kind==='side_chat');assert.ok(side?.sessionId);assert.notEqual(side.sessionId,sid);assert.equal(h.calls.created.at(-1).agentPreset,'jingjing-owner-chat');assert.equal(h.taskProgress.current('private:12345').id,j.id);
}));
test('new host work queues behind the running task instead of racing on files',()=>fixture(async h=>{
 await h.launchOwnerTask('private:12345','检查文件甲','检查文件甲');await settle();const first=h.taskProgress.current('private:12345');
 await h.launchOwnerTask('private:12345','修改文件乙','修改文件乙');await settle();const queued=h.taskProgress.list('private:12345').find(x=>x.id!==first.id);assert.equal(queued.status,'queued');assert.equal(queued.sessionId,undefined);
 h.taskEvent(first.sessionId,{type:'turn/start',data:{turn:1}});h.taskEvent(first.sessionId,{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}});await settle();await h.pumpOwnerTasks();assert.ok(queued.sessionId);assert.notEqual(queued.sessionId,first.sessionId);
}));
test('scope change requests cancellation and preserves the new constraint for continuation',()=>fixture(async h=>{
 await h.launchOwnerTask('private:12345','修改文件','修改文件');await settle();const j=h.taskProgress.current('private:12345');
 await h.handleTaskControl('private:12345','只检查，别修改');assert.equal(j.constraint,'只检查，别修改');assert.equal(j.status,'stopping');assert.ok(h.calls.cancelled.includes(j.sessionId));
 h.taskEvent(j.sessionId,{type:'turn/start',data:{turn:1}});assert.equal(j.status,'stopping');h.taskEvent(j.sessionId,{type:'turn/end',data:{turn:1,reason:{kind:'cancelled'}}});await settle();
 await h.handleTaskControl('private:12345','继续任务');await settle();assert.match(h.taskProgress.current('private:12345').prompt,/只检查，别修改/);assert.match(h.taskProgress.current('private:12345').prompt,/不得重复/);
}));
test('task file delivery uses export copies, verifies send, and does not duplicate receipt',()=>fixture(async h=>{
 let sends=0;const request=h.bot.request.bind(h.bot);h.bot.request=async(action,body)=>{if(action==='upload_private_file')sends++;return request(action,body);};
 const out=path.join(h.temp,'workspace','对外导出');fs.mkdirSync(out,{recursive:true});const filename=path.join(out,'result.csv');fs.writeFileSync(filename,'name,amount\na,1\n');
 const j=h.taskProgress.create('private:12345','处理文件',{status:'completed'});await h.deliverTaskResult(j,'处理完成。【交付文件：'+filename+'】');
 assert.equal(sends,1);assert.match(j.deliveries[filename],/已发送/);await h.deliverTaskResult(j,'处理完成。【交付文件：'+filename+'】');assert.equal(sends,1);assert.ok(j.resultDeliveredAt);
 const privateFile=path.join(h.temp,'workspace','private.csv');fs.writeFileSync(privateFile,'private');await assert.rejects(h.deliverTaskResult(j,'【交付文件：'+privateFile+'】'),/对外导出/);
}));
test('background questions use an explicit answer prefix so normal chat is not swallowed',()=>fixture(async h=>{
 await h.launchOwnerTask('private:12345','检查日志','检查日志');await settle();const j=h.taskProgress.current('private:12345');
 await h.handleTaskRequest({type:'question/requested',sessionId:j.sessionId,clientId:'client',eventId:'request',questions:[{id:'q',question:'选哪个范围？',options:[{label:'今天'},{label:'全部'}]}]});assert.ok(j.pendingRequest);
 assert.equal(await h.handleTaskControl('private:12345','晚上好'),false);assert.ok(j.pendingRequest);assert.equal(await h.handleTaskControl('private:12345','任务回答：今天'),true);assert.equal(j.pendingRequest,null);
}));
test('daily photo status uses character voice without exposing generation or inventing delivery',()=>fixture(async h=>{
 for(const photo of [{status:'queued'},{status:'running'},{status:'failed',resultUrl:'https://example.com/photo'},{status:'failed',file:'ready.png'},{status:'sending'},{status:'uncertain'},{status:'completed'}]){
  const text=h.photoStatusReply(photo);assert.doesNotMatch(text,/生成|生图|上游|模型|接口|下载|failed|running/);if(photo.status!=='completed')assert.doesNotMatch(text,/已经发给你/);
 }
 await h.handleTaskControl('private:12345','进度呢');
}));
