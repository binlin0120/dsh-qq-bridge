// roster: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["QQ_REQUESTS_FILE","ROOT","ROSTER_HELP","assertAccessConfig","atomicWriteJson","capabilityKeys","caps","cfg","fs","log","normalizeIdList","noteGuestDigest","path","qqRequests","readConfigObject","reconcileSessionPolicies","sayBridge","sendToQQ","work"];
export function createRoster(deps){
// ── 四类名单读写（写 config.json + 热更新 + 让失效会话退役） ───────────────
  function rosterSnapshot() {
    return {
      owner: deps.cfg.ownerQQ ?? null,
      admins: (deps.cfg.admins ?? []).map(String),
      users: (deps.cfg.allow?.private ?? []).map(String).filter((x) => x !== String(deps.cfg.ownerQQ ?? '')),
      groups: (deps.cfg.allow?.groups ?? []).map(String)
    };
  }

/** op: add|remove；list: admins|users|groups；返回 { ok, changed, error, roster } */
  function rosterUpdate(op, list, rawId) {
    const id = String(rawId ?? '').trim();
    if (!/^\d{5,12}$/.test(id)) return { ok: false, error: `号码不对：${rawId}` };
    if (!['add', 'remove'].includes(op)) return { ok: false, error: `op 只能是 add/remove` };
    if (!['admins', 'users', 'groups'].includes(list)) return { ok: false, error: `list 只能是 admins/users/groups` };
    if (list !== 'groups' && id === String(deps.cfg.ownerQQ ?? '')) return { ok: false, error: '机主自己不用加，也删不掉' };
    if(op==='add' && list!=='groups' && deps.cfg.deny.private.map(String).includes(id))return {ok:false,error:'该账号在黑名单，先由owner明确解除再加'};
    const configFile = deps.path.join(deps.ROOT, 'config.json');
    const file = deps.readConfigObject(configFile);deps.assertAccessConfig(file);
    file.allow = file.allow ?? { private: [], groups: [] };
    file.allow.private = Array.isArray(file.allow.private) ? file.allow.private : [];
    file.allow.groups = Array.isArray(file.allow.groups) ? file.allow.groups : [];
    file.admins = Array.isArray(file.admins) ? file.admins : [];
    const target = list === 'admins' ? file.admins : list === 'users' ? file.allow.private : file.allow.groups;
    const has = target.map(String).includes(id);
    let changed = false;
    if (op === 'add' && !has) { target.push(Number(id)); changed = true; }
    if (op === 'remove' && has) {
      const next = target.filter((x) => String(x) !== id);
      if (list === 'admins') file.admins = next; else if (list === 'users') file.allow.private = next; else file.allow.groups = next;
      changed = true;
    }
    if(op==='remove' && list==='admins' && has && !file.allow.private.map(String).includes(id)){file.allow.private.push(Number(id));changed=true;}
    if (changed) {
      deps.atomicWriteJson(configFile, file);
      deps.cfg.admins = deps.normalizeIdList(file.admins);
      deps.cfg.allow = { private: deps.normalizeIdList(file.allow.private), groups: deps.normalizeIdList(file.allow.groups) };
      deps.caps.reconcile(deps.capabilityKeys());void deps.work.reconcile();
      deps.reconcileSessionPolicies();
      deps.log(`名单已更新：${op} ${list} ${id}（管理员 ${deps.cfg.admins.join(',') || '无'}；聊天用户 ${deps.cfg.allow.private.join(',') || '无'}；群 ${deps.cfg.allow.groups.join(',') || '无'}）`);
    }
    return { ok: true, changed, roster: rosterSnapshot() };
  }

async function handleRosterCommand(key, text, { isOwner }) {
    const t = String(text ?? '').trim();
    if (t === '/名单') {
      const r = rosterSnapshot();
      await deps.sendToQQ(key, `管理员：${r.admins.join('、') || '无'}\n聊天用户：${r.users.join('、') || '无'}\n群聊：${r.groups.join('、') || '无'}`);
      return true;
    }
    if (t === '/帮助' || t === '/指令') {
      await deps.sendToQQ(key, isOwner ? deps.ROSTER_HELP + '\n/加管理 QQ号\n/删管理 QQ号' : deps.ROSTER_HELP);
      return true;
    }
    const m = /^\/(加|删)(用户|群|管理)\s*(\d+)\s*$/.exec(t);
    if (!m) return false;
    const op = m[1] === '加' ? 'add' : 'remove';
    const list = m[2] === '用户' ? 'users' : m[2] === '群' ? 'groups' : 'admins';
    if (list === 'admins' && !isOwner) {
      await deps.sayBridge(key, '加减管理员只有机主能弄');
      return true;
    }
    let r;
    try { r = rosterUpdate(op, list, m[3]); } catch (error) { r = { ok: false, error: error?.message ?? String(error) }; }
    if (!r.ok) { await deps.sayBridge(key, `没改成：${r.error}`); return true; }
    // 改完回读确认，再告诉对方结果
    const after = rosterSnapshot()[list].includes(String(m[3]));
    const okNow = op === 'add' ? after : !after;
    const label = list === 'users' ? '聊天用户' : list === 'groups' ? '群聊白名单' : '管理员';
    await deps.sayBridge(key, okNow
      ? `${r.changed ? '好了' : '本来就是这样'}：${m[3]} ${op === 'add' ? '在' : '不在'}${label}里了`
      : `改了但回读没对上 你让机主看一眼`);
    if (!isOwner) deps.noteGuestDigest({ dir: 'event', text: `管理员 ${key.split(':')[1]} 用指令${m[1]}了${label} ${m[3]}` });
    return true;
  }

function saveQqRequests() {
    try { deps.fs.writeFileSync(deps.QQ_REQUESTS_FILE, JSON.stringify(deps.qqRequests, null, 1)); } catch (error) { deps.log(`保存 qq-requests 失败: ${error?.message ?? error}`); }
  }
return {rosterSnapshot,rosterUpdate,handleRosterCommand,saveQqRequests};
}
