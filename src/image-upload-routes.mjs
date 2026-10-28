import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {resolveSafeAddresses,isPrivateIp} from './safe-fetch.js';

const publicV4=ip=>net.isIP(ip)===4&&!isPrivateIp(ip);
export function uploadCandidates(dns,record,now=Date.now()){
 const recent=record&&Number.isFinite(record.verifiedAt)&&record.verifiedAt<=now&&now-record.verifiedAt<7*86400000?record.ips||[]:[];
 return [...new Set([...dns,...recent].filter(publicV4))].slice(0,4);
}
export function rankUploads(rows,bytes){
 return rows.filter(r=>r.exit===0&&r.http_code===404&&r.ssl_verify_result===0&&r.size_upload===bytes&&r.time_total>0).sort((a,b)=>b.speed_upload-a.speed_upload||a.time_total-b.time_total).map(r=>r.ip);
}
async function probe(ip,url,file){
 const u=new URL(url);u.pathname=u.pathname.replace(/\/task\/submit$/,'/_network_upload_probe');
 // Never probe the paid submission path; no API key or user image is sent.
 if(!u.pathname.endsWith('/_network_upload_probe'))throw Error('Invalid upload probe path');
 return new Promise(resolve=>execFile('curl',['--noproxy','*','-4','-sS','--http1.1','--connect-timeout','4','--max-time','20','--resolve',`${u.hostname}:443:${ip}`,'-H','Content-Type: application/json','--data-binary','@'+file,'-o','/dev/null','-w','%{json}',u.href],{timeout:23000,maxBuffer:64000},(error,out)=>{try{const m=JSON.parse(out);resolve({ip,exit:error?.code||0,...Object.fromEntries(['http_code','ssl_verify_result','size_upload','speed_upload','time_total'].map(k=>[k,m[k]]))});}catch{resolve({ip,exit:1});}}));
}
async function connect(ip,host){
 return new Promise((resolve,reject)=>{const s=tls.connect({host:ip,port:443,servername:host,rejectUnauthorized:true});const timer=setTimeout(()=>{s.destroy();reject(Error('Upload TLS timeout'));},4000);s.once('secureConnect',()=>{clearTimeout(timer);s.destroy();resolve();});s.once('error',()=>{clearTimeout(timer);reject(Error('Upload TLS failed'));});});
}
export async function selectUploadRoute({url,stateFile,bodyBytes,log=()=>{},resolve=resolveSafeAddresses,runProbe=probe,check=connect,clock=Date.now}){
 const u=new URL(url);if(u.protocol!=='https:'||u.port&&u.port!=='443')throw Error('Invalid upload endpoint');
 let all={hosts:{}};try{all=JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch{}
 const now=clock(),old=all.hosts?.[u.hostname];let dns=[];try{dns=await resolve(u.hostname);}catch{}
 const candidates=uploadCandidates(dns,old,now);if(!candidates.length)throw Object.assign(Error('生图接口没有可用公网IPv4地址'),{code:'IMAGE_UPLOAD_ROUTE_UNAVAILABLE'});
 let ranked=[],rows=[],cached=old?.probePath===u.pathname&&old.verifiedAt<=now&&now-old.verifiedAt<600000&&old.ips?.some(ip=>candidates.includes(ip));
 if(cached)ranked=old.ips.filter(ip=>candidates.includes(ip));
 else{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jj-upload-route-'));
  try{
   const file=path.join(dir,'probe.json');const size=Math.max(65536,Math.min(512*1024,bodyBytes||65536));
   const body=Buffer.from(JSON.stringify({network_probe:'a'.repeat(size-20)}));fs.writeFileSync(file,body,{mode:0o600});
   rows=await Promise.all(candidates.map(ip=>runProbe(ip,url,file)));ranked=rankUploads(rows,body.length);
   if(ranked.length){all.hosts??={};all.hosts[u.hostname]={verifiedAt:now,probePath:u.pathname,ips:ranked,probeBytes:body.length,results:rows};fs.mkdirSync(path.dirname(stateFile),{recursive:true});const tmp=stateFile+'.'+randomUUID()+'.new';fs.writeFileSync(tmp,JSON.stringify(all,null,2),{mode:0o600});fs.renameSync(tmp,stateFile);}
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
 for(const ip of [...new Set([...ranked,...candidates])]){try{await check(ip,u.hostname);log(`图片上传选路 ${u.hostname} ${ip} cached=${!!cached} verified=${ranked.includes(ip)}`);return {ip,host:u.hostname,cached:!!cached,measured:ranked.includes(ip),results:rows};}catch{}}
 throw Object.assign(Error('生图接口所有线路连接失败，尚未提交'),{code:'IMAGE_UPLOAD_ROUTE_UNAVAILABLE'});
}
