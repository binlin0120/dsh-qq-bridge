// social-v1: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["DIRECTION_HINT","QUEUE_MAX","SENSITIVE_RE","SILENT_MARKER","SPACE_SPLIT_HINT","api","auditAndSend","buildWakePromptV2","buildWakeSnapshotV2","canReplayGroupMessage","canonicalV2Key","cfg","clearInterval","clearTimeout","currentMode","currentRoleHint","disarmPendingWakeLease","dshReady","enqueueForRetry","ensureSession","getSocialV2State","isCurrentSession","isSessionAllowedInCurrentMode","log","mdToPlain","mediaHintFor","messageMediaStore","noteModelMessagesV2","pendingWakeKeys","promptQueues","queued","randInt","resolveMediaList","sayBridge","selfNickname","setInterval","setTimeout","shouldAuditKey","social","socialV2","state","truncateText","withSlangContext"];
export function createSocialV1(deps){
function isSocialEnabled() {
    return deps.currentMode === 'reserved' && deps.cfg.social?.enabled !== false;
  }

function socialState(key) {
    if (!deps.social.states.has(key)) {
      deps.social.states.set(key, { phase: 'idle', lastCheckAt: 0, nextCheckAt: 0, lastActiveMessageAt: 0, activeEnteredAt: 0, activeDeadlineAt: 0, activeExitAt: 0, lastAiReplyAt: 0, lastFollowUpAt: 0, probeDeadline: 0, proactiveNextCheckAt: 0 });
    }
    return deps.social.states.get(key);
  }

// 启动阶段的"明确与 AI 有关"：@ / 提到名字 / 必回关键词 / 管理员私聊
  function isDirectAddress(textContent, event, kind) {
    if (kind !== 'group') return true;
    const lower = String(textContent ?? '').toLowerCase();
    const selfId = String(event?.self_id ?? '');
    if (selfId && lower.includes('@' + selfId)) return true;
    if (deps.selfNickname && (lower.includes('@' + deps.selfNickname) || lower.includes(deps.selfNickname))) return true;
    for (const kw of (deps.cfg.social?.mustReplyKeywords ?? [])) {
      if (lower.includes(String(kw).toLowerCase())) return true;
    }
    if (isDirectedAtAi(textContent)) return true;
    return false;
  }

// 是否"直接针对 AI"的提问/挑战：提到 AI 相关词且带疑问/比较，或对"你"开火，或追问催促
  function isDirectedAtAi(textContent) {
    const lower = String(textContent ?? '').toLowerCase();
    const aiMention = /deepseek|claude|chatgpt|gpt|大肥鱼|小鲸鱼|鲸鱼|d指导|d老师|d师傅|深度求索|\bds\b|ai|人工智障|机器人|模型/.test(lower);
    const challenge = /强|弱|行不行|能不能|会不会|是不是|一半|水平|垃圾|废物|白嫖|菜|不如|厉害|赢|输|比.*强|比.*弱/.test(lower);
    const question = /[?？吗呢吧]|怎么|为什么|哪|谁/.test(lower);
    if (aiMention && (question || challenge)) return true;
    // "你/您" + 疑问/比较/挑战（放宽，避免漏掉"你有claude一半强吗"这类直接问）
    if (/(你|您).{0,10}(吗|呢|？|\?|怎么|是不是|能不能|行不行|有没有|有|没有|比|不如|强|弱|一半|厉害|垃圾|菜|赢|输)/.test(lower)) return true;
    if (/^(你|您)(是不是|行不行|能不能|会不会|觉得|有|没有)/.test(lower)) return true;
    // "你是...还是... / 你是...吗 / 你是...？"（如：你是人类还是ai、你是真人吗）
    if (/(你|您)是[^？?。！!]{0,14}(还是|或者|吗|么|？|\?)/.test(lower)) return true;
    // 追问/催促：AI 没回时的真人式催促
    if (/怎么不说话|人呢|回我|说话啊|理我|别装死|在不在|装死|说话/.test(lower)) return true;
    return false;
  }

// 活跃期批量检测用的"必须回"判断：不依赖 event，只认昵称/关键词/直接针对 AI 的提问
  function isMustReplyText(textContent) {
    const lower = String(textContent ?? '').toLowerCase();
    if (deps.selfNickname && (lower.includes('@' + deps.selfNickname) || lower.includes(deps.selfNickname))) return true;
    for (const kw of (deps.cfg.social?.mustReplyKeywords ?? [])) {
      if (lower.includes(String(kw).toLowerCase())) return true;
    }
    if (isDirectedAtAi(textContent)) return true;
    return false;
  }

function appendRecentMessage(key, sender, textContent, plainText, quoteTargetIsSelf = false, isOwner = false, media = [], messageRef = '') {
    if (!deps.social.recentMessages.has(key)) deps.social.recentMessages.set(key, []);
    const arr = deps.social.recentMessages.get(key);
    arr.push({
      sender,
      text: deps.truncateText(String(textContent), 200),
      plain: deps.truncateText(String(plainText ?? textContent), 200),
      quoteTargetIsSelf: !!quoteTargetIsSelf,
      isOwner: !!isOwner,
      media: Array.isArray(media) ? media : [],
      messageId: messageRef ? String(messageRef) : '',
      hasMedia: Array.isArray(media) && media.length > 0,
      time: Date.now()
    });
    const cap = Math.max(50, Number(deps.cfg.social?.contextWindow ?? 15) * 2);
    while (arr.length > cap) arr.shift();
  }

function appendSummary(key, sender, textContent, plainText, isOwner = false, media = [], messageRef = '') {
    if (!deps.social.pendingSummaries.has(key)) {
      deps.social.pendingSummaries.set(key, { items: [], since: Date.now() });
    }
    const entry = deps.social.pendingSummaries.get(key);
    entry.items.push({ sender, text: deps.truncateText(String(textContent), 200), plain: deps.truncateText(String(plainText ?? textContent), 200), isOwner: !!isOwner, media: Array.isArray(media) ? media : [], messageId: messageRef ? String(messageRef) : '', hasMedia: Array.isArray(media) && media.length > 0, time: Date.now() });
    if (entry.items.length > 60) entry.items.shift();
  }

function buildContextBlock(key) {
    const ctx = (deps.social.recentMessages.get(key) ?? []).slice(-Number(deps.cfg.social?.contextWindow ?? 15));
    return ctx.map((m) => `${m.isOwner ? '【管理员】' : ''}${m.sender}：${m.text}${deps.mediaHintFor(key, m.messageId, m.media)}`).join('\n') || '（无）';
  }

// 触发进入活跃（启动阶段 → 活跃阶段）
  function enterActive(key) {
    const now = Date.now();
    const st = socialState(key);
    st.phase = 'active';
    st.lastCheckAt = now;
    st.nextCheckAt = now + deps.randInt(Number(deps.cfg.social?.activeCheckMinMs ?? 20000), Number(deps.cfg.social?.activeCheckMaxMs ?? 40000));
    st.lastActiveMessageAt = now;
    st.activeEnteredAt = now;
    st.probeDeadline = 0;
    // 从进入活跃那一刻起，随机一个“最长活跃持续时间”；到点后主动收尾退场（当前仅群聊启用）
    if (key.startsWith('group:') && deps.cfg.social?.activeDurationEnabled !== false) {
      st.activeDeadlineAt = now + deps.randInt(
        Number(deps.cfg.social?.activeDurationMinMs ?? 15 * 60 * 1000),
        Number(deps.cfg.social?.activeDurationMaxMs ?? 30 * 60 * 1000)
      );
    } else {
      st.activeDeadlineAt = 0;
    }
    st.activeExitAt = 0;
  }

function cancelSocialTimers(key) {
    const timers = deps.social.pendingTimers.get(key);
    if (!timers) return;
    for (const t of timers) deps.clearTimeout(t);
    deps.social.pendingTimers.delete(key);
  }

function cancelAllSocialTimers() {
    for (const timers of deps.social.pendingTimers.values()) {
      for (const t of timers) deps.clearTimeout(t);
    }
    deps.social.pendingTimers.clear();
  }

// 离开仿真模式时清理全部社交运行时状态，避免旧定时器/状态残留。
  function cleanupSocialForModeChange() {
    cancelAllSocialTimers();
    deps.social.states.clear();
    deps.social.recentMessages.clear();
    deps.messageMediaStore.clear();
    deps.social.pendingSummaries.clear();
    deps.social.silentContext.clear();
    deps.social.silentTurns.clear();
    deps.social.exitingSessions.clear();
    // 拒绝仍在排队中的 prompt，避免调用方 await 永远挂起
    for (const [, entry] of deps.promptQueues) {
      for (const item of entry.queue) item.reject(new Error('模式切换，已取消排队中的投递'));
    }
    deps.promptQueues.clear();
  }

function leaveActive(key) {
    cancelSocialTimers(key);
    deps.social.states.delete(key);
    deps.social.silentContext.delete(key);
  }

// 活跃阶段：只贴"没给过 AI 的新消息"（上下文在会话历史里，不重复贴，不贴人格）
  // allowSilent=false 表示这条必须回（被 @/点名/私聊等），不提供 [SILENT] 出口。
  function buildBatchPrompt(key, newMsgs, allowSilent = true) {
    const lines = newMsgs.map((m) => `${m.isOwner ? '【管理员】' : ''}${m.sender}：${m.text}${deps.mediaHintFor(key, m.messageId, m.media)}`).join('\n');
    const directionHint = lines.includes('[引用') ? `${deps.DIRECTION_HINT}\n` : '';
    if (!allowSilent) {
      return `【新消息】\n${lines}\n\n${directionHint}请回复消息。\n${deps.SPACE_SPLIT_HINT}`;
    }
    return `【新消息】\n${lines}\n\n${directionHint}请根据情况决定是否回复。如果不需要回应、想潜水/不接话，请只输出 ${deps.SILENT_MARKER}；否则正常回复。\n${deps.SPACE_SPLIT_HINT}`;
  }

// 冷场试探：让 AI 基于会话自然说一句（只给状态背景，不注入"试探"意图）
  function buildProbePrompt(key) {
    return `【群聊上下文】\n${buildContextBlock(key)}\n\n群里安静了一会儿，你可以说点什么。如果不想说，请只输出 ${deps.SILENT_MARKER}。\n${deps.SPACE_SPLIT_HINT}`;
  }

// 活跃超时退场：让 AI 自然地说一句收尾/潜水话，说完后安静下来。
  // 只给“该收尾了”的暗示，不暴露桥接的计时机制。
  function buildActiveExitPrompt(key, roleHint) {
    let p = '';
    if (roleHint) p += roleHint + '\n\n';
    p += `【群聊上下文】\n${buildContextBlock(key)}\n\n你已经参与群聊有一阵子了，现在该自然地收尾/潜水了。请说一句简短的退场话（例如“我先潜水了”“你们聊，我摸鱼去了”），说完后就安静下来，不再继续接话。`;
    return p;
  }

// 活跃超时判定：到达进入活跃时随机出的最长时间后，安排一次“收尾退场”投递，
  // 并把状态切到 exiting（退场中），等待 AI 的退场发言完成后再回到观望。
  function triggerActiveDurationExit(key, st, now) {
    if (!st || st.phase !== 'active') return false;
    if (!key.startsWith('group:')) return false; // 仅群聊启用，私聊不自动退场
    if (deps.cfg.social?.activeDurationEnabled === false) return false;
    const deadline = st.activeDeadlineAt || 0;
    if (!deadline || now < deadline) return false;
    if (st.phase === 'exiting') return true;
    st.phase = 'exiting';
    st.activeExitAt = now;
    // 先取消尚未触发的旧回复/补刀定时器，避免退场期间再冒出旧发言
    cancelSocialTimers(key);
    const roleHint = deps.currentRoleHint();
    const promptText = buildActiveExitPrompt(key, roleHint);
    scheduleSocialReply(
      key, promptText,
      Number(deps.cfg.social?.activeReplyDelayMinMs ?? 2000),
      Number(deps.cfg.social?.activeReplyDelayMaxMs ?? 8000),
      '活跃超时退场',
      true
    );
    deps.log(`社交模式：${key} 活跃超过时长上限，提示 AI 收尾退场`);
    return true;
  }

// 二期：观望阶段主动开话题（第三种触发）
  function buildProactivePrompt(key, roleHint) {
    let p = '';
    if (roleHint) p += roleHint + '\n\n';
    p += `【群聊上下文】\n${buildContextBlock(key)}\n\n群内已经长时间没人说话了，你打算开启一个新话题。优先结合你的人格/角色设定的兴趣，其次结合群里大家的兴趣，挑一个合适的话题。可以联网搜索一些新鲜话题来聊。如果你觉得现在不适合开口，可以只输出 ${deps.SILENT_MARKER}。\n${deps.SPACE_SPLIT_HINT}`;
    return p;
  }

// 实际的 DSH prompt 投递（不再直接对外暴露，统一走 promptQueues 串行队列）。
  async function deliverPromptNow(key, promptText, opts = {}) {
    if(opts.recoveryAttempt&&!deps.canReplayGroupMessage(key,opts.groupAdmission))return {ok:true,skipped:true};
    if (!deps.isSessionAllowedInCurrentMode(key)) throw new Error(`当前模式不允许会话 ${key}`);
    // Recheck queued wakes at dispatch time: no model call while paused/disabled
    // and no reserved2 prompt leaking into an ordinary chat after a mode switch.
    const wakeBlocked = () => opts.wakeReason && (deps.currentMode !== 'reserved2' || deps.socialV2.paused || deps.cfg.socialV2?.enabled === false);
    const skipWake = () => {
      deps.pendingWakeKeys.delete(key);
      deps.disarmPendingWakeLease(key);
      return { ok: true, skipped: true };
    };
    if (wakeBlocked()) return skipWake();
    if (!deps.dshReady) {
      const items = deps.queued.get(key) ?? [];
      if (items.length >= deps.QUEUE_MAX) {
        items.shift();
        deps.log(`队列满（${deps.QUEUE_MAX}），丢弃最旧消息 (${key})`);
      }
      items.push({ promptText, farewell: !!opts.farewell, silent: !!opts.silent, media: opts.media ?? [], wakeReason: opts.wakeReason, groupAdmission:opts.groupAdmission });
      deps.queued.set(key, items);
      return { ok: true, queued: true };
    }
    let sessionId;
    try {
      sessionId = await deps.ensureSession(key);
    } catch (error) {
      if (String(error?.message ?? error).includes('会话创建期间已重置')) {
        deps.enqueueForRetry(key, promptText, opts);
        return { ok: true, retried: true };
      }
      throw error;
    }
    let wakeState;
    let wakeToken;
    let wakeSnapshot;
    if (opts.wakeReason) {
      if (wakeBlocked()) return skipWake();
      // Build only after session creation: retries may rotate the token, and an
      // offline queue may have received more messages since this wake was queued.
      wakeState = deps.getSocialV2State(key);
      wakeToken = wakeState.agentToken;
      promptText = deps.buildWakePromptV2(key, opts.wakeReason);
      wakeSnapshot = deps.buildWakeSnapshotV2(key);
      if (wakeSnapshot) {
        promptText += `\n\n【本次消息快照】\n${JSON.stringify(wakeSnapshot)}\n以上消息已提供，无需重复查询；partial=true 时用 qq_get_unread_messages(afterSeq=readThroughSeq) 继续读取。先处理当前消息；回复前如需确认后续补充，用 qq_wait_for_messages(purpose="reply") 补足短静默，已安静够久会立即返回，不要先长等。收尾只确认你已处理的 readThroughSeq（本地 seq，非 QQ messageId），传给 qq_mark_read 或 qq_set_wake_config 的 throughSeq；新到消息留待处理。`;
      }
    }
    let content = [{ type: 'text', text: deps.withSlangContext(promptText,key) }];
    if (Array.isArray(opts.media) && opts.media.length > 0) {
      const imageParts = await deps.resolveMediaList(opts.media);
      content = [{ type: 'text', text: deps.withSlangContext(promptText,key) }, ...imageParts];
    }
    // 媒体解析成功后再标记退场，避免解析异常时残留退场标记。
    if (!deps.isCurrentSession(key, sessionId)) throw new Error('投递前会话已重置或权限已变化');
    if (opts.farewell) deps.social.exitingSessions.add(sessionId);
    let accepted;
    try {
      accepted = await deps.api.sessions.prompt({ sessionId, mode: 'queue', content });
    } catch (error) {
      if (opts.farewell) deps.social.exitingSessions.delete(sessionId);
      throw error;
    }
    if (!accepted.result.ok) {
      if (opts.farewell) deps.social.exitingSessions.delete(sessionId);
      const errText = `${accepted.result.error.code}: ${accepted.result.error.message}`;
      const safeErrText = deps.shouldAuditKey(key) && deps.SENSITIVE_RE.test(errText) ? '（含敏感信息，已隐藏）' : errText;
      if (!opts.silent) await deps.sayBridge(key, `⚠️ 消息未被接受：${safeErrText}`);
      return { ok: false, error: safeErrText };
    }
    if (wakeSnapshot && deps.isCurrentSession(key, sessionId)
        && deps.socialV2.conversations.get(deps.canonicalV2Key(key)) === wakeState
        && wakeState.agentToken === wakeToken) {
      // Acceptance grants visibility, never acknowledgement. New arrivals and
      // rejected/stale deliveries must not be cleared by an old cursor.
      deps.noteModelMessagesV2(wakeState, [...wakeSnapshot.messages, ...wakeSnapshot.recent]);
    }
    if (accepted.result.value.command?.text && !opts.silent && deps.currentMode !== 'reserved2') {
      if (opts.farewell) deps.social.exitingSessions.delete(sessionId);
      await deps.auditAndSend(key, deps.mdToPlain(accepted.result.value.command.text));
    } else if (accepted.result.value.command?.text && opts.silent && opts.farewell) {
      deps.social.exitingSessions.delete(sessionId);
    }
    return { ok: true };
  }

// 每个 QQ 会话串行投递 DSH prompt，保证 turn 完成顺序与提交顺序一致，
  // 从而让 [SILENT]、摘要静默、退场标记都能准确匹配到自己的 turn。
  function deliverPrompt(key, promptText, opts = {}) {
    return new Promise((resolve, reject) => {
      let entry = deps.promptQueues.get(key);
      if (!entry) {
        entry = { queue: [], running: false };
        deps.promptQueues.set(key, entry);
      }
      entry.queue.push({ promptText, opts, resolve, reject });
      processPromptQueue(key);
    });
  }

async function processPromptQueue(key) {
    const entry = deps.promptQueues.get(key);
    if (!entry || entry.running) return;
    const item = entry.queue.shift();
    if (!item) {
      if (entry.queue.length === 0) deps.promptQueues.delete(key);
      return;
    }
    entry.running = true;
    try {
      const result = await deliverPromptNow(key, item.promptText, item.opts);
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      entry.running = false;
      if (deps.promptQueues.get(key) === entry) {
        if (entry.queue.length) processPromptQueue(key);
        else deps.promptQueues.delete(key);
      }
    }
  }

function scheduleSocialReply(key, promptText, minDelay, maxDelay, label, farewell = false, media = null) {
    const delay = deps.randInt(minDelay, maxDelay);
    deps.log(`社交模式：${label} ${key}，延迟 ${Math.round(delay / 1000)}s 后投递`);
    const timer = deps.setTimeout(() => {
      const timers = deps.social.pendingTimers.get(key);
      if (timers) {
        timers.delete(timer);
        if (timers.size === 0) deps.social.pendingTimers.delete(key);
      }
      deliverPrompt(key, promptText, { farewell, media: media ?? [] }).catch((error) => deps.log(`社交投递异常 ${key}: ${error?.message ?? error}`));
    }, delay);
    const timers = deps.social.pendingTimers.get(key) ?? new Set();
    timers.add(timer);
    deps.social.pendingTimers.set(key, timers);
  }

// 全局扫描：驱动观望期主动开话题、活跃期检测、冷场处理、试探回退
  function socialLoopTick() {
    if (!isSocialEnabled()) return;
    const now = Date.now();
    // 所有"发过消息或已有状态"的群都参与状态机（观望中的群也做主动判定）
    const keys = new Set([...deps.social.states.keys(), ...deps.social.recentMessages.keys()]);
    for (const key of keys) {
      const st = socialState(key);
      if (st.phase === 'idle') {
        // ── 观望阶段：第三种触发（主动开话题，仅群聊生效） ─────────────────
        if (deps.cfg.social?.proactiveEnabled !== false && key.startsWith('group:')) {
          const arr = deps.social.recentMessages.get(key) ?? [];
          const lastMsgTime = arr.length ? arr[arr.length - 1].time : 0;
          const idleThreshold = Number(deps.cfg.social?.proactiveIdleThresholdMs ?? 1800000);
          if (now - lastMsgTime >= idleThreshold) {
            if (!st.proactiveNextCheckAt) {
              st.proactiveNextCheckAt = now + deps.randInt(Number(deps.cfg.social?.proactiveCheckMinMs ?? 2700000), Number(deps.cfg.social?.proactiveCheckMaxMs ?? 5400000));
            }
            if (now >= st.proactiveNextCheckAt) {
              st.proactiveNextCheckAt = now + deps.randInt(Number(deps.cfg.social?.proactiveCheckMinMs ?? 2700000), Number(deps.cfg.social?.proactiveCheckMaxMs ?? 5400000));
              if (Math.random() < Number(deps.cfg.social?.proactiveProbability ?? 0.2)) {
                enterActive(key);
                const roleHint = deps.currentRoleHint();
                const promptText = buildProactivePrompt(key, roleHint);
                scheduleSocialReply(
                  key, promptText,
                  Number(deps.cfg.social?.activeReplyDelayMinMs ?? 2000),
                  Number(deps.cfg.social?.activeReplyDelayMaxMs ?? 8000),
                  '主动开话题'
                );
                deps.log(`社交模式：${key} 观望期主动开话题，进入活跃`);
              }
            }
          }
        }
      } else if (st.phase === 'active') {
        // 活跃超时：即使群里一直有人说话，到达随机上限后也主动收尾退场
        if (triggerActiveDurationExit(key, st, now)) continue;
        if (now >= st.nextCheckAt) {
          const newMsgs = (deps.social.recentMessages.get(key) ?? []).filter((m) => m.time > st.lastCheckAt);
          st.lastCheckAt = now;
          st.nextCheckAt = now + deps.randInt(Number(deps.cfg.social?.activeCheckMinMs ?? 20000), Number(deps.cfg.social?.activeCheckMaxMs ?? 40000));
          if (newMsgs.length) {
            st.lastActiveMessageAt = now;
            const mustReply = key.startsWith('private:') || newMsgs.some((m) => m.quoteTargetIsSelf || isMustReplyText(m.plain ?? m.text));

            // 选择性沉默：只对非必须回的普通闲聊生效；直接提问/点名永远走正常回复
            if (!mustReply) {
              // 基准沉默概率；刚发过言后有人快速接话时不沉默，避免“活跃到一半突然不接”
              let skipProb = Math.min(1, Math.max(0, Number(deps.cfg.social?.skipProbability ?? 0.3)));
              const sinceAiReply = now - (st.lastAiReplyAt || 0);
              if (sinceAiReply < 60000) skipProb = 0;
              const pressure = Math.min(0.5, newMsgs.length * 0.1);
              skipProb = Math.max(0, skipProb - pressure);
              if (Math.random() < skipProb) {
                deps.log(`社交模式：活跃期 ${key} 跳过 ${newMsgs.length} 条普通消息（选择性沉默，skip=${skipProb.toFixed(2)}）`);
                // 真人"看到了但没回"：保留到 silentContext，下次投递时一起带给模型
                const silent = deps.social.silentContext.get(key) ?? [];
                silent.push(...newMsgs);
                deps.social.silentContext.set(key, silent.slice(-30));
                for (const m of newMsgs) appendSummary(key, m.sender, m.text, m.plain ?? m.text, m.isOwner, m.media ?? [], m.messageId ?? '');
                continue;
              }
            }

            // 投递时把之前沉默但"已看到未回应"的消息一并带给模型（真人视角：我看到过，只是当时没接）
            const seenMsgs = deps.social.silentContext.get(key) ?? [];
            const promptMsgs = [...seenMsgs, ...newMsgs];
            deps.social.silentContext.delete(key);
            const promptText = buildBatchPrompt(key, promptMsgs, !mustReply);
            const batchMedia = promptMsgs.flatMap((m) => Array.isArray(m.media) ? m.media : []);
            scheduleSocialReply(
              key, promptText,
              Number(deps.cfg.social?.activeReplyDelayMinMs ?? 2000),
              Number(deps.cfg.social?.activeReplyDelayMaxMs ?? 8000),
              '活跃期回应',
              false,
              batchMedia
            );
            deps.log(`社交模式：活跃期 ${key} 检测到 ${newMsgs.length} 条新消息${seenMsgs.length ? `（含 ${seenMsgs.length} 条之前沉默的）` : ''}`);
          } else if (now - st.lastActiveMessageAt >= Number(deps.cfg.social?.idleWindowMs ?? 180000)) {
            // 冷场：大概率回观望；小概率让 AI 说一句（试探群友是否还在）
            if (Math.random() < Number(deps.cfg.social?.idleRetryProbability ?? 0.25)) {
              st.phase = 'probing';
              st.probeDeadline = now + Number(deps.cfg.social?.idleRetryWaitMs ?? 120000);
              const promptText = buildProbePrompt(key);
              scheduleSocialReply(
                key, promptText,
                Number(deps.cfg.social?.activeReplyDelayMinMs ?? 2000),
                Number(deps.cfg.social?.activeReplyDelayMaxMs ?? 8000),
                '冷场试探'
              );
              deps.log(`社交模式：${key} 冷场，AI 试探性说一句`);
            } else {
              leaveActive(key);
              deps.log(`社交模式：${key} 冷场，回到观望`);
            }
          }
        }
      } else if (st.phase === 'exiting') {
        // 退场中：等待 AI 的收尾发言完成后进入观望。
        // 这里不做任何参与/冷场判定，新消息由 handleIncoming 转入摘要。
        // 极端兜底：超过 60 分钟仍未完成（如 DSH 长时间离线），强制回观望，避免状态卡死。
        if (now - st.activeExitAt > 60 * 60 * 1000) {
          deps.log(`社交模式：${key} 退场等待超时（60 分钟），强制回到观望`);
          st.phase = 'idle';
          st.activeDeadlineAt = 0;
          st.activeExitAt = 0;
          const sid = deps.state.sessions[key];
          if (sid) deps.social.exitingSessions.delete(sid);
        }
      } else if (st.phase === 'probing' && now > st.probeDeadline) {
        // 试探后仍无人说话 → 100% 回观望
        leaveActive(key);
        deps.log(`社交模式：${key} 试探无回应，回到观望`);
      }
    }
  }

function startSocialLoop() {
    if (deps.social.loopTimer) deps.clearInterval(deps.social.loopTimer);
    deps.social.loopTimer = deps.setInterval(socialLoopTick, 5000);
    deps.social.loopTimer.unref?.();
  }

async function flushSummaries(key = null) {
    const targets = key ? (deps.social.pendingSummaries.has(key) ? [[key, deps.social.pendingSummaries.get(key)]] : []) : [...deps.social.pendingSummaries.entries()];
    for (const [k, entry] of targets) {
      if (!entry.items.length) continue;
      const lines = entry.items.map((m) => `${m.isOwner ? '【管理员】' : ''}${m.sender}：${m.text}${deps.mediaHintFor(k, m.messageId, m.media)}`).join('\n');
      const summaryMedia = entry.items.flatMap((m) => Array.isArray(m.media) ? m.media : []);
      let sessionId;
      try {
        sessionId = await deps.ensureSession(k);
      } catch (error) {
        deps.log(`摘要投喂创建会话失败 (${k}): ${error?.message ?? error}`);
        continue;
      }
      const roleHint = deps.currentRoleHint();
      const summaryText = `${roleHint ? roleHint + '\n\n' : ''}【群聊摘要】过去一段时间群里发生了这些（你未逐条参与）：\n${lines}\n\n【最近对话】\n${buildContextBlock(k)}\n\n你不需要回复，只需记住这些内容，后续聊天会更自然。`;
      const silentId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      deps.social.silentTurns.set(sessionId, [...(deps.social.silentTurns.get(sessionId) ?? []), { id: silentId, ts: Date.now() }]);
      const popSilent = () => {
        const arr = deps.social.silentTurns.get(sessionId) ?? [];
        const next = arr.filter((x) => x.id !== silentId);
        if (next.length > 0) deps.social.silentTurns.set(sessionId, next);
        else deps.social.silentTurns.delete(sessionId);
      };
      try {
        const result = await deliverPrompt(k, summaryText, { silent: true, media: summaryMedia });
        if (result.ok) {
          deps.log(`已投喂群聊摘要 (${k}) ${entry.items.length} 条`);
          entry.items = [];
        } else {
          popSilent();
          deps.log(`摘要投喂被拒 (${k}): ${result.error || '未知错误'}`);
        }
      } catch (error) {
        popSilent();
        deps.log(`摘要投喂失败 (${k}): ${error?.message ?? error}`);
      }
    }
    for (const k of [...deps.social.pendingSummaries.keys()]) {
      if (deps.social.pendingSummaries.get(k)?.items?.length === 0) deps.social.pendingSummaries.delete(k);
    }
  }
return {isSocialEnabled,socialState,isDirectAddress,isDirectedAtAi,isMustReplyText,appendRecentMessage,appendSummary,buildContextBlock,enterActive,cancelSocialTimers,cancelAllSocialTimers,cleanupSocialForModeChange,leaveActive,buildBatchPrompt,buildProbePrompt,buildActiveExitPrompt,triggerActiveDurationExit,buildProactivePrompt,deliverPromptNow,deliverPrompt,processPromptQueue,scheduleSocialReply,socialLoopTick,startSocialLoop,flushSummaries};
}
