// health-checks: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["STATE_DIR","api","cfg","clearTimeout","currentMode","dshPresetIds","dshReady","ensureChatModel","execFileSync","fs","guestCheckFailed","guestSelfCheckTimer","internalPurposes","learnerSessions","log","noteGuestDigest","options","os","path","pinInternalTitle","reconcileSessionPolicies","setTimeout","unwrap","waitLearnerTurn"];
export function createHealthChecks(deps){
// ── 访客安全自检：DSH 就绪后开一个访客会话，看它的工具和提示词 ─────────────
  function readSessionLogLines(sessionId) {
    const root = deps.path.join(deps.os.homedir(), '.dsh', 'sessions');
    let dirs = [];
    try { dirs = deps.fs.readdirSync(root); } catch { return null; }
    for (const d of dirs) {
      const f = deps.path.join(root, d, sessionId, 'session.v4.jsonl.zstd');
      if (!deps.fs.existsSync(f)) continue;
      // 日志是多段 zstd 帧拼接的，zlib.zstdDecompressSync 只解第一段；用系统 zstd 命令完整解
      const raw = deps.execFileSync('zstd', ['-dc', f], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
      return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }
    return null;
  }

function scheduleGuestSelfCheck(delayMs = 90000) {
    if (deps.guestSelfCheckTimer) deps.clearTimeout(deps.guestSelfCheckTimer);
    deps.guestSelfCheckTimer = deps.setTimeout(() => { deps.guestSelfCheckTimer = null; runGuestSelfCheck().catch((error) => deps.log(`访客自检异常：${error?.message ?? error}`)); }, delayMs);
    deps.guestSelfCheckTimer.unref?.();
  }

async function runGuestSelfCheck() {
    if (!deps.dshReady || deps.currentMode !== 'closed-agent') return;
    const presetName = deps.cfg.guest?.preset || 'jingjing-guest';
    if (!deps.dshPresetIds.includes(presetName)) { deps.log(`访客自检：预设 ${presetName} 不在 DSH 清单里（访客会话本来就建不出来）`); return; }
    const dir = deps.path.join(deps.STATE_DIR, 'guest-selfcheck');
    deps.fs.mkdirSync(dir, { recursive: true });
    let sessionId = null;
    try {
      const ws = deps.unwrap(await deps.api.workspace.create({ path: dir }), 'selfcheck workspace.create');
      sessionId = deps.unwrap(await deps.api.sessions.create({ workspaceId: ws.workspace.workspaceId, agentPreset: presetName }), 'selfcheck session.create').sessionId;
      await deps.pinInternalTitle(sessionId,'访客权限自检');
      deps.internalPurposes.set(sessionId,'guest_selfcheck');
      deps.learnerSessions.add(sessionId);
      deps.api.events.follow(sessionId);
      await deps.ensureChatModel(sessionId);
      const accepted = await deps.api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: '【私聊】自检（QQ 10000）：在吗' }] });
      if (!accepted.result.ok){deps.options.onRejected?.();throw new Error(`prompt 被拒：${accepted.result.error.code}`);}
      try { await deps.waitLearnerTurn(sessionId, 120000); } catch {}
      // DSH 写会话日志有延迟：最多等 40 秒，直到日志里出现工具清单
      let lines = null;
      let header = null;
      for (let i = 0; i < 20 && !header; i++) {
        await new Promise((r) => deps.setTimeout(r, 2000));
        try { lines = readSessionLogLines(sessionId); } catch { lines = null; }
        header = lines ? [...lines].reverse().find((x) => x.type === 'request/header' && Array.isArray(x.data?.header?.tools)) : null;
      }
      if (!lines) { deps.log('⚠️ 访客自检：读不到会话日志，没法确认工具面（执行期白名单仍在）'); return; }
      const sys = lines.find((x) => x.type === 'system/message');
      const sysText = String(sys?.data?.message?.content?.[0]?.text ?? '');
      if (!header) { deps.log('⚠️ 访客自检：日志里没有工具清单，没法确认工具面（执行期白名单仍在）'); return; }
      const names = header.data.header.tools.map((t) => String(t.name));
      const bad = names.filter((n) => !n.startsWith('mcp__web-search-safe__'));
      if (bad.length > 0) {
        const was = deps.guestCheckFailed;
        deps.guestCheckFailed = true;
        deps.reconcileSessionPolicies();
        deps.log(`⛔ 访客自检没通过：访客会话里出现了不该有的工具 ${bad.join(', ')}；已暂停所有访客会话（机主私聊不受影响）`);
        if (!was) deps.noteGuestDigest({ dir: 'event', text: `访客安全自检没通过：别人那边的会话里出现了工具 ${bad.slice(0, 5).join('、')}，桥接已经先把别人的会话停了，要让机主看一下` });
        return;
      }
      if (deps.guestCheckFailed) { deps.guestCheckFailed = false; deps.reconcileSessionPolicies(); }
      const noisy = ['DeepSeek Harness Web GUI', 'MCP resource servers', 'Prefer showing the primary results'].filter((k) => sysText.includes(k));
      deps.log(`访客自检通过：工具 [${names.join(', ') || '无'}]，提示词 ${sysText.length} 字${noisy.length ? `；⚠️ 提示词里还有 DSH 自带段落：${noisy.join(' / ')}` : ''}`);
    } finally {
      if (sessionId) {
        deps.learnerSessions.delete(sessionId);
        deps.internalPurposes.delete(sessionId);
        try { await deps.api.workspace.archiveSession({ sessionId }); } catch {}
      }
    }
  }
return {readSessionLogLines,scheduleGuestSelfCheck,runGuestSelfCheck};
}
