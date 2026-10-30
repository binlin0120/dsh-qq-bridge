import test from 'node:test';import assert from 'node:assert/strict';
import {parseRpcResponse,assertSettingsCapability,DshProtocolError} from '../src/dsh-protocol.mjs';
import {NodeApiClient,unwrap} from '../src/dsh-client.js';
test('RPC contract validates correlation and boolean outcome without leaking payload',()=>{
 const request={method:'session/prompt',rpcId:'fixture'};
 assert.equal(parseRpcResponse({type:'server-response',rpcId:'fixture',result:{ok:true,value:{}}},request).result.ok,true);
 for(const bad of [null,{}, {type:'server-response',rpcId:'other'}, {type:'server-response',rpcId:'fixture',result:{ok:'true',secret:'do-not-log'}}]){
  assert.throws(()=>parseRpcResponse(bad,request),error=>error instanceof DshProtocolError&&!error.message.includes('do-not-log'));
 }
 assert.throws(()=>unwrap({result:{ok:false}},'test'),DshProtocolError);
 assert.throws(()=>unwrap({result:{ok:false,error:{code:'denied',message:'fixture'}}},'test'),/denied/);
});
test('wire adapter sends slash endpoints, argument wrappers and unique prompt requestId',async()=>{
 const client=Object.create(NodeApiClient.prototype);client.mintRpcId=()=> 'fixture';client.onEnvelope=()=>{};
 const sent=[];client.postJson=async(url,message)=>{sent.push({url,message});return{json:async()=>({type:'server-response',rpcId:message.rpcId,result:{ok:true,value:{}}})};};
 await client.callUnary('session.prompt',{sessionId:'s',text:'fixture'});
 await client.callUnary('session.prompt',{sessionId:'s',text:'fixture'});
 assert.equal(sent[0].url,'/api/session/prompt');assert.ok(sent[0].message.payload.args.request.requestId);
 assert.notEqual(sent[0].message.payload.args.request.requestId,sent[1].message.payload.args.request.requestId);
});
test('readiness rejects business failure and unknown settings projection',()=>{
 assert.equal(assertSettingsCapability({result:{ok:true,value:{namespaces:{}}}}).settings,true);
 for(const result of [{ok:false,error:{message:'denied'}},{ok:true,value:null},{ok:true,value:[]}])assert.throws(()=>assertSettingsCapability({result}),DshProtocolError);
});
