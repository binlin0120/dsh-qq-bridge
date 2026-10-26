import {readState,writeState} from './reliability.mjs';
export class DeliveryOutbox {
 constructor(file){this.file=file;this.state=readState(file,{});this.pending=new Map();for(const item of Object.values(this.state))if(item.status==='sending')item.status='uncertain';this.save();}
 save(){writeState(this.file,this.state);}
 markArchived(id){if(this.state[id]){this.state[id].archived=true;this.save();}}
 deliver(id,send,meta={}){
  if(this.pending.has(id))return this.pending.get(id);
  const work=(async()=>{
   const old=this.state[id];if(old?.status==='confirmed')return {...old.receipt,duplicate:true};
   if(old?.status==='uncertain'||old?.status==='sending')throw Error('投递结果未知，先核对回执，不能自动重复发送');
   this.state[id]={status:'sending',at:Date.now(),...meta};this.save();
   try{const receipt=await send();if(receipt?.ok===false)throw Error('QQ没有确认整条消息送达');this.state[id]={...this.state[id],status:'confirmed',receipt:receipt||{ok:true},confirmedAt:Date.now()};this.save();return receipt||{ok:true};}
   catch(e){this.state[id]={...this.state[id],status:'uncertain',error:String(e.message).slice(0,200)};this.save();throw e;}
  })();this.pending.set(id,work);work.finally(()=>this.pending.delete(id)).catch(()=>{});return work;
 }
}
