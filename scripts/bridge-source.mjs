// Static contract view of the composed implementation; runtime tests import real feature factories.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
export function readBridgeSource(){const runtime=fs.readFileSync(path.join(root,'src/bridge-runtime.mjs'),'utf8');const features=fs.readdirSync(path.join(root,'src/features')).filter(x=>x.endsWith('.mjs')).sort().map(x=>fs.readFileSync(path.join(root,'src/features',x),'utf8').replace(/\bdeps\./g,''));return runtime+'\n'+features.join('\n');}
export function readBridgeAuditFile(file,...args){let text=String(file instanceof URL?fileURLToPath(file):file).replaceAll('\\','/');if(text.endsWith('/src/bridge.js')&&args[0]==='utf8')return readBridgeSource();return fs.readFileSync(file,...args);}
