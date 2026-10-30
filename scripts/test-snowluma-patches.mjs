import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {applySnowlumaPatches} from './patch-snowluma-sdk.mjs';
const root=new URL('..',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('./snowluma-patches.json',import.meta.url)));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snowluma-patch-'));try{
 for(const [name,pkg] of Object.entries(manifest.packages)){const base=path.join(dir,'node_modules',name);fs.mkdirSync(base,{recursive:true});fs.writeFileSync(path.join(base,'package.json'),JSON.stringify({version:pkg.version}));
  for(const [relative,entry] of Object.entries(pkg.files)){let raw=fs.readFileSync(new URL('node_modules/'+name+'/'+relative,root),'utf8');if(sha(raw)===entry.after)for(const [from,to] of Object.entries(entry.edits))raw=raw.replaceAll("from '"+to+"'","from '"+from+"'");assert.equal(sha(raw),entry.before);const target=path.join(base,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,raw);}
 }return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('known pristine dependencies patch once, verify, and remain idempotent',()=>fixture(root=>{
 assert.throws(()=>applySnowlumaPatches({root,verifyOnly:true}),/not applied/);
 assert.equal(applySnowlumaPatches({root}).patchedFiles,13);assert.equal(applySnowlumaPatches({root}).patchedFiles,0);assert.equal(applySnowlumaPatches({root,verifyOnly:true}).verifiedFiles,33);
}));
for(const fault of ['version','hash','missing'])test('unknown '+fault+' fails before writing any other dependency',()=>fixture(root=>{
 const first=path.join(root,'node_modules/@snowluma/sdk/dist/internal/abort.js'),before=fs.readFileSync(first);
 const last=path.join(root,'node_modules/@snowluma/mcp');if(fault==='version')fs.writeFileSync(path.join(last,'package.json'),'{"version":"99.0.0"}');
 else{const rel=Object.keys(manifest.packages['@snowluma/mcp'].files).at(-1),target=path.join(last,rel);if(fault==='hash')fs.appendFileSync(target,'\n// unknown');else fs.unlinkSync(target);}
 assert.throws(()=>applySnowlumaPatches({root}));assert.deepEqual(fs.readFileSync(first),before);
}));
