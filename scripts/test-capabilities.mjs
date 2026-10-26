import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {CapabilityState,WorkService,validQQ} from '../src/capabilities.mjs';
import {bridgeHarness} from './audit-bridge-harness.mjs';
async function withBridge(fn){const h=await bridgeHarness({config:{ownerQQ:12345,allow:{private:[12345,23456,34567],groups:[45678]}}});try{h.setMode('closed-agent');h.setPresets(['standard','dafeiyu','jingjing-guest','jingjing-memo','jingjing-worker']);h.caps.reconcile(h.capabilityKeys());h.work.runner={ready:true,reason:'',probe:async()=>({ready:true}),cancel:async()=>{},run:async()=>({stdout:'ok',files:[]})};await fn(h);}finally{await h.close();}}
function event(uid,text){return {user_id:uid,self_id:99999,message_id:'msg-'+Math.random(),message:[{type:'text',data:{text}}],sender:{nickname:'fixture'}};}
test('QQ id 0 or string 0 does not hide a valid later field',()=>{assert.equal(validQQ('0',null,23456),'23456');assert.equal(validQQ(0,undefined),'');});
test('owner adds admin without restarting; existing private chat can submit work immediately',()=>withBridge(async h=>{
 await h.ensureSession('private:23456');const previous=h.state.sessions['private:23456'];
 await h.handleIncoming('private',12345,event(12345,'/加管理 23456'),h.cfg);
 assert.equal(h.capabilityRole('private:23456'),'admin');assert.equal(h.state.sessions['private:23456'],previous);
 await h.handleIncoming('private',23456,event(23456,'/干活 计算1加1'),h.cfg);
 assert.equal(Object.values(h.work.jobs).length,1);assert.equal(Object.values(h.work.jobs)[0].status,'queued');
 assert.equal(h.work.info('private:23456').work,true);
}));
test('ordinary user, group and an administrator cannot grant admin privileges',()=>withBridge(async h=>{
 await h.handleIncoming('private',23456,event(23456,'/加管理 34567'),h.cfg);assert.equal(h.cfg.admins.length,0);
 h.rosterUpdate('add','admins',23456);await h.handleIncoming('private',23456,event(23456,'/加管理 34567'),h.cfg);assert.equal(h.cfg.admins.includes('34567'),false);
 assert.throws(()=>h.work.submit('private:34567','run'));assert.throws(()=>h.work.submit('group:45678','run'));
}));
test('demotion cancels queued work, revokes old epoch and keeps ordinary chat',()=>withBridge(async h=>{
 h.rosterUpdate('add','admins',23456);const epoch=h.caps.epoch('private:23456');const j=h.work.submit('private:23456','test');
 h.rosterUpdate('remove','admins',23456);await h.work.reconcile();assert.equal(j.status,'cancelled');assert.equal(h.capabilityRole('private:23456'),'user');assert.throws(()=>h.caps.assertWork('private:23456',epoch));
}));
test('photo markers use a shared selfie character prompt and have no daily quota',()=>withBridge(async h=>{
 for(let i=0;i<25;i++)await h.handleCompanionActions('private:23456',`【发照片：在书桌前 ${i}】`);
 assert.equal(Object.keys(h.mediaJobs.data).length,25);const j=Object.values(h.mediaJobs.data)[0];assert.equal(j.character,true);assert.match(j.prompt,/齐肩微卷黑发/);assert.equal(j.caption,'');assert.equal(h.cfg.usageLimits,false);
 const r=await h.handleCompanionActions('group:45678','【发照片：卧室】');assert.match(r,/群聊/);
}));
test('sticker request never submits a drawing even when inventory has no match',()=>withBridge(async h=>{
 const r=await h.handleCompanionActions('private:23456','【发表情包：unavailable】');assert.equal(Object.keys(h.mediaJobs.data).length,0);assert.match(r,/表情/);
}));
test('life photo selection persists across restart, alternates 2-3 in five; work status excluded',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cap-test-'));try{const file=path.join(dir,'s.json');let c=new CapabilityState(file,()=> 'owner');const answers=Array.from({length:10},()=>c.photoHint('private:1','你在干嘛'));assert.equal(answers.filter(x=>x.includes('本轮倾向')).length,5);c=new CapabilityState(file,()=> 'owner');assert.equal(c.data.photos['private:1'].n,10);assert.equal(c.photoHint('private:1','你在干嘛 任务进度'),'');assert.match(c.photoHint('private:2','在干嘛'),/本轮/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('job inputs are scoped to sender and permission epoch; any extension accepted',()=>withBridge(async h=>{
 h.rosterUpdate('add','admins',23456);h.rosterUpdate('add','admins',34567);
 const f=h.work.addInput('private:23456','anything.custom',Buffer.from('hello'));assert.equal(f.name,'anything.custom');assert.throws(()=>h.work.submit('private:34567','read',{inputIds:[f.id]}));
 const own=h.work.submit('private:23456','read',{online:true,inputIds:[f.id]});assert.equal(own.online,true);
}));
test('revocation during execution stops result delivery',()=>withBridge(async h=>{
 h.rosterUpdate('add','admins',23456);const j=h.work.submit('private:23456','compute');h.work.model=async()=>JSON.stringify({code:'print(1)',summary:'ok'});
 h.work.runner.run=async()=>{h.rosterUpdate('remove','admins',23456);return {stdout:'ok',files:[{name:'result.txt',data:Buffer.from('secret').toString('base64')}]};};
 let sent=0;h.work.sendFile=async()=>{sent++};await h.work.tick();assert.equal(sent,0);assert.equal(j.status,'cancelled');
}));
test('job failure does not automatically retry uncertain external sending',()=>withBridge(async h=>{
 h.rosterUpdate('add','admins',23456);const j=h.work.submit('private:23456','compute');h.work.model=async()=>JSON.stringify({code:'print(1)',summary:'ok'});h.work.sendText=async()=>{throw Error('connection lost')};await h.work.tick();assert.equal(j.status,'uncertain');await h.work.tick();assert.equal(j.status,'uncertain');
}));

test('removing a non-admin never creates a new allowed user',()=>withBridge(async h=>{h.rosterUpdate('remove','admins',98765);assert.equal(h.cfg.allow.private.includes('98765'),false);}));

test('an already downloaded photo is delivered without a new paid generation',()=>withBridge(async h=>{
 const j=h.mediaJobs.add({kind:'draw',target:'private:12345',prompt:'fixture',caption:'海报第四版',scene:'在书桌前',character:true,direct:true});const folder=path.join(h.temp,'workspace','画的图');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,j.id+'.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k3ioAAAAASUVORK5CYII=','base64'));await h.runMediaJob(j);assert.equal(j.status,'completed');assert.equal(j.taskId,undefined);assert.equal(h.caps.data.life.scene,'在书桌前');assert.equal(h.caps.data.life.caption,'海报第四版');assert.equal(h.caps.data.life.at,j.at);assert.match(JSON.stringify(h.chatArchive.query('private:12345',{})),/海报第四版/);
}));

test('restart does not revoke queued work during initial mode discovery',async()=>{
 const config={ownerQQ:12345,allow:{private:[12345,23456],groups:[]}};let h=await bridgeHarness({config});let files;
 try{h.setMode('closed-agent');h.caps.reconcile(h.capabilityKeys());h.work.runner.ready=true;h.work.submit('private:12345','queued across restart');files={'state/capabilities.json':h.caps.data,'state/work-jobs/jobs.json':h.work.jobs};}finally{await h.close();}
 h=await bridgeHarness({config,files});try{await h.work.reconcile();assert.equal(Object.values(h.work.jobs)[0].status,'queued');h.setMode('closed-agent');h.caps.reconcile(h.capabilityKeys());await h.work.reconcile();assert.equal(Object.values(h.work.jobs)[0].status,'queued');}finally{await h.close();}
});

test('character photos reject named real contacts instead of drawing them',()=>withBridge(async h=>{await assert.rejects(h.queueCharacterPhoto('private:23456','小鲸鱼和扶摇一起拍两个人的合照'),/换个日常/);assert.equal(Object.keys(h.mediaJobs.data).length,0);}));

test('model placeholder work marker uses actual trailing requirements and rejects empty templates',()=>withBridge(async h=>{
 h.rosterUpdate('add','admins',23456);const answer=await h.handleCompanionActions('private:23456','【工作：完整需求】\n输入sample.csv，按姓名去重，保留第一行，输出CSV');const j=Object.values(h.work.jobs)[0];assert.match(j.task,/按姓名去重/);assert.match(answer,/排队/);const before=Object.keys(h.work.jobs).length;const no=await h.handleCompanionActions('private:23456','【工作：完整需求】');assert.equal(Object.keys(h.work.jobs).length,before);assert.match(no,/描述不完整/);
}));

test('multiple collection stickers use native QQ action and wait instead of failing cooldown',()=>withBridge(async h=>{
 h.noteOwnerChat('in','发两个收藏表情'); // Real direct requests remain allowed during quiet hours.
 const requests=[];const original=h.bot.request.bind(h.bot);h.bot.request=async(action,body)=>{requests.push({action,body});return original(action,body);};
 const r=await h.handleCompanionActions('private:12345','【发表情包：fixture-sticker】【发表情包：fixture-sticker】');
 const sent=requests.filter(x=>x.action==='send_custom_face');assert.equal(sent.length,2);assert.equal(sent[0].body.emoji_id,'fixture-sticker');assert.equal(sent[0].body.user_id,12345);assert.doesNotMatch(r,/没办成|太快/);assert.equal(h.caps.data.deliveries.filter(x=>x.type==='sticker').length,2);
}));

test('owner explicit silence is durable and next direct message resumes it',()=>withBridge(async h=>{
 await h.handleIncoming('private',12345,event(12345,'别说话了'),h.cfg);assert.equal(h.state.ownerQuiet,true);assert.equal(h.calls.sent.length,0);assert.equal(h.canSendNow('private:12345'),false);assert.equal(h.canSendNow('private:12345',{reminder:true}),true);
 await h.handleIncoming('private',12345,event(12345,'在吗'),h.cfg);assert.equal(h.state.ownerQuiet,false);
}));
