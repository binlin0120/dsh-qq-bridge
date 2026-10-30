// internal-model: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["STATE_DIR","api","beijingTime","cfg","clearTimeout","crypto","ensureChatModel","fs","internalPurposes","invocations","isOwnerKey","learnerSessions","learnerWaiters","loadGuestChat","modelLanes","ownerChat","path","readSessionLogLines","recallContext","resolvePresetName","scrubPrivate","temporal","unwrap","waitLearnerTurn","withTimeout"];
export function createInternalModel(deps){
// ── 一次性无工具会话：整理、写日记都用它 ────────────────────────────────
  async function pinInternalTitle(sessionId,label){
    return deps.unwrap(await deps.api.callUnary('session/rename',{sessionId,title:'鲸鲸内部：'+String(label).slice(0,60)}),'pin internal title');
  }

async function runMemoPrompt(text, timeoutMs = 180000, options = {}) {
    options={...options,effort:deps.cfg.dsh.reasoningEffort||'high'};if(options.signal?.aborted)throw Error('本轮已经停止');
    if(!options.laneAcquired)return deps.modelLanes.run(options.lane||'background',()=>runMemoPrompt(text,timeoutMs,{...options,laneAcquired:true}),{signal:options.signal});
    const purpose=options.purpose||(options.preset==='jingjing-worker'?'work_planner':'internal_task');
    if(!options.tracked){const scope=options.scope||options.contextKey||'internal';const id=deps.crypto.randomUUID(),start=Date.now();
      const audit=(status,error)=>deps.fs.appendFileSync(deps.path.join(deps.STATE_DIR,'invocation-attempts.jsonl'),JSON.stringify({id,at:Date.now(),purpose,scope,goalId:options.goalId,taskId:options.taskId,revision:options.revision,status,elapsedMs:Date.now()-start,sourceHash:deps.invocations.fingerprint(purpose,scope,[text,options.images?.length||0]),provider:deps.cfg.dsh.provider,model:deps.cfg.dsh.model,effort:options.effort||deps.cfg.dsh.reasoningEffort,error:error?deps.scrubPrivate(error).slice(0,200):null})+'\n',{mode:0o600});
      const call=async()=>{audit('started');try{const result=await runMemoPrompt(text,timeoutMs,{...options,purpose,tracked:true});audit('completed');return result;}catch(e){audit('blocked',e.message);throw e;}};
      return ['memory_summary','friend_memory_summary','weekly_diary_chunk','weekly_diary_summary','slang_extract','slang_research'].includes(purpose)?deps.invocations.run(purpose,scope,text,call,{resume:options.resume===true,metadata:{provider:deps.cfg.dsh.provider,model:deps.cfg.dsh.model}}):call();
    }
    if(options.contextKey&&!options.chain)text=deps.recallContext(options.contextKey,String(text).slice(-1500))+'\n'+text;
    if(options.chain&&!String(text).includes('【当前时间】'))text='【当前时间】'+deps.beijingTime(Date.now())+'\n'+text;
    if(!String(text).includes('【当前时间】'))text=deps.temporal.context(options.contextKey||'',{history:options.contextKey?(deps.isOwnerKey(options.contextKey)?deps.ownerChat:deps.loadGuestChat(options.contextKey)):[]})+'\n'+text;
    const preset = deps.resolvePresetName(options.preset || 'jingjing-memo', { strict: true });
    if (!preset) throw new Error('缺少 jingjing-memo 预设');
    const dir = deps.path.join(deps.STATE_DIR, options.preset==='jingjing-worker'?'worker-planner':'memo-agent');
    deps.fs.mkdirSync(dir, { recursive: true });
    let sessionId = null,abortMemo=null;
    try {
      const ws = deps.unwrap(await deps.api.workspace.create({ path: dir }), 'memo workspace.create');
      sessionId = deps.unwrap(await deps.api.sessions.create({ workspaceId: ws.workspace.workspaceId, agentPreset: preset }), 'memo session.create').sessionId;
      options.onSession?.(sessionId);
      await pinInternalTitle(sessionId,options.purpose||'内部整理');
      deps.learnerSessions.add(sessionId);
      deps.internalPurposes.set(sessionId,purpose);
      deps.api.events.follow(sessionId);
      await deps.ensureChatModel(sessionId);
      if(options.signal?.aborted)throw Error('本轮已经停止');
      const waiting = deps.waitLearnerTurn(sessionId, timeoutMs);waiting.catch(()=>{});
      abortMemo=()=>{for(const waiter of deps.learnerWaiters.get(sessionId)||[]){deps.clearTimeout(waiter.timer);waiter.reject(Error('本轮已经停止'));}deps.learnerWaiters.delete(sessionId);void deps.withTimeout(deps.api.stopSessionWork(sessionId),3000,'abort memo').catch(()=>{});};options.signal?.addEventListener('abort',abortMemo,{once:true});
      options.beforeRequest?.();
      const accepted = await deps.api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text },...(options.images||[])] });
      if (!accepted.result.ok){options.onRejected?.();throw new Error(`prompt 被拒：${accepted.result.error.code}`);}
      return String(await waiting).trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '').trim();
    } finally {
      if(abortMemo)options.signal?.removeEventListener('abort',abortMemo);
      if (sessionId) {
        deps.learnerSessions.delete(sessionId);
        deps.internalPurposes.delete(sessionId);
        try { await deps.withTimeout(deps.api.stopSessionWork(sessionId),3000,'memo stop'); } catch {}
        if(options.onStopped){try{const rows=deps.readSessionLogLines(sessionId)||[];options.onStopped(rows.filter(x=>['turn/start','turn/end'].includes(x.type)).at(-1)?.type==='turn/end');}catch{options.onStopped(false);}}
        try { await deps.withTimeout(deps.api.workspace.archiveSession({sessionId}),3000,'memo archive'); } catch {}
      }
    }
  }
return {pinInternalTitle,runMemoPrompt};
}
