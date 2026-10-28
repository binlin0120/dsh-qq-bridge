import {isPrivateIp} from './safe-fetch.js';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
const MAX=20*1024*1024;
export function responseHeaders(raw) {
  const blocks=String(raw).trim().split(/\r?\n\r?\n/).filter(x=>/^HTTP\//.test(x));
  const lines=(blocks.at(-1)||'').split(/\r?\n/);const out={status:Number(lines.shift()?.split(' ')[1])};
  for(const line of lines){const i=line.indexOf(':');if(i>0)out[line.slice(0,i).toLowerCase()]=line.slice(i+1).trim();}return out;
}
export function validRange(h,offset) {
  const m=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(h['content-range']||'');
  return h.status===206&&m&&Number(m[1])===offset&&Number(m[2])>=offset&&Number(m[2])<Number(m[3])&&Number(m[3])<=MAX ? {end:Number(m[2]),total:Number(m[3])}:null;
}
const curl=(args,timeout)=>new Promise(resolve=>execFile('curl',args,{timeout,maxBuffer:128*1024},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
export async function downloadImage(u,tmp,ips,{validate,log=()=>{},run=curl,clock=Date.now,progress=()=>{}}={}) {
  const host=new URL(u).hostname;const metaFile=tmp+'.json';const hdr=tmp+'.headers';const chunk=tmp+'.chunk';
  let meta={url:u,total:0,validator:''};let full=false;
  try{const previous=JSON.parse(fs.readFileSync(metaFile,'utf8'));if(previous.url===u&&previous.validator&&previous.total>0)meta=previous;else if(fs.existsSync(tmp))fs.renameSync(tmp,tmp+'.unverified-'+randomUUID());}catch(e){if(fs.existsSync(tmp))fs.renameSync(tmp,tmp+'.unverified-'+randomUUID());}
  if(fs.existsSync(tmp)&&fs.statSync(tmp).size>MAX)throw Error('下载残片超过20MB');
  const base=['-4','-sS','-f','--proto','=https','--max-filesize',String(MAX),'--connect-timeout','6'];
  const probes=await Promise.all(ips.slice(0,2).map(async ip=>{
    const r=await run([...base,'-r','0-65535','--max-time','3','-o','/dev/null','-w','%{http_code} %{speed_download} %{size_download}','--resolve',`${host}:443:${ip}`,u],5000);
    const [status,speed,bytes]=String(r.stdout).trim().split(/\s+/).map(Number);
    return {ip,speed:([200,206].includes(status)&&bytes>0&&Number.isFinite(speed))?speed:0};
  }));
  log(`图床测速 ${host}：`+probes.map(p=>`${p.ip}=${Math.round(p.speed/1024)}KB/s`).join(' '));
  const ranked=[...new Set([...probes.sort((a,b)=>b.speed-a.speed).map(p=>p.ip),...ips])];if(meta.ip&&!ranked.slice(0,2).includes(meta.ip))delete meta.ip;const unresponsive=new Set();const deadline=clock()+240000;let last='暂时没有完整图片';
  try{
    for(let attempt=0;attempt<32&&clock()<deadline;attempt++){
      const ip=(!full&&meta.ip)||ranked[attempt%ranked.length];if(!ip)break;
      if(deadline-clock()<7000)throw Object.assign(Error('下载预算已用完，保留有效断点'),{code:'DOWNLOAD_BUDGET_EXHAUSTED'});
      const offset=fs.existsSync(tmp)?fs.statSync(tmp).size:0;
      if(meta.total&&offset===meta.total){const buf=fs.readFileSync(tmp);try{validate(buf);return buf;}catch{fs.unlinkSync(tmp);meta={url:u,total:0,validator:''};continue;}}
      for(const f of [hdr,chunk])if(fs.existsSync(f))fs.unlinkSync(f);
      const args=[...base,'--resolve',`${host}:443:${ip}`,'--speed-time','45','--speed-limit','128','--max-time',String(Math.max(1,Math.min(60,Math.floor((deadline-clock())/1000)))),'-D',hdr,'-o',chunk];
      if(!full)args.push('-r',`${offset}-${offset+1024*1024-1}`);
      if(offset&&meta.validator)args.push('-H','If-Range: '+meta.validator);
      const r=await run([...args,u],65000);const h=responseHeaders(fs.existsSync(hdr)?fs.readFileSync(hdr,'utf8'):'');
      const size=fs.existsSync(chunk)?fs.statSync(chunk).size:0;const range=validRange(h,offset);
      if(!Number.isFinite(h.status)||h.status<100){delete meta.ip;unresponsive.add(ip);last='图片连接未得到有效响应，保留已验证断点';log(last+'并切换IP');if(ranked.every(x=>unresponsive.has(x)))throw Object.assign(Error('所有图片连接均未得到有效响应，保留已验证断点'),{code:'TRANSPORT_NO_RESPONSE'});continue;}unresponsive.delete(ip);
      if(h.status===404||h.status===410)throw Object.assign(Error('原图片链接已失效 HTTP '+h.status),{code:'IMAGE_NOT_FOUND'});
      if([429,500,502,503,504].includes(h.status))throw Object.assign(Error('图床暂时不可用，保留已验证断点 HTTP '+h.status),{code:'IMAGE_SERVER_UNAVAILABLE'});
      const validator=h.etag&&!/^W\//.test(h.etag)?h.etag:h['last-modified']||'';
      if(h.status===200){
        // Range ignored or If-Range failed: only a complete fresh image may replace the partial.
        if(!r.error&&size>0&&size<=MAX){const buf=fs.readFileSync(chunk);validate(buf);fs.writeFileSync(tmp,buf);meta={url:u,total:size,validator};fs.writeFileSync(metaFile,JSON.stringify(meta),{mode:0o600});return buf;}
        full=true;last='FULL_TRANSFER_INCOMPLETE';log('图片取回：'+last);continue;
      }
      if(!range||!size||size>range.end-offset+1||offset&&(!meta.validator||validator!==meta.validator||meta.total!==range.total)){
        last=!range?'RANGE_RESPONSE_INVALID':!size?'EMPTY_BODY':size>range.end-offset+1?'RANGE_SIZE_MISMATCH':validator!==meta.validator?'VERSION_CHANGED':'TOTAL_CHANGED';
        log(`图片取回：${last} status=${h.status} offset=${offset} bytes=${size}`);
        if(full)throw Error('下载画好的图失败：'+last);
        full=true;continue;
      }
      if(!validator&&size<range.total){last='RANGE_WITHOUT_VALIDATOR';log('图片取回：'+last+'，改为完整获取');full=true;continue;}
      fs.appendFileSync(tmp,fs.readFileSync(chunk),{mode:0o600});meta={url:u,total:range.total,validator,ip};fs.writeFileSync(metaFile,JSON.stringify(meta),{mode:0o600});progress({downloadedBytes:fs.statSync(tmp).size,totalBytes:meta.total,lastProgressAt:clock()});
      if(fs.statSync(tmp).size===meta.total){const buf=fs.readFileSync(tmp);try{validate(buf);}catch(e){fs.unlinkSync(tmp);throw e;}return buf;}
      last=r.error?'连接中断，保留已验证范围的下载进度':'分段下载尚未完成';
    }
    throw Error('下载画好的图失败：'+last);
  }finally{for(const f of [hdr,chunk])try{fs.unlinkSync(f);}catch{}}
}

export function selectImageDownloadIps(host, dnsIps, policy={}, now=Date.now()) {
  const fallback=[...new Set(dnsIps)];const route=policy?.hosts?.[String(host).toLowerCase()];
  if(!route||!Number.isFinite(route.verifiedAt)||route.verifiedAt>now||now-route.verifiedAt>7*86400000||!Number.isFinite(route.expiresAt)||route.expiresAt<=now)return fallback;
  const preferred=(Array.isArray(route.ips)?route.ips:[]).slice(0,2).filter(ip=>typeof ip==='string'&&/^\d+\.\d+\.\d+\.\d+$/.test(ip)&&!isPrivateIp(ip));
  return [...new Set([...preferred,...fallback])];
}
