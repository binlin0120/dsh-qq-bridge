// Exact, version-locked repair of the published SnowLuma ESM artifacts.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath,pathToFileURL} from 'node:url';
const rootDefault=fileURLToPath(new URL('..',import.meta.url));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function applySnowlumaPatches({root=rootDefault,verifyOnly=false,manifest=JSON.parse(fs.readFileSync(new URL('./snowluma-patches.json',import.meta.url),'utf8'))}={}){
 const plans=[];let verified=0;
 for(const [name,pkg] of Object.entries(manifest.packages)){
  const base=path.join(root,'node_modules',name),file=path.join(base,'package.json');if(!fs.existsSync(file))throw Error('Required dependency missing: '+name);
  const installed=JSON.parse(fs.readFileSync(file,'utf8'));if(installed.version!==pkg.version)throw Error('Unsupported dependency version: '+name+'; expected '+pkg.version);
  for(const [relative,entry] of Object.entries(pkg.files)){
   const target=path.resolve(base,relative);if(!target.startsWith(path.resolve(base)+path.sep))throw Error('Unsafe patch path');if(!fs.existsSync(target))throw Error('Dependency file missing: '+name+'/'+relative);
   const raw=fs.readFileSync(target),digest=sha(raw);if(digest===entry.after){verified++;continue;}if(digest!==entry.before)throw Error('Unknown dependency source shape: '+name+'/'+relative);if(verifyOnly)throw Error('Required SnowLuma patch not applied; run npm run compat:patch in a deployment candidate');
   let next=raw.toString('utf8');for(const [from,to] of Object.entries(entry.edits))next=next.replaceAll("from '"+from+"'","from '"+to+"'");if(sha(Buffer.from(next))!==entry.after)throw Error('Patch output verification failed: '+name+'/'+relative);plans.push({target,next});verified++;
  }
 }
 for(const {target,next} of plans){const temp=target+'.bridge-patch-'+process.pid;try{fs.writeFileSync(temp,next,{mode:fs.statSync(target).mode&0o777});fs.renameSync(temp,target);}finally{try{fs.unlinkSync(temp);}catch{}}}
 return {ok:true,packages:Object.keys(manifest.packages).length,verifiedFiles:verified,patchedFiles:plans.length};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{console.log('[snowluma-compat] '+JSON.stringify(applySnowlumaPatches({verifyOnly:process.argv.includes('--verify')})));}catch(error){console.error('[snowluma-compat] '+error.message);process.exitCode=1;}}
