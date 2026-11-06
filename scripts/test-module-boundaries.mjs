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

test('runtime supplies every declared feature dependency',()=>{
 const tree=parse(fs.readFileSync(new URL('bridge-runtime.mjs',root),'utf8'),{ecmaVersion:2024,sourceType:'module'});
 const factories=new Map();
 for(const imp of tree.body.filter(n=>n.type==='ImportDeclaration'&&n.source.value.startsWith('./features/'))){
  const feature=parse(fs.readFileSync(new URL(imp.source.value,root),'utf8'),{ecmaVersion:2024,sourceType:'module'});
  const decl=feature.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='VariableDeclaration'&&n.declaration.declarations.some(d=>d.id.name==='dependencies'));
  const names=decl.declaration.declarations.find(d=>d.id.name==='dependencies').init.elements.map(n=>n.value);
  for(const spec of imp.specifiers)factories.set(spec.local.name,names);
 }
 let checked=0;
 function walk(n){
  if(!n||typeof n!=='object')return;
  if(n.type==='CallExpression'&&factories.has(n.callee?.name)){
   const supplied=new Set(n.arguments[0].properties.map(p=>p.key?.name??p.key?.value));
   assert.deepEqual(factories.get(n.callee.name).filter(k=>!supplied.has(k)),[],n.callee.name+' has missing live dependencies');checked++;
  }
  for(const value of Object.values(n))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
 }
 walk(tree);assert.equal(checked,factories.size);
});
