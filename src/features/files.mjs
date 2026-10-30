// files: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["OUTBOX_ROOTS","TEMP_OUT_DIR","WORKSPACE_ROOT","cfg","fs","path","rosterRoleOf"];
export function createFiles(deps){
function safeFileName(name) {
    const base = deps.path.basename(String(name || 'file')).replace(/[\u0000-\u001f\/\\:*?"<>|]/g, '_').slice(0, 120);
    return base || 'file';
  }

/** 发出去的文件只能在 工作目录 或 临时导出目录 下；发给别人时不能是记忆和手册 */
  function resolveOutboxPath(p, { forOwner }) {
    const real = deps.fs.realpathSync(deps.path.resolve(String(p)));
    if (!deps.OUTBOX_ROOTS.some((r) => real===r || real.startsWith(r+deps.path.sep))) throw new Error('只能发送已配置工作目录或导出临时目录中的文件');
    if (!forOwner && !real.startsWith(deps.path.join(deps.WORKSPACE_ROOT,'对外导出')+deps.path.sep) && !real.startsWith(deps.TEMP_OUT_DIR+deps.path.sep)) throw new Error('给别人发文件前请放到工作目录的对外导出子目录，记忆和私人工作区不能直接外发');
    const st = deps.fs.statSync(real);
    if (!st.isFile()) throw new Error('不是文件');
    return { real, size: st.size };
  }

function outTarget(raw) {
    const t = String(raw ?? '').trim() || `private:${String(deps.cfg.ownerQQ ?? '')}`;
    const m = /^(private|group):(\d{5,12})$/.exec(t);
    if (!m) throw new Error('target 要写成 private:QQ号 或 group:群号');
    const role = deps.rosterRoleOf(m[1], m[2], deps.cfg);
    if (!role) throw new Error(`${t} 不在名单里`);
    return { key: t, kind: m[1], id: m[2], forOwner: role === 'owner' };
  }
return {safeFileName,resolveOutboxPath,outTarget};
}
