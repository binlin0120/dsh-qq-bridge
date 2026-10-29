import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {bridgeHarness} from './audit-bridge-harness.mjs';

test('private memory and files default to this deployment workspace',async()=>{
 const h=await bridgeHarness();
 try{
  assert.equal(h.WORKSPACE_ROOT,path.join(h.temp,'workspace'));
  assert.equal(h.MEMORY_FILE,path.join(h.temp,'workspace','memory','AGENTS.md'));
  const privateFile=path.join(h.WORKSPACE_ROOT,'private.txt');fs.writeFileSync(privateFile,'private fixture');
  assert.equal(h.resolveOutboxPath(privateFile,{forOwner:true}).real,fs.realpathSync(privateFile));
  assert.throws(()=>h.resolveOutboxPath(privateFile,{forOwner:false}),/对外导出/);
  const exported=path.join(h.WORKSPACE_ROOT,'对外导出','public.txt');fs.mkdirSync(path.dirname(exported),{recursive:true});fs.writeFileSync(exported,'fixture');
  assert.equal(h.resolveOutboxPath(exported,{forOwner:false}).real,fs.realpathSync(exported));
  assert.throws(()=>h.resolveOutboxPath(path.join(h.temp,'config.json'),{forOwner:true}),/工作目录/);
 }finally{await h.close();}
});

test('short chain can be enabled in portable config without a preexisting state file',async()=>{
 const h=await bridgeHarness({config:{orchestration:{enabled:true,shortChain:true},work:{enabled:false}}});
 try{assert.ok(h.shortChain);assert.ok(h.orchestrator);}finally{await h.close();}
});

test('unconfigured image generation stops before contacting a provider',async()=>{
 const h=await bridgeHarness();
 try{await assert.rejects(h.drawImage('fixture','1K','1:1',{character:true}),/draw.baseUrl/);assert.equal(h.calls.http.length,0);}
 finally{await h.close();}
});
