import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanion} from '../src/features/companion.mjs';
import {createDelivery} from '../src/features/delivery.mjs';
import {createOwnerControls} from '../src/features/owner-controls.mjs';
import {splitForQQ} from '../src/md-to-plain.js';

function fixture({mode='closed-agent',failAt=-1,onGap=()=>{},actions}={}){
  const sent=[],archived=[],delays=[],key='private:12345';
  const deps={KNOWN_AGENT_TOKENS:new Set(),currentMode:mode,cfg:{ownerQQ:'12345',sendDelayMs:0,security:{interceptNotify:false}},
    sendEpochs:new Map(),state:{sessions:{[key]:'original'}},sessionPolicy:()=> 'fixture',isSessionAllowedInCurrentMode:()=>true,
    lastSendFailed:new Map(),sendChain:Promise.resolve(),text:x=>x,escapeCqText:x=>x,splitForQQ,
    bot:{sendPrivateMessage:async(_id,message)=>{if(sent.length===failAt)throw Error('fixture transport failed');sent.push(message);return {message_id:sent.length};}},
    withTimeout:async p=>p,sleep:async ms=>{delays.push(ms);if(ms===3000)onGap(deps);},log:()=>{},appendActivity:()=>{},
    SENSITIVE_RE:/secret\s+joined/};
  const delivery=createDelivery(deps);
  const controls=createOwnerControls({orchestrator:null,isOwnerKey:()=>true});
  const companion=createCompanion({cfg:deps.cfg,isSilentMarker:t=>t==='[SILENT]',
    handleCompanionActions:actions||controls.handleCompanionActions,auditAndSend:delivery.auditAndSend,
    noteOwnerChat:(...x)=>archived.push(x),noteOutsideShare:()=>{},log:()=>{}});
  return {sent,archived,delays,delivery,companion,deps,key};
}
const pending={sessionId:'isolated'};
test('proactive paragraph breaks become three ordered nonempty bubbles',async()=>{
  const h=fixture();await h.companion.deliverCompanionShare(pending,'今天画到眼睛酸 (´-｀)\n\n团子换了地方\n你忙完叫我');
  assert.deepEqual(h.sent,['今天画到眼睛酸 (´-｀)','团子换了地方','你忙完叫我']);
  assert.equal(h.archived.length,1);assert.equal(h.delays.filter(x=>x===3000).length,2);
});
test('CRLF and whitespace-only blank lines do not produce empty bubbles',async()=>{
  const h=fixture();await h.companion.deliverCompanionShare(pending,'  第一段\r\n \t\r\n第二段\r\n\r\n  ');
  assert.deepEqual(h.sent,['第一段','第二段']);
});
test('media action removal cannot leave an empty bubble',async()=>{
  const h=fixture({actions:async(_key,text)=>text.replace(/【发表情包：[^】]*】/g,'')});
  await h.companion.deliverCompanionShare(pending,'第一段\n\n【发表情包：开心】\n\n第二段');
  assert.deepEqual(h.sent,['第一段','第二段']);
});
test('silent, empty and media-only bodies are never delivered',async()=>{
  for(const body of ['',' \n\t ','[SILENT]','【发表情包：开心】']){
    const h=fixture({actions:async(_key,text)=>text.replace(/【发表情包：[^】]*】/g,'')});
    await h.companion.deliverCompanionShare(pending,body);assert.deepEqual(h.sent,[]);assert.equal(h.archived.length,0);
  }
});
test('full body is audited before any paragraph is sent',async()=>{
  const h=fixture({mode:'reserved'});await h.companion.deliverCompanionShare(pending,'secret\n\njoined');
  assert.deepEqual(h.sent,[]);assert.equal(h.archived.length,0);
});
test('ordinary multiline delivery retains its original formatting',async()=>{
  const h=fixture();const original='说明\n\n第一项\n第二项';assert.equal(await h.delivery.auditAndSend(h.key,original),true);
  assert.deepEqual(h.sent,[original]);
});
test('failure stops subsequent bubbles and does not record full delivery',async()=>{
  const h=fixture({failAt:1});await assert.rejects(h.companion.deliverCompanionShare(pending,'第一段\n\n第二段\n第三段'),/没有确认成功/);
  assert.deepEqual(h.sent,['第一段']);assert.equal(h.archived.length,0);
});
test('session change between bubbles cancels the old batch',async()=>{
  const h=fixture({onGap:d=>{d.state.sessions['private:12345']='replacement';}});
  await assert.rejects(h.companion.deliverCompanionShare(pending,'第一段\n第二段'),/发送已取消/);
  assert.deepEqual(h.sent,['第一段']);assert.equal(h.archived.length,0);
});
test('stop epoch change between bubbles cancels the old batch',async()=>{
  const h=fixture({onGap:d=>d.sendEpochs.set('private:12345',1)});
  await assert.rejects(h.companion.deliverCompanionShare(pending,'第一段\n第二段'),/发送已取消/);
  assert.deepEqual(h.sent,['第一段']);assert.equal(h.archived.length,0);
});
