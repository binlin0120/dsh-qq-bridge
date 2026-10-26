
import fs from 'node:fs';
export class ResourceScheduler{
 constructor({models=2,heavy=1,available=()=>{const m=/MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo','utf8'));return m?Number(m[1])*1024:0;},canHeavy=()=>true}={}){this.limit={model:models,heavy};this.active={model:0,heavy:0};this.queue=[];this.available=available;this.canHeavy=canHeavy;this.closed=false;}
 run(kind,id,fn,check=()=>{}){return new Promise((resolve,reject)=>{this.queue.push({kind,id,fn,check,resolve,reject});this.pump();});}
 pump(){if(this.closed)return;for(const job of [...this.queue]){try{job.check();}catch(e){this.queue.splice(this.queue.indexOf(job),1);job.reject(e);continue;}if((job.kind==='model'&&this.pausedModels)||(job.kind==='heavy'&&this.pausedHeavy))continue;if(this.active[job.kind]>=this.limit[job.kind])continue;if(job.kind==='heavy'&&(this.available()<448*1024*1024||!this.canHeavy()))continue;this.queue.splice(this.queue.indexOf(job),1);this.active[job.kind]++;Promise.resolve().then(()=>{job.check();return job.fn();}).then(job.resolve,job.reject).finally(()=>{this.active[job.kind]--;this.pump();});}}
 snapshot(){return {scope:'orchestrator_managed_calls_only',recoveryModelsPaused:!!this.pausedModels,recoveryHeavyPaused:!!this.pausedHeavy,active:{...this.active},limits:{...this.limit},queued:this.queue.map(x=>({kind:x.kind,id:x.id})),heavyMemoryFloorMiB:448};}
 close(){this.closed=true;for(const j of this.queue.splice(0))j.reject(Error('调度器已关闭'));}
}
