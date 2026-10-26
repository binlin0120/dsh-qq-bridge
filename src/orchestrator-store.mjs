
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
export class GoalStore{
 constructor(file){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});this.db=new DatabaseSync(file);fs.chmodSync(file,0o600);this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY,owner TEXT NOT NULL,source TEXT NOT NULL,op TEXT NOT NULL,revision INTEGER NOT NULL,epoch TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(owner,source,op));
 CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,goal TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,FOREIGN KEY(goal) REFERENCES goals(id));
 CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
 CREATE TABLE IF NOT EXISTS sources(owner TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,id));`);this.recover();}
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 put(kind,id,data){this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,id,JSON.stringify(data));return data;}
 get(kind,id){const r=this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id);return r?JSON.parse(r.data):null;}
 records(kind){return this.db.prepare('SELECT data FROM records WHERE kind=?').all(kind).map(x=>JSON.parse(x.data));}
 source(owner,id,text){this.db.prepare('INSERT OR IGNORE INTO sources VALUES(?,?,?)').run(owner,id,JSON.stringify({owner,id,text,at:Date.now()}));return this.readSource(owner,id);}
 readSource(owner,id){const r=this.db.prepare('SELECT data FROM sources WHERE owner=? AND id=?').get(owner,id);return r?JSON.parse(r.data):null;}
 hydrate(g){Object.defineProperty(g,'_cas',{value:{revision:g.revision,epoch:g.epoch,version:g.stateVersion||0},writable:true,configurable:true,enumerable:false});return g;}
 goal(id){const r=this.db.prepare('SELECT data FROM goals WHERE id=?').get(id);return r?this.hydrate(JSON.parse(r.data)):null;}
 goals(owner){return this.db.prepare('SELECT data FROM goals'+(owner?' WHERE owner=?':'')+' ORDER BY rowid').all(...(owner?[owner]:[])).map(x=>this.hydrate(JSON.parse(x.data)));}
 saveGoal(g){const expected=g._cas||{revision:g.revision,epoch:g.epoch,version:g.stateVersion||0};g.updatedAt=Date.now();g.stateVersion=(g.stateVersion||0)+1;const result=this.db.prepare("UPDATE goals SET revision=?,epoch=?,status=?,data=? WHERE id=? AND revision=? AND epoch=? AND coalesce(json_extract(data,'$.stateVersion'),0)=?").run(g.revision,g.epoch,g.status,JSON.stringify(g),g.id,expected.revision,expected.epoch,expected.version);if(!result.changes)throw Object.assign(Error('目标已被更新，旧状态没有覆盖新要求'),{code:'STALE_GOAL'});this.hydrate(g);return g;}
 create(owner,source,op,request,extra={}){return this.transaction(()=>{if(!this.readSource(owner,source))throw Error('任务没有有效来信来源');const row=this.db.prepare('SELECT data FROM goals WHERE owner=? AND source=? AND op=?').get(owner,source,op);if(row)return {...JSON.parse(row.data),duplicate:true};const g={id:crypto.randomUUID(),owner,source,op,request,revision:1,epoch:crypto.randomUUID(),engine:'orchestrator-v1',status:'received',at:Date.now(),updatedAt:Date.now(),...extra};this.db.prepare('INSERT INTO goals VALUES(?,?,?,?,?,?,?,?)').run(g.id,owner,source,op,1,g.epoch,g.status,JSON.stringify(g));return this.hydrate(g);});}
 task(id){const r=this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id);return r?JSON.parse(r.data):null;}
 tasks(goal,revision){return this.db.prepare('SELECT data FROM tasks WHERE goal=?'+(revision?' AND revision=?':'')+' ORDER BY rowid').all(goal,...(revision?[revision]:[])).map(x=>JSON.parse(x.data));}
 addTask(g,t){const v={...t,id:crypto.randomUUID(),goal:g.id,revision:g.revision,epoch:g.epoch,status:'queued',at:Date.now()};this.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?)').run(v.id,g.id,g.revision,v.status,JSON.stringify(v));return v;}
 saveTask(t){this.db.prepare('UPDATE tasks SET status=?,data=? WHERE id=?').run(t.status,JSON.stringify(t),t.id);return t;}
 event(id,data){return this.transaction(()=>{if(this.get('event',id))return false;this.put('event',id,{...data,at:Date.now()});return true;});}
 recover(){for(const g of this.goals())if(['planning','running','verifying','delivering','cancel_requested'].includes(g.status)){g.status='uncertain';g.error='服务重启，原执行结果待核实，没有自动重派';this.saveGoal(g);}for(const t of this.db.prepare("SELECT data FROM tasks WHERE status IN ('running','verifying')").all().map(x=>JSON.parse(x.data))){t.status='uncertain';this.saveTask(t);}}
 assert(g){const live=this.goal(g.id);if(!live||live.revision!==g.revision||live.epoch!==g.epoch||['cancel_requested','cancelled','superseded','uncertain','failed','blocked_external'].includes(live.status))throw Object.assign(Error('目标版本、权限或停止状态已变化'),{code:'STALE_GOAL'});return live;}
 close(){this.db.close();}
}
