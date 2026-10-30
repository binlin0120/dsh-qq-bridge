// Prevent runtime backup files and broken executable aliases from entering a release.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));let files=0;
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else{files++;if(/\.bak(?:$|[-.\d])/i.test(e.name))throw Error('Backup artifact in source: '+path.relative(root,p));}}}
walk(path.join(root,'src'));const p=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));for(const [name,command] of Object.entries(p.scripts)){if(/cd\s+\.\.\/voice-tool/.test(command))throw Error('Broken external voice alias: '+name);}console.log('Source guard passed: '+files+' files, no backup artifacts or invalid voice aliases.');
