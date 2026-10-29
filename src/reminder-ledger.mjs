import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export const normalizeReminder=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s，。！？、,.!?：:；;⏰]/gu,'');
export const reminderKey=(target,at,event)=>crypto.createHash('sha256').update(JSON.stringify([target,Number(at),normalizeReminder(event)])).digest('hex');
export function reminderIntent(text){return /(?:提醒我|提醒一下我|记得.{0,8}(?:叫我|喊我|提醒)|到时.{0,4}(?:叫我|喊我|提醒)|别忘了.{0,8}(?:提醒|叫我|喊我))/.test(text)&&!/^(?:不用|不要|别再).{0,4}提醒|(?:你)?(?:会不会|能不能设置|有没有).{0,8}提醒功能/.test(text);}
export class ReminderLedger{
 constructor(file){fs.mkdirSync(path.dirname(file),{recursive:true});this.db=new DatabaseSync(file);fs.chmodSync(file,0o600);this.db.exec("PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,status TEXT NOT NULL,data TEXT NOT NULL)");this.db.exec("UPDATE deliveries SET status='uncertain' WHERE status='sending'");}
 get(id){const r=this.db.prepare('SELECT status,data FROM deliveries WHERE id=?').get(id);return r?{...JSON.parse(r.data),status:r.status}:null;}
 claim(id,data={}){const result=this.db.prepare("INSERT OR IGNORE INTO deliveries VALUES(?,'sending',?)").run(id,JSON.stringify({...data,at:Date.now()}));return !!result.changes;}
 finish(id,status,receipt){if(!['sent','uncertain','failed_before_send'].includes(status))throw Error('Invalid reminder state');this.db.prepare("UPDATE deliveries SET status=?,data=json_set(data,'$.receipt',json(?),'$.doneAt',?) WHERE id=? AND status='sending'").run(status,JSON.stringify(receipt||{}),Date.now(),id);return this.get(id);}
 close(){this.db.close();}
}
