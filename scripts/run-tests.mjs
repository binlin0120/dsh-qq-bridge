import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url));const registry=JSON.parse(fs.readFileSync(new URL('./test-registry.json',import.meta.url),'utf8')).tests;
const files=fs.readdirSync(path.join(root,'scripts')).filter(f=>/^test-.*\.mjs$/.test(f)).sort();
const registered=Object.keys(registry).sort();if(JSON.stringify(files)!==JSON.stringify(registered))throw Error('Test registry mismatch; register every new test with tier and reason');
for(const [file,entry] of Object.entries(registry))if(!['audit','features','release','integration','aggregate'].includes(entry.tier)||!entry.reason)throw Error('Invalid test registry entry: '+file);
const tier=process.argv[2]||'default';if(!['default','audit','features','release','list'].includes(tier))throw Error('Use default/audit/features/release/list; integration tests require an explicit script invocation.');
if(tier==='list'){for(const [file,entry] of Object.entries(registry))console.log(entry.tier+' '+file+' — '+entry.reason);process.exit(0);}
const selected=files.filter(f=>tier==='default'?['audit','features','release'].includes(registry[f].tier):registry[f].tier===tier);let failed=0;
for(const file of selected){console.log('\nRunning '+file);const result=spawnSync(process.execPath,[path.join(root,'scripts',file)],{cwd:root,stdio:'inherit',timeout:90000,env:{...process.env,QQ_BRIDGE_TEST_LIVE:'0'}});if(result.status!==0||result.error){failed++;console.error('FAILED '+file+': '+(result.error?.message||result.status));}}
console.log(`\nRegistered ${tier} suite: ${selected.length-failed}/${selected.length} scripts passed. ${files.filter(f=>registry[f].tier==='integration').length} integration probes excluded.`);process.exitCode=failed?1:0;
