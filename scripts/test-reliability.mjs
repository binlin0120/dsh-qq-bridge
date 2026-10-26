import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ModelGuard,DailyQuota,ChatArchive,DurableJobs,approvalDecision,chooseApproval,quietAt,chunkRecords,parseMemoObject,scrubPrivate,writeState} from '../src/reliability.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qq-reliability-'));
test.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
const file=n=>path.join(temp,n+'.json');
const a={provider:'lane',model:'good'},b={provider:'lane',model:'candidate'};
test('model fallback survives successful probe/turn and process restart',()=>{
 const f=file('model');let g=new ModelGuard(f,a);g.switched(b);g.healthy(b);
 assert.deepEqual(g.state.previous,a);g=new ModelGuard(f,b);
 assert.equal(g.failed(b),null);assert.equal(g.failed(b),null);assert.deepEqual(g.failed(b),a);
 g.reverted(a);assert.equal(g.state.previous,null);assert.deepEqual(g.state.current,a);
});
test('old model events cannot bless or fail a newly selected model',()=>{
 const g=new ModelGuard(file('stale'),a);g.switched(b);g.failed(b);g.healthy(a);assert.equal(g.state.streak,1);g.failed(a);assert.equal(g.state.streak,1);
});
test('model guard never persists provider credentials or endpoint secrets',()=>{
 const f=file('minimal');const g=new ModelGuard(f,{...a,authToken:'not-for-state',baseUrl:'https://example.invalid'});
 assert.equal(fs.readFileSync(f,'utf8').includes('not-for-state'),false);assert.deepEqual(g.state.current,a);
});
test('QQ consent needs no number and unrelated/rejected wording never grants approval',()=>{
 assert.equal(approvalDecision('同意！'),true);assert.equal(approvalDecision('同意加她'),true);
 assert.equal(approvalDecision('不同意'),false);assert.equal(approvalDecision('你觉得我该同意吗'),null);
 assert.equal(approvalDecision('你好'),null);assert.equal(approvalDecision('她说同意'),null);
 const requests=[{flag:'old',at:10,notifiedAt:15},{flag:'latest',at:20,notifiedAt:25}];
 assert.equal(chooseApproval(requests,'同意',30).flag,'latest');assert.equal(chooseApproval(requests,'你好',30),null);
});
test('quotas survive restart and reset only at Shanghai midnight',()=>{
 let t=Date.parse('2026-10-22T23:59:00+08:00');const f=file('quota');const q=new DailyQuota(f,()=>t);q.take('draw',1);
 assert.throws(()=>new DailyQuota(f,()=>t).take('draw',1));
 t+=120000;assert.equal(new DailyQuota(f,()=>t).count('draw'),0);
});
test('quiet hours have exact boundaries, cross-midnight and Shanghai timezone',()=>{
 for(const [time,expected] of [['22:59',false],['23:00',true],['07:59',true],['08:00',false]]) assert.equal(quietAt(Date.parse(`2026-10-22T${time}:00+08:00`)),expected);
});
test('archive keeps every record beyond rolling chat limit, per contact, and seeds idempotently',()=>{
 const dir=path.join(temp,'archive');let ar=new ChatArchive(dir);
 const list=Array.from({length:900},(_,i)=>({at:1792600000000+i,dir:'in',text:'item '+i}));
 ar.seed('private:12345',list);ar.seed('private:12345',list);ar=new ChatArchive(dir);
 assert.equal(ar.query('private:12345').length,900);assert.equal(ar.query('private:99999').length,0);
 assert.equal(ar.query('private:12345',{query:'item 0'}).length,1);assert.throws(()=>ar.query('../../root'));
 assert.throws(()=>ar.query('private:12345',{limit:10}));
 const chunks=chunkRecords(list,500);assert.equal(chunks.flat().length,900);assert.equal(chunks.flat()[0].text,'item 0');
});
test('known sensitive number/key categories are redacted before archive',()=>{
 const input='110101200001010010 13812345678 sk-abcdefghijklmnopqrst';const clean=scrubPrivate(input);
 assert.equal(clean.includes('13812345678'),false);assert.equal(clean.includes('110101200001010010'),false);assert.equal(clean.includes('sk-'),false);
});
test('restart resumes polling task ID and never resubmits ambiguous submission/send',async()=>{
 const f=file('jobs');const q=new DurableJobs(f);
 const submitted=q.add({kind:'draw'});q.update(submitted,{status:'running',taskId:'remote-1'});
 const sending=q.add({kind:'draw'});q.update(sending,{status:'sending'});
 const submitting=q.add({kind:'draw'});q.update(submitting,{status:'submitting'});
 const restored=new DurableJobs(f);assert.equal(restored.data[submitted.id].status,'queued');assert.equal(restored.data[submitted.id].taskId,'remote-1');
 assert.equal(restored.data[sending.id].status,'uncertain');assert.equal(restored.data[submitting.id].status,'uncertain');
 let count=0;await Promise.all([restored.tick(async()=>{count++;}),restored.tick(async()=>{count++;})]);assert.equal(count,1);assert.equal(restored.data[submitted.id].status,'completed');
});
test('corrupt persisted state fails closed rather than wiping stored quota',()=>{
 const f=file('bad');fs.writeFileSync(f,'{invalid');assert.throws(()=>new DailyQuota(f));assert.equal(fs.readFileSync(f,'utf8'),'{invalid');
});
test('memo parser accepts complete JSON with preamble/fence but never partial plain notes',()=>{
 assert.deepEqual(parseMemoObject('任务：整理\n```json\n{"memory":"含{括号}与\\\"引号","handoff":"ok"}\n```'),{memory:'含{括号}与"引号',handoff:'ok'});
 assert.throws(()=>parseMemoObject('任务：整理小鲸鱼的笔记\n- 这是正文'));
 assert.throws(()=>parseMemoObject('{"memory":"truncated'));
});
