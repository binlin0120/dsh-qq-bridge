import crypto from 'node:crypto';import {readState,writeState} from './reliability.mjs';
export class MemoryQueue {
 constructor(file){this.file=file;this.state=readState(file,{});}
 enqueue(request){const id=crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');if(!this.state[id]){this.state[id]={id,request,status:'pending',at:Date.now()};this.save();}return this.state[id];}
 save(){writeState(this.file,this.state);}
 flush(book){for(const item of Object.values(this.state)){if(item.status==='completed')continue;const revision=book.snapshot().revision;if(item.blockedRevision===revision)continue;try{const r=book.remember(item.request);item.status='completed';item.revision=r.revision;item.doneAt=Date.now();delete item.error;}catch(e){item.status='blocked';item.blockedRevision=revision;item.error=String(e.message).slice(0,200);}this.save();}}
}
