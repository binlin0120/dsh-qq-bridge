// connections: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["AbortSignal","ROOT","SNOWLUMA_SILENCE_WARN_MS","SNOWLUMA_STATUS_POLL_MS","bot","cfg","checkDsh","clearTimeout","collectors","createTurnCollector","discoverSnowLumaConnection","dshCheckStarted","fetch","log","path","pendingWakeKeys","pendingWakeLeaseTimers","persistSnowLumaEndpoint","persistToken","setInterval","setTimeout","snowlumaHealth","snowlumaWatchStarted","tokenHealAt","v2TurnStartAt"];
export function createConnections(deps){
/**
   * 重连后重建「断线时正在跑的那个回合」的 collector。
   *
   * 为什么必须有这一步：`pumpMux` 的 finally 会在断线时清空 `collectors`（否则重连后
   * 旧状态会让回复重复累加）。而重连时 DSH **只**通过开场快照重放历史 —— 快照被刻意
   * 排除在事件通道之外（否则历史回合会被当成新回合重复发送）。于是断线前发出的
   * `turn/start` 再也补不回来：重连后到达的 live `turn/end` 找不到对应回合，
   * `createTurnCollector.push()` 返回 null ⇒ **这一轮的回复被静默丢弃**（QQ 上没消息、
   * 日志里没记录、token 却照付）。
   *
   * 修法：只把「有 turn/start 但没有 turn/end」的回合重放进 collector ——
   * 这些正是断线那一刻仍在进行的回合。已结束的回合一律不喂，所以不会重复回复。
   */
  function rebuildInFlightCollector(sessionId, records) {
    if (!Array.isArray(records) || !records.length) return;
    const eventOf = (entry) => (entry?.type === 'event' ? entry.event : entry);
    const open = new Set();
    for (const entry of records) {
      const event = eventOf(entry);
      if (event?.type === 'turn/start') open.add(event.data?.turn);
      else if (event?.type === 'turn/end') open.delete(event.data?.turn);
    }
    if (!open.size) return;
    const collector = deps.createTurnCollector();
    let restored = 0;
    for (const entry of records) {
      const event = eventOf(entry);
      // 只回放未结束回合的文本来源：turn/start 建立回合，assistant/message 累积文本。
      if (event?.type !== 'turn/start' && event?.type !== 'assistant/message') continue;
      if (!open.has(event.data?.turn)) continue;
      collector.push(event);
      restored += 1;
    }
    if (!restored) return;
    deps.collectors.set(sessionId, collector);
    // 恢复出来的回合也必须带起始时间，否则租约对它无从生效 —— 这正是
    // 「DSH 重启后忙标记永不复位」的那条路径（issue #19）。不知道真实起点时按现在算：
    // 活着的回合会在 turn/end 清掉；真丢了的回合最多再忙一个租约期就自动解除。
    if (!deps.v2TurnStartAt.has(sessionId)) deps.v2TurnStartAt.set(sessionId, Date.now());
    deps.log(`重连后恢复了进行中的回合（${sessionId}，turn ${[...open].join(',')}）`);
  }

// 唤醒“防卡死”租约：正常应在 turn/end 时删除 pendingWakeKeys；若 DSH 接受了但一直没回合结束，
  // 30 分钟后强制解除 busy 标记，避免该会话永久无法被唤醒。
  function armPendingWakeLease(key) {
    const old = deps.pendingWakeLeaseTimers.get(key);
    if (old) deps.clearTimeout(old);
    const timer = deps.setTimeout(() => {
      deps.pendingWakeKeys.delete(key);
      deps.pendingWakeLeaseTimers.delete(key);
    }, 30 * 60 * 1000);
    timer.unref?.();
    deps.pendingWakeLeaseTimers.set(key, timer);
  }

function disarmPendingWakeLease(key) {
    const old = deps.pendingWakeLeaseTimers.get(key);
    if (old) deps.clearTimeout(old);
    deps.pendingWakeLeaseTimers.delete(key);
  }

function clearAllPendingWakeLeases() {
    for (const t of deps.pendingWakeLeaseTimers.values()) deps.clearTimeout(t);
    deps.pendingWakeLeaseTimers.clear();
  }

function startDshWatch() {
    if (deps.dshCheckStarted) return;
    deps.dshCheckStarted = true;
    deps.checkDsh();
    deps.setInterval(deps.checkDsh, 5000);
  }

/** 记录一次"上游还活着"的证据。任何来自 SnowLuma 的事件包都算（含心跳）。 */
  function noteUpstreamPacket(kind) {
    deps.snowlumaHealth.lastPacketAt = Date.now();
    deps.snowlumaHealth.lastPacketKind = String(kind ?? '');
  }

/** 记下一次接收链路健康度。@param good - boolean；非布尔值忽略。 */
  function noteReceiveHealth(good, source) {
    if (typeof good !== 'boolean') return;
    deps.snowlumaHealth.good = good;
    deps.snowlumaHealth.goodSource = source;
    deps.snowlumaHealth.goodError = '';
    deps.snowlumaHealth.goodCheckedAt = Date.now();
  }

/** 供 /api/status 与控制台使用的只读快照。 */
  function snowlumaHealthSnapshot() {
    const now = Date.now();
    const agoMs = deps.snowlumaHealth.lastPacketAt ? now - deps.snowlumaHealth.lastPacketAt : null;
    const silent = deps.snowlumaHealth.lastPacketAt > 0 && agoMs > deps.SNOWLUMA_SILENCE_WARN_MS;
    // 只有 SnowLuma **明确自报** good=false 才算"确认坏了"（接收链路）。
    // 「静默」只能说明连它的进程/WS 都没动静了 —— 那是**另一个**故障面，措辞必须分开。
    const confirmed = deps.snowlumaHealth.good === false;
    let hint = null;
    if (confirmed) {
      hint = 'SnowLuma 自报接收链路异常（good=false）：它的 [Hook] 收不到 QQ 客户端的数据，'
        + '消息进不来。这不是桥接的问题。请查看 SnowLuma 的 logs/snowluma-*.log 里的 [Hook] 行'
        + '（receive path stale / process enumeration timed out），并考虑升级 SnowLuma。';
    } else if (silent) {
      hint = `已连接但 ${Math.round(agoMs / 60000)} 分钟没有收到任何事件包（连 30 秒一次的心跳都没有）。`
        + '这说明 SnowLuma 的 OneBot 服务/进程本身可能已经卡住或不在了，而不只是收不到 QQ 数据；'
        + '请直接查看 SnowLuma 的 logs/snowluma-*.log。';
    }
    return {
      // 只读 snowlumaHealth.connected（由 bot 的 open/close 维护），**不要**在这里引用
      // `bot`：它在本闭包里声明得晚得多（`const`，TDZ），一旦有人把本函数提前调用就会
      // 抛 "Cannot access 'bot' before initialization"。
      connected: deps.snowlumaHealth.connected,
      accountOnline: deps.snowlumaHealth.accountOnline,
      good: deps.snowlumaHealth.good,
      goodSource: deps.snowlumaHealth.goodSource || null,
      goodError: deps.snowlumaHealth.goodError || null,
      lastPacketAgoMs: agoMs,
      lastPacketKind: deps.snowlumaHealth.lastPacketKind || null,
      silent,
      degraded: confirmed || silent,
      hint,
    };
  }

/** 边沿触发地告警/恢复，避免每轮探测都刷一行日志。 */
  function reportSnowlumaHealth() {
    const snap = snowlumaHealthSnapshot();
    if (snap.degraded && !deps.snowlumaHealth.degraded) {
      deps.snowlumaHealth.degraded = true;
      deps.snowlumaHealth.reason = snap.hint ?? '';
      deps.log(`⚠️ SnowLuma 上游不健康：${snap.hint}`);
      deps.log('   这不是桥接的问题：桥接没有任何原生/注入面，也不控制 SnowLuma 或 QQ。');
      deps.log('   排查：SnowLuma 的 logs/snowluma-*.log 里搜 [Hook]（看是否有 "receive path stale" 或 "process enumeration timed out"）。');
    } else if (!snap.degraded && deps.snowlumaHealth.degraded) {
      deps.snowlumaHealth.degraded = false;
      deps.snowlumaHealth.reason = '';
      deps.log('✅ SnowLuma 上游已恢复正常（good≠false 且事件包在流动）');
    }
  }

/**
   * 问一次 SnowLuma 的 `get_status`：账号在不在线、它自评的接收链路是否健康。
   *
   * ⚠️ 必须用 `get_status` —— `get_login_info` 只返回 `{ user_id, nickname }`，
   *    从它身上取 good 会永远拿到 undefined（而且不会报错，见上方长注释）。
   *    这里只是**兜底轮询**：主路径是每 30 秒一次的心跳（免费，见 onEvent）。
   */
  async function pollSnowlumaStatus() {
    const httpUrl = String(deps.cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
    try {
      const res = await deps.fetch(`${httpUrl}/get_status`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(deps.cfg.snowluma?.accessToken ? { authorization: `Bearer ${deps.cfg.snowluma.accessToken}` } : {}),
        },
        body: '{}',
        signal: deps.AbortSignal.timeout(8000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status !== 'ok') {
        deps.snowlumaHealth.goodError = `HTTP ${res.status}${body?.wording ? ` ${body.wording}` : ''}`;
      } else {
        noteReceiveHealth(body.data?.good, 'get_status');
        if (typeof body.data?.online === 'boolean') deps.snowlumaHealth.accountOnline = body.data.online;
      }
    } catch (error) {
      deps.snowlumaHealth.goodError = error?.message ?? String(error);
    }
    deps.snowlumaHealth.goodCheckedAt = Date.now();
    reportSnowlumaHealth();
  }

function startSnowlumaWatch() {
    if (deps.snowlumaWatchStarted) return;
    deps.snowlumaWatchStarted = true;
    // 首次延后一点，避免与启动时的连接/自愈抢时序
    deps.setTimeout(() => { void pollSnowlumaStatus(); }, 5000);
    deps.setInterval(() => { void pollSnowlumaStatus(); }, deps.SNOWLUMA_STATUS_POLL_MS);
    // 边沿告警的兜底心跳：主信号（心跳 status.good）到达时会立刻评估，这里只防"心跳也没了"
    deps.setInterval(reportSnowlumaHealth, 30_000);
  }

// ── 本地控制台（独立 Web 面板，不依赖 DSH WebUI） ───────────────────────────
  // 模式/角色/静默状态都存 state/*.json，桥接即时感知；此服务只读写这些文件。
  function v2ToolEnabled(flag) {
    return deps.cfg.socialV2?.tools?.[flag] !== false;
  }

/**
   * SnowLuma 恢复连接时自愈 accessToken。
   *
   * 为什么需要：SnowLuma 的 OneBot 配置按账号分文件（config/onebot_<QQ号>.json），
   * 每个账号 token 不同。换账号登录后，config.json 里的旧 token 会 401/连不上，
   * 而 SDK 的重连会一直用**构造时**那个 token 无限重试 —— 表现为"桥接活着但收发全废"。
   * 这里在每次重连失败时重新发现当前账号的 token 并热更新，随后自愈。
   */
  /**
   * 应用自愈结果：**HTTP token 与 WS token 是两个不同的值**。
   *   - cfg.snowluma.accessToken → HTTP 调用（发语音、fetch_ptt_text、get_msg 等）与写回 config.json
   *   - bot.accessToken          → WebSocket 连接（桥接的主链路，端口 3001）
   * 只修其中一个的话，桥接仍会以 1006 反复重连（实测踩过）。
   */
  async function applyHealedTokens(r) {
    const httpToken = r.token;
    const wsToken = r.wsToken || r.token;
    // ⚠️ 端点跟随是可关的（`snowluma.followDiscoveredEndpoint: false`），默认保持原行为。
    //
    // 为什么需要这个开关：自愈会拿 `discoverSnowLumaConnection()` **发现到的** wsUrl
    // 覆盖掉配置里的值，并写回 config.json。这在"换了 QQ 账号所以端口变了"的主场景下
    // 是对的（端口确实是 per-account 的），但它**不区分**「用户写的是一个过期值」和
    // 「用户就是要指向别处」。后果：
    //   · 想跑第二个实例/指向另一份 SnowLuma 安装（多账号、测试、灰度）时，
    //     它会静默把端点改回去、连到发现到的那一份 —— 表现为"消息发到了另一个账号/群"，
    //     或者"我明明指向了 B 却一直在收 A 的消息"，很难归因；
    //   · 实测踩过：把 wsUrl 指向一个死端口想让它"别连"，启动后仍被改回真实端点并连上。
    // 关掉之后**只自愈 token**（换账号仍然能恢复），但绝不动 URL、也不写回 URL。
    const followEndpoint = deps.cfg.snowluma?.followDiscoveredEndpoint !== false;
    const wsUrl = followEndpoint ? (r.wsUrl || deps.cfg.snowluma.wsUrl) : deps.cfg.snowluma.wsUrl;
    const wsChanged = deps.bot.accessToken !== wsToken || deps.bot.url !== wsUrl;
    deps.bot.accessToken = wsToken || undefined;
    // 端口也是 per-account 的（实测：换账号后 WS 从 3001 之类变到别的端口），
    // 只换 token 不换 URL 会一直 1006 重连。
    deps.bot.url = wsUrl;
    if (wsChanged) deps.log(`🔄 SnowLuma WS 连接已更新：${wsUrl}（token ${String(wsToken).slice(0, 4)}…）`);
    if (deps.cfg.snowluma.accessToken !== httpToken) {
      deps.log(`🔄 SnowLuma HTTP token 已更新（来源 ${r.source}）：${String(deps.cfg.snowluma.accessToken).slice(0, 4)}… → ${String(httpToken).slice(0, 4)}…`);
      deps.cfg.snowluma.accessToken = httpToken;
    }
    if (!followEndpoint && r.wsUrl && r.wsUrl !== deps.cfg.snowluma.wsUrl) {
      deps.log(`   （已按 snowluma.followDiscoveredEndpoint=false 忽略发现到的端点 ${r.wsUrl}，继续用配置值 ${deps.cfg.snowluma.wsUrl}）`);
    }
    // 把确认可用的端点写回 config.json：下次启动直接就对了，不用再自愈一遍。
    // ⚠️ 必须在**改 cfg 之前**算出要写什么，但写文件时对照的是**文件里**的旧值 ——
    //    这里显式传 wsUrl，且不依赖 cfg 的内存值来判断"是否需要写"。
    // 关掉端点跟随时不写 URL：否则"我设了别处"这件事会被自愈持久化地抹掉。
    const previousWsUrl = deps.cfg.snowluma.wsUrl;
    deps.cfg.snowluma.wsUrl = wsUrl;
    try {
      const w = deps.persistSnowLumaEndpoint(deps.path.join(deps.ROOT, 'config.json'), {
        accessToken: httpToken,
        ...(followEndpoint ? { wsUrl, httpUrl: r.baseUrl } : {})
      });
      if (w.updated) deps.log(`   已写回 config.json：${Object.keys(w.changed).join(' / ')}`);
      else deps.log('   config.json 端点已是最新，无需改写');
      if (!followEndpoint && previousWsUrl !== wsUrl) deps.cfg.snowluma.wsUrl = previousWsUrl;
    } catch (error) {
      deps.log(`   ⚠️ 写回 config.json 失败：${error?.message ?? error}`);
    }
    // 更新了就让 SDK 立刻用新参数重连（否则要等下一轮退避，最长要好几秒）
    if (wsChanged) {
      try { deps.bot.close(1000, 'token-refresh'); } catch {}
      try { deps.bot.connect(); } catch {}
    }
    return wsChanged;
  }

/** 只写文件、不动物件（连接已成功时用）。 */
  async function syncTokenToFile() {
    try {
      const r = deps.persistToken(deps.path.join(deps.ROOT, 'config.json'), deps.cfg.snowluma.accessToken ?? '');
      // 只记「已写回」，不打印 token 片段：日志会被贴进 issue / 截图，
      // 前 4 个字符同样是凭据的一部分（CWE-532，见 PR #13）。
      if (r.updated) deps.log('🔄 已把当前 token 写回 config.json');
    } catch {}
  }

async function healTokenIfStale(reason) {
    const now = Date.now();
    if (now - deps.tokenHealAt < 10000) return;   // 节流：close 事件会连续触发
    deps.tokenHealAt = now;
    try {
      const r = await deps.discoverSnowLumaConnection({ cfg: deps.cfg, timeoutMs: 4000 });
      if (!r.ok) {
        deps.log(`⚠️ token 自愈失败（${reason}）：${r.error}`);
        return;
      }
      await applyHealedTokens(r);
      deps.log(`   自愈完成：账号 ${r.self?.user_id ?? '?'}（${reason}）`);
    } catch (error) {
      deps.log(`⚠️ token 自愈异常：${error?.message ?? error}`);
    }
  }
return {rebuildInFlightCollector,armPendingWakeLease,disarmPendingWakeLease,clearAllPendingWakeLeases,startDshWatch,noteUpstreamPacket,noteReceiveHealth,snowlumaHealthSnapshot,reportSnowlumaHealth,pollSnowlumaStatus,startSnowlumaWatch,v2ToolEnabled,applyHealedTokens,syncTokenToFile,healTokenIfStale};
}
