import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export const SANDBOX_IMAGE='sha256:a471ae3898a7baea22ac30f32c8f5e96161ba8855a2c447f63e9b9b6bfc9e907';
export class DockerSandbox {
  constructor(){this.executionTail=Promise.resolve();this.activeJobId=null;this.image=SANDBOX_IMAGE;this.ready=false;this.reason='工作环境正在检查';}
  async probe(){
    try{const r=await exec('docker',['image','inspect',this.image,'--format','{{.Id}}'],{timeout:15000});if(!r.stdout.trim().startsWith('sha256:'))throw Error('工作镜像不可用');const ps=await exec('docker',['ps','--filter','name=jj-work-','--format','{{.Names}}'],{timeout:5000});if(ps.stdout.trim()&&!this.activeJobId)throw Error('还有原工作容器未确认结束');if(this.heldRelease&&await this.confirmStopped(this.activeJobId)){this.heldRelease();this.heldRelease=null;this.activeJobId=null;}if(this.heldRelease)throw Error('原工作容器停止未确认');this.ready=true;this.reason='';}
    catch(e){this.ready=false;this.reason='隔离工作环境不可用';}return {ready:this.ready,reason:this.reason};
  }
  name(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('无效任务号');return 'jj-work-'+id;}
  async cancel(id){try{await exec('docker',['rm','-f',this.name(id)],{timeout:10000});}catch{}}
  async confirmStopped(id){try{const r=await exec('docker',['inspect',this.name(id),'--format','{{.State.Running}}'],{timeout:5000});return r.stdout.trim()==='false';}catch(e){return /No such (?:object|container)/i.test(String(e.stderr||e.message));}}
  async run(job,root,code,check){
    const previous=this.executionTail;let release;const lease=new Promise(r=>release=r);this.executionTail=previous.catch(()=>{}).then(()=>lease);await previous.catch(()=>{});
    try{check();this.activeJobId=job.id;return await this.runExclusive(job,root,code,check);}
    finally{if(this.activeJobId===job.id){await this.cancel(job.id);if(await this.confirmStopped(job.id)){this.activeJobId=null;release();}else{this.heldRelease=release;this.ready=false;this.reason='原工作容器停止未确认，暂停新的程序执行';}}else release();}
  }
  async runExclusive(job,root,code,check){
    check();if(!this.ready)throw Error(this.reason);
    const mem=fs.readFileSync('/proc/meminfo','utf8').match(/MemAvailable:\s+(\d+)/);if(!mem||Number(mem[1])<384*1024)throw Error('可用内存不足，任务未执行，可稍后重试');
    const input=path.join(root,'input');fs.mkdirSync(input,{recursive:true,mode:0o755});fs.chmodSync(input,0o755);
    const script=path.join(root,'script.py');fs.writeFileSync(script,code,{mode:0o444});fs.chmodSync(script,0o444);
    const name=this.name(job.id);
    try{
      await exec('docker',['run','-d','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','256m','--memory-swap','256m','--cpus','0.5','--ulimit','nofile=128:128','--user','65534:65534','--tmpfs','/work:rw,noexec,nosuid,size=100m,uid=65534,gid=65534','--tmpfs','/tmp:rw,noexec,nosuid,size=16m,uid=65534,gid=65534','--mount',`type=bind,src=${input},dst=/input,readonly`,'--mount',`type=bind,src=${script},dst=/script.py,readonly`,'--workdir','/work','--env','HOME=/tmp',this.image,'python3','-c','import time;time.sleep(330)'],{timeout:20000,maxBuffer:1024*1024});
      check();
      const result=await exec('docker',['exec',name,'python3','-I','/script.py'],{timeout:Math.max(1,Math.min(240000,job.deadline-Date.now())),maxBuffer:1024*1024});
      check();
      // Only top-level regular files, opened without following symlinks. /work is a bounded tmpfs.
      const exporter=`import os,stat,base64,json\nitems=[];total=0\nfor n in sorted(os.listdir('/work')):\n if n.startswith('.') or '/' in n: continue\n try:\n  f=os.open('/work/'+n,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);s=os.fstat(f)\n  if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1: os.close(f);continue\n  b=os.read(f,20*1024*1024+1);os.close(f);total+=len(b)\n  if len(b)>20*1024*1024 or total>20*1024*1024: raise ValueError('output exceeds safe transfer size')\n  items.append({'name':n,'data':base64.b64encode(b).decode()})\n except OSError: continue\nprint(json.dumps(items))`;
      const exported=await exec('docker',['exec',name,'python3','-I','-c',exporter.replaceAll(String.fromCharCode(92)+'n',String.fromCharCode(10))],{timeout:20000,maxBuffer:30*1024*1024});
      check();return {stdout:result.stdout.slice(0,3000),files:JSON.parse(exported.stdout)};
    }finally{await this.cancel(job.id);}
  }
}
