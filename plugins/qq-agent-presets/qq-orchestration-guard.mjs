import path from 'node:path';import {fileURLToPath} from 'node:url';
import fs from 'node:fs';import {apply as restrict} from './qq-guest-restrict.mjs';
export const name='qq-orchestration-guard';export const inject=['tools'];
export function apply(ctx,config={}){const file=config.modeFile||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../state/orchestration-mode.json');let enabled=false;try{enabled=JSON.parse(fs.readFileSync(file,'utf8')).enabled===true;}catch(e){if(e.code!=='ENOENT')throw e;}if(enabled)restrict(ctx,{noTools:config.noTools===true});}
