// voice: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["AUDIO_EXTS","AbortSignal","ROOT","STATE_DIR","api","appendActivity","assertOutboundAuditOk","beijingTime","captureSendGuard","cfg","cleanupTemp","clearTimeout","closedAgentPreset","composeServiceReply","createTurnCollector","crypto","describeAudio","dshReady","ensureChatModel","fallbackServiceVoice","fetch","fs","getSocialV2State","inspectAudio","isOwnerKey","listAudioFiles","loadGuestChat","log","noteGuestChat","noteOwnerChat","ownerChat","path","pinInternalTitle","process","processAudioVolume","readConversationPersona","resolveAudioProcessing","resolveAudioSource","resolvePresetName","safeJoinLibrary","saveSocialV2State","scrubPrivate","sendChain","sendToQQ","serviceFacts","serviceVoiceAliases","serviceVoiceLast","setTimeout","truncateText","unwrap","voiceSendTimes"];
export function createVoice(deps){
function voiceCfg() {
    const v = deps.cfg.socialV2?.voice ?? {};
    return {
      enabled: v.enabled !== false,
      dir: deps.path.resolve(deps.ROOT, String(v.dir ?? 'audio')),
      maxSeconds: Number(v.maxSeconds) > 0 ? Number(v.maxSeconds) : 300,
      maxBytes: Number(v.maxBytes) > 0 ? Number(v.maxBytes) : 20 * 1024 * 1024,
      maxPerMinute: Number(v.maxPerMinute) >= 0 ? Number(v.maxPerMinute) : 2,
      maxPerHour: Number(v.maxPerHour) >= 0 ? Number(v.maxPerHour) : 10,
      allowAbsolutePath: v.allowAbsolutePath === true,
      defaultVolume: Number(v.defaultVolume) > 0 ? Number(v.defaultVolume) : 1,
      loudness: v.loudness || 'normal',
      ffmpegPath: deps.process.env.FFMPEG_PATH || v.ffmpegPath || null,
      autoReadback: v.autoReadback !== false
    };
  }

function voiceLibrary() {
    const dir = voiceCfg().dir;
    const files = deps.listAudioFiles(dir);
    return files.map((f) => {
      let stat = null;
      try { stat = deps.fs.statSync(f); } catch {}
      return { name: deps.path.relative(dir, f).split(deps.path.sep).join('/'), bytes: stat?.size ?? 0, mtimeMs: stat?.mtimeMs ?? 0 };
    });
  }

/**
   * 把「AI 给的语音引用」解析成可发送的本地绝对路径。
   *
   * 安全边界：**AI 只能从语音库目录里取文件**（防 prompt injection 拿任意本地文件当语音外发）。
   *
   * 历史坑（已修）：这里曾经在 `socialV2.voice.allowAbsolutePath: true` 时直接把 AI 给的
   * 绝对路径交给 resolveAudioSource 解析，于是「AI 传 C:\Users\x\Music\任意.mp3」
   * 就能把本机任意音频（< 20 MB）发到群里 —— 而 inspectAudio 对「没有音频流」或
   * ffprobe 不可用的情况是放行的，等于把开关变成了任意文件外发通道。
   * 现在即使开了这个开关，也要求绝对路径**必须落在语音库目录之内**；
   * 真要从库外发文件请走操作者通道（resolveVoicePathForOperator / CLI）。
   */
  function voicePathInsideLibrary(vc, absPath) {
    const rel = deps.path.relative(vc.dir, absPath);
    if (!rel || rel.startsWith('..') || deps.path.isAbsolute(rel)) return null;
    if (!deps.fs.existsSync(absPath) || !deps.fs.statSync(absPath).isFile()) return null;
    return deps.safeJoinLibrary(vc.dir, rel);
  }

function resolveVoicePathForV2(input) {
    const vc = voiceCfg();
    const raw = String(input ?? '').trim();
    if (!raw) throw new Error('缺少音频：给语音库里的文件名（可用 qq_list_voices 查看）');
    if (/^(base64:\/\/|data:|https?:\/\/)/i.test(raw)) {
      throw new Error('语音只接受语音库里的本地文件；不接受 base64://、data: 或 http(s):// 来源');
    }
    const isAbs = deps.path.isAbsolute(raw) || /^file:\/\//i.test(raw) || raw.startsWith('~');

    let resolved = null;
    if (isAbs) {
      const r = deps.resolveAudioSource(raw, {});
      const confined = r.path ? voicePathInsideLibrary(vc, r.path) : null;
      if (confined) {
        resolved = { path: confined, via: `${r.via}+library-confined` };
      } else {
        // 只报目录名，不报绝对路径：这条消息会经 MCP 工具错误回给模型，
        // 而模型面对的是不可信的群聊内容（prompt injection 可能诱导它复述本机路径）。
        throw new Error(`语音只能从语音库取文件（语音库目录：${deps.path.basename(vc.dir)}）；即使是绝对路径也必须位于语音库之内（socialV2.voice.allowAbsolutePath 已不再放宽 AI 通道）。请把音频放进语音库，或用操作者通道（CLI / 控制台）发送库外文件。`);
      }
    } else {
      // ⚠️ 安全关键：相对路径**只能**在语音库内解析。
      //
      // 不能直接丢给 resolveAudioSource —— 它会**先用 process.cwd() 解析相对路径**
      // （voice-core.js 的 cwd 分支），于是 AI 传 `..\..\某个\本机文件.mp3` 就能读库外文件，
      // 把 allowAbsolutePath=false 这个闸门整个绕过去（实测可复现）。
      // 相对路径一律先过 safeJoinLibrary（含 realpath 复核，挡 symlink 逃逸）。
      const joined = deps.safeJoinLibrary(vc.dir, raw);
      if (joined && deps.fs.existsSync(joined) && deps.fs.statSync(joined).isFile()) {
        resolved = { path: joined, via: 'voice-dir-safe' };
      } else {
        // 允许省略扩展名：逐个补常见扩展名再在库内试一次（仍然不越出语音库）
        if (!deps.path.extname(raw)) {
          for (const ext of deps.AUDIO_EXTS) {
            const cand = deps.safeJoinLibrary(vc.dir, `${raw}${ext}`);
            if (cand && deps.fs.existsSync(cand) && deps.fs.statSync(cand).isFile()) {
              resolved = { path: cand, via: 'voice-dir-safe+ext' };
              break;
            }
          }
        }
        if (!resolved) {
          // 库内没找到：检查是不是"想读库外文件"（这条错误要说清楚，避免误以为是名字写错）
          const looksLikeEscape = /(^|[\\/])\.\.([\\/]|$)/.test(raw) || deps.path.isAbsolute(raw);
          if (looksLikeEscape) {
            throw new Error('语音只能从语音库取文件：路径里出现了「..」或绝对路径，已拒绝（防止读到库外的本机文件）');
          }
        }
      }
    }

    if (resolved) return { path: resolved.path, via: resolved.via, resolvedFrom: raw };

    // 模糊提示：只列库内文件（绝不回显库外路径）
    const library = voiceLibrary();
    const hint = library.length
      ? `语音库里现有：${library.slice(0, 12).map((x) => x.name).join('、')}${library.length > 12 ? ` 等 ${library.length} 个` : ''}`
      : `语音库（${deps.path.basename(vc.dir)}）目前是空的，先把音频文件放进去`;
    // 按 basename 去扩展名做近似匹配（只用于提示）
    const want = deps.path.basename(raw).toLowerCase();
    const wantNoExt = want.replace(/\.[^.]+$/, '');
    const fuzzyHits = library
      .filter((x) => {
        const base = deps.path.basename(x.name).toLowerCase();
        return base === want || base.replace(/\.[^.]+$/, '') === wantNoExt;
      })
      .map((x) => x.name);
    const fuzzy = fuzzyHits.length ? `；近似匹配：${fuzzyHits.join('、')}` : '';
    throw new Error(`语音库里找不到「${raw}」${fuzzy}。${hint}`);
  }

/**
   * 操作者通道（CLI）的路径解析：允许绝对路径（操作者本来就能读本机文件），
   * 相对路径先按「语音库」解析，再按当前工作目录解析 —— 这样两种直觉写法都成立。
   * base64/http 来源仍然禁止：语音应来自本地文件，别让 CLI 变成任意 URL 的外发口子。
   */
  function resolveVoicePathForOperator(input) {
    const vc = voiceCfg();
    const raw = String(input ?? '').trim();
    if (!raw) throw new Error('缺少音频路径');
    if (/^(base64:\/\/|data:|https?:\/\/)/i.test(raw)) {
      throw new Error('语音只接受本地文件；不接受 base64://、data: 或 http(s):// 来源');
    }
    const r = deps.resolveAudioSource(raw, { voiceDir: vc.dir });
    if (r.path) return { path: r.path, via: r.via, resolvedFrom: raw };
    const fuzzy = r.candidates?.length ? `；语音库近似匹配：${r.candidates.map((c) => deps.path.basename(c.path)).join('、')}` : '';
    throw new Error(`找不到音频「${raw}」${fuzzy}`);
  }

/**
   * 语音发送限流：与文本发送分开计数，避免语音吃掉聊天额度（也避免聊天把语音额度耗光）。
   *
   * 只**检查**不占额度：额度在真正发出去之后才由 voiceBudgetCommit 记账 ——
   * 这样参数错、被审计拦截、网关失败都不会白白吃掉配额（否则连失败几次就被假 429 卡住）。
   */
  function voiceBudgetCheck(scopeKey, cfgV) {
    const now = Date.now();
    const bucket = deps.voiceSendTimes.get(scopeKey) ?? [];
    const inMinute = bucket.filter((t) => now - t < 60000);
    const inHour = bucket.filter((t) => now - t < 3600000);
    if (cfgV.maxPerMinute > 0 && inMinute.length + 1 > cfgV.maxPerMinute) {
      throw new Error(`语音发送频率超限（每分钟最多 ${cfgV.maxPerMinute} 条），请稍后再试`);
    }
    if (cfgV.maxPerHour > 0 && inHour.length + 1 > cfgV.maxPerHour) {
      throw new Error(`语音发送频率超限（每小时最多 ${cfgV.maxPerHour} 条），请稍后再试`);
    }
  }

/** 语音真正发出后记账（顺带裁掉超过 1 小时的旧时间戳，避免数组无界增长）。 */
  function voiceBudgetCommit(scopeKey, at = Date.now()) {
    const bucket = (deps.voiceSendTimes.get(scopeKey) ?? []).filter((t) => at - t < 3600000);
    bucket.push(at);
    deps.voiceSendTimes.set(scopeKey, bucket);
  }

/**
   * 底层发送：把音频作为 record 段交给 SnowLuma。
   * guard=true（agent 通道）时，发送前必须通过 captureSendGuard —— 会话/模式/白名单任一变
   * 就放弃发送；guard=false（操作者通道）时不套会话闸门（操作者可能不在任何会话里）。
   *
   * audio 可传音量设置 { volume, normalize, loudness }：SnowLuma 的 record 段没有增益字段，
   * 所以音量必须在本地用 ffmpeg 调好再发（临时文件发完即删）。
   */
  async function sendVoiceV2(key, filePath, { guard = false, audit = true, audio = null } = {}) {
    const vc = voiceCfg();
    // 注意：这里**不检查** vc.enabled —— 那是「AI 能不能发语音」的开关，判定放在
    // AI 路由（/api/socialV2/send-voice）与 sendVoiceForV2 里。底层只管发，
    // 否则"默认不启用"会连操作者通道（CLI / 控制台面板 / 图形界面）一起封死。
    if (audit) deps.assertOutboundAuditOk(key, `[语音:${deps.path.basename(filePath)}]`);
    let info;
    try {
      info = await deps.inspectAudio(filePath, { maxBytes: vc.maxBytes, maxSeconds: vc.maxSeconds });
    } catch (error) {
      throw new Error(`音频检查失败：${error?.message ?? error}`);
    }
    if (!info.ok) throw new Error(`音频不可发送：${info.error}`);

    // 音量处理（默认原样 → 不产生临时文件）
    let processed;
    try {
      processed = await deps.processAudioVolume(filePath, {
        volume: audio?.volume ?? vc.defaultVolume,
        normalize: audio?.normalize === true,
        loudness: audio?.loudness ?? vc.loudness,
        ffmpegPath: vc.ffmpegPath
      });
    } catch (error) {
      throw new Error(`音量处理失败：${error?.message ?? error}`);
    }
    const sendPath = processed.path;

    const assertSendAllowed = guard ? deps.captureSendGuard(key) : null;
    const [kind, id] = key.split(':');
    const recordSegment = { type: 'record', data: { file: sendPath } };
    let resolveSend;
    let rejectSend;
    const sendPromise = new Promise((resolve, reject) => { resolveSend = resolve; rejectSend = reject; });
    deps.sendChain = deps.sendChain.then(async () => {
      try {
        if (assertSendAllowed) assertSendAllowed();
        // 语音条比图片大、要过一次 SILK 转码，给 60s 预算（文本/图片共用同一 sendChain，
        // 所以这条语音发完之前后面的文本会自然排队，不会插队到语音前面）。
        const httpUrl = String(deps.cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
        const action = kind === 'private' ? 'send_private_msg' : 'send_group_msg';
        const params = kind === 'private'
          ? { user_id: Number(id), message: [recordSegment] }
          : { group_id: Number(id), message: [recordSegment] };
        const res = await deps.fetch(`${httpUrl}/${action}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(deps.cfg.snowluma?.accessToken ? { authorization: `Bearer ${deps.cfg.snowluma.accessToken}` } : {})
          },
          body: JSON.stringify(params),
          signal: deps.AbortSignal.timeout(60000)
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.status !== 'ok' || body.retcode !== 0) {
          const hint = res.status === 426 ? '（HTTP 426：snowluma.httpUrl 可能指向了 WebSocket 端口）' : '';
          throw new Error(`OneBot ${action} 失败: ${body.wording || body.retcode || res.status}${hint}`);
        }
        resolveSend(body.data);
      } catch (error) {
        rejectSend(error);
      }
    });
    try {
      const data = await sendPromise;
      return {
        messageId: data?.message_id ?? null,
        bytes: info.size,
        duration: info.duration ?? null,
        codec: info.codec ?? '',
        warnings: info.warnings ?? [],
        detail: deps.describeAudio(info),
        // 音量处理信息：mode='original' 表示没动过（没产生临时文件）
        audioProcessing: processed.detail,
        volume: processed.volume,
        loudness: processed.loudness,
        audioMode: processed.mode
      };
    } finally {
      // 音量处理产物是一次性的：发完（或失败）就删，别把 temp 撑大
      deps.cleanupTemp(sendPath, processed.converted);
    }
  }

/** 把「我发了条语音」写进二代会话的 recentMessages，让 AI 自己知道刚发过什么。 */
  function recordVoiceSentV2(key, sent, label) {
    const st = deps.getSocialV2State(key);
    const display = label || `[语音 ${sent.detail}]`;
    const entry = {
      messageId: sent.messageId ? String(sent.messageId) : null,
      sender: '我',
      text: deps.truncateText(display, 200),
      plain: deps.truncateText(display, 200),
      quoteTargetIsSelf: false,
      isOwner: true,
      ownerLabel: '我',
      isSelf: true,
      at: Date.now()
    };
    st.recentMessages.push(entry);
    if (st.recentMessages.length > 200) st.recentMessages = st.recentMessages.slice(-200);
    st.lastAiReplyAt = entry.at;
    st.lastActionAt = entry.at;
    st.wakeConfig.noActionCount = 0;
    deps.saveSocialV2State();
  }

/**
   * 发完语音后的**落地验证**：把这条消息从网关读回来，确认它真的带着 record 段。
   *
   * 为什么不用 fetch_ptt_text 做这件事：那个动作依赖 QQ 侧的语音转写结果，
   * 而**自己发出去的**语音根本不会产生转写（实测 retcode=100「消息中不包含语音」）。
   * 想让 AI 确认「语音真的发出去了」，唯一可靠的证据是 get_msg 回读到的 record 段。
   * 返回 { confirmed, file, duration } 或 null（读不回来不影响"已发送"这个事实）。
   */
  async function verifyVoiceMessageSent(messageId) {
    if (!messageId) return null;
    try {
      const httpUrl = String(deps.cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
      const res = await deps.fetch(`${httpUrl}/get_msg`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(deps.cfg.snowluma?.accessToken ? { authorization: `Bearer ${deps.cfg.snowluma.accessToken}` } : {})
        },
        body: JSON.stringify({ message_id: Number(messageId) }),
        signal: deps.AbortSignal.timeout(30000)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status !== 'ok' || body.retcode !== 0) return null;
      const segments = Array.isArray(body.data?.message) ? body.data.message : [];
      const record = segments.find((s) => s?.type === 'record');
      if (!record) return null;
      // 注意：只回报「确认成功 + 时长」，**不回传 file/url**。
      // 私聊消息里 get_msg 会把源文件路径塞进 url（如 库外的本地音频路径），
      // 回给 AI 就等于把本机路径写进模型上下文（也会被敏感信息审计拦）。
      return {
        confirmed: true,
        duration: record.data?.duration != null ? Number(record.data.duration) : null
      };
    } catch (error) {
      deps.log(`[voice] 发送后回读校验失败（不影响已发送）：${error?.message ?? error}`);
      return null;
    }
  }

/**
   * AI 通道入口：解析引用 → 限流 → 发送 → 记账 → 回读校验。
   * 返回 { messageId, detail, verified, readback }。
   */
  async function sendVoiceForV2(key, voiceRef, { label = '', verify = null, readback = false, audio = null } = {}) {
    const vc = voiceCfg();
    if (!vc.enabled) throw new Error('语音功能已关闭（socialV2.voice.enabled=false）');
    const resolved = resolveVoicePathForV2(voiceRef);
    // 音量参数校验前置（AI 传错时给出可读错误，而不是让 ffmpeg 报奇怪的错）
    if (audio) deps.resolveAudioProcessing({ volume: audio.volume ?? vc.defaultVolume, normalize: audio.normalize === true, loudness: audio.loudness ?? vc.loudness });
    voiceBudgetCheck(key, vc);
    const sent = await sendVoiceV2(key, resolved.path, { guard: true, audit: true, audio });
    voiceBudgetCommit(key);
    recordVoiceSentV2(key, sent, label);
    deps.log(`[voice] ${key} 已发送语音 ${deps.path.basename(resolved.path)} (${sent.detail}, messageId=${sent.messageId ?? '?'})`);
    deps.appendActivity(`${key} [voice] 发送语音 ${deps.path.basename(resolved.path)} (${sent.detail})`);
    let readbackText = null;
    const wantReadback = readback === true;
    if (wantReadback && sent.messageId) {
      try {
        const httpUrl = String(deps.cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
        const res = await deps.fetch(`${httpUrl}/fetch_ptt_text`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(deps.cfg.snowluma?.accessToken ? { authorization: `Bearer ${deps.cfg.snowluma.accessToken}` } : {})
          },
          body: JSON.stringify({ message_id: String(sent.messageId) }),
          signal: deps.AbortSignal.timeout(30000)
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.status === 'ok' && body.retcode === 0) readbackText = body.data?.text ?? '';
      } catch (error) {
        deps.log(`[voice] 语音转写回读失败（不影响已发送）：${error?.message ?? error}`);
      }
    }
    // 默认做「回读到 record 段」的落地校验；转写按需（自己发的语音通常没有转写）。
    const wantVerify = verify === true || (verify !== false && vc.autoReadback);
    const verification = wantVerify ? await verifyVoiceMessageSent(sent.messageId) : null;
    return { ...sent, key, file: resolved.path, via: resolved.via, verification, readback: readbackText };
  }

async function runServiceVoicePrompt(prompt,key,owner){
    const invocationId=deps.crypto.randomUUID(),startedAt=Date.now();let id,controller,deadline,openedDeadline;
    const trace=(status,error)=>deps.fs.appendFileSync(deps.path.join(deps.STATE_DIR,'invocation-attempts.jsonl'),JSON.stringify({id:invocationId,at:Date.now(),purpose:'bridge_reply',scope:key,status,elapsedMs:Date.now()-startedAt,provider:deps.cfg.dsh.provider,model:deps.cfg.dsh.model,effort:deps.cfg.dsh.reasoningEffort||'high',error:error?deps.scrubPrivate(error).slice(0,200):null})+'\n',{mode:0o600});
    try{
      const preset=deps.resolvePresetName(owner?'jingjing-owner-chat':'jingjing-memo',{strict:true});if(!preset)throw Error('No tool-free conversation preset');
      const dir=deps.path.join(deps.STATE_DIR,'service-voice');deps.fs.mkdirSync(dir,{recursive:true});const ws=deps.unwrap(await deps.api.workspace.create({path:dir}),'service voice workspace');
      id=deps.unwrap(await deps.api.sessions.create({workspaceId:ws.workspace.workspaceId,agentPreset:preset}),'service voice session').sessionId;
      await deps.pinInternalTitle(id,'鲸鲸操作回复');await deps.ensureChatModel(id);
      // This reader is independent: a notice may itself originate inside the main SSE reader.
      // Waiting on that same reader would deadlock the reply until its timeout.
      controller=new AbortController();let opened;const ready=new Promise((resolve,reject)=>{opened=()=>{deps.clearTimeout(openedDeadline);resolve();};openedDeadline=deps.setTimeout(()=>reject(Error('Service voice stream unavailable')),5000);});
      const stream=deps.api.events.mux({},controller.signal,opened);stream.follow(id);let done,fail;const result=new Promise((resolve,reject)=>{done=resolve;fail=reject;deadline=deps.setTimeout(()=>reject(Error('Service voice reply deadline')),15000);});result.catch(()=>{});
      const consume=(async()=>{let collector=deps.createTurnCollector();for await(const envelope of stream){const frame=envelope.payload;if(frame.type!=='session/event'||frame.sessionId!==id)continue;const event=frame.event;if(event.type==='turn/start')collector=deps.createTurnCollector();if(event.type==='tool/call')throw Error('Service voice tried a tool');const ended=collector.push(event);if(ended){if(ended.reason.kind!=='completed')throw Error('Service voice did not complete');done(ended.text);return;}}if(!controller.signal.aborted)fail(Error('Service voice stream ended'));})().catch(fail);
      await ready;trace('started');deps.unwrap(await deps.api.sessions.prompt({sessionId:id,mode:'queue',content:[{type:'text',text:prompt}]}),'service voice prompt');const text=await result;trace('completed');return text;
    }catch(e){trace('blocked',e.message);throw e;}
    finally{deps.clearTimeout(deadline);deps.clearTimeout(openedDeadline);controller?.abort();if(id){try{await deps.api.stopSessionWork(id);}catch{}try{await deps.api.workspace.archiveSession({sessionId:id});}catch{}}}
  }

async function sayBridge(key,text,options={}){
    const guard=deps.captureSendGuard(key),facts=deps.serviceFacts(deps.scrubPrivate(String(text)),options.facts||{});
    const history=deps.isOwnerKey(key)?deps.ownerChat:deps.loadGuestChat(key);let output;
    try{
      if(options.nativeVoice===true)throw Error('Use verified conversational text');
      // A model outage or DSH restart must not recursively call that failed model for an explanation.
      if(!deps.dshReady||/模型连续出错|模型出错|agent 处理出错|消息未被接受|服务重启中/.test(facts.text))throw Error('Conversational service unavailable');
      const owner=deps.isOwnerKey(key),persona=deps.readConversationPersona(owner?(deps.closedAgentPreset||'dafeiyu'):'jingjing-guest');
      output=await deps.composeServiceReply({facts,persona,owner,now:deps.beijingTime(Date.now()),recent:history.slice(-8).map(({dir,text})=>({dir,text})),last:deps.serviceVoiceLast.get(key)||''},prompt=>runServiceVoicePrompt(prompt,key,owner));
    }catch(e){deps.log('操作回复表达未完成，不重试：'+deps.scrubPrivate(e.message));output=deps.fallbackServiceVoice(facts);}
    guard();options.capabilityGuard?.();
    const receipt=await deps.sendToQQ(key,output,options);
    if(receipt?.ok){deps.serviceVoiceLast.set(key,output);const entry=deps.isOwnerKey(key)?deps.noteOwnerChat('out',output):deps.noteGuestChat(key,{dir:'out',text:output});deps.serviceVoiceAliases.set(key+'\0'+String(text).trim(),{entry,at:Date.now()});}
    return {...receipt,text:output};
  }
return {voiceCfg,voiceLibrary,voicePathInsideLibrary,resolveVoicePathForV2,resolveVoicePathForOperator,voiceBudgetCheck,voiceBudgetCommit,sendVoiceV2,recordVoiceSentV2,verifyVoiceMessageSent,sendVoiceForV2,runServiceVoicePrompt,sayBridge};
}
