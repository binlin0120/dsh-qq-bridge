import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {GroupMediaAuthority,mediaIntent} from '../src/group-context.mjs';import {bridgeHarness} from './audit-bridge-harness.mjs';
const evt=(uid,text,id,group=45678,at=true)=>({user_id:uid,self_id:99999,group_id:group,message_id:id,sender:{nickname:'owner'},message:[...(at?[{type:'at',data:{qq:'99999'}}]:[]),{type:'text',data:{text}}]});
async function fixture(fn){const h=await bridgeHarness({config:{ownerQQ:12345,allow:{private:[12345],groups:[45678,56789]},sendDelayMs:0}});try{h.setMode('closed-agent');h.setSelfIdentity('大肥鱼','99999');h.caps.reconcile(h.capabilityKeys());const original=h.bot.request.bind(h.bot);h.bot.request=async(a,b)=>a==='get_group_list'?{status:'ok',retcode:0,data:[{group_id:45678},{group_id:56789}]}:original(a,b);h.testMemo(JSON.stringify({scene:'在书桌前自然合适的角色照片',caption:'给你看看'}));await fn(h);}finally{await h.close();}}
const jobs=h=>Object.values(h.mediaJobs.data);
test('actual mentioned member can request screenshot wording; second request across groups is capped, others and owner remain independent',()=>fixture(async h=>{
 await h.handleIncoming('group',45678,evt(23456,'来张美女图片','member-1'),h.cfg);assert.equal(jobs(h).length,1);assert.equal(jobs(h)[0].authorization.actor,'23456');assert.equal(jobs(h)[0].authorization.kind,'member');assert.equal(jobs(h)[0].guest,true);
 await h.handleIncoming('group',56789,evt(23456,'生成一张图片','member-2',56789),h.cfg);assert.equal(jobs(h).length,1);assert.match(h.calls.sent.at(-1).text,/今天.*明天/);
 await h.handleIncoming('group',45678,evt(34567,'来张美女图片','other'),h.cfg);assert.equal(jobs(h).length,2);
 await h.handleIncoming('group',45678,evt(12345,'发张照片','owner-1'),h.cfg);await h.handleIncoming('group',45678,evt(12345,'再发张照片','owner-2'),h.cfg);assert.equal(jobs(h).length,4);assert.equal(h.groupAuthority.memberCount(12345),0);
}));
test('replayed event and repeated same source do not submit twice; ordinary duplicate scene from different people is never shared',()=>fixture(async h=>{
 const e=evt(23456,'来张美女图片','replayed');await h.handleIncoming('group',45678,e,h.cfg);await h.handleIncoming('group',45678,e,h.cfg);assert.equal(jobs(h).length,1);
 await h.handleOwnerGroupCommand('group:45678','来张美女图片',e,{member:true,addressed:true});assert.equal(jobs(h).length,1);assert.equal(h.groupAuthority.memberCount(23456),1);
 await h.handleIncoming('group',45678,evt(34567,'来张美女图片','different-actor'),h.cfg);assert.equal(jobs(h).length,2);
}));
test('no mention or quoted hypothetical request does not spend a member allowance; model actions cannot forge approval',()=>fixture(async h=>{
 await h.handleIncoming('group',45678,evt(23456,'来张美女图片','not-called',45678,false),h.cfg);assert.equal(jobs(h).length,0);
 await h.handleIncoming('group',45678,evt(23456,'他说“发张照片”','quote'),h.cfg);assert.equal(jobs(h).length,0);assert.equal(h.groupAuthority.memberCount(23456),0);
 const r=await h.handleCompanionActions('group:45678','【发照片：书桌前】');assert.match(r,/群聊媒体/);assert.equal(jobs(h).length,0);
}));
test('queued member authorization is rechecked before actual delivery; removing allowed group prevents sending',()=>fixture(async h=>{
 await h.handleIncoming('group',45678,evt(23456,'来张美女图片','ready'),h.cfg);const j=jobs(h)[0];const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k3ioAAAAASUVORK5CYII=','base64');j.file=path.join(h.temp,'member.png');fs.writeFileSync(j.file,png);h.cfg.allow.groups=[];await assert.rejects(h.runMediaJob(j),/失效|名单/);h.cfg.allow.groups=[45678,56789];await h.runMediaJob(j);assert.equal(j.status,'completed');
}));
test('member allowance persists across restart and renews exactly at Beijing midnight',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'member-quota-'));try{let now=Date.parse('2026-10-30T23:59:59+08:00');const file=path.join(dir,'authority.json');const create=()=>new GroupMediaAuthority(file,()=>12345,()=>true,()=>0,()=>({enabled:true,perDay:1}),()=>now);let a=create();const issue=(service,id,actor=23456)=>service.issueMember({actor,sourceKey:'group:45678',sourceId:id,target:'group:45678',text:'发张图片'});const auth=issue(a,'first');a.admitMember(auth,auth.target);a=create();assert.equal(a.memberCount(23456),1);assert.throws(()=>issue(a,'second'),/今天/);now+=1000;assert.equal(a.memberCount(23456),0);const next=issue(a,'new-day');a.admitMember(next,next.target);assert.equal(a.memberCount(23456),1);assert.throws(()=>a.assert(next,'group:56789','photo'));assert.throws(()=>a.assert(next,next.target,'sticker'));assert.throws(()=>a.issueMember({actor:23456,sourceKey:'group:56789',sourceId:'cross',target:'group:45678',text:'发张图片'}));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('concurrent group requests charge at admission atomically; disk failure never admits generation',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'member-atomic-'));try{const file=path.join(dir,'authority.json');const a=new GroupMediaAuthority(file,()=>12345,()=>true,()=>0,()=>({enabled:true,perDay:1}));const request=id=>a.issueMember({actor:23456,sourceKey:'group:45678',sourceId:id,target:'group:45678',text:'来张图片'});const first=request('one'),second=request('two');a.admitMember(first,first.target);assert.throws(()=>a.admitMember(second,second.target),/今天/);a.admitMember(first,first.target);assert.equal(a.memberCount(23456),1);
 const other=a.issueMember({actor:34567,sourceKey:'group:45678',sourceId:'other',target:'group:45678',text:'来张图片'});a.file=dir;assert.throws(()=>a.admitMember(other,other.target));assert.equal(a.memberCount(34567),0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('disabled member policy keeps owner media authorization valid',()=>fixture(async h=>{h.cfg.groupPhotos.enabled=false;await h.handleIncoming('group',45678,evt(23456,'发张图片','disabled'),h.cfg);assert.equal(jobs(h).length,0);await h.handleIncoming('group',45678,evt(12345,'发张照片','owner'),h.cfg);assert.equal(jobs(h).length,1);}));

test('screenshot discussion and capability questions never become paid picture generation',()=>{for(const text of ['看看这个图片怎么回事','看下这张图片','能发图片吗','他刚才发了图片'])assert.equal(mediaIntent(text),null,text);for(const text of ['来张美女图片','生成一张图片','发张风景图'])assert.equal(mediaIntent(text),'photo',text);});
