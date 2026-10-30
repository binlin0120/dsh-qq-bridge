import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {safeFetchBytes} from '../src/safe-fetch.js';

async function harness(fn) {
 const h=await bridgeHarness({config:{ownerQQ:12345,allow:{private:[12345,23456],groups:[]},guestPhotos:{enabled:true},draw:{model:'chosen-image',imageSize:'2K',dailyLimit:8},quietHours:{from:23,to:8}}});
 try {h.setMode('closed-agent');h.setPresets(['standard','dafeiyu','jingjing-guest','jingjing-memo']);await fn(h);} finally {await h.close();}
}
test('bridge loads actual draw configuration and quota',()=>harness(async h=>{
 assert.equal(h.cfg.draw.model,'chosen-image');assert.equal(h.cfg.draw.imageSize,'2K');assert.equal(h.cfg.draw.dailyLimit,8);
}));
test('owner memory rejection never advances cursor or overwrites files',()=>harness(async h=>{
 for(let i=0;i<100;i++)h.noteOwnerChat('in','测试记忆 '+i);
 const before=h.ownerMemory.consolidatedUpTo||0;
 h.testMemo(new Error('simulated model failure'));await h.maybeConsolidateMemory({force:true});assert.equal(h.ownerMemory.consolidatedUpTo||0,before);
}));
test('owner memory commits sourced increments without replacing the core book',()=>harness(async h=>{
 h.noteOwnerChat('in','我喜欢短句');const before=h.memoryBook.raw();const source=h.memoryStore.pending('private:12345')[0];
 h.testMemo(JSON.stringify({episodes:[],core:[{text:'偏好短句',sourceIds:[source.id]}]}));
 const result=await h.maybeConsolidateMemory({force:true});assert.equal(result.ok,true,result.error);assert.ok(h.ownerMemory.cursorSeq>0);assert.equal(h.memoryBook.raw(),before);assert.equal(h.memoryStore.pending('private:12345').length,0);
}));

test('weekly model failure has a future retry instead of permanent tried flag',()=>harness(async h=>{
 h.ownerMemory.diaryTried='2026-10-12';await h.maybeWriteDiary();assert.ok(h.ownerMemory.diaryRetryAt>Date.now());
}));
test('truncated image is rejected and complete 1px PNG is accepted',()=>harness(async h=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k3ioAAAAASUVORK5CYII=','base64');
 assert.doesNotThrow(()=>h.validateImage(png));assert.throws(()=>h.validateImage(png.subarray(0,35)));
}));
test('guest action creates a self-targeted job and never grants tools',()=>harness(async h=>{
 const result=await h.handleGuestPhoto('private:23456','【发照片：书桌前画海报】');assert.ok(result.length>0);
 const j=Object.values(h.mediaJobs.data)[0];assert.equal(j.target,'private:23456');assert.equal(j.status,'queued');
 await h.handleGuestPhoto('private:23456','【发照片：书桌前画海报】');assert.equal(Object.keys(h.mediaJobs.data).length,1);
}));
test('private owner file cannot be exported to another user',()=>harness(async h=>{
 assert.throws(()=>h.outTarget('private:99999'));
 assert.equal(Object.values(h.mediaJobs.data).length,0);
}));
async function api(h,fn) {
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 const call=(route,body)=>new Promise((resolve,reject)=>{
   const req=http.request({host:'127.0.0.1',port:server.address().port,path:route,method:body?'POST':'GET',headers:{'x-console-token':'fixture-console-token','content-type':'application/json'}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();
 });
 try{await fn(call);}finally{await new Promise(r=>server.close(r));}
}
test('real bridge approval endpoint refuses unrelated replies and accepts QQ 同意',()=>harness(async h=>{
 h.qqRequests.push({flag:'req-one',type:'friend',userId:'23456',at:Date.now()-1000,notifiedAt:Date.now()-500});
 await api(h,async call=>{
  assert.equal((await call('/api/qq/requests/handle',{flag:'req-one',approve:true})).status,409);
  h.api.sessions.prompt=async()=>({result:{ok:true,value:{}}});
  await h.handleIncoming('private',12345,{user_id:12345,self_id:99999,message_id:'1',message:[{type:'text',data:{text:'同意'}}],sender:{nickname:'owner'}},h.cfg);
  assert.equal(h.qqRequests[0].decision.approve,true);
  assert.equal((await call('/api/qq/requests/handle',{flag:'req-one',approve:true})).status,200);
  const repeated=await call('/api/qq/requests/handle',{flag:'req-one',approve:true});assert.equal(repeated.status,200);assert.equal(repeated.body.alreadyHandled,true);
 });
}));
test('jobs API reports accepted as queued, not falsely delivered',()=>harness(async h=>api(h,async call=>{
 const r=await call('/api/qq/draw',{prompt:'test drawing',sendTo:'private:12345'});
 assert.equal(r.status,200);assert.equal(r.body.sent,false);assert.ok(r.body.jobId);assert.equal(Object.values(h.mediaJobs.data)[0].status,'queued');
 const again=await call('/api/qq/draw',{prompt:'test drawing',sendTo:'private:12345'});assert.equal(again.body.jobId,r.body.jobId);assert.equal(h.dailyQuota.count('draw'),1);
})));
test('special QQ face ZIP is read in memory and extracts a supported image',async()=>{
 const py=process.platform==='win32'?'python':'python3';
 const zip=execFileSync(py,['-c',"import zipfile,io,sys,base64; b=io.BytesIO();z=zipfile.ZipFile(b,'w');z.writestr('assets/face.png',base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k3ioAAAAASUVORK5CYII='));z.close();sys.stdout.buffer.write(b.getvalue())"]);
 const h=await bridgeHarness({globals:{execFileSync}});
 try{assert.equal(h.extractFaceImage(zip).subarray(1,4).toString(),'PNG');assert.throws(()=>h.extractFaceImage(Buffer.from('not a zip')));}finally{await h.close();}
});
test('generic safe byte download still rejects local/private addresses',async()=>{
 await assert.rejects(safeFetchBytes('http://127.0.0.1/private.pdf'),/内网|本机/);
});
test('incoming owner PDF uses bounded binary download without image-only rejection',async()=>{
 const h=await bridgeHarness({config:{ownerQQ:12345},globals:{safeFetchBytes:async()=>({buffer:Buffer.from('%PDF-test')})}});
 try{const note=await h.buildInboundNote('private:12345','private',12345,{message:[{type:'file',data:{name:'test.pdf',url:'https://public.invalid/file'}}]});assert.match(note,/已存到/);assert.equal(fs.readFileSync(path.join(h.temp,'workspace','收到的文件',new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),'test.pdf'),'utf8'),'%PDF-test');const inputs=Object.values(h.work.files);assert.equal(inputs.length,1);assert.equal(inputs[0].key,'private:12345');assert.match(note,/隔离工作文件/);assert.equal(fs.readFileSync(inputs[0].path,'utf8'),'%PDF-test');assert.notEqual(path.dirname(inputs[0].path),path.join(h.temp,'workspace','收到的文件',new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})));}finally{await h.close();}
});
test('registered reminder is sent once by bridge and records delivery separately',()=>harness(async h=>{
 const original=h.bot.sendPrivateMessage.bind(h.bot);h.bot.sendPrivateMessage=async(...args)=>{await original(...args);return {message_id:42};};
 h.reminderPermits.fixture={at:Date.now()-10,status:'pending',text:'测试喝水',used:false};
 await h.tickReminders();await h.tickReminders();
 assert.equal(h.reminderPermits.fixture.status,'sent');assert.equal(h.calls.sent.length,1);assert.match(h.calls.sent[0].text,/⏰ 测试喝水/);
}));
