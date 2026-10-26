import fs from 'node:fs';import crypto from 'node:crypto';
const atomic=(file,data)=>{fs.writeFileSync(file+'.new',JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(file+'.new',file);};
export class InvocationLedger {
 constructor(file){this.file=file;try{this.data=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.data={};}if(!this.data||Array.isArray(this.data)||typeof this.data!=='object')throw Error('后台调用记录损坏，拒绝覆盖');for(const row of Object.values(this.data))if(row.status==='running'){row.status='blocked';row.error='上次调用结果未确认，重启不重新调用';}atomic(file,this.data);}
 fingerprint(purpose,scope,input){return crypto.createHash('sha256').update(JSON.stringify([purpose,scope,input])).digest('hex');}
 key(purpose,scope,input){return purpose+':'+scope+':'+this.fingerprint(purpose,scope,input);}
 async run(purpose,scope,input,fn,{resume=false,metadata={}}={}){const id=this.key(purpose,scope,input),old=this.data[id];
  if(old?.status==='completed')return old.result;
  if(old&&!resume)throw Object.assign(Error('同批后台输入已处理或失败，停止自动重复：'+purpose),{code:'BACKGROUND_BLOCKED'});
  if(old?.result!==undefined)return old.result;
  const row=this.data[id]={id,purpose,scope,sourceHash:this.fingerprint(purpose,scope,input),status:'running',startedAt:Date.now(),metadata};atomic(this.file,this.data);
  try{const result=await fn();row.result=result;row.status='completed';row.completedAt=Date.now();atomic(this.file,this.data);return result;}
  catch(e){row.status='blocked';row.blockedAt=Date.now();row.error=String(e.message).replace(/sk-[A-Za-z0-9_-]+/g,'[hidden]').slice(0,250);atomic(this.file,this.data);throw e;}
 }
 block(purpose,scope,input,error){const id=this.key(purpose,scope,input);if(this.data[id]){this.data[id].status='blocked';this.data[id].error=String(error).slice(0,250);atomic(this.file,this.data);}}
}
