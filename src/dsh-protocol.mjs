// Runtime wire contract. No credentials or response bodies are included in errors.
export class DshProtocolError extends Error {
 constructor(endpoint,reason){super(`Unsupported DSH protocol at ${endpoint}: ${reason}`);this.name='DshProtocolError';this.code='DSH_PROTOCOL_UNSUPPORTED';}
}
export function assertResult(result,endpoint='RPC'){
 if(!result||typeof result!=='object'||typeof result.ok!=='boolean')throw new DshProtocolError(endpoint,'missing boolean result.ok');
 if(result.ok===false&&(!result.error||typeof result.error!=='object'||typeof result.error.message!=='string'))throw new DshProtocolError(endpoint,'invalid failure envelope');
 return result;
}
export function parseRpcResponse(full,request){
 const endpoint=request.method;
 if(!full||full.type!=='server-response'||full.rpcId!==request.rpcId)throw new DshProtocolError(endpoint,'envelope type or correlation mismatch');
 assertResult(full.result,endpoint);return full;
}
export function assertSettingsCapability(response){
 const result=assertResult(response?.result,'settings/describe');
 if(!result.ok)throw new DshProtocolError('settings/describe','capability probe rejected');
 if(!result.value||typeof result.value!=='object'||Array.isArray(result.value))throw new DshProtocolError('settings/describe','settings projection missing');
 return {generation:'cookie-slash-rpc-remote-mux',settings:true};
}
