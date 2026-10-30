// events: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["KNOWN_AGENT_TOKENS","SENSITIVE_RE","SILENT_MARKER","SILENT_TURN_TIMEOUT_MS","activeWaits","api","appendActivity","appendToolLog","armPendingWakeLease","buildWakeReminderPromptV2","cancelPendingEntry","cfg","clearAllPendingWakeLeases","clearTimeout","collectors","createTurnCollector","currentMode","defaultWakeConfigV2","deliverPrompt","deliveryOutbox","disarmPendingWakeLease","ensureWakeableV2","getSocialV2State","guestWhere","handleCompanionActions","handleTaskRequest","isCurrentSession","isGuestKey","isOwnerKey","isScheduledSession","isSendToolName","isSilentMarker","isSocialEnabled","lastSendSucceeded","learnerCollectors","learnerSessions","learnerWaiters","log","markReadCalledKeys","mdToPlain","noteGuestChat","noteGuestDigest","noteModelError","noteModelHealthy","noteOwnerChat","observeOrchestratorFrame","orchestrationTurn","orchestrator","pendingSendToolCalls","pendingWakeKeys","planSocialTimeline","progressBlock","recordSessionSnapshot","recordSessionUsage","registerPending","replayPendingWakeReasonsV2","reverse","sanitizeToolArgs","saveSocialV2State","sayBridge","sendBurstToQQ","sendToQQ","sendToolSucceededSessions","sessionActualModels","setTimeout","shouldAuditKey","shouldBlockSilentReply","slangLearnerSessionId","sleep","social","socialState","splitChatSegments","taskCollectors","taskEvent","taskProgress","taskSessions","toolCallNames","turnActualModels","turnLeaseNoted","turnProgress","v2TurnStartAt","wakeConfigMissCount","wakeConfigUpdatedKeys","withoutProgress"];
export function createEvents(deps){
// DSH 事件流 → QQ

  /**
   * 把一条 session/event 喂给该会话的 turn collector，并维护 collectors 的生命周期。
   *
   * 两条不变量（都曾被真实故障踩过）：
   *   ① 只为 turn/start 建 collector —— 任何事件都建的话，一条重连后补发的
   *      assistant/message 就会留下永不结束的空 collector，而「会话是否繁忙」正是按
   *      collectors.has() 判断的 ⇒ 这个会话从此再也收不到唤醒；
   *   ② turn/end 即使没有匹配的 turn/start（重连快照没带上）也要清掉已成空壳的
   *      collector，否则同样会永久繁忙。
   */
  function trackTurnEvent(sessionId, event) {
    if(deps.orchestrator&&event?.type==='turn/start')deps.orchestrationTurn.set(sessionId,event.data?.turn);
    let collector = deps.collectors.get(sessionId);
    if (!collector && event?.type === 'turn/start') {
      collector = deps.createTurnCollector();
      deps.collectors.set(sessionId, collector);
    }
    const ended = collector ? collector.push(event) : null;
    if(ended&&deps.orchestrator?.store.get('stopped_turn',sessionId+':'+ended.turn)){deps.collectors.delete(sessionId);deps.v2TurnStartAt.delete(sessionId);deps.turnLeaseNoted.delete(sessionId);return {collector,ended:null};}
    if (ended) {
      // 回合正常收尾：collector 立刻释放。v2TurnStartAt 留给调用方（无行动判定要用它），
      // 调用方在 `if (ended)` 分支里用完再删。
      deps.collectors.delete(sessionId);
    } else if (event?.type === 'turn/end' && (!collector || collector.size?.() === 0)) {
      deps.collectors.delete(sessionId);
      deps.v2TurnStartAt.delete(sessionId);
      deps.turnLeaseNoted.delete(sessionId);
    }
    return { collector, ended };
  }

async function pumpMux() {
    // 事件流重连退避：DSH 侧流被立刻关闭时（例如版本不兼容，见 issue #34），
    // 固定 3 秒重连会以每分钟 20 行的速度刷屏，真正有用的错误反而被淹没。
    let retryMs = 3000;
    let failureStreak = 0;
    for (;;) {
      let framesThisStream = 0;
      try {
        deps.log('连接 DSH 事件流…');
        for await (const envelope of deps.api.events.mux({})) {
          framesThisStream += 1;
          const frame = envelope.payload;
          deps.observeOrchestratorFrame(frame);
          // 会话开场快照：只喂 token 账本。它含**历史** turn/end，绝不能让它们走
          // session/event 通道 —— 否则桥接会把早已结束的回合当成新回合去发 QQ 回复。
          if (frame.type === 'session/snapshot') {
            deps.recordSessionSnapshot(frame.sessionId, frame.snapshot);
            if(deps.taskSessions.has(frame.sessionId)){
              const open=new Map();for(const event of frame.snapshot?.records||[]){if(event.type==='turn/start')open.set(event.data?.turn,[]);if(open.has(event.data?.turn))open.get(event.data.turn).push(event);if(event.type==='turn/end')open.delete(event.data?.turn);}
              if(open.size){const c=deps.createTurnCollector();for(const rows of open.values())for(const e of rows)c.push(e);deps.taskCollectors.set(frame.sessionId,c);}
            }
            continue;
          }
          if (frame.type === 'session/event') {
            // Token 记账放在最前面：无论会话是否仍属当前模式/是否学习会话，
            // 花掉的钱都是真的，都必须入账（归属由 resolveKey 决定）。
            deps.recordSessionUsage(frame.sessionId, frame.event);
            if(deps.taskEvent(frame.sessionId,frame.event))continue;
            const key = deps.reverse.get(frame.sessionId);
            if (!key) {
              // 黑话学习会话：只收集 turn，不发送 QQ，并唤醒等待中的学习任务。
              if (deps.learnerSessions.has(frame.sessionId)) {
                // 与主 collector 同样的道理（issue #26 的补充）：**只有 turn/start 才建** collector。
                // 迟到事件（session/end-seed、session/title、model/selection…）不会有 turn/end，
                // 若在这里顺手建一个，它会永远留在 learnerCollectors 里并吞掉后续 turn 事件，
                // 等待者要么拿不到结果、要么拿到错位的文本。
                let learnerCollector = deps.learnerCollectors.get(frame.sessionId) ?? null;
                if (!learnerCollector && frame.event.type === 'turn/start') {
                  learnerCollector = deps.createTurnCollector();
                  deps.learnerCollectors.set(frame.sessionId, learnerCollector);
                }
                const learnerEnded = learnerCollector ? learnerCollector.push(frame.event) : null;
                if (learnerEnded) {
                  deps.learnerCollectors.delete(frame.sessionId);
                  const waiters = deps.learnerWaiters.get(frame.sessionId) ?? [];
                  const waiter = waiters.shift();
                  if (waiters.length === 0) deps.learnerWaiters.delete(frame.sessionId);
                  if (waiter) {
                    deps.clearTimeout(waiter.timer);
                    if (learnerEnded.reason.kind === 'completed' && learnerEnded.text.trim()) {
                      waiter.resolve(learnerEnded.text);
                    } else {
                      waiter.reject(new Error(`学习会话 turn 未正常完成：${learnerEnded.reason.kind}`));
                    }
                  }
                  // 旧学习会话 turn 结束后从集合移除，避免残留
                  if (frame.sessionId !== deps.slangLearnerSessionId) deps.learnerSessions.delete(frame.sessionId);
                }
              }
              continue;
            }
            // 追踪当前 turn 是否成功调用过 MCP 发送类工具：
            if (!deps.isCurrentSession(key, frame.sessionId)&&!deps.isScheduledSession(key,frame.sessionId)) continue;
            // 只有“发送成功”才跳过自动转发；如果工具调用失败，仍允许 AI 的文本正常发出。
            if (frame.event.type === 'turn/start') {
              deps.turnActualModels.set(frame.sessionId, deps.sessionActualModels.get(frame.sessionId));
              deps.sendToolSucceededSessions.delete(frame.sessionId);
              deps.pendingSendToolCalls.delete(frame.sessionId);
              deps.v2TurnStartAt.set(frame.sessionId, Date.now());
              deps.turnLeaseNoted.delete(frame.sessionId);
            }
            if(deps.currentMode==='closed-agent'&&deps.isOwnerKey(key)&&deps.isCurrentSession(key,frame.sessionId)&&!(deps.social.silentTurns.get(frame.sessionId)?.length)){
              if(frame.event.type==='tool/call'){
                let j=deps.turnProgress.get(frame.sessionId);
                if(!j){j=deps.taskProgress.create(key,'当前会话工具操作',{status:'running',sessionId:frame.sessionId,kind:'chat_tools'});deps.turnProgress.set(frame.sessionId,j);}
                deps.taskProgress.update(j,{stage:'正在执行工具，等待结果'});
              }
              if(frame.event.type==='tool/result'){
                const j=deps.turnProgress.get(frame.sessionId);if(j)deps.taskProgress.update(j,{done:j.done+1,stage:'工具已返回，正在核对结果'});
              }
              if(frame.event.type==='assistant/message'){
                const j=deps.turnProgress.get(frame.sessionId);const msg=deps.progressBlock((frame.event.data?.message?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''));
                if(j&&msg){deps.taskProgress.update(j,{stage:msg,authoredProgress:msg});void deps.taskProgress.notify(j,msg,{authored:true}).catch(e=>deps.log('进度发送：'+e.message));}
              }
              if(frame.event.type==='turn/end'){
                const j=deps.turnProgress.get(frame.sessionId);if(j){deps.taskProgress.update(j,{status:j.status==='stopping'?'cancelled':frame.event.data?.reason?.kind==='completed'?'completed':'failed',stage:'回合结束'});deps.turnProgress.delete(frame.sessionId);}
              }
            }
            if (frame.event.type === 'tool/call') {
              const toolName = String(frame.event.data?.name ?? '');
              const callId = frame.event.data?.callId;
              const args = deps.sanitizeToolArgs(frame.event.data?.arguments ?? frame.event.data?.input ?? frame.event.data);
              deps.appendToolLog({ type: 'call', time: new Date().toISOString(), key, sessionId: frame.sessionId, tool: toolName, args });
              if (callId != null) {
                if (deps.isSendToolName(toolName)) {
                  let pending = deps.pendingSendToolCalls.get(frame.sessionId);
                  if (!pending) {
                    pending = new Set();
                    deps.pendingSendToolCalls.set(frame.sessionId, pending);
                  }
                  pending.add(callId);
                }
                let nameMap = deps.toolCallNames.get(frame.sessionId);
                if (!nameMap) {
                  nameMap = new Map();
                  deps.toolCallNames.set(frame.sessionId, nameMap);
                }
                nameMap.set(String(callId), toolName);
              }
            }
            if (frame.event.type === 'tool/result') {
              const callId = frame.event.data?.message?.source?.callId;
              const toolName = callId != null ? (deps.toolCallNames.get(frame.sessionId)?.get(String(callId)) ?? '') : '';
              const resultBlock = frame.event.data?.message?.content?.[0];
              const resultError = frame.event.data?.message?.isError === true || resultBlock?.isError === true;
              const errorText = resultError ? String(resultBlock?.text ?? resultBlock?.error ?? frame.event.data?.message?.error ?? '') : '';
              deps.appendToolLog({
                type: 'result',
                time: new Date().toISOString(),
                key,
                sessionId: frame.sessionId,
                tool: toolName,
                ok: !resultError,
                error: errorText ? deps.sanitizeToolArgs(errorText) : null
              });
              if (callId != null) {
                deps.toolCallNames.get(frame.sessionId)?.delete(String(callId));
                const pending = deps.pendingSendToolCalls.get(frame.sessionId);
                if (pending?.has(callId)) {
                  pending.delete(callId);
                  if (pending.size === 0) deps.pendingSendToolCalls.delete(frame.sessionId);
                  if (!resultError) {
                    deps.sendToolSucceededSessions.add(frame.sessionId);
                  }
                }
              }
            }
            // collector 生命周期见 trackTurnEvent()：只为 turn/start 建、空壳 turn/end 即清。
            const { ended } = trackTurnEvent(frame.sessionId, frame.event);
            if (ended) {
              // reserved2 无行动兜底：普通唤醒回合若既没发消息、也没 mark_read / set_wake_config，
              // 则累计 noActionCount；达到阈值后自动重置 WakeConfig，避免 AI 卡死。
              const silentQueueNow = deps.social.silentTurns.get(frame.sessionId) ?? [];
              const isSilentTurn = silentQueueNow.length > 0;
              if (deps.currentMode === 'reserved2' && key && !isSilentTurn) {
                const st = deps.getSocialV2State(key);
                const turnStart = deps.v2TurnStartAt.get(frame.sessionId) ?? 0;
                const sendToolHit = deps.sendToolSucceededSessions.has(frame.sessionId);
                // turn/start 丢了（重连后由快照补发的回合）就无从判断「这一轮有没有行动」：
                // 此时记 miss 会冤枉 AI，连续 3 次就把 AI 自己设的唤醒配置重置成默认值。
                if (turnStart > 0 || sendToolHit) {
                  const actionTaken = sendToolHit || (turnStart > 0 && st.lastActionAt >= turnStart);
                  if (actionTaken) {
                    st.wakeConfig.noActionCount = 0;
                  } else {
                    st.wakeConfig.noActionCount = (st.wakeConfig.noActionCount || 0) + 1;
                    const limit = Number(deps.cfg.socialV2?.wake?.noActionLimit) || 3;
                    if (st.wakeConfig.noActionCount >= limit) {
                      deps.log(`[reserved2] ${key} 连续 ${st.wakeConfig.noActionCount} 次唤醒无行动，重置唤醒配置`);
                      st.wakeConfig = deps.defaultWakeConfigV2();
                      st.bootstrapSent = true;
                      st.wakeConfig.noActionCount = 0;
                    }
                  }
                  deps.saveSocialV2State();
                } else {
                  deps.log(`[reserved2] ${key} 回合结束但缺少 turn/start（重连补发），跳过无行动计数`);
                }
              }
              deps.v2TurnStartAt.delete(frame.sessionId);
              deps.collectors.delete(frame.sessionId);
              deps.turnLeaseNoted.delete(frame.sessionId);
              const sendToolSucceeded = deps.sendToolSucceededSessions.has(frame.sessionId);
              deps.sendToolSucceededSessions.delete(frame.sessionId);
              deps.pendingSendToolCalls.delete(frame.sessionId);
              deps.toolCallNames.delete(frame.sessionId);
              // 标记本次 turn 是否为“活跃超时退场”发言（用于准确回到观望，避免把旧回复误判为退场）
              const isFarewell = deps.social.exitingSessions.has(frame.sessionId);
              if (isFarewell) deps.social.exitingSessions.delete(frame.sessionId);
              // 摘要投喂触发的 turn：回复静默（不发送到 QQ）。
              // 用 FIFO 时间戳队列 + 超时回收，避免计数残留吞掉后续正常回复。
              const silentQueue = deps.social.silentTurns.get(frame.sessionId) ?? [];
              const silentNow = Date.now();
              while (silentQueue.length && silentNow - silentQueue[0].ts > deps.SILENT_TURN_TIMEOUT_MS) silentQueue.shift();
              if (silentQueue.length > 0) {
                silentQueue.shift();
                if (silentQueue.length > 0) deps.social.silentTurns.set(frame.sessionId, silentQueue);
                else deps.social.silentTurns.delete(frame.sessionId);
                deps.log(`摘要投喂 turn 结束，静默 (${key})`);
                continue;
              }
              // reserved2 防遗忘：每次唤醒回合结束时，若 AI 没有调用 qq_set_wake_config 设置下一次唤醒条件，
              // 则发送提醒；连续未设置达到上限后重置为默认唤醒配置。静默/后台提醒回合已在上方 continue，不触发。
              if (deps.pendingWakeKeys.has(key)) {
                deps.pendingWakeKeys.delete(key);
                deps.disarmPendingWakeLease(key);
                if (deps.wakeConfigUpdatedKeys.has(key) || deps.markReadCalledKeys.has(key)) {
                  deps.ensureWakeableV2(deps.getSocialV2State(key), { key });
                  deps.wakeConfigUpdatedKeys.delete(key);
                  deps.markReadCalledKeys.delete(key);
                  deps.wakeConfigMissCount.delete(key);
                } else {
                  const currentMiss = (deps.wakeConfigMissCount.get(key) ?? 0) + 1;
                  const maxReminders = Number(deps.cfg.socialV2?.wake?.maxWakeConfigReminders) || 2;
                  if (currentMiss < maxReminders) {
                    deps.wakeConfigMissCount.set(key, currentMiss);
                    deps.pendingWakeKeys.add(key);
                    deps.armPendingWakeLease(key);
                    deps.deliverPrompt(key, deps.buildWakeReminderPromptV2(key)).then((result) => {
                      if (result && result.ok === false) {
                        deps.pendingWakeKeys.delete(key);
                        deps.disarmPendingWakeLease(key);
                      }
                    }).catch((error) => {
                      deps.pendingWakeKeys.delete(key);
                      deps.disarmPendingWakeLease(key);
                      deps.log(`[reserved2] ${key} 唤醒提醒投递失败: ${error?.message ?? error}`);
                    });
                    deps.log(`[reserved2] ${key} 未设置唤醒条件，发送提醒 (${currentMiss}/${maxReminders})`);
                  } else {
                    const st = deps.getSocialV2State(key);
                    st.wakeConfig = deps.defaultWakeConfigV2();
                    deps.saveSocialV2State();
                    deps.log(`[reserved2] ${key} 连续未设置唤醒条件，已重置为默认唤醒配置`);
                  }
                }
              }
              // 繁忙期间被暂存的唤醒原因：当前 turn 结束后补一次（定时器类与消息类语义不同，
              // 详见 replayPendingWakeReasonsV2 的注释）。
              deps.replayPendingWakeReasonsV2(key);
              if (ended.reason.kind === 'completed' && deps.turnActualModels.has(frame.sessionId)) deps.noteModelHealthy(deps.turnActualModels.get(frame.sessionId));
              if (ended.reason.kind === 'completed' && ended.text.trim()) {
                const plain = deps.mdToPlain(deps.withoutProgress(ended.text));
                // 纯 Markdown/空白输出按“无文本”处理，避免后续 planSocialTimeline 拿空串崩溃。
                if (!plain.trim()) {
                  deps.log(`agent 回复为空（仅格式/空白）(${key})`);
                  if (isFarewell) {
                    const st = deps.socialState(key);
                    if (st.phase === 'exiting') {
                      st.phase = 'idle';
                      st.activeDeadlineAt = 0;
                      st.activeExitAt = 0;
                      deps.log(`社交模式：${key} 空退场回合，回到观望`);
                    }
                  }
                  continue;
                }
                // 社交模式静默标记：AI 主动选择“潜水/不接话”，不发送到 QQ
                if (deps.isSilentMarker(plain)) {
                  deps.log(`社交模式：AI 选择静默（${deps.SILENT_MARKER}）(${key})`);
                  if (isFarewell) {
                    const st = deps.socialState(key);
                    if (st.phase === 'exiting') {
                      st.phase = 'idle';
                      st.activeDeadlineAt = 0;
                      st.activeExitAt = 0;
                      deps.log(`社交模式：${key} 退场选择静默，回到观望`);
                    }
                  }
                  continue;
                }
                // 本回合已经通过 MCP 发送工具成功发出消息：跳过自动转发，避免重复发送。
                if (sendToolSucceeded) {
                  deps.log(`工具已发送消息，跳过自动转发 (${key})`);
                  if (isFarewell) {
                    const st = deps.socialState(key);
                    if (st.phase === 'exiting') {
                      st.phase = 'idle';
                      st.activeDeadlineAt = 0;
                      st.activeExitAt = 0;
                      deps.log(`社交模式：${key} 工具发送后退场完成，回到观望`);
                    }
                  }
                  continue;
                }
                // 审计（对完整文本执行，避免截断漏判；这里只判断，不发送，避免双重发送）
                const hasKnownToken = [...deps.KNOWN_AGENT_TOKENS].some((t) => t && plain.includes(t));
                if (deps.shouldAuditKey(key) && (deps.SENSITIVE_RE.test(plain) || hasKnownToken)) {
                  deps.log(`⚠️ 回复被安全策略拦截 (${key})，疑似包含敏感信息${hasKnownToken ? '（含会话令牌）' : ''}`);
                  deps.appendActivity(`${key} agent 回复被拦截（疑似敏感信息${hasKnownToken ? '/会话令牌' : ''}）`);
                  if (deps.cfg.security?.interceptNotify !== false) {
                    await deps.sayBridge(key, '⚠️ 本条回复因疑似包含敏感信息（路径/凭据/会话令牌）被安全策略拦截，已记录并通知管理员。');
                  }
                  if (isFarewell) {
                    const st = deps.socialState(key);
                    if (st.phase === 'exiting') {
                      st.phase = 'idle';
                      st.activeDeadlineAt = 0;
                      st.activeExitAt = 0;
                      deps.log(`社交模式：${key} 退场发言被拦截，回到观望`);
                    }
                  }
                  continue;
                }
                // 仿真群友模式：时间线多段发送（主回复 + 可选二次补刀）
                if (deps.isSocialEnabled()) {
                  if (deps.shouldBlockSilentReply(key)) {
                    deps.log(`静默模式，拦截在途回复 (${key})`);
                    deps.appendActivity(`${key} 静默模式，拦截在途回复`);
                    if (isFarewell) {
                      const st = deps.socialState(key);
                      if (st.phase === 'exiting') {
                        st.phase = 'idle';
                        st.activeDeadlineAt = 0;
                        st.activeExitAt = 0;
                        deps.log(`社交模式：${key} 静默模式下退场回合被拦截，回到观望`);
                      }
                    }
                    continue;
                  }
                  const timeline = deps.planSocialTimeline(plain, deps.cfg.social);
                  const messages = timeline.main;
                  deps.log(`agent 回复 (${key}) ${plain.length} 字 → ${messages.length} 条`);
                  deps.appendActivity(`${key} agent 回复：${messages[0].slice(0, 80)}${messages.length > 1 ? '（分' + messages.length + '条）' : ''}${messages[0].length > 80 ? '…' : ''}`);
                  if (messages.length > 1) {
                    await deps.sendBurstToQQ(key, messages, deps.cfg.social);
                  } else {
                    await deps.sendToQQ(key, messages[0]);
                  }
                  // 发言后刷新活跃时间，并调度可能的二次补刀
                  const st = deps.socialState(key);
                  if (isFarewell) {
                    // 确认为退场发言：不再刷新活跃时间、不调度补刀，直接进入观望
                    st.phase = 'idle';
                    st.activeDeadlineAt = 0;
                    st.activeExitAt = 0;
                    deps.log(`社交模式：${key} 退场发言完成，进入观望`);
                  } else if (st.phase === 'exiting') {
                    // 退场期间有旧回复恰好完成：照常发出，但不把它当作退场，也不调度补刀
                    deps.log(`社交模式：${key} 退场期间旧回复完成，保持退场状态`);
                  } else {
                    if (deps.lastSendSucceeded(key)) {
                      st.lastActiveMessageAt = Date.now();
                      st.lastAiReplyAt = Date.now();
                      deps.log(`社交模式：发言完成，刷新活跃时间 (${key})`);
                    } else {
                      // 发送其实失败了（网关报错/超时/被限流）。旧代码照样刷新时间戳，
                      // 于是「我说过话了」这个判断被写进状态：主动发言概率被压低、
                      // 活跃调度往前走，而群里根本没收到消息。这里不刷新，让下一轮照常补上。
                      deps.log(`社交模式：${key} 本轮发言未送达（QQ 发送失败），不刷新活跃时间`);
                    }
                  }
                } else if (deps.currentMode === 'reserved2') {
                  deps.log(`[reserved2] AI 内部输出（不自动转发）(${key}): ${plain.slice(0, 80)}`);
                  deps.appendActivity(`${key} [reserved2] AI 内部输出：${plain.slice(0, 80)}${plain.length > 80 ? '…' : ''}`);
                } else {
                  if (deps.shouldBlockSilentReply(key)) {
                    deps.log(`静默模式，拦截在途回复 (${key})`);
                    deps.appendActivity(`${key} 静默模式，拦截在途回复`);
                    continue;
                  }
                  let replyText=plain;
                  if(deps.currentMode==='closed-agent') replyText=await deps.handleCompanionActions(key,plain,{sessionId:frame.sessionId,turn:ended.turn});
                  const segments = deps.splitChatSegments(replyText);
                  deps.log(`agent 回复 (${key}) ${plain.length} 字 → ${segments.length} 条`);
                  deps.appendActivity(`${key} agent 回复：${plain.slice(0, 80)}${plain.length > 80 ? '…' : ''}${segments.length > 1 ? '（分' + segments.length + '条）' : ''}`);
                  for (let si = 0; si < segments.length; si++) {
                    await deps.deliveryOutbox.deliver(`${key}:${frame.sessionId}:${ended.turn}:chat:${si}`,()=>deps.sendToQQ(key, segments[si]),{key,kind:'chat',sessionId:frame.sessionId,turn:ended.turn});
                    if (si < segments.length - 1) await new Promise((r) => deps.setTimeout(r, 3000 + Math.floor(Math.random() * 2000)));
                  }
                  if (deps.isGuestKey(key)) {
                    const [gk, gid] = key.split(':');
                    deps.noteGuestDigest({ dir: 'out', where: deps.guestWhere(key, gk, gid), text: replyText });
                    deps.noteGuestChat(key, { dir: 'out', text: replyText });
                  }
                  if (deps.currentMode === 'closed-agent' && deps.isOwnerKey(key)) deps.noteOwnerChat('out', replyText);
                }
              } else if (ended.reason.kind === 'error') {
                const msg = ended.reason.error?.message ?? '未知错误';
                const safeMsg = deps.shouldAuditKey(key) && deps.SENSITIVE_RE.test(msg) ? '（含敏感信息，已隐藏）' : msg.slice(0, 500);
                // 以前这里只发 QQ、不写日志：出问题时 bridge.log 里什么都没有，排查只能靠猜（PR #24）。
                deps.log(`⚠️ agent 处理出错 (${key})：${safeMsg}`);
                deps.noteModelError(msg.slice(0, 200), deps.turnActualModels.get(frame.sessionId)).catch(() => {});
                deps.appendActivity(`${key} agent 处理出错：${safeMsg.slice(0, 80)}`);
                await deps.sayBridge(key, `⚠️ agent 处理出错：${safeMsg}`);
                if (isFarewell) {
                  const st = deps.socialState(key);
                  if (st.phase === 'exiting') {
                    st.phase = 'idle';
                    st.activeDeadlineAt = 0;
                    st.activeExitAt = 0;
                    deps.log(`社交模式：${key} 退场发言出错，回到观望`);
                  }
                }
              } else if (ended.reason.kind === 'aborted') {
                deps.log(`⏹️ 回合被中止 (${key})`);
                await deps.sayBridge(key, '⏹️ 已停止');
                if (isFarewell) {
                  const st = deps.socialState(key);
                  if (st.phase === 'exiting') {
                    st.phase = 'idle';
                    st.activeDeadlineAt = 0;
                    st.activeExitAt = 0;
                    deps.log(`社交模式：${key} 退场发言中止，回到观望`);
                  }
                }
              } else if (!ended.text.trim()) {
                // completed 但没文本（纯工具调用回合）
                deps.log(`回合完成但无文本 (${key})`);
                if (isFarewell) {
                  const st = deps.socialState(key);
                  if (st.phase === 'exiting') {
                    st.phase = 'idle';
                    st.activeDeadlineAt = 0;
                    st.activeExitAt = 0;
                    deps.log(`社交模式：${key} 退场回合无文本，回到观望`);
                  }
                }
              }
            }
          } else if ((frame.type === 'question/requested' || frame.type === 'approval/requested') && deps.taskSessions.has(frame.sessionId)) {
            await deps.handleTaskRequest(frame);
          } else if ((frame.type === 'question/requested' || frame.type === 'approval/requested') && deps.learnerSessions.has(frame.sessionId)) {
            // 黑话学习会话不应向用户提问/请求审批；自动跳过，避免阻塞学习任务。
            try {
              if (frame.type === 'question/requested') {
                await deps.api.respond({
                  clientId: frame.clientId,
                  eventId: frame.eventId,
                  outcome: { kind: 'result', value: { answers: frame.questions.map((q) => ({ id: q.id, selected: [], custom: '' })) } }
                });
              } else {
                await deps.api.respond({
                  clientId: frame.clientId,
                  eventId: frame.eventId,
                  outcome: { kind: 'result', value: 'rejected' }
                });
              }
              deps.log('黑话学习会话自动跳过提问/审批');
            } catch (error) {
              deps.log('自动响应学习会话提问/审批失败:', error?.message ?? error);
            }
          } else if (frame.type === 'question/requested') {
            const key = deps.reverse.get(frame.sessionId);
            if (!key) continue;
            if (!deps.isCurrentSession(key, frame.sessionId)) { await deps.cancelPendingEntry({ ...frame, kind: 'question' }); continue; }
            const lines = frame.questions.map((q, i) => {
              const qText = String(q.question ?? '');
              const sensitive = deps.shouldAuditKey(key) && deps.SENSITIVE_RE.test(qText);
              if (sensitive) deps.log(`⚠️ 提问文本含敏感信息，已隐藏 (${key})`);
              const safeQuestion = sensitive ? '（含敏感信息，已隐藏）' : qText;
              let s = `${i + 1}. ${safeQuestion}`;
              if (q.options?.length) {
                const opts = q.options.map((o) => {
                  const label = String(o.label ?? '');
                  const optSensitive = deps.shouldAuditKey(key) && deps.SENSITIVE_RE.test(label);
                  if (optSensitive) deps.log(`⚠️ 提问选项含敏感信息，已隐藏 (${key})`);
                  return `「${optSensitive ? '（含敏感信息，已隐藏）' : label}」`;
                });
                s += '\n   ' + opts.join(' ');
              }
              return s;
            });
            await deps.sayBridge(key, '❓ agent 需要你回答：\n' + lines.join('\n') + '\n（直接回复选项文字或输入你的回答）');
            await deps.registerPending(key, { kind: 'question', rpcId: envelope.rpcId, sessionId: frame.sessionId, clientId: frame.clientId, eventId: frame.eventId, questions: frame.questions });
          } else if (frame.type === 'approval/requested') {
            const key = deps.reverse.get(frame.sessionId);
            if (!key) continue;
            if (!deps.isCurrentSession(key, frame.sessionId)) { await deps.cancelPendingEntry({ ...frame, kind: 'approval' }); continue; }
            const rawReason = frame.reason ?? '';
            const sensitiveReason = deps.shouldAuditKey(key) && deps.SENSITIVE_RE.test(rawReason);
            if (sensitiveReason) deps.log(`⚠️ 审批理由含敏感信息，已隐藏 (${key})`);
            const safeReason = sensitiveReason ? '（含敏感信息，已隐藏）' : rawReason;
            const reason = safeReason ? `\n理由：${safeReason}` : '';
            const rawToolName = frame.toolName ?? '';
            const sensitiveTool = deps.shouldAuditKey(key) && deps.SENSITIVE_RE.test(rawToolName);
            if (sensitiveTool) deps.log(`⚠️ 审批工具名含敏感信息，已隐藏 (${key})`);
            const safeToolName = sensitiveTool ? '（含敏感信息，已隐藏）' : rawToolName;
            await deps.sayBridge(key, `🔐 agent 请求审批：${safeToolName}${reason}\n回复「通过」或「拒绝」`);
            await deps.registerPending(key, { kind: 'approval', rpcId: envelope.rpcId, sessionId: frame.sessionId, clientId: frame.clientId, eventId: frame.eventId, toolName: frame.toolName });
          } else if (frame.type === 'stream/error') {
            deps.log('事件流错误:', frame.error);
          }
        }
        // 流正常关闭（服务端主动断开）不会抛错。以前这里什么都不打，日志看起来
        // 就像「连上了、然后又连一次」，完全看不出 DSH 把流关了。
        deps.log(`DSH 事件流已结束（本次收到 ${framesThisStream} 帧）`);
      } catch (error) {
        deps.log('事件流中断:', error?.message ?? error);
      } finally {
        // WebSocket 正常关闭和异常中断都会走到这里；必须清掉旧 turn 相关状态，
        // 否则重连后旧 collector/标记残留会导致回复重复累加或误判。
        deps.collectors.clear(); // 清除旧 turn collector，避免重连后残留导致重复累加
        deps.social.silentTurns.clear(); // 清除未消费的摘要静默名额，避免重连后吞掉正常回复
        deps.sendToolSucceededSessions.clear();
        deps.pendingSendToolCalls.clear();
        deps.v2TurnStartAt.clear();
        deps.toolCallNames.clear();
        deps.pendingWakeKeys.clear();
        deps.clearAllPendingWakeLeases();
        deps.social.exitingSessions.clear();
        deps.wakeConfigUpdatedKeys.clear();
        deps.markReadCalledKeys.clear();
        deps.wakeConfigMissCount.clear();
        // 长轮询（qq_wait_for_messages）的租约也要清：它的 req.on('close') 在事件流
        // 断开时不一定触发，残留租约会用 429 卡住该会话最长 15 分钟的等待工具。
        deps.activeWaits.clear();
      }
      if (framesThisStream > 0) {
        failureStreak = 0;
        retryMs = 3000;
      } else {
        failureStreak += 1;
        retryMs = Math.min(30000, retryMs * 2);
        if (failureStreak === 3) {
          deps.log('⚠️ 连续多次连上 DSH 事件流后一帧都没收到就断开：多半是 DSH 侧事件流协议/版本不匹配'
            + '（可在 DSH 里核对版本，或查看 issue #34）。已改为指数退避重连，不再每 3 秒刷屏。');
        }
      }
      await deps.sleep(retryMs);
    }
  }
return {trackTurnEvent,pumpMux};
}
