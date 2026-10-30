// models: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["MODEL_GOOD_FILE","REASONING_EFFORT_DEFAULT","ROOT","STATE_DIR","api","atomicWriteJson","cfg","curModelId","fs","internalPurposes","lastSendSucceeded","learnerSessions","log","modelAppliedSessions","modelErrorNotifiedFor","modelErrorStreak","modelGood","modelGuard","modelSelectionEpoch","modelStartupChecked","nominalModel","noteOwnerChat","path","pinInternalTitle","readConfigObject","readSessionLogLines","rebuildInFlightCollector","resolvePresetName","reverse","sayBridge","sessionActualModels","sessionModels","sleep","state","taskSessions","tokenLedger","truncateText","unwrap","waitLearnerTurn"];
export function createModels(deps){
async function fetchModelCatalog() {
    try {
      return await deps.api.callUnary('session.modelCatalog', {});
    } catch (error) {
      const message = String(error?.message ?? error);
      if (!/not.?found|unknown|unsupported|404|invalid server-response/i.test(message)) throw error;
      return deps.api.callUnary('session.models', {});
    }
  }

function rememberModel(sessionId, selection) {
    const model = selection?.model;
    if (typeof model === 'string' && model) {
      deps.sessionModels.set(sessionId, { model, provider: selection?.provider });
    }
  }

/** 摄入一条会话事件到 token 账本；任何异常都不能影响 QQ 主链路。 */
  function recordSessionUsage(sessionId, event) {
    try {
      if (event?.type === 'model/selection') rememberModel(sessionId, event.data);
      const known = deps.sessionModels.get(sessionId);
      if(event.type==='turn/start'){
        const category=deps.state.scheduledSessions?.[sessionId]?'scheduled_reminder':deps.taskSessions.has(sessionId)?(deps.taskSessions.get(sessionId).kind==='side_chat'?'chat_reply':'owner_background_task'):(deps.internalPurposes.get(sessionId)||(deps.learnerSessions.has(sessionId)?'memory_summary':deps.reverse.has(sessionId)?'chat_reply':'other_background'));
        deps.fs.appendFileSync(deps.path.join(deps.STATE_DIR,'invocation-categories.jsonl'),JSON.stringify({at:Date.now(),sessionId,turn:event.data?.turn,category,key:deps.taskSessions.get(sessionId)?.key||deps.reverse.get(sessionId)||null})+'\n',{mode:0o600});
      }
      deps.tokenLedger.ingestEvent({
        sessionId,
        event,
        model: event?.data?.usage?.model ?? known?.model,
        provider: event?.data?.provider ?? known?.provider
      });
    } catch (error) {
      deps.log('token 账本：摄入事件失败', error?.message ?? error);
    }
  }

/**
   * 处理会话开场快照：
   * 1. `projections.tokenUsage` 是**整条会话日志**的权威累计桶（含桥接启动前的历史）；
   * 2. `records` 是最近若干条历史事件，用来回填「逐轮花费」。
   * 重连时该帧会重新下发，账本内部按 (turn, step, retry) + seq 做幂等折叠，不会翻倍。
   */
  function recordSessionSnapshot(sessionId, snapshot) {
    try {
      if (!snapshot) return;
      const selection = snapshot.projections?.values?.modelSelection;
      rememberModel(sessionId, selection?.lastUsed ?? selection?.pending ?? null);
      const known = deps.sessionModels.get(sessionId);
      deps.tokenLedger.ingestBaseline({
        sessionId,
        projection: snapshot.projections,
        at: Date.now(),
        model: known?.model ?? deps.nominalModel(),
        provider: known?.provider ?? deps.cfg.dsh?.provider
      });
      deps.tokenLedger.ingestSnapshotRecords({ sessionId, records: snapshot.records });
      deps.rebuildInFlightCollector(sessionId, snapshot.records);
    } catch (error) {
      deps.log('token 账本：处理会话快照失败', error?.message ?? error);
    }
  }

function noteModelHealthy(actual = deps.cfg.dsh) {
    if (`${actual?.provider}/${actual?.model}` !== deps.curModelId()) return;
    deps.modelGuard.healthy(actual);
    deps.modelErrorStreak = 0;
    deps.modelErrorNotifiedFor = '';
    const provider = String(deps.cfg.dsh?.provider || '');
    const model = String(deps.cfg.dsh?.model || '');
    if (!provider || !model) return;
    if (deps.modelGood?.provider === provider && deps.modelGood?.model === model) return;
    deps.modelGood = { provider, model, at: Date.now() };
    try { deps.atomicWriteJson(deps.MODEL_GOOD_FILE, deps.modelGood); } catch {}
    deps.log(`模型保险：已记下能用的模型 ${provider}/${model}`);
  }

async function probeModel(provider, model) {
    const preset = deps.resolvePresetName('jingjing-memo', { strict: true });
    if (!preset) return { ok: false, error: '缺少 jingjing-memo 预设，没法试模型' };
    const dir = deps.path.join(deps.STATE_DIR, 'memo-agent');
    deps.fs.mkdirSync(dir, { recursive: true });
    let sessionId = null;
    try {
      const ws = deps.unwrap(await deps.api.workspace.create({ path: dir }), 'probe workspace.create');
      sessionId = deps.unwrap(await deps.api.sessions.create({ workspaceId: ws.workspace.workspaceId, agentPreset: preset }), 'probe session.create').sessionId;
      await deps.pinInternalTitle(sessionId,'渠道健康检查');
      deps.internalPurposes.set(sessionId,'channel_healthcheck');
      deps.learnerSessions.add(sessionId);
      deps.api.events.follow(sessionId);
      const sel = await deps.api.sessions.selectModel({ sessionId, provider, model, reasoningEffort: String(deps.cfg.dsh?.reasoningEffort || 'high') });
      if (!sel?.result?.ok) return { ok: false, error: `DSH 不认这个模型：${sel?.result?.error?.message ?? '未知原因'}（要先在 DSH 渠道配置里声明）` };
      const waiting = deps.waitLearnerTurn(sessionId, 90000);
      const accepted = await deps.api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: '只回一个字：好' }] });
      if (!accepted.result.ok) return { ok: false, error: `${accepted.result.error.code}: ${accepted.result.error.message}` };
      try {
        await waiting;
        return { ok: true };
      } catch (error) {
        // waitLearnerTurn 只说「没正常完成」，原因在会话日志里
        let detail = '';
        try {
          const lines = deps.readSessionLogLines(sessionId) || [];
          const end = [...lines].reverse().find((x) => x.type === 'turn/end');
          detail = String(end?.data?.reason?.error?.message ?? '').slice(0, 300);
        } catch {}
        return { ok: false, error: detail || (error?.message ?? String(error)) };
      }
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error) };
    } finally {
      if (sessionId) {
        deps.learnerSessions.delete(sessionId);
        deps.internalPurposes.delete(sessionId);
        try { await deps.api.workspace.archiveSession({ sessionId }); } catch {}
      }
    }
  }

function applyModel(provider, model) {
    const configFile = deps.path.join(deps.ROOT, 'config.json');
    const file = deps.readConfigObject(configFile);
    file.dsh = { ...(file.dsh ?? {}), provider, model };
    deps.atomicWriteJson(configFile, file);
    deps.modelGuard.switched({ provider, model });
    deps.cfg.dsh = { ...(deps.cfg.dsh ?? {}), provider, model };
    deps.modelSelectionEpoch += 1;
  }

async function revertModel(reason) {
    const fallback = [deps.modelGuard.state.previous, deps.modelGood].find(x => x && `${x.provider}/${x.model}` !== deps.curModelId() && deps.modelGuard.fallbackAllowed(x));
    if (!fallback) return false;
    const bad = deps.curModelId();
    applyModel(fallback.provider, fallback.model);
    deps.modelGuard.reverted(fallback);
    deps.modelErrorStreak = 0;
    deps.log(`模型保险：${bad} → ${deps.curModelId()}（${deps.truncateText(reason,120)}）`);
    if (deps.cfg.ownerQQ) {
      const key = `private:${deps.cfg.ownerQQ}`;
      const msg = `⚠️ 模型出错，已换回 ${fallback.model}；若它不支持图片，识图会暂时不可用。`;
      await deps.sayBridge(key,msg); if (deps.lastSendSucceeded(key)) deps.noteOwnerChat('out',msg);
    }
    return true;
  }

async function noteModelError(message, actual) {
    if (!actual || `${actual.provider}/${actual.model}` !== deps.curModelId()) return;
    if (/abort|cancel|permission|approval/i.test(message)) return;
    const fallback = deps.modelGuard.failed(actual);
    deps.modelErrorStreak = deps.modelGuard.state.streak;
    if (deps.modelErrorStreak < 3) return;
    if (fallback) { await revertModel(`连续三次模型错误`); return; }
    if (deps.modelErrorNotifiedFor !== deps.curModelId()) {
      deps.modelErrorNotifiedFor = deps.curModelId();
      await deps.sayBridge(`private:${deps.cfg.ownerQQ}`, '⚠️ 当前模型连续出错，暂无其他回退模型。你可以发 /status 查看，或 /恢复模型 重试恢复。');
    }
  }

async function modelStartupCheck() {
    if (deps.modelStartupChecked) return;
    deps.modelStartupChecked = true;
    const provider = String(deps.cfg.dsh?.provider || '');
    const model = String(deps.cfg.dsh?.model || '');
    if (!provider || !model) return;
    if (deps.modelGood?.provider === provider && deps.modelGood?.model === model) return;
    const r = await probeModel(provider, model);
    if (r.ok) {
      noteModelHealthy();
      deps.log(`模型保险：启动检查通过 ${provider}/${model}`);
    } else if (!(await revertModel(`启动检查没通过：${r.error}`))) {
      deps.log(`⚠️ 模型保险：启动检查没通过 ${provider}/${model}（${r.error}），而且没有记下能用的旧模型`);
    }
  }

// 返回 'applied' | 'not-found' | 'failed'。
  // 'not-found' 表示 DSH 侧会话已经不存在（DSH 重启、异常退出、归档竞态），
  // 本地映射已失效，调用方必须退役重建，否则每条消息都会对着一个不存在的会话重试。
  async function ensureChatModel(sessionId) {
    if (deps.modelAppliedSessions.get(sessionId) === deps.modelSelectionEpoch) return 'applied';
    const provider = String(deps.cfg.dsh?.provider || 'deepseek-official');
    const model = String(deps.cfg.dsh?.model || 'deepseek-flash');
    const effort = String(deps.cfg.dsh?.reasoningEffort || deps.REASONING_EFFORT_DEFAULT);
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = deps.unwrap(await deps.api.sessions.selectModel({ sessionId, provider, model, reasoningEffort: effort }), 'session.selectModel');
        deps.sessionActualModels.set(sessionId, {provider:result.selected.provider,model:result.selected.model});
        deps.modelAppliedSessions.set(sessionId, deps.modelSelectionEpoch);
        deps.log(`已设置会话模型 ${sessionId} -> ${result.selected.provider}/${result.selected.model} (${result.selected.reasoningEffort ?? '默认'})`);
        return 'applied';
      } catch (error) {
        lastError = error;
        deps.log(`设置会话模型失败 ${sessionId}（第 ${attempt}/2 次）: ${error?.message ?? error}`);
        if (attempt < 2) await deps.sleep(1000);
      }
    }
    const message = String(lastError?.message ?? lastError ?? '');
    if (/not[- ]?found/i.test(message)) {
      // 终态失败：记下 epoch，避免退役前（或退役失败时）被反复重试刷屏。
      deps.modelAppliedSessions.set(sessionId, deps.modelSelectionEpoch);
      return 'not-found';
    }
    return 'failed';
  }
return {fetchModelCatalog,rememberModel,recordSessionUsage,recordSessionSnapshot,noteModelHealthy,probeModel,applyModel,revertModel,noteModelError,modelStartupCheck,ensureChatModel};
}
