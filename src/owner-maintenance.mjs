
import crypto from 'node:crypto';
export function maintenancePurpose(text){
 const s=String(text||'').trim();
 if(!s||/^(?:如果|假如|假设|要是|他说|她说|引用|示例|例子)|(?:有什么风险|什么后果|有没有.{0,4}能力|支持.{0,8}吗|会不会.{0,8}危险)/.test(s))return null;
 if(/^(?:别|不要|不用|不必|禁止|不许).{0,20}(?:操作|执行|传|转|发|提醒|加|改|删|重启|查)/.test(s))return null;
 const action=/(?:帮|请|给我|把|替我|查|看|检查|排查|设|加|改|删|取消|重启|停止|启动|同意|通过|拒绝|转发|发给|发到|告诉|提醒我)/.test(s);if(!action)return null;
 if(/(?:照片|图片|原图|那张|这张)/.test(s)&&/转发|重发|发到|发给/.test(s))return 'forward';
 if(/传话|带句话|告诉.{0,25}(?:说|我)|给.{0,30}(?:发|回|传|带).{0,10}(?:消息|句话|话)|(?:跟|和).{0,20}说/.test(s))return 'relay';
 if(/提醒|闹钟|定时|课表|日程/.test(s))return 'schedule';
 if(/笔记|交接|记忆/.test(s)&&/读|看|查/.test(s))return 'memory_read';
 if(/好友|申请|邀请/.test(s))return 'friend';
 if(/群/.test(s)&&/禁言|踢|退群|公告|群名|群头衔|管群|群设置/.test(s))return 'group';
 if(/服务器|服务|配置|日志|进程|项目|目录|文件路径|账号|凭据|宿主/.test(s))return 'host';
 return null;
}
export class OwnerMaintenanceBroker{
 constructor({store,allowed,source,find,create}){Object.assign(this,{store,allowed,source,find,create});}
 async submit(key,sourceId,action){
  if(!this.allowed(key))throw Error('这项维护只接受owner当前私聊授权');
  const source=this.source(key,sourceId);if(!source||source.owner!==key||!source.id)throw Error('维护来信来源没有核实');
  const purpose=maintenancePurpose(source.text);if(!purpose||purpose!==action.purpose)throw Error('这条来信没有明确授权这类维护，尚未执行');
  const id=crypto.createHash('sha256').update(JSON.stringify([key,sourceId])).digest('hex');
  const old=this.store.get('owner_maintenance',id),job=this.find(id);
  if(job){const r={id,jobId:job.id,purpose,status:job.status,engine:'legacy_owner_maintenance'};this.store.put('owner_maintenance',id,{...old,...r});return r;}
  if(old)throw Error('上次维护派发结果尚未核实，没有重复启动');
  const record={id,sourceId,purpose,key,status:'intent',at:Date.now()};this.store.put('owner_maintenance',id,record);
  try{const j=await this.create({id,key,sourceId,purpose,text:source.text});const r={...record,status:'accepted',jobId:j.id,engine:'legacy_owner_maintenance'};this.store.put('owner_maintenance',id,r);return r;}catch(e){this.store.put('owner_maintenance',id,{...record,status:'uncertain',error:String(e.message)});throw e;}
 }
}
