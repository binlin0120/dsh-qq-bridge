// delivery: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["AbortSignal","KNOWN_AGENT_TOKENS","PARTICLE_TAIL","SEND_TIMEOUT_MS","SENSITIVE_RE","SOFT_PARTICLES","appendActivity","bot","cfg","currentMode","escapeCqText","fetch","isOwnerKey","isSessionAllowedInCurrentMode","lastOwnerChatAt","lastSendFailed","log","quietAt","randInt","readRoleState","sayBridge","sendChain","sendEpochs","sessionPolicy","sleep","splitForQQ","state","text","withTimeout","withinDeadline"];
export function createDelivery(deps){
// ── 夜间免打扰：23:00-8:00 不主动发给机主（他在聊、或者是他定的 ⏰ 提醒除外） ──
  function shanghaiHour(t = Date.now()) { return new Date(t + 8 * 3600000).getUTCHours(); }

function inQuietHours(t = Date.now()) { return deps.quietAt(t,deps.cfg.quietHours); }

function canSendNow(key,{direct=false,reminder=false}={}) {
    if(deps.isOwnerKey(key)&&deps.state.ownerQuiet&&!direct&&!reminder)return false;
    if (!deps.isOwnerKey(key) || !inQuietHours()) return true;
    return direct || reminder || Date.now()-deps.lastOwnerChatAt('in') < 10*60000;
  }

function requireActiveHours() { if(inQuietHours()) throw new Error('现在是23:00–08:00免打扰，主动社交动作请留到白天'); }

async function oneBotCall(action, params) {
    const r = await deps.withinDeadline(()=>deps.bot.request(action,params),{ms:15000,label:'OneBot '+action});
    if (!r || r.status !== 'ok' || r.retcode !== 0) throw new Error(`${action} 失败：${r?.wording || r?.message || r?.retcode || 'unknown'}`);
    return r.data;
  }

function redactKnownTokensOnly(text) {
    let s = String(text ?? '');
    for (const token of deps.KNOWN_AGENT_TOKENS) {
      if (token && s.includes(token)) s = s.split(token).join('***');
    }
    return s;
  }

function sendToQQ(key, msg, options = {}) {
    let batchFailed=false;const messageIds=[];
    const assertSendAllowed = captureSendGuard(key);
    const safeMsg = redactKnownTokensOnly(msg);
    const [kind, id] = key.split(':');
    const parts = deps.splitForQQ(safeMsg);
    deps.lastSendFailed.delete(key);
    for (const part of parts) {
      deps.sendChain = deps.sendChain
        .then(async () => {
          assertSendAllowed();
          options.capabilityGuard?.();
          const receipt=kind === 'private'?await deps.withTimeout(deps.bot.sendPrivateMessage(Number(id), deps.text(deps.escapeCqText(part))), deps.SEND_TIMEOUT_MS, `QQ发送 ${kind}:${id}`):await deps.withTimeout(deps.bot.sendGroupMessage(Number(id), deps.text(deps.escapeCqText(part))), deps.SEND_TIMEOUT_MS, `QQ发送 ${kind}:${id}`);
          if(receipt?.message_id)messageIds.push(receipt.message_id);
        })
        .catch((error) => {
          batchFailed=true;
          deps.lastSendFailed.set(key, true);
          deps.log(`QQ 发送失败 (${key}):`, error?.message ?? error);
        })
        .then(() => deps.sleep(deps.cfg.sendDelayMs));
    }
    return deps.sendChain.then(()=>{if(options.capabilityGuard&&batchFailed)throw Error('QQ发送没有确认成功');return {ok:!batchFailed,messageIds};});
  }

/** 上一批发往该会话的消息是否全部成功。 */
  function lastSendSucceeded(key) {
    return deps.lastSendFailed.get(key) !== true;
  }

function softenSegment(seg) {
    const t = String(seg ?? '').trim();
    if (!t) return t;
    if (deps.PARTICLE_TAIL.test(t)) return t;
    if (/[\uff01\uff1f!?\u2026~]$/.test(t)) return t;
    if (!/[\u4e00-\u9fa5]$/.test(t)) return t;
    if (t.length < 4) return t;
    return t + deps.SOFT_PARTICLES[Math.floor(Math.random() * deps.SOFT_PARTICLES.length)];
  }

function splitChatSegments(text, maxLen = 50) {
    // 网址先换成占位符：否则 ? ; , 会被当成句读切开或删掉，链接就坏了。最后再换回。
    const chatUrls = [];
    const src = String(text ?? '').replace(/\r\n/g, '\n').trim()
      .replace(/https?:\/\/[^\s\u3000-\u303f\uff01-\uff5e]+/g, (u) => { chatUrls.push(u); return `\u0000${chatUrls.length - 1}\u0000`; });
    const restoreUrls = (x) => String(x ?? '').replace(/\u0000(\d+)\u0000/g, (_, i) => chatUrls[Number(i)]);
    if (!src) return [];
    const stripBullet = (x) => String(x ?? '')
      .replace(/^[\s\u2022\u00b7\-\*\u25aa\u25e6\u25cf\u25cb\u25c6\u25c7\u2192>]+/u, '')
      .replace(/^\d+[.\u3001)]\s*/, '')
      .trim();
    const cleanPunct = (x) => String(x ?? '')
      .replace(/[\uff0c,\u3001\uff1b;]/g, '')
      .replace(/[\u3002]/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    const raw = src.split(/\n+/).flatMap((paragraph,paragraphIndex)=>paragraph.split(/(?<=[\u3002\uff01\uff1f!?\uff1b;\u2026])\s*/).map(text=>({text:stripBullet(text),paragraphIndex}))).filter(x=>x.text);
    // merge short sentences up to maxLen so QQ does not get flooded
    const merged = [];
    let previousParagraph=-1;
    for (const {text:seg,paragraphIndex} of raw) {
      if (paragraphIndex===previousParagraph&&merged.length > 0 && merged[merged.length - 1].length + seg.length <= maxLen) {
        merged[merged.length - 1] += seg;
      } else if (seg.length > maxLen) {
        const subs = seg.split(/(?<=[\uff0c,\u3001])\s*/).map((x) => x.trim()).filter(Boolean);
        let buf = '';
        for (const sub of subs) {
          if ((buf + sub).length <= maxLen) buf += sub;
          else { if (buf) merged.push(buf); buf = sub; }
        }
        if (buf) merged.push(buf);
      } else {
        merged.push(seg);
      }
      previousParagraph=paragraphIndex;
    }
    let out = merged.map(cleanPunct).filter(Boolean);
    // hard cap: at most 7 messages per turn (QQ anti-spam)
    if (out.length > 7) {
      const head = out.slice(0, 6);
      const tail = out.slice(6).join('');
      out = [...head, tail];
    }
    // 不再强行在句尾补语气词：机主要的是“语气词想加再加”，由人设控制，桥接不代加。
    out = out.filter(Boolean).map(restoreUrls);
    return out.length > 0 ? out : [restoreUrls(cleanPunct(src))];
  }

function singleLineForQQ(s) {
    return String(s ?? '')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

// 超长段落：先按次要标点拆，再按字符硬拆，保证不丢内容、不退回单条长消息。
  // URL 会被当作不可拆分的原子，避免把 https://... 这种整条网页地址拆断。
  function splitLongSegment(segment, max) {
    const s = String(segment ?? '').trim();
    if (!s) return [];
    const safeMax = Number.isFinite(max) && max >= 1 ? Math.floor(max) : 500;
    if (s.length <= safeMax) return [s];

    const urlRe = /https?:\/\/[^\s，。；、]+/g;
    const urls = [];
    const masked = s.replace(urlRe, (m) => {
      urls.push(m);
      return `\u0000URL${urls.length - 1}\u0000`;
    });

    const raw = masked.split(/([，、；：,;:])/);
    const tokens = [];
    for (let i = 0; i < raw.length; i += 2) {
      tokens.push(((raw[i] ?? '') + (raw[i + 1] ?? '')).trim());
    }
    const out = [];
    let cur = '';
    // ⚠️ 占位符 \u0000URL<n>\u0000 必须是**不可切开的最小单位**。
    // 早先的实现对超长 token 直接按 safeMax 硬切，会把占位符拦腰截断
    // （如 "\u0000UR" + "L0\u0000"），后面的还原正则 \u0000URL(\d+)\u0000 就匹配不上 →
    // **URL 整条丢失 + 裸 NUL + 字面量 "URL0" 被发进 QQ 消息**（实测 13 个偏移里 5 个损坏）。
    // 这里改成按占位符边界切分，宁可某段略超 max 也绝不切碎占位符。
    const PLACEHOLDER_ANY = /\u0000URL\d+\u0000/;
    const PLACEHOLDER_ALL = /\u0000URL\d+\u0000/g;
    /** 把 token 切成 {text, isPlaceholder} 序列（占位符整体一块，绝不拆） */
    const splitByPlaceholder = (tok) => {
      const parts = [];
      let last = 0;
      let m;
      PLACEHOLDER_ALL.lastIndex = 0;
      while ((m = PLACEHOLDER_ALL.exec(tok)) !== null) {
        if (m.index > last) parts.push({ text: tok.slice(last, m.index), isPlaceholder: false });
        parts.push({ text: m[0], isPlaceholder: true });
        last = m.index + m[0].length;
      }
      if (last < tok.length) parts.push({ text: tok.slice(last), isPlaceholder: false });
      return parts;
    };
    for (const tok of tokens) {
      if (!tok) continue;
      if (tok.length > safeMax) {
        if (cur) { out.push(cur); cur = ''; }
        for (const piece of splitByPlaceholder(tok)) {
          // 占位符整块输出；普通文本仍按 safeMax 切
          if (piece.isPlaceholder) { out.push(piece.text); continue; }
          for (let i = 0; i < piece.text.length;) {
            let end = Math.min(i + safeMax, piece.text.length);
            // 绝不在代理对（emoji、部分生僻字）中间下刀：硬切会产生「半个 emoji」，
            // 两个孤立代理各自成为一条 QQ 消息、永远无法再拼回，群友看到的就是乱码方块。
            // 退一格把整个字符让给下一段；若退成空串就不退（safeMax 极小时），
            // 宁可硬切也要保证循环一定前进。逻辑内联在此，函数保持自包含
            // —— test-voice.mjs 会把这个函数的源码单独 eval 出来测。
            if (end < piece.text.length && end - i > 1) {
              const last = piece.text.charCodeAt(end - 1);
              if (last >= 0xd800 && last <= 0xdbff) end -= 1;
            }
            out.push(piece.text.slice(i, end));
            i += end > i ? end - i : safeMax;
          }
        }
      } else if (cur.length + tok.length <= safeMax) {
        cur += tok;
      } else {
        out.push(cur);
        cur = tok;
      }
    }
    if (cur) out.push(cur);

    return out
      .map((chunk) => chunk.replace(/\u0000URL(\d+)\u0000/g, (_, i) => urls[Number(i)] ?? ''))
      .filter(Boolean);
  }

// 判断字符是否属于“中文汉字”范围，用于识别空格分句意图。
  // 注意：这里只认汉字，不认中文标点/全角符号，避免“你好， 世界”这种 AI 排版空格被误拆。
  function isCjkChar(ch) {
    if (!ch) return false;
    const code = ch.codePointAt(0);
    return (
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0xF900 && code <= 0xFAFF)
    );
  }

// 按“有意的空格”拆分：真人不会主动用空格，因此 AI 回复里的空格视为分条信号。
  // 空格两侧只要有一侧是中文/中文标点，就按分条处理（包括中英文/数字之间的空格）。
  // 注意：该逻辑只用于一代 reserved 的自动转发文本；二代 reserved2 不走这里，二代必须显式用数组分条。
  function splitByCjkSpaces(src) {
    const tokens = String(src ?? '').split(/\s+/).map((t) => t.trim()).filter(Boolean);
    if (tokens.length <= 1) return tokens;
    const groups = [];
    let cur = tokens[0];
    for (let i = 1; i < tokens.length; i++) {
      const prevLast = [...cur].pop() || '';
      const currFirst = [...tokens[i]][0] || '';
      // 空格两侧只要有一侧是汉字，就视为分条信号。
      if (isCjkChar(prevLast) || isCjkChar(currFirst)) {
        groups.push(cur);
        cur = tokens[i];
      } else {
        cur = cur + ' ' + tokens[i];
      }
    }
    if (cur) groups.push(cur);
    return groups;
  }

// 新分句逻辑：分句权交给 AI。
  // AI 用空格表示“这里要分成下一条消息”，桥接按空格拆条；
  // 不想分条时用标点连接、不加空格即可。单条消息只做 maxReplyChars（默认 500 字）安全硬拆。
  function planSocialTimeline(text, socialCfg) {
    const src = String(text ?? '').replace(/\r\n/g, '\n').trim();
    const rawMaxChars = Number(socialCfg?.maxReplyChars ?? 500);
    const maxChars = Number.isFinite(rawMaxChars) && rawMaxChars >= 1 ? Math.floor(rawMaxChars) : 500;
    const enabled = socialCfg?.burstEnabled !== false;
    if (!src) return { main: [], followUp: null };

    // 关闭分条：整条作为一条消息发送，只做安全硬拆
    if (!enabled) {
      return { main: splitLongSegment(src, maxChars).map(singleLineForQQ), followUp: null };
    }

    // 按空格（含换行）拆成候选消息；每个候选再按 maxChars 安全硬拆
    const parts = splitByCjkSpaces(src);
    if (parts.length <= 1) {
      return { main: splitLongSegment(parts[0] || src, maxChars).map(singleLineForQQ), followUp: null };
    }

    const main = [];
    for (const part of parts) {
      main.push(...splitLongSegment(part, maxChars).map(singleLineForQQ));
    }
    return { main: main.filter(Boolean), followUp: null };
  }

// 分条发送：与 sendToQQ 共用同一 sendChain，严格顺序；条间随机间隔，
  // 有概率使用长间隔（错落感）；最后一条后不再 sleep。
  function sendBurstToQQ(key, messages, socialCfgOrMin, maybeMax) {
    const assertSendAllowed = captureSendGuard(key);
    const [kind, id] = key.split(':');
    let min, max, longProb = 0, longMin = 0, longMax = 0;
    if (typeof socialCfgOrMin === 'object' && socialCfgOrMin !== null) {
      const cfg = socialCfgOrMin;
      min = Math.max(0, Number(cfg.burstIntervalMinMs) || 1000);
      max = Math.max(min, Number(cfg.burstIntervalMaxMs) || min);
      longProb = Math.min(1, Math.max(0, Number(cfg.longGapProbability) || 0));
      longMin = Math.max(0, Number(cfg.longGapMinMs) || 8000);
      longMax = Math.max(longMin, Number(cfg.longGapMaxMs) || longMin);
    } else {
      min = Math.max(0, Number(socialCfgOrMin) || 0);
      max = Math.max(min, Number(maybeMax) || min);
    }

    const sent = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = redactKnownTokensOnly(messages[i]);
      const isLast = i === messages.length - 1;
      deps.sendChain = deps.sendChain
        .then(async () => {
          assertSendAllowed();
          if (kind === 'private') await deps.withTimeout(deps.bot.sendPrivateMessage(Number(id), deps.text(deps.escapeCqText(msg))), deps.SEND_TIMEOUT_MS, `QQ发送 ${kind}:${id}`);
          else await deps.withTimeout(deps.bot.sendGroupMessage(Number(id), deps.text(deps.escapeCqText(msg))), deps.SEND_TIMEOUT_MS, `QQ发送 ${kind}:${id}`);
          sent.push(msg);
        })
        .catch((error) => {
          deps.log(`QQ 发送失败 (${key}):`, error?.message ?? error);
          // 与 sendToQQ 同样的失败记账。少了这一步，调用方 `lastSendSucceeded(key)`
          // 会把「一条都没发出去」当成「我已经说过话了」：刷新 lastActiveMessageAt /
          // lastAiReplyAt 并抑制后续接话，而群里什么都没收到 —— 静默丢回复。
          deps.lastSendFailed.set(key, true);
        });
      if (!isLast) {
        const useLong = longProb > 0 && Math.random() < longProb;
        const delay = useLong ? deps.randInt(longMin, longMax) : deps.randInt(min, max);
        deps.sendChain = deps.sendChain.then(() => deps.sleep(delay));
      }
    }
    return deps.sendChain.then(() => sent);
  }

async function onebotSend(kind, id, message, replyToMessageId, atUserId = null) {
    const segments = [];
    if (replyToMessageId !== undefined && replyToMessageId !== null && String(replyToMessageId).trim() !== '') {
      const rid = String(replyToMessageId).trim();
      if (!/^-?[1-9]\d*$/.test(rid)) throw new Error('replyToMessageId 必须是非零整数（消息 id 可能为负数）');
      segments.push({ type: 'reply', data: { id: rid } });
    }
    if (atUserId !== undefined && atUserId !== null && String(atUserId).trim() !== '') {
      const at = String(atUserId).trim();
      // 只允许正整数 QQ 号，禁止 @all，避免被滥用成 @全体成员
      if (!/^\d+$/.test(at)) throw new Error('atUserId 必须是正整数 QQ 号，且不能为 all');
      segments.push({ type: 'at', data: { qq: at } });
    }
    const rawMessage = String(message ?? '');
    const hasKnownToken = [...deps.KNOWN_AGENT_TOKENS].some((t) => t && rawMessage.includes(t));
    if (hasKnownToken) {
      deps.log(`发送内容包含会话令牌，已阻止发送 (${kind}:${id})`);
      throw new Error('发送内容包含会话令牌，已阻止发送');
    }
    segments.push({ type: 'text', data: { text: deps.escapeCqText(rawMessage) } });
    const action = kind === 'private' ? 'send_private_msg' : 'send_group_msg';
    const params = kind === 'private' ? { user_id: Number(id), message: segments } : { group_id: Number(id), message: segments };
    const httpUrl = String(deps.cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
    const res = await deps.fetch(`${httpUrl}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(deps.cfg.snowluma?.accessToken ? { authorization: `Bearer ${deps.cfg.snowluma.accessToken}` } : {})
      },
      body: JSON.stringify(params),
      signal: deps.AbortSignal.timeout(15000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.status !== 'ok' || body.retcode !== 0) {
      const hint = res.status === 426 ? '（HTTP 426：snowluma.httpUrl 可能指向了 WebSocket 端口，请检查 config.json 的 snowluma.httpUrl 是否为 OneBot HTTP API 地址）' : '';
      throw new Error(`OneBot ${action} 失败: ${body.wording || body.retcode || res.status}${hint}`);
    }
    return body.data;
  }

function clampGapV2(ms, sendCfg) {
    const min = Math.max(100, Number(sendCfg.burstIntervalMinMs) || 300);
    const max = Math.max(min, Number(sendCfg.maxGapMs) || 10000);
    return Math.max(min, Math.min(max, Math.round(Number(ms) || min)));
  }

function computeGapsV2(messages, gapMode, gapMs, gaps, sendCfg) {
    const delays = [];
    if (!messages || messages.length <= 1) return delays;
    const mode = gapMode === 'fixed' || gapMode === 'byLength' ? gapMode : 'auto';
    if (mode === 'fixed') {
      if (Array.isArray(gaps) && gaps.length >= messages.length - 1) {
        for (let i = 0; i < messages.length - 1; i++) delays.push(clampGapV2(gaps[i], sendCfg));
      } else {
        const g = clampGapV2(Number(gapMs) || Number(sendCfg.burstIntervalMinMs) || 1000, sendCfg);
        for (let i = 0; i < messages.length - 1; i++) delays.push(g);
      }
    } else if (mode === 'byLength') {
      const base = Number(sendCfg.gapBaseMs) || 800;
      const perChar = Number(sendCfg.gapPerCharMs) || 20;
      for (let i = 0; i < messages.length - 1; i++) {
        const chars = Math.max(1, String(messages[i] || '').length);
        delays.push(clampGapV2(base + chars * perChar, sendCfg));
      }
    } else {
      const longProb = Math.min(1, Math.max(0, Number(sendCfg.longGapProbability) || 0));
      for (let i = 0; i < messages.length - 1; i++) {
        const useLong = longProb > 0 && Math.random() < longProb;
        const min = useLong ? (Number(sendCfg.longGapMinMs) || 5000) : (Number(sendCfg.burstIntervalMinMs) || 1000);
        const max = useLong ? (Number(sendCfg.longGapMaxMs) || 10000) : (Number(sendCfg.burstIntervalMaxMs) || 3000);
        delays.push(clampGapV2(deps.randInt(Math.max(100, min), Math.max(100, max)), sendCfg));
      }
    }
    return delays;
  }

function sendMessagesV2(key, messages, delays, replyToMessageId, atUserId = null, messageIds = []) {
    const assertSendAllowed = captureSendGuard(key);
    const [kind, id] = key.split(':');
    const sent = [];
    const failed = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const useReply = i === 0 ? replyToMessageId : null;
      const useAt = i === 0 ? atUserId : null;
      deps.sendChain = deps.sendChain
        .then(async () => {
          assertSendAllowed();
          const receipt=await onebotSend(kind, id, msg, useReply, useAt);
          if(receipt?.message_id!==undefined&&receipt.message_id!==null)messageIds.push(receipt.message_id);
          sent.push(msg);
        })
        .catch((error) => {
          deps.log(`QQ 发送失败 (${key}):`, error?.message ?? error);
          failed.push(error);
        });
      if (i < delays.length) {
        const d = delays[i];
        deps.sendChain = deps.sendChain.then(() => deps.sleep(d));
      }
    }
    return deps.sendChain.then(() => {
      if (failed.length > 0) {
        const err = new Error(`QQ 发送失败 ${failed.length}/${messages.length} 条：${failed[0]?.message ?? '未知错误'}`);
        err.sent = sent.slice();
        throw err;
      }
      return sent;
    });
  }

// 审计范围：closed-agent 仅对 owner 私聊跳过；其余模式/会话一律审计
  function shouldAuditKey(key) {
    if (deps.currentMode === 'closed-agent') {
      return !(key === `private:${String(deps.cfg.ownerQQ ?? '')}`);
    }
    return true;
  }

// 入队校验无法约束排队等待期间的权限变化，每条消息临近实际发送时再次校验。
  function captureSendGuard(key) {
    const policy = deps.sessionPolicy(key);
    const sendEpoch=deps.sendEpochs.get(key)||0;
    const sessionId = deps.state.sessions[key];
    return () => {
      if ((deps.sendEpochs.get(key)||0)!==sendEpoch || !deps.isSessionAllowedInCurrentMode(key) || policy !== deps.sessionPolicy(key)
          || (sessionId && deps.state.sessions[key] !== sessionId)) {
        throw new Error('发送已取消：会话、模式或白名单已变化');
      }
    };
  }

// 静默模式：除 owner 私聊外，不发送任何在途 AI 回复。
  function shouldBlockSilentReply(key) {
    const roleState = deps.readRoleState();
    return roleState.mode === 'silent' && key !== `private:${String(deps.cfg.ownerQQ ?? '')}`;
  }

// 统一出站消息：先完整文本审计，再发送。返回是否真的发出。
  async function auditAndSend(key, text, options={}) {
    const hasKnownToken = [...deps.KNOWN_AGENT_TOKENS].some((t) => t && String(text ?? '').includes(t));
    if (shouldAuditKey(key) && (deps.SENSITIVE_RE.test(text) || hasKnownToken)) {
      deps.log(`⚠️ 回复被安全策略拦截 (${key})，疑似包含敏感信息${hasKnownToken ? '（含会话令牌）' : ''}`);
      deps.appendActivity(`${key} agent 回复被拦截（疑似敏感信息${hasKnownToken ? '/会话令牌' : ''}）`);
      if (deps.cfg.security?.interceptNotify !== false) {
        await deps.sayBridge(key, '⚠️ 本条回复因疑似包含敏感信息（路径/凭据/会话令牌）被安全策略拦截，已记录并通知管理员。');
      }
      return false;
    }
    const receipt=await sendToQQ(key, text, options);
    return receipt.ok;
  }
return {shanghaiHour,inQuietHours,canSendNow,requireActiveHours,oneBotCall,redactKnownTokensOnly,sendToQQ,lastSendSucceeded,softenSegment,splitChatSegments,singleLineForQQ,splitLongSegment,isCjkChar,splitByCjkSpaces,planSocialTimeline,sendBurstToQQ,onebotSend,clampGapV2,computeGapsV2,sendMessagesV2,shouldAuditKey,captureSendGuard,shouldBlockSilentReply,auditAndSend};
}
