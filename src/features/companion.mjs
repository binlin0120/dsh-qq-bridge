// companion: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["STATE_DIR","api","atomicWriteJson","auditAndSend","beijingTime","caps","cfg","chatTurnRunning","companionDecision","companionSettleBusy","companionTickBusy","dshReady","ensureChatModel","handleCompanionActions","historicalScene","internalPurposes","invocations","isSilentMarker","log","mediaJobs","memoryHistory","noteOutsideShare","noteOwnerChat","ownerChat","ownerMemoryScope","path","pinInternalTitle","readJsonSafe","readSessionLogLines","scrubPrivate","state","taskProgress","temporal","unwrap"];
export function createCompanion(deps){
function harvestCompanionText(rows,sinceMs){
    let start=-1;
    for(let i=0;i<rows.length;i++){if(rows[i].type==="turn/start"&&Number(rows[i].time||0)>=sinceMs-5000)start=i;}
    if(start<0)return "";
    const parts=[];
    for(let i=start+1;i<rows.length;i++){
      const r=rows[i];
      if(r.type==="turn/end")break;
      if(r.type!=="assistant/message")continue;
      const content=r.data?.message?.content;
      if(!Array.isArray(content))continue;
      for(const part of content)if(part?.type==="text"&&part.text)parts.push(String(part.text));
    }
    return parts.join("\n").trim();
  }

async function deliverCompanionShare(pending,text){
    const key=`private:${deps.cfg.ownerQQ}`;
    let body=String(text??"").trim();
    if(!body||deps.isSilentMarker(body)){deps.log("主动分享：本轮不分享（静默）");return;}
    body=String(await deps.handleCompanionActions(key,body,{sessionId:pending.sessionId})??"").trim();
    if(!body||deps.isSilentMarker(body)){deps.log("主动分享：本轮只有媒体动作，无正文代发");return;}
    const ok=await deps.auditAndSend(key,body);
    if(ok){deps.noteOwnerChat("out",`（你主动发的分享）${body}`,{kind:"companion_share"});deps.noteOutsideShare(key,body);deps.log(`主动分享已由桥接代发（${body.length} 字）`);}
    else deps.log("主动分享代发未成功（发送失败或被安全策略拦截）");
  }

async function settleCompanionPending(runtime){
    const pending=runtime.pending;if(!pending||deps.companionSettleBusy)return;
    deps.companionSettleBusy=true;
    try{
      const rows=deps.readSessionLogLines(pending.sessionId);if(!rows)return;
      const end=rows.filter(x=>x.type==="turn/start"||x.type==="turn/end").at(-1);
      const finished=end?.type==="turn/end"&&Number(end.time)>=Number(pending.at);
      if(!finished){
        if(Date.now()-Number(pending.at)>30*60000){delete runtime.pending;deps.atomicWriteJson(deps.path.join(deps.STATE_DIR,"companion-runtime.json"),runtime);deps.log("主动分享：上一回合超时未结束，已放弃等待");}
        return;
      }
      delete runtime.pending;deps.atomicWriteJson(deps.path.join(deps.STATE_DIR,"companion-runtime.json"),runtime);
      if(pending.viaBridge!==true)return;
      await deliverCompanionShare(pending,harvestCompanionText(rows,Number(pending.at)));
    }catch(e){deps.log("主动分享代发异常："+deps.scrubPrivate(e.message));}
    finally{deps.companionSettleBusy=false;}
  }

async function companionTick({dryRun=false}={}){
    const schedule=deps.readJsonSafe(deps.path.join(deps.STATE_DIR,'companion-schedule.json'),null),key=`private:${deps.cfg.ownerQQ}`;
    const runtime=deps.readJsonSafe(deps.path.join(deps.STATE_DIR,'companion-runtime.json'),{});
    if(runtime.pending&&!dryRun)await settleCompanionPending(runtime);
    const preliminary=deps.companionDecision({enabled:schedule?.enabled===true});if(!preliminary.eligible)return {ok:true,dryRun,skipped:true,...preliminary,newModelCalls:0};
    if(deps.invocations.data[deps.invocations.key('companion_share',key,preliminary.slot)])return {ok:true,dryRun,skipped:true,reason:'occurrence_already_processed',newModelCalls:0};
    const lastShare=Math.max(0,...deps.memoryHistory(deps.ownerMemoryScope,deps.ownerChat).filter(x=>x.dir==='out'&&x.text.startsWith('（你主动发的分享）')).map(x=>x.at),...Object.values(deps.mediaJobs.data).filter(j=>j.character&&j.direct===false&&j.status==='completed').map(j=>j.doneAt||0));
    const decision=deps.companionDecision({enabled:schedule?.enabled===true,ownerQuiet:deps.state.ownerQuiet,busy:!deps.dshReady||deps.chatTurnRunning(key)||!!deps.taskProgress.current(key)||deps.companionTickBusy,lastSharedAt:lastShare,pending:!!runtime.pending});
    if(dryRun||!decision.eligible)return {ok:true,dryRun,skipped:!decision.eligible,...decision,newModelCalls:0};
    deps.companionTickBusy=true;
    try{
      const result=await deps.invocations.run('companion_share',key,decision.slot,async()=>{
        const sessionId=schedule.sessionId;if(!sessionId)throw Error('主动分享没有已迁移会话');
        await deps.pinInternalTitle(sessionId,'鲸鲸空闲时间');await deps.ensureChatModel(sessionId);deps.internalPurposes.set(sessionId,'companion_share');deps.api.events.follow(sessionId);
        const prompt=deps.temporal.context(key,{history:deps.ownerChat})+'\n'+schedule.prompt+'\n【本轮已核实近况】'+JSON.stringify({recentMessages:deps.memoryHistory(deps.ownerMemoryScope,deps.ownerChat).filter(x=>x.dir==='out').slice(-6).map(({at,text})=>({at:deps.beijingTime(at),text})),recentLife:(deps.caps.data.lifeHistory||[]).slice(-2).map(x=>deps.historicalScene(x.scene,x.at,x.deliveredAt))})+'；状态已随本轮提供，无需为读取同一份状态重复查接口。'+'\n【本轮怎么发（桥接代发，覆盖前面的旧说明）】你现在没有任何工具可用，不用调用任何接口，也不要在正文里提工具或接口。想分享，就把要发给机主的话直接写成本轮回复正文，桥接会替你发到他的 QQ；要配照片就在正文里写【发照片：场景描述】，发表情写【发表情包：含义】。不想发就只回复 [SILENT]，不要附带解释或总结——多写出来的内容同样会被发给他。';
        runtime.pending={sessionId,slot:decision.slot,at:Date.now(),viaBridge:true};deps.atomicWriteJson(deps.path.join(deps.STATE_DIR,'companion-runtime.json'),runtime);
        const accepted=await deps.api.sessions.prompt({sessionId,mode:'queue',content:[{type:'text',text:prompt}]});if(!accepted.result.ok)deps.unwrap(accepted,'companion prompt');
        return {accepted:true,sessionId,slot:decision.slot};
      },{metadata:{provider:deps.cfg.dsh.provider,model:deps.cfg.dsh.model,trigger:'daylight_companion_tick'}});
      return {ok:true,...result};
    }catch(e){if(e.code==='BACKGROUND_BLOCKED')return {ok:true,skipped:true,reason:'occurrence_already_processed'};throw e;}
    finally{deps.companionTickBusy=false;}
  }
return {harvestCompanionText,deliverCompanionShare,settleCompanionPending,companionTick};
}
