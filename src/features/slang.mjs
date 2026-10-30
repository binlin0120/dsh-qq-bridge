// slang: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["SLANG_FILE","SLANG_MAX_ENTRIES","SLANG_SESSION_FILE","SLANG_STATUS","STATE_DIR","api","atomicWriteJson","buildExtractionPrompt","buildResearchPrompt","buildSlangContext","cfg","chatTurnRunning","dshReady","ensureChatModel","fs","isOwnerKey","lastSlangResearchAt","learnerCollectors","learnerSessions","learnerWaiters","loadGuestChat","log","orchestrator","ownerChat","parseExtractionJson","parseResearchJson","path","pendingSlangResearch","readJsonSafe","resetControlContext","resolvePresetName","runMemoPrompt","saveSlang","setTimeout","slangEntries","slangExtractionCooldowns","slangLearnerSessionId","slangResearchingIds","slangStoreWritable","slangSubmitTimes","slangTaskChain","slangWindows","taskProgress","temporal","truncateText","unwrap","upsertSlangEntry","work"];
export function createSlang(deps){
function saveSlangStore() {
    if (!deps.slangStoreWritable) {
      deps.log('⚠️ 黑话库处于只读降级状态（启动时加载失败），本次改动不落盘');
      return;
    }
    try {
      const result = deps.saveSlang(deps.SLANG_FILE, deps.slangEntries);
      if (result?.dropped > 0) {
        deps.slangEntries = result.entries;
        deps.log(`黑话库超过 ${deps.SLANG_MAX_ENTRIES} 条上限，已按「已确认优先」丢弃 ${result.dropped} 条最不活跃的词条`);
      }
    } catch (error) { deps.log('保存黑话库失败:', error?.message ?? error); }
  }

function queueSlangTask(fn) {
    deps.slangTaskChain = deps.slangTaskChain.then(fn).catch((error) => deps.log('黑话学习任务异常:', error?.message ?? error));
    return deps.slangTaskChain;
  }

async function ensureSlangLearnerSession() {
    const preset = deps.resolvePresetName(deps.cfg.slang?.learnerPreset || deps.cfg.agentPreset, { strict: true });
    if (!preset) throw new Error('黑话学习缺少已验证的安全 preset，拒绝创建或复用会话');
    const saved = deps.readJsonSafe(deps.SLANG_SESSION_FILE, null);
    // 旧记录没有 preset 元数据，无法证明其权限，必须重新创建。
    if (saved?.preset !== preset) invalidateSlangLearnerSession();
    if (deps.slangLearnerSessionId) {
      deps.learnerSessions.add(deps.slangLearnerSessionId);
      deps.api.events.follow(deps.slangLearnerSessionId);
      return deps.slangLearnerSessionId;
    }
    if (saved?.sessionId && saved.preset === preset) {
      deps.slangLearnerSessionId = String(saved.sessionId);
      deps.learnerSessions.add(deps.slangLearnerSessionId);
      deps.api.events.follow(deps.slangLearnerSessionId);
      await deps.ensureChatModel(deps.slangLearnerSessionId);
      return deps.slangLearnerSessionId;
    }
    const dir = deps.path.join(deps.STATE_DIR, 'slang-agent');
    deps.fs.mkdirSync(dir, { recursive: true });
    const wsValue = deps.unwrap(await deps.api.workspace.create({ path: dir }), 'slang workspace.create');
    const workspaceTitle = deps.cfg.slang?.workspaceTitle || 'QQ 黑话学习';
    if (wsValue.created && workspaceTitle) {
      try { await deps.api.workspace.rename({ workspaceId: wsValue.workspace.workspaceId, title: workspaceTitle }); } catch {}
    }
    const params = { workspaceId: wsValue.workspace.workspaceId };
    params.agentPreset = preset;
    const value = deps.unwrap(await deps.api.sessions.create(params), 'slang session.create');
    deps.slangLearnerSessionId = value.sessionId;
    deps.learnerSessions.add(deps.slangLearnerSessionId);
    deps.api.events.follow(deps.slangLearnerSessionId);
    await deps.ensureChatModel(deps.slangLearnerSessionId);
    deps.fs.mkdirSync(deps.STATE_DIR, { recursive: true });
    deps.atomicWriteJson(deps.SLANG_SESSION_FILE, { sessionId: deps.slangLearnerSessionId, preset });
    deps.log(`黑话学习会话已创建：${deps.slangLearnerSessionId}`);
    return deps.slangLearnerSessionId;
  }

function invalidateSlangLearnerSession() {
    // 如果在途任务仍在使用旧会话，先保留 learnerSessions 以便事件继续被消费；
    // 没有等待/收集中的旧会话才从集合移除。
    const oldId = deps.slangLearnerSessionId;
    deps.slangLearnerSessionId = null;
    if (oldId && !deps.learnerWaiters.has(oldId) && !deps.learnerCollectors.has(oldId)) {
      deps.learnerSessions.delete(oldId);
    }
    try { deps.fs.unlinkSync(deps.SLANG_SESSION_FILE); } catch {}
  }

function waitLearnerTurn(sessionId, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const timer = deps.setTimeout(() => {
        const arr = deps.learnerWaiters.get(sessionId) ?? [];
        const idx = arr.findIndex((w) => w.timer === timer);
        if (idx >= 0) arr.splice(idx, 1);
        if (arr.length === 0) deps.learnerWaiters.delete(sessionId);
        reject(new Error(`等待学习会话 turn 超时(${timeoutMs}ms)`));
      }, timeoutMs);
      const waiter = { resolve, reject, timer };
      const arr = deps.learnerWaiters.get(sessionId) ?? [];
      arr.push(waiter);
      deps.learnerWaiters.set(sessionId, arr);
    });
  }

async function runSlangExtraction(key) {
    if (deps.cfg.slang?.enabled === false) return;
    if (!deps.dshReady) return;
    const messages = deps.slangWindows.get(key) ?? [];
    const min = Math.max(1, Number(deps.cfg.slang?.extractMinMessages ?? 30));
    if (messages.length < min) return;

    const promptText=deps.buildExtractionPrompt(messages);
    try {
      const output=await deps.runMemoPrompt(promptText,120000,{purpose:'slang_extract',scope:key,effort:'low'});
      const items = deps.parseExtractionJson(output);
      if (!items.length) {
        deps.log(`黑话提取：${key} 未发现候选`);
        const win = deps.slangWindows.get(key) ?? [];
        deps.slangWindows.set(key, win.slice(messages.length));
        return;
      }
      let added = 0;
      let updated = 0;
      const researchCandidates = [];
      const thresholds = Array.isArray(deps.cfg.slang?.inferenceThresholds) ? deps.cfg.slang.inferenceThresholds.map(Number).filter(Boolean) : [2, 4, 8];
      const seenContents = new Set();
      for (const item of items) {
        if (seenContents.has(item.content)) continue;
        seenContents.add(item.content);
        const idx = Number(item.source_id) - 1;
        const src = Number.isInteger(idx) && idx >= 0 && idx < messages.length ? messages[idx] : null;
        const evidence = src ? [{ key, sender: src.sender, text: src.text, time: src.time }] : [];
        const result = deps.upsertSlangEntry(deps.slangEntries, item.content, { evidence, countIncrement: 1 });
        if (result.created) added += 1; else updated += 1;
        if (result.entry && result.entry.status === deps.SLANG_STATUS.CANDIDATE && thresholds.includes(result.entry.count) && result.entry.count > result.entry.lastInferenceCount) {
          researchCandidates.push(result.entry);
        }
      }
      const win = deps.slangWindows.get(key) ?? [];
      deps.slangWindows.set(key, win.slice(messages.length));
      saveSlangStore();
      deps.log(`黑话提取：${key} 新增 ${added} 条，更新 ${updated} 条`);
      if (researchCandidates.length && deps.cfg.slang?.autoResearch !== false) {
        queueSlangTask(() => runSlangResearch(researchCandidates));
      }
    } catch (error) {
      if (/会话|session|not found|404/i.test(String(error?.message ?? error))) {
        invalidateSlangLearnerSession();
      }
      deps.log(`黑话提取失败 (${key}):`, error?.message ?? error);
    }
  }

async function runSlangResearch(candidates) {
    for(const e of candidates||[])if(e?.id)deps.pendingSlangResearch.set(e.id,e);
    if(Date.now()-deps.lastSlangResearchAt<1800000||deps.taskProgress.current(`private:${deps.cfg.ownerQQ}`)||deps.chatTurnRunning(`private:${deps.cfg.ownerQQ}`))return;
    candidates=[...deps.pendingSlangResearch.values()];deps.pendingSlangResearch.clear();deps.lastSlangResearchAt=Date.now();
    if (!candidates || !candidates.length) return;
    if (deps.cfg.slang?.enabled === false) return;
    if (!deps.dshReady) return;
    // 过滤掉已经在研究队列里的候选，避免同一批被重复排队研究。
    const targets = candidates.filter((e) => e && !deps.slangResearchingIds.has(e.id));
    if (!targets.length) return;
    for (const e of targets) deps.slangResearchingIds.add(e.id);
    const promptText=deps.buildResearchPrompt(targets);
    try {
      const output=await deps.runMemoPrompt(promptText,120000,{purpose:'slang_research',scope:'shared_slang',effort:'low'});
      const results = deps.parseResearchJson(output);
      for (const r of results) {
        const entry = deps.slangEntries.find((e) => e.content === r.content);
        if (!entry) continue;
        // 只有明确确认（confirmed: true）的结果才写入解释字段；
        // 不确定/未确认的结果保留原状，允许后续再次研究。
        if (r.confirmed !== true) {
          deps.log(`黑话研究：${r.content} 未确认，保留候选待后续研究`);
          continue;
        }
        if (r.meaning) entry.meaning = r.meaning;
        if (r.usage) entry.usage = r.usage;
        if (r.example) entry.example = r.example;
        if (r.risk) entry.risk = r.risk;
        if (Array.isArray(r.sources) && r.sources.length) entry.sources = r.sources.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 10);
        entry.lastInferenceCount = entry.count;
        entry.updatedAt = new Date().toISOString();
      }
      saveSlangStore();
      deps.log(`黑话研究：已更新 ${results.length} 条候选解释`);
    } catch (error) {
      if (/会话|session|not found|404/i.test(String(error?.message ?? error))) {
        invalidateSlangLearnerSession();
      }
      deps.log('黑话研究失败:', error?.message ?? error);
    } finally {
      for (const e of targets) deps.slangResearchingIds.delete(e.id);
    }
  }

function maybeQueueSlangExtraction(key) {
    if (deps.cfg.slang?.enabled === false) return;
    if (!deps.dshReady || deps.taskProgress.current(`private:${deps.cfg.ownerQQ}`) || deps.chatTurnRunning(`private:${deps.cfg.ownerQQ}`)) return;
    const cooldown = Number(deps.cfg.slang?.extractCooldownMs ?? 1800000);
    const last = deps.slangExtractionCooldowns.get(key) ?? 0;
    if (Date.now() - last < cooldown) return;
    const messages = deps.slangWindows.get(key) ?? [];
    const min = Math.max(1, Number(deps.cfg.slang?.extractMinMessages ?? 30));
    if (messages.length < min) return;
    deps.slangExtractionCooldowns.set(key, Date.now());
    queueSlangTask(() => runSlangExtraction(key));
  }

// 黑话学习素材入口：群聊普通消息进入滚动窗口（命令/角色控制语不学；
  // 只学当前消息自己的文字，不学引用原文）。一代/二代共用。
  function feedSlangWindow(key, sender, plainContent) {
    if (deps.cfg.slang?.enabled === false) return;
    if (!key || !plainContent || typeof plainContent !== 'string') return;
    const text = plainContent.trim();
    if (!text || text.startsWith('/')) return;
    if (/进入角色扮演|退出角色扮演|切换角色|设置角色|改角色|换角色|关闭角色扮演|开启角色扮演/.test(text)) return;
    if (!deps.slangWindows.has(key)) deps.slangWindows.set(key, []);
    const win = deps.slangWindows.get(key);
    win.push({ sender: String(sender || '未知'), text: deps.truncateText(text, 200), time: Date.now() });
    if (win.length > 80) win.splice(0, win.length - 80);
    maybeQueueSlangExtraction(key);
  }

// AI 提交黑话候选的限频：防止单个会话在短时间内刷大量候选。
  function allowSlangSubmit(key) {
    const now = Date.now();
    const arr = (deps.slangSubmitTimes.get(key) ?? []).filter((t) => now - t < 60 * 60 * 1000);
    const recentMinute = arr.filter((t) => now - t < 60 * 1000).length;
    const MAX_PER_MINUTE = 2;
    const MAX_PER_HOUR = 10;
    if (recentMinute >= MAX_PER_MINUTE || arr.length >= MAX_PER_HOUR) return false;
    arr.push(now);
    deps.slangSubmitTimes.set(key, arr);
    return true;
  }

// 返回给 AI 的“公开黑话条目”（只含安全展示字段，不泄露内部字段）。
  //
  // 刻意**不含 evidence**：证据行的形状是 `{ key, sender, text, time }`，
  // 其中 text 是提交该词条的那个会话里的消息片段、key 是那个会话的名字。
  // 黑话库是全群共享的，带上 evidence 就等于让 A 群的 AI 读到 B 群的会话名和原话。
  // 控制台要证据走 `GET /api/slang`（原始条目，含 evidence，仅控制台可达）。
  function publicSlangEntry(e) {
    return {
      id: e?.id ?? '',
      content: e?.content ?? '',
      meaning: e?.meaning ?? '',
      usage: e?.usage ?? '',
      example: e?.example ?? '',
      risk: e?.risk ?? '',
      status: e?.status ?? deps.SLANG_STATUS.CANDIDATE,
      source: e?.source ?? 'ai',
      count: Number(e?.count) || 0,
      updatedAt: e?.updatedAt ?? ''
    };
  }

// 已确认黑话的公开列表（按出现次数排序，最多 injectMax 条）。
  function confirmedSlangListV2() {
    const max = Math.max(1, Math.min(30, Number(deps.cfg.slang?.injectMax) || 8));
    return deps.slangEntries
      .filter((e) => e.status === deps.SLANG_STATUS.CONFIRMED && e.content && e.meaning)
      .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
      .slice(0, max)
      .map(publicSlangEntry);
  }

function withSlangContext(promptText,key='') {
    const history=key?(deps.isOwnerKey(key)?deps.ownerChat:deps.loadGuestChat(key)):[];
    const sourceId=/【本条来信索引：([a-f0-9-]+)】/.exec(promptText)?.[1];const message=sourceId?history.find(x=>x.id===sourceId):null;
    const timeLine=deps.temporal.context(key,{history,message});
    const parts = [timeLine];
    if(deps.isOwnerKey(key))parts.push(deps.resetControlContext(key),'【本轮相处要求】先接住他本句的具体意思，温柔亲近地继续聊。他说下周再做就尊重安排，不催作业、不数落、不把没做当品德问题；不能用颜文字包装挖苦。不捏造他的饮食、作息、经历，不说没有依据的“又”“平时那样”。纠错后直接改，不辩解。只有他明确要结束才收尾，不把普通回答当逐客信号，不反复说不吵你、你忙吧、想说再叫我。语气词自然使用，不硬凑。');
    if(deps.orchestrator&&deps.isOwnerKey(key)){
      const sid=sourceId||history.filter(x=>x.dir==='in').at(-1)?.id;if(sid&&!deps.orchestrator.store.get('source_context',key+':'+sid))deps.orchestrator.store.put('source_context',key+':'+sid,{goalVersions:Object.fromEntries(deps.orchestrator.context(key).map(g=>[g.goalId,g.revision])),maintenanceQuestions:Object.fromEntries(deps.taskProgress.list(key).filter(j=>j.maintenanceKey&&j.pendingRequest?.eventId).map(j=>[j.id,j.pendingRequest.eventId]))});
      parts.push('【协作控制】你仍然是鲸鲸，前台自然接话，复杂工作由受控代理执行，不能自己调用宿主命令、原生subagent/fork或直接QQ发送。简单聊天不派活。用户说你忙你的、我去喝水等闲聊，不是在问进度，不输出status，不主动汇报；只有真正在问任务情况才用status。需要时在正文后输出单行【协作：合法JSON】，其中action为create/revise/cancel/status/answer/resume/roster/owner_maintenance/owner_maintenance_control；sourceId必须是本轮来信索引。create包含request完整需求、online是否本次明确要求联网、review是否确需独立核验、inputIds明确引用的输入文件ID数组。revise可含affected受影响任务名数组，无法确定就不填使全图重核；修改不是重新执行已交付效果。roster是名单操作，包含operation:add/remove、list:users/groups/admins、target明确QQ或群号；若用名字，则lookupName必须是用户本次原话中的名字，由桥接唯一核对。名单属于有限宿主操作，不派文件代理、不调用bash；只输出动作标记，不先声称完成。旧有owner专属传话、转发已有图片、提醒增删查询、好友申请、群管理、宿主维护与好友笔记读取使用owner_maintenance，purpose分别为relay/forward/schedule/friend/group/host/memory_read。它是明确选择的旧owner维护适配器，不是普通隔离worker；只在本轮owner确实要求执行对应操作时选择，不用于闲聊、能力讨论或普通文件研究，更不能在新worker失败后偷偷fallback。维护参数只能是purpose和来源，需求全文由桥接读原消息，不要扩写命令、收件人或路径。原照片转发绝不生成新图。已有维护的查询/停止/只检查/继续/回答问题用owner_maintenance_control，带下方真实jobId、command:status/cancel/constrain/resume/answer和本轮sourceId；不能把控制请求当新维护。resume只核对原记录，不会重新派发整个维护任务。新工作和维护并存时按用户指向选择目标，不明确就自然问清楚。当前旧维护记录：'+JSON.stringify(deps.taskProgress.list(key).filter(j=>j.maintenanceKey).slice(-5).map(j=>({jobId:j.id,task:j.task,status:j.status,constraint:j.constraint,stage:j.stage,pending:j.pendingRequest?{type:j.pendingRequest.type,questions:(j.pendingRequest.questions||[]).map(q=>({question:q.question,options:q.options?.map(o=>o.label)})),tool:j.pendingRequest.toolName}:null})))+'。维护已有独立任务账本，未确认结果不重复派发；你仍可聊天，不能先说已完成。其他动作携带明确goalId；answer还要questionId、revision和text。不得为能力讨论自动派活，结合上下文判断“能不能”是否已在交代具体任务。一次消息可以聊天并修改任务。不要在控制动作回执前声称已完成；一般只说准备做什么。任务状态只信下面记录，不把queued说成running，不把回合结束当交付。提问顺着语境，不让用户背口令。多个目标无法唯一指代就问清楚。只有明确恢复才用resume，失败请求不会后台自动重试。主聊换会话不影响目标归属。正在处理的协作：'+JSON.stringify(deps.orchestrator.context(key))+'；可用输入文件（只有本次要求相关的才引用）：'+JSON.stringify(Object.values(deps.work.files).filter(f=>f.key===key&&Date.now()-f.at<3600000).map(({id,name})=>({id,name})))+'；本轮可用来源：'+sid);
    }
    if (deps.cfg.slang?.enabled !== false) {
      const block = deps.buildSlangContext(deps.slangEntries, deps.cfg.slang?.injectMax ?? 8);
      if (block) parts.push(block);
    }
    return parts.join('\n\n') + '\n\n' + promptText;
  }
return {saveSlangStore,queueSlangTask,ensureSlangLearnerSession,invalidateSlangLearnerSession,waitLearnerTurn,runSlangExtraction,runSlangResearch,maybeQueueSlangExtraction,feedSlangWindow,allowSlangSubmit,publicSlangEntry,confirmedSlangListV2,withSlangContext};
}
