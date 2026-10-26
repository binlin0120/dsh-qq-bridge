export function companionDecision({now=Date.now(),enabled=false,ownerQuiet=false,busy=false,lastSharedAt=0,pending=false}={}){
 const d=new Date(now+8*3600000),hour=d.getUTCHours(),minute=d.getUTCMinutes();const slot=d.toISOString().slice(0,13);
 const reason=!enabled?'disabled':hour<8||hour>=23?'quiet_hours':minute<46||minute>=50?'not_due':ownerQuiet?'owner_quiet':pending?'previous_turn_unconfirmed':busy?'conversation_busy':lastSharedAt&&now-lastSharedAt<3600000?'recently_shared':null;
 return {eligible:reason===null,reason,slot};
}
