import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {downloadImage,responseHeaders,validRange} from '../src/image-download.mjs';
test('HTTP range parsing rejects wrong offsets and oversized responses',()=>{const h=responseHeaders('HTTP/1.1 206 Partial\r\nContent-Range: bytes 3-5/6\r\nETag: "v1"\r\n\r\n');assert.deepEqual(validRange(h,3),{end:5,total:6});assert.equal(validRange(h,2),null);assert.equal(validRange({...h,'content-range':'bytes 3-5/999999999'},3),null);});
async function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'image-dl-'));try{await fn(path.join(dir,'image.part'));}finally{fs.rmSync(dir,{recursive:true,force:true});}}
const output=(args,headers,body)=>{fs.writeFileSync(args[args.indexOf('-D')+1],headers);fs.writeFileSync(args[args.indexOf('-o')+1],body);};
test('partial transfer resumes with matching ETag and range, validates full bytes',()=>fixture(async tmp=>{
 let calls=0;const offsets=[];const run=async args=>{if(args.includes('-w'))return {stdout:'206 5000 1024'};calls++;const range=args[args.indexOf('-r')+1];offsets.push(range.split('-')[0]);output(args,'HTTP/1.1 206 Partial\r\nETag: "v1"\r\nContent-Range: bytes '+(calls===1?'0-5/6':'3-5/6')+'\r\n\r\n',calls===1?'abc':'def');return {error:calls===1?Error('timeout'):null};};
 const b=await downloadImage('https://example.com/a',tmp,['1.1.1.1'],{run,validate:b=>assert.equal(b.toString(),'abcdef')});assert.equal(b.toString(),'abcdef');assert.deepEqual(offsets,['0','3']);
}));
test('changed file version is not appended to old partial',()=>fixture(async tmp=>{
 fs.writeFileSync(tmp,'abc');fs.writeFileSync(tmp+'.json',JSON.stringify({url:'https://example.com/a',total:6,validator:'"old"'}));let calls=0;
 const run=async args=>{if(args.includes('-w'))return {stdout:'206 3000 1024'};calls++;output(args,calls===1?'HTTP/1.1 206 Partial\r\nETag: "new"\r\nContent-Range: bytes 3-5/6\r\n\r\n':'HTTP/1.1 200 OK\r\nETag: "new"\r\n\r\n',calls===1?'XYZ':'newfile');return {};};
 const b=await downloadImage('https://example.com/a',tmp,['1.1.1.1'],{run,validate:b=>assert.equal(b.toString(),'newfile')});assert.equal(b.toString(),'newfile');assert.equal(calls,2);
}));
test('HTTP errors in speed probes are not ranked as fast valid images',()=>fixture(async tmp=>{
 const used=[];const run=async args=>{if(args.includes('-w'))return {stdout:args.includes('example.com:443:1.1.1.1')?'403 999999 888':'206 100 100'};used.push(args[args.indexOf('--resolve')+1]);output(args,'HTTP/1.1 200 OK\r\n\r\n','image');return {};};await downloadImage('https://example.com/a',tmp,['1.1.1.1','2.2.2.2'],{run,validate:b=>assert.equal(b.toString(),'image')});assert.match(used[0],/2\.2\.2\.2/);
}));
test('corrupt complete image is never delivered',()=>fixture(async tmp=>{const run=async args=>{if(args.includes('-w'))return {stdout:'206 100 100'};output(args,'HTTP/1.1 200 OK\r\n\r\n','broken');return {};};await assert.rejects(downloadImage('https://example.com/a',tmp,['1.1.1.1'],{run,validate:()=>{throw Error('invalid image');}}),/invalid image/);}));
test('a complete but corrupt saved partial is discarded before safe recovery',()=>fixture(async tmp=>{
 fs.writeFileSync(tmp,'broken');fs.writeFileSync(tmp+'.json',JSON.stringify({url:'https://example.com/a',total:6,validator:'"v1"'}));const run=async args=>{if(args.includes('-w'))return {stdout:'206 100 100'};output(args,'HTTP/1.1 200 OK\r\n\r\n','valid');return {};};const b=await downloadImage('https://example.com/a',tmp,['1.1.1.1'],{run,validate:b=>{if(b.toString()!=='valid')throw Error('invalid');}});assert.equal(b.toString(),'valid');
}));
