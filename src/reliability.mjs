import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function readState(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export function writeState(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
export const modelId = x => `${x?.provider || ''}/${x?.model || ''}`;
export class ModelGuard {
  constructor(file, current, legacy) {
    this.file = file;
    current = {provider:current.provider,model:current.model};
    if(legacy) legacy = {provider:legacy.provider,model:legacy.model};
    this.state = readState(file, { version: 1, current, previous: legacy && modelId(legacy) !== modelId(current) ? legacy : null, streak: 0 });
    if(this.state.current) this.state.current = {provider:this.state.current.provider,model:this.state.current.model};
    if(this.state.previous) this.state.previous = {provider:this.state.previous.provider,model:this.state.previous.model};
    if (modelId(this.state.current) !== modelId(current)) {
      this.state.previous = this.state.current || this.state.previous;
      this.state.current = current;
      this.state.streak = 0;
    }
    this.save();
  }
  save() { writeState(this.file, this.state); }
  switched(next) {
    if (modelId(next) !== modelId(this.state.current)) this.state.previous = this.state.current;
    this.state.current = { provider: next.provider, model: next.model };
    this.state.streak = 0; this.state.epoch = crypto.randomUUID(); this.save();
  }
  healthy(actual) { if (modelId(actual) === modelId(this.state.current)) { this.state.streak = 0; this.save(); } }
  fallbackAllowed(candidate) {
    if (!candidate?.provider) return false;
    // Re-read policy so an operator's quarantine also applies to an existing guard.
    try {
      const policy = readState(path.join(path.dirname(this.file), 'model-route-policy.json'), {});
      return !(policy.quarantinedProviders || []).includes(candidate.provider) &&
        (!Array.isArray(policy.fallbackAllowlist) || policy.fallbackAllowlist.includes(candidate.provider));
    } catch { return false; }
  }
  failed(actual) {
    if (modelId(actual) !== modelId(this.state.current)) return null;
    this.state.streak++; this.save();
    return this.state.streak >= 3 && this.fallbackAllowed(this.state.previous) && modelId(this.state.previous) !== modelId(actual) ? this.state.previous : null;
  }
  reverted(next) {
    this.state.current = { provider: next.provider, model: next.model };
    this.state.previous = null; this.state.streak = 0; this.save();
  }
}
export function approvalDecision(text) {
  const s = String(text).trim().replace(/[，。！!？?\s]/g, '');
  if (/^(?:不同意|拒绝|别加|不要加|不加|别进|不进)(?:他|她|它|这个好友|这个群|好友|群)?$/.test(s)) return false;
  if (/^(?:同意|同意加|同意加入|同意进|可以加|加吧|进吧)(?:他|她|它|这个好友|这个群|好友|群)?$/.test(s)) return true;
  return null;
}
export function chooseApproval(requests, text, now = Date.now()) {
  const decision = approvalDecision(text);
  if (decision === null) return null;
  const candidates = requests.filter(x => !x.handling && now - x.at < 7 * 86400000 && !x.decision);
  const focused = candidates.filter(x => x.notifiedAt).sort((a,b) => b.notifiedAt - a.notifiedAt);
  const item = focused[0] || (candidates.length === 1 ? candidates[0] : null);
  return item ? { flag: item.flag, approve: decision, at: now } : null;
}
export const shDate = t => new Date(t + 8 * 3600000).toISOString().slice(0, 10);
export function quietAt(t, { from = 23, to = 8 } = {}) {
  const h = new Date(t + 8 * 3600000).getUTCHours();
  return from > to ? h >= from || h < to : h >= from && h < to;
}
export class DailyQuota {
  constructor(file, clock = Date.now) { this.file = file; this.clock = clock; this.data = readState(file, {}); }
  count(kind) { return Number(this.data[`${shDate(this.clock())}:${kind}`] || 0); }
  take(kind, limit = Infinity) {
    if (this.count(kind) >= limit) throw new Error('今天的额度已经用完');
    const day = shDate(this.clock());
    this.data = Object.fromEntries(Object.entries(this.data).filter(([k]) => k.startsWith(day + ':')));
    this.data[`${day}:${kind}`] = this.count(kind) + 1; writeState(this.file, this.data);
  }
}
export function scrubPrivate(text) {
  return String(text).replace(/\b\d{17}[\dXx]\b/g, '[身份证已删除]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号已删除]')
    .replace(/\b(?:sk|rk|ak)-[A-Za-z0-9_-]{12,}/g, '[密钥已删除]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [已删除]');
}
export class ChatArchive {
  constructor(dir) { this.dir = dir; this.ids=new Map();fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  append(key, entry) {
    if (!/^(private|group):\d+$/.test(key)) throw new Error('invalid archive key');
    const e = { ...entry, id: entry.id || crypto.randomUUID(), text: scrubPrivate(entry.text), key };
    const dir = path.join(this.dir, key.replace(':', '_')); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file=path.join(dir,shDate(e.at)+'.jsonl');let ids=this.ids.get(file);
    if(!ids){ids=new Set();if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){try{ids.add(JSON.parse(line).id);}catch{}}this.ids.set(file,ids);}
    if(ids.has(e.id))return e;
    fs.appendFileSync(file, JSON.stringify(e) + '\n', { mode: 0o600 });ids.add(e.id);
    return e;
  }
  query(key, { from = 0, to = Infinity, query = '', limit = 50000 } = {}) {
    if (!/^(private|group):\d+$/.test(key)) throw new Error('invalid archive key');
    const dir = path.join(this.dir, key.replace(':', '_')); const result = [];
    if (!fs.existsSync(dir)) return result;
    for (const name of fs.readdirSync(dir).filter(x => /^\d{4}-\d\d-\d\d\.jsonl$/.test(x)).sort()) {
      const day = Date.parse(name.slice(0,10) + 'T00:00:00+08:00');
      if (day >= to || day + 86400000 <= from) continue;
      for (const line of fs.readFileSync(path.join(dir,name), 'utf8').split('\n').filter(Boolean)) {
        const e = JSON.parse(line);
        if (e.at >= from && e.at < to && String(e.text).includes(query)) result.push(e);
        if (result.length > limit) throw new Error('历史结果过多，请缩短时间范围');
      }
    }
    return result;
  }
  seed(key, list) {
    const existing = new Set(this.query(key).map(x => `${x.at}|${x.dir}|${x.text}`));
    for (const e of list) { const fp = `${e.at}|${e.dir}|${scrubPrivate(e.text)}`; if (!existing.has(fp)) { this.append(key, e); existing.add(fp); } }
  }
}
export function chunkRecords(records, max = 8000) {
  const out = []; let batch = [], size = 0;
  for (const row of records) {
    const n = JSON.stringify(row).length;
    if (batch.length && size + n > max) { out.push(batch); batch = []; size = 0; }
    batch.push(row); size += n;
  }
  if (batch.length) out.push(batch); return out;
}
export function parseMemoObject(raw) {
  const text=String(raw);let start=-1,depth=0,quoted=false,escaped=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(start<0) {if(c!=='{')continue;start=i;depth=1;continue;}
    if(quoted) {if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}' && --depth===0) {
      try{return JSON.parse(text.slice(start,i+1));}catch{throw new Error('记忆输出不是合法JSON，未推进整理进度');}
    }
  }
  throw new Error('记忆输出缺少完整JSON对象，未推进整理进度');
}
export async function fetchLimited(url, { maxBytes = 20 * 1024 * 1024, timeoutMs = 120000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`下载失败 HTTP ${res.status}`); }
  const n = Number(res.headers.get('content-length'));
  if (n > maxBytes) { await res.body?.cancel(); throw new Error('文件超过大小上限'); }
  const chunks = []; let size = 0;
  for await (const b of res.body) { size += b.length; if (size > maxBytes) throw new Error('文件超过大小上限'); chunks.push(b); }
  return Buffer.concat(chunks);
}
export class DurableJobs {
  constructor(file) {
    this.file = file; this.data = readState(file, {}); this.busy = false;
    for (const j of Object.values(this.data)) {
      if (j.status === 'sending' || j.status === 'submitting') { j.status = 'uncertain'; j.error = '重启前的提交或发送结果未知，不自动重复'; }
      else if (j.status === 'running') j.status = 'queued';
    }
    this.save();
  }
  save() { writeState(this.file, this.data); }
  add(input) { const id = crypto.randomUUID(); this.data[id] = { ...input, id, status: 'queued', at: Date.now() }; this.save(); return this.data[id]; }
  update(j, fields) { Object.assign(j, fields); this.save(); }
  async tick(worker) {
    if (this.busy) return;
    const j = Object.values(this.data).find(x => x.status === 'queued' && (!x.nextAt || Date.now() >= x.nextAt));
    if (!j) return; this.busy = true; this.update(j, { status: 'running' });
    try { await worker(j); if (j.status === 'running') this.update(j, { status: 'completed', doneAt: Date.now() }); }
    catch (e) { this.update(j, { status: ['cancelled','uncertain','failed'].includes(j.status)?j.status:j.status === 'sending' || j.status === 'submitting' ? 'uncertain' : 'failed', error: String(e.message).slice(0,300) }); }
    finally { this.busy = false; }
  }
}
