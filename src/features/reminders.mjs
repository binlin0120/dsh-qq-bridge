// reminders: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["REMINDER_FILE","atomicWriteJson","cfg","noteOwnerChat","reminderBusy","reminderKey","reminderLedger","reminderPermits","sendToQQ"];
export function createReminders(deps){
async function tickReminders() {
    if(deps.reminderBusy)return;deps.reminderBusy=true;
    try {
      for(const r of Object.values(deps.reminderPermits)) {
        if(r.status!=='pending'||Date.now()<r.at)continue;
        if(Date.now()-r.at>15*60000){r.status='expired';deps.atomicWriteJson(deps.REMINDER_FILE,deps.reminderPermits);continue;}
        r.status='sending';r.used=true;deps.atomicWriteJson(deps.REMINDER_FILE,deps.reminderPermits);
        const key=`private:${deps.cfg.ownerQQ}`,deliveryId=deps.reminderKey(key,r.at,r.eventKey||r.text);
        if(!deps.reminderLedger.claim(deliveryId,{target:key,due:r.at})){r.status=deps.reminderLedger.get(deliveryId)?.status||'uncertain';deps.atomicWriteJson(deps.REMINDER_FILE,deps.reminderPermits);continue;}
        let receipt;try{receipt=await deps.sendToQQ(key,'⏰ '+r.text);}catch(e){receipt={ok:false,error:e.message};}
        r.status=receipt?.ok&&receipt.messageIds?.length?'sent':'uncertain';r.messageIds=receipt?.messageIds||[];r.doneAt=Date.now();deps.reminderLedger.finish(deliveryId,r.status,receipt);deps.atomicWriteJson(deps.REMINDER_FILE,deps.reminderPermits);
        if(r.status==='sent')deps.noteOwnerChat('out','⏰ '+r.text);
      }
    }finally{deps.reminderBusy=false;}
  }

async function isRegisteredReminder(message) {
    const marker=/^⏰\s*\[([a-f0-9-]{36})\]/.exec(message);
    if(!marker) return false; const permit=deps.reminderPermits[marker[1]];
    if(!permit || permit.used || Date.now()<permit.at-120000 || Date.now()>permit.at+15*60000) return false;
    return true;
  }
return {tickReminders,isRegisteredReminder};
}
