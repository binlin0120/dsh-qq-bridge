// session-policy: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["DSH_CONTROL_TIMEOUT_MS","STATE_DIR","activeWaits","allowed","api","cancelPendingEntry","cancelSocialTimers","cfg","clearSocialV2Timers","clearTimeout","closedAgentPreset","collectors","crypto","currentMode","disarmPendingWakeLease","dshDefaultPreset","dshPresetIds","feedbackTimes","guestCheckFailed","isOwnerKey","lastSendFailed","log","markReadCalledKeys","modelAppliedSessions","normalizeModeInput","normalizeOwnerQQ","path","pending","pendingSendToolCalls","pendingWakeKeys","queuedHintAt","readJsonSafe","rememberAgentToken","reverse","rosterRoleOf","runtimeStopping","saveSocialV2State","saveState","sendToolSucceededSessions","sessionModels","settingFromDshNamespace","slangSubmitTimes","social","socialV2","state","toolCallNames","turnLeaseNoted","unwrap","v2TurnStartAt","wakeConfigMissCount","wakeConfigUpdatedKeys","withTimeout"];
export function createSessionPolicy(deps){
// 从 DSH settings 读取桥接模式；命名空间未注册时回退本地 state/mode.json
  async function refreshMode() {
    try {
      const s = deps.unwrap(await deps.api.settings.describe({}), 'settings.describe');
      // DSH 的默认 preset（`agent-presets` 命名空间的 default）——closed-agent 的兜底值来源
      const presetNs = s.namespaces.find((n) => n.ns === 'agent-presets');
      const defaultPreset = deps.settingFromDshNamespace(presetNs, 'default');
      if (typeof defaultPreset === 'string' && defaultPreset) {
        deps.dshDefaultPreset = defaultPreset;
      }
      const ns = s.namespaces.find((n) => n.ns === 'qq-mode');
      // 规范化后再比较：`simulation` 也走这里（见 MODE_INPUT_ALIASES）。
      // 读取必须 user 层优先：DSH 0.2.0-rc.2 写完 settings 后同进程内 value 不更新，
      // 只读 value 会让控制台切的模式被 5 秒轮询改回去（issue #22）。
      const fromDsh = deps.normalizeModeInput(deps.settingFromDshNamespace(ns, 'mode'));
      if (fromDsh) {
        deps.currentMode = fromDsh;
        // DSH 设置页也可配置管理员 QQ；**留空表示不覆盖 config.json**
        // （见 plugins/qq-mode-console 的 schema 描述）。这里必须显式判断空串：
        // normalizeOwnerQQ('') 返回 null，若照旧 `!== undefined` 就直接赋值，
        // 设置页每次轮询都会把 config.json 里的 ownerQQ 抹成 null —— 而 5 秒一次的
        // refreshMode 会让它「几秒后必然发生」，后果是 closed-agent 谁都不放行、
        // 审批/提问永远等不到管理员回答。
        const rawOwnerValue = deps.settingFromDshNamespace(ns, 'ownerQQ');
        if (rawOwnerValue !== undefined) {
          const rawOwner = String(rawOwnerValue ?? '').trim();
          if (rawOwner) {
            try {
              deps.cfg.ownerQQ = deps.normalizeOwnerQQ(rawOwner);
            } catch (error) {
              deps.log(`DSH settings ownerQQ 无效，已忽略: ${error?.message ?? error}`);
            }
          }
        }
        // DSH 的 qq-mode schema 只有 mode / ownerQQ 两个字段，没有 closedAgentPreset；
        // 该值仍以本地 state/mode.json 为准（用 typeof 判断，允许用空串显式清空），
        // 否则这里提前 return 会让控制台的 preset 下拉变成永远不生效的死设置。
        const localPreset = deps.readJsonSafe(deps.path.join(deps.STATE_DIR, 'mode.json'), null);
        if (typeof localPreset?.closedAgentPreset === 'string') {
          deps.closedAgentPreset = localPreset.closedAgentPreset;
        }
        return;
      }
    } catch {}
    const local = deps.readJsonSafe(deps.path.join(deps.STATE_DIR, 'mode.json'), null);
    const fromLocal = local ? deps.normalizeModeInput(local.mode) : null;
    if (fromLocal) deps.currentMode = fromLocal;
    if (typeof local?.closedAgentPreset === 'string' && local.closedAgentPreset) {
      deps.closedAgentPreset = local.closedAgentPreset;
    }
  }

/** 拉取 DSH 当前可用的 agent preset 清单（供控制台下拉与 closed-agent 兜底使用）。 */
  async function refreshPresetList() {
    try {
      const { presets: list } = deps.unwrap(await deps.api.agentPresets.list({}), 'agentPresets.list');
      deps.dshPresetIds = list.map((p) => String(p.id));
      if (!deps.dshDefaultPreset) {
        const marked = list.find((p) => p.isDefault === true);
        if (marked) deps.dshDefaultPreset = String(marked.id);
      }
    } catch (error) {
      deps.log(`获取 DSH preset 列表失败：${error?.message ?? error}（会话将按配置的 preset 尝试创建）`);
    }
  }

/** 当前模式是否允许该会话进入 */
  function modeAllowed(key, kind, id, cfg, mode) {
    if(deps.runtimeStopping)return false;
    if (mode === 'closed-agent') {
      // 机主私聊 = 完整工具；管理员 / 聊天用户 / 群聊白名单 = 只聊天（见 modePreset 的访客预设）
      return deps.rosterRoleOf(kind, id, cfg) !== null;
    }
    // chat / reserved / reserved2（仿真模式，暂同 chat 白名单）
    return deps.allowed(kind, id, cfg);
  }

/**
   * 解析一个 preset 名。
   *
   * strict=false（closed-agent，仅 owner 私聊）：名字不可用时回退到 DSH 默认 preset ——
   *   那里本来就用完整工具面，回退不构成提权。
   * strict=true（chat / reserved / reserved2，会话可能属于 QQ 群）：名字不可用时返回 ''，
   *   表示「没有可安全使用的 preset」，由调用方拒绝建会话（fail-closed）。
   *   **绝不能回退到 DSH 默认 preset（standard）**：standard 含 bash/文件读写等本地工具，
   *   一旦套在群聊会话上，群友即可驱动一个能操作本机的 agent（见 RULES.md「无本地工具」）。
   */
  function resolvePresetName(name, { strict = false } = {}) {
    const wanted = String(name ?? '').trim();
    if (!wanted) return strict ? '' : (deps.dshDefaultPreset || '');
    // DSH 可能接受未知 preset 并套用默认值；清单未知时也必须 fail-closed。
    if (deps.dshPresetIds.length === 0) return strict ? '' : wanted;
    if (deps.dshPresetIds.includes(wanted)) return wanted;
    deps.log(`⚠️ preset "${wanted}" 不在 DSH 可用清单（${deps.dshPresetIds.join(', ')}）中`);
    if (strict) {
      deps.log(`⛔ 群聊/仿真会话缺少 preset "${wanted}"，拒绝回退到 DSH 默认 preset（会把本地工具暴露给 QQ 群）；请运行 node scripts/setup-dsh.mjs 并重启 DSH`);
      return '';
    }
    return deps.dshDefaultPreset || '';
  }

/** 当前模式下的会话预设；返回 undefined 表示「该模式下没有可安全使用的 preset」 */
  function modePreset(key, mode, cfg) {
    if (mode === 'closed-agent' && !deps.isOwnerKey(key)) {
      // 访客会话一律 strict：访客预设缺失时拒绝建会话，绝不回退到带本地工具的默认预设
      if (deps.guestCheckFailed) return undefined;
      return resolvePresetName(cfg.guest?.preset || 'jingjing-guest', { strict: true }) || undefined;
    }
    if (mode === 'closed-agent') {
      const chosen = resolvePresetName(deps.closedAgentPreset);
      if (!chosen) deps.log('⚠️ 无法确定 closed-agent 的 preset（DSH preset 清单未知），将按 DSH 默认 preset 建会话');
      return chosen || undefined;
    }
    // 二代仿真模式优先使用 socialV2.agentPreset；未配置时回退到默认聊天预设。
    // 非 closed-agent 一律 strict：宁可建不出会话，也不给群聊套上带本地工具的默认 preset。
    const wanted = mode === 'reserved2' ? (cfg.socialV2?.agentPreset || cfg.agentPreset) : cfg.agentPreset;
    return resolvePresetName(wanted, { strict: true }) || undefined;
  }

/** 判断一个会话 key 是否仍被当前模式/白名单允许（供唤醒调度与 HTTP 路由共用）。 */
  function isSessionAllowedInCurrentMode(key) {
    const m = /^(group|private):(\d+)$/.exec(key);
    if (!m) return false;
    return modeAllowed(key, m[1], Number(m[2]), deps.cfg, deps.currentMode);
  }

function sessionPolicy(key) {
    return JSON.stringify([deps.currentMode, modePreset(key, deps.currentMode, deps.cfg) ?? '', deps.currentMode === 'closed-agent' ? deps.cfg.ownerQQ : null]);
  }

function isScheduledSession(key,sid){const binding=deps.state.scheduledSessions?.[sid];return binding?.key===key&&binding.policy===sessionPolicy(key)&&isSessionAllowedInCurrentMode(key);}

function isCurrentSession(key, sessionId) {
    return isSessionAllowedInCurrentMode(key) && deps.state.sessions[key] === sessionId
      && deps.state.sessionPolicies[key] === sessionPolicy(key);
  }

/**
   * 让 DSH 停下一个已经不再属于桥接的会话：先清队列再取消在途 turn，最后归档。
   * 拆出来是因为所有「撤销映射」的路径都必须做同样的事（retireSession / session-reset /
   * workspace-reset / reset，以及控制台的二代状态重置）—— 少一处就会留下
   * 「DSH 还在烧 token、桥接已经收不到也发不出」的静默黑洞。
   */
  function stopRetiredSessionWork(sessionId, key = '') {
    void (async () => {
      try { await deps.withTimeout(deps.api.stopSessionWork(sessionId), deps.DSH_CONTROL_TIMEOUT_MS, 'stopSessionWork'); }
      catch (error) { deps.log(`⚠️ 停止旧会话失败 ${key}：${error?.message ?? error}；本地映射已撤销，请在 DSH 检查旧任务`); }
      try { await deps.withTimeout(deps.api.workspace.archiveSession({ sessionId }), deps.DSH_CONTROL_TIMEOUT_MS, 'archiveSession'); }
      catch (error) { deps.log(`归档失效会话失败 ${key}: ${error?.message ?? error}`); }
    })();
  }

/**
   * 清掉「按会话 key 记账」的内存态。
   *
   * 为什么单独抽出来：这些 Map/Set 分散在文件各处，退役路径（retireSession）、
   * 手动重置（/api/session/reset、/reset、workspace reset）、二代状态重置
   * 各自只清了其中一部分 —— 于是「哪个 key 清哪个不清」完全靠人记。
   * 结果是有界但真实的慢性泄漏：被移出白名单的会话，其 lastSendFailed、
   * 限流时间戳会一直留在内存里。所有撤销会话映射的路径都必须调用这里。
   */
  function forgetConversationCaches(key) {
    deps.lastSendFailed.delete(key);
    deps.activeWaits.delete(key);
    deps.queuedHintAt.delete(key);
    deps.slangSubmitTimes.delete(key);
    deps.feedbackTimes.delete(key);
    deps.wakeConfigMissCount.delete(key);
    deps.wakeConfigUpdatedKeys.delete(key);
    deps.markReadCalledKeys.delete(key);
  }

function retireSession(key) {
    const sessionId = deps.state.sessions[key];
    delete deps.state.sessions[key];
    delete deps.state.sessionPolicies[key];
    // 按 key 记账的内存态在**有映射和无映射时都要清**：一条被移出白名单、
    // 但从未成功建过会话的 key 同样会留下限流时间戳与失败标记。
    forgetConversationCaches(key);
    if (!sessionId) return;
    deps.reverse.delete(sessionId);
    deps.collectors.delete(sessionId);
    deps.sessionModels.delete(sessionId);
    deps.modelAppliedSessions.delete(sessionId);
    deps.sendToolSucceededSessions.delete(sessionId);
    deps.pendingSendToolCalls.delete(sessionId);
    deps.v2TurnStartAt.delete(sessionId);
    deps.turnLeaseNoted.delete(sessionId);
    deps.toolCallNames.delete(sessionId);
    deps.social.silentTurns.delete(sessionId);
    deps.social.exitingSessions.delete(sessionId);
    // 退役的会话要退订：否则 _desiredFollows 只增不减，每次重连都会为它重开一条
    // follow 流并重发一整份历史快照（内存与重连延迟都随会话数线性增长）。
    deps.api.events.forget?.(sessionId);
    const entry = deps.pending.get(key);
    if (entry) { deps.clearTimeout(entry.timer); void deps.cancelPendingEntry(entry).catch(() => {}); }
    deps.pending.delete(key);
    deps.clearSocialV2Timers(key);
    deps.cancelSocialTimers(key);
    deps.disarmPendingWakeLease(key);
    deps.pendingWakeKeys.delete(key);
    const st = deps.socialV2.conversations.get(key);
    if (st) {
      // 保留旧 token 在脱敏集合中，但撤销它的调用权限。
      st.agentToken = deps.crypto.randomBytes(24).toString('hex');
      deps.rememberAgentToken(key, st.agentToken);
      st.bootstrapSent = false;
      st.modelSeenSeqs = new Set();
    }
    deps.saveState();
    deps.saveSocialV2State();
    stopRetiredSessionWork(sessionId, key);
    deps.log(`会话权限已变化，停用旧映射 ${key} -> ${sessionId}`);
  }

function reconcileSessionPolicies() {
    // DSH preset 清单未知时**绝不能**做退役判定。
    //
    // 为什么：`sessionPolicy()` 包含 `modePreset()` 的结果，而 `modePreset()` 依赖
    // `dshPresetIds`（来自 DSH 的 `agentPresets/list`）。启动瞬间或一次瞬时失败时
    // 这个清单可能是空的，`resolvePresetName(strict)` 于是返回 ''，算出来的策略就变成
    // `["reserved2","",null]` —— 与已存的 `["reserved2","qq-chat-v2",null]` 不等，
    // 于是**所有** QQ 会话在这一个 tick 里被集体退役：DSH 会话被停掉归档、agentToken 轮换、
    // 映射删除，每个群的上下文全丢，日志里只有一句「会话权限已变化」。
    // 一次网络抖动换来全体失忆，代价完全不成比例。清单为空时宁可不判定，等下一轮。
    if (deps.dshPresetIds.length === 0) return;
    for (const [key, sessionId] of Object.entries(deps.state.sessions)) {
      if (!isCurrentSession(key, sessionId)) retireSession(key);
    }
  }
return {refreshMode,refreshPresetList,modeAllowed,resolvePresetName,modePreset,isSessionAllowedInCurrentMode,sessionPolicy,isScheduledSession,isCurrentSession,stopRetiredSessionWork,forgetConversationCaches,retireSession,reconcileSessionPolicies};
}
