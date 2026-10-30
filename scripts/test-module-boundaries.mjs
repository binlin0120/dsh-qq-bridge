import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';import {parse} from 'acorn';
const root=new URL('../src/',import.meta.url),contracts=JSON.parse(fs.readFileSync(new URL('features/feature-contract.json',root)));
function normalize(value){if(Array.isArray(value))return value.map(normalize);if(!value||typeof value!=='object')return value;if(value.type==='MemberExpression'&&!value.computed&&value.object.type==='Identifier'&&value.object.name==='deps')return {name:value.property.name,type:'Identifier'};const out={};for(const key of Object.keys(value).filter(k=>!['start','end','loc','range','raw'].includes(k)).sort())out[key]=key==='shorthand'?false:normalize(value[key]);return out;}
test('domain extraction preserves each function AST, including conditions, side effects and authority checks',()=>{
 let checked=0;for(const file of new Set(Object.values(contracts).map(x=>x.file))){const tree=parse(fs.readFileSync(new URL('features/'+file,root),'utf8'),{ecmaVersion:2024,sourceType:'module'});const factory=tree.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='FunctionDeclaration').declaration;
  for(const node of factory.body.body.filter(n=>n.type==='FunctionDeclaration')){const record=contracts[node.id.name];assert.ok(record,'Unregistered feature '+node.id.name);assert.equal(record.file,file);assert.equal(crypto.createHash('sha256').update(JSON.stringify(normalize(node))).digest('hex'),record.sha256,node.id.name);checked++;}
 }assert.equal(checked,Object.keys(contracts).length);assert.ok(checked>250);
});
test('entry composes the runtime and business functions live in named feature modules',()=>{
 const entry=fs.readFileSync(new URL('bridge.js',root),'utf8');assert.ok(entry.split('\n').length<10);assert.match(entry,/startBridge/);
 const runtime=fs.readFileSync(new URL('bridge-runtime.mjs',root),'utf8');assert.ok(runtime.split('\n').length<4500);for(const name of ['console-server','delivery','memory','connections','sessions','incoming'])assert.ok(fs.existsSync(new URL('features/'+name+'.mjs',root)));
 assert.ok(!/new Function|\beval\(/.test(runtime));
});
