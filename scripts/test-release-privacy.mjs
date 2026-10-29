import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import{spawnSync}from'node:child_process';
async function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-release-scan-'));try{fs.mkdirSync(path.join(dir,'scripts'));fs.copyFileSync(new URL('./privacy-scan.mjs',import.meta.url),path.join(dir,'scripts/privacy-scan.mjs'));fs.writeFileSync(path.join(dir,'.gitignore'),'');spawnSync('git',['init','--quiet',dir],{windowsHide:true});await fn(dir,()=>spawnSync(process.execPath,['scripts/privacy-scan.mjs','--json'],{cwd:dir,encoding:'utf8',windowsHide:true}));}finally{assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true,force:true});}}

test('known token formats cannot hide inside heuristic allowPaths',()=>fixture(async(dir,scan)=>{
 fs.mkdirSync(path.join(dir,'src'));const token=['github','pat','A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'].join('_');fs.writeFileSync(path.join(dir,'src/bridge.js'),'// '+token);
 const r=scan();assert.equal(r.status,1);const v=JSON.parse(r.stdout);assert.ok(v.findings.some(x=>x.kind==='credential'&&x.file==='src/bridge.js'));assert.equal(r.stdout.includes(token),false);
}));
test('Unicode file paths and later regex matches are actually scanned',()=>fixture(async(dir,scan)=>{
 fs.mkdirSync(path.join(dir,'roles'));fs.writeFileSync(path.join(dir,'roles','测试.md'),'lowercase-normal-package-name-that-is-long-enough\n'+'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8');
 const r=scan();assert.equal(r.status,1);assert.ok(JSON.parse(r.stdout).findings.some(x=>x.file==='roles/测试.md'));assert.doesNotMatch(r.stderr,/提前结束/);
}));
test('empty deployment credentials and ordinary identifiers pass',()=>fixture(async(dir,scan)=>{
 fs.writeFileSync(path.join(dir,'config.example.json'),JSON.stringify({accessToken:'',authToken:''}));fs.writeFileSync(path.join(dir,'README.md'),'lowercase-normal-package-name-that-is-long-enough');assert.equal(scan().status,0);
}));
