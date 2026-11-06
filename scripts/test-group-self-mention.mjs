import test from 'node:test';
import assert from 'node:assert/strict';
import {isExplicitSelfMention} from '../src/group-mention.mjs';
import {bridgeHarness} from './audit-bridge-harness.mjs';

const SELF='99999', OTHER_A='77777', OTHER_B='88888';
const at=qq=>({type:'at',data:{qq,name:'鲸鲸'}});
const text=value=>({type:'text',data:{text:value}});
let sequence=0;
const event=(userId,body,mentions=[],extra={})=>({
  message_id:'self-mention-'+(++sequence),self_id:Number(SELF),group_id:45678,
  user_id:userId,sender:{nickname:'鲸鲸',card:'鲸鲸'},
  message:[...mentions.map(at),text(body)],...extra,
});

async function fixture(fn){
  const h=await bridgeHarness({config:{ownerQQ:12345,allow:{private:[12345,23456],groups:[45678]},guest:{maxPerMinute:100},sendDelayMs:0}});
  try{h.setMode('closed-agent');h.setSelfIdentity('鲸鲸',SELF);h.caps.reconcile(h.capabilityKeys());await fn(h);}
  finally{await h.close();}
}
function effects(h){
  return {
    sent:h.calls.sent.length,prompts:h.calls.prompts.length,created:h.calls.created.length,
    archived:h.calls.archived.length,cancelled:h.calls.cancelled.length,http:h.calls.http.length,
    media:Object.keys(h.mediaJobs.data).length,tasks:h.taskProgress.list('group:45678').length,
    resets:JSON.stringify(h.resetRequests),pendingReset:h.pendingResetMeaning.size,queued:h.queued.size,
  };
}

test('self mention accepts only structured at segments targeting the exact numeric self QQ',()=>{
  for(const qq of [SELF,Number(SELF)])assert.equal(isExplicitSelfMention({self_id:SELF,message:[at(qq)]}),true);
  assert.equal(isExplicitSelfMention({self_id:SELF,message:[at(OTHER_A),null,at(SELF)]}),true);
  for(const qq of [OTHER_A,OTHER_B,'all','@'+SELF,' '+SELF,SELF+' ',null,undefined,'',{},true]){
    assert.equal(isExplicitSelfMention({self_id:SELF,message:[at(qq)]}),false,String(qq));
  }
});

test('trusted self identity wins over event self id and missing numeric identity never matches',()=>{
  assert.equal(isExplicitSelfMention({self_id:OTHER_A,message:[at(SELF)]},SELF),false);
  assert.equal(isExplicitSelfMention({self_id:OTHER_A,message:[at(OTHER_A)]},SELF),false);
  assert.equal(isExplicitSelfMention({self_id:SELF,message:[at(SELF)]},'invalid'),false);
  for(const self_id of [undefined,null,'','all','@'+SELF])assert.equal(isExplicitSelfMention({self_id,message:[at(self_id)]}),false);
});

test('nickname, ordinary text at, raw CQ strings, reply-only and all-member mention never count',()=>{
  for(const message of [undefined,null,'[CQ:at,qq='+SELF+']',[],[text('鲸鲸 大肥鱼 @鲸鲸 @'+SELF)],
    [{type:'reply',data:{id:'self-message'}}],[at('all')],[{type:'text',data:{qq:SELF,text:'@'+SELF}}]]){
    assert.equal(isExplicitSelfMention({self_id:SELF,message,raw_message:'[CQ:at,qq='+SELF+']'}),false);
  }
});

test('three identically named QQ accounts remain distinct for owner and member group messages',()=>fixture(async h=>{
  for(const actor of [12345,23456]){
    for(const target of [OTHER_A,OTHER_B])await h.handleIncoming('group',45678,event(actor,'鲸鲸 帮我解释一下这个函数',[target]),h.cfg);
  }
  assert.equal(h.calls.prompts.length,0,'same-name accounts cannot activate the group window');
  for(const actor of [12345,23456]){
    const baseline=h.calls.prompts.length;
    await h.handleIncoming('group',45678,event(actor,'帮我解释一下这个函数',[SELF]),h.cfg);
    assert.equal(h.calls.prompts.length,baseline+1,'an exact at of self must reach the model');
  }
}));

test('group call helper ignores nickname configuration, quoted admission and spoofed event self id',()=>fixture(async h=>{
  h.cfg.guest.groupCallNames=['鲸鲸','大肥鱼'];
  assert.equal(h.isGuestGroupCalled('鲸鲸 @99999',event(23456,'鲸鲸 @99999')),false);
  assert.equal(h.isGuestGroupCalled('鲸鲸',event(23456,'鲸鲸',[OTHER_A],{self_id:Number(OTHER_A)})),false);
  assert.equal(h.isGuestGroupCalled('',event(23456,'',[SELF],{self_id:Number(OTHER_A)})),false);
  assert.equal(h.canReplayGroupMessage('group:45678',{key:'group:45678',sourceId:'quoted',quoteTargetIsSelf:true,text:'你好',event:event(23456,'你好')}),false);
  const seed=event(23456,'请帮我看看',[SELF]);
  const modeEpoch=h.getGroupAdmissionEpoch();
  assert.equal(h.canReplayGroupMessage('group:45678',{key:'group:45678',sourceId:'followup',modeEpoch,event:seed,followup:true,activeUntil:Date.now()+1000}),true);
  assert.equal(h.canReplayGroupMessage('group:45678',{key:'group:45678',sourceId:'expired',modeEpoch,event:seed,followup:true,activeUntil:Date.now()-1}),false);
  assert.equal(h.canReplayGroupMessage('group:45678',{key:'group:45678',sourceId:'stale-mode',modeEpoch:modeEpoch-1,event:seed,followup:true,activeUntil:Date.now()+1000}),false);
}));

test('unmentioned reset, stop, permission commands and image requests have no reply or task side effects',()=>fixture(async h=>{
  const before=effects(h);
  for(const actor of [12345,23456])for(const command of ['/reset','/new','换个新对话','换好了吗','停止','进入角色扮演','/status','/权限','发张照片']){
    await h.handleIncoming('group',45678,event(actor,command),h.cfg);
  }
  assert.deepEqual(effects(h),before);
}));

test('explicit self at preserves owner controls and visitor permission denial',()=>fixture(async h=>{
  const before=effects(h);
  await h.handleIncoming('group',45678,event(12345,'/status',[OTHER_A]),h.cfg);
  assert.deepEqual(effects(h),before,'at another account must not run an owner control');
  await h.handleIncoming('group',45678,event(12345,'/status',[SELF]),h.cfg);
  assert.equal(h.calls.sent.length,1);assert.match(h.calls.sent[0].text,/会话/);assert.equal(h.calls.prompts.length,0);
  await h.handleIncoming('group',45678,event(23456,'进入角色扮演',[SELF]),h.cfg);
  assert.equal(h.calls.sent.length,2);assert.match(h.calls.sent.at(-1).text,/仅管理员/);
  assert.equal(h.calls.prompts.length,0);
}));

test('reply to self without at is discarded before fetching quoted content or applying commands',()=>fixture(async h=>{
  let lookups=0;const request=h.bot.request.bind(h.bot);
  h.bot.request=async(action,params)=>{if(action==='get_msg'){lookups++;return{status:'ok',retcode:0,data:{user_id:Number(SELF),group_id:45678,message:[text('先前的回复')]}};}return request(action,params);};
  const before=effects(h);
  await h.handleIncoming('group',45678,event(12345,'/status',[],{message:[{type:'reply',data:{id:'9001'}},text('/status')]}),h.cfg);
  await h.handleIncoming('group',45678,event(23456,'你好',[],{message:[{type:'reply',data:{id:'9001'}},text('你好')]}),h.cfg);
  assert.equal(lookups,0);assert.deepEqual(effects(h),before);
}));

test('no mention remains silent in chat, closed-agent and simulation modes and while DSH is unavailable',()=>fixture(async h=>{
  for(const mode of ['chat','closed-agent','reserved2']){
    h.setMode(mode);h.setReady(false);const before=effects(h);
    for(const command of ['鲸鲸','@99999 帮我看看','/status','停止'])await h.handleIncoming('group',45678,event(12345,command),h.cfg);
    assert.deepEqual(effects(h),before,mode);
  }
}));

test('private owner commands and member conversation remain available without any mention',()=>fixture(async h=>{
  await h.handleIncoming('private',12345,event(12345,'/status'),h.cfg);
  assert.equal(h.calls.sent.length,1);assert.equal(h.calls.sent[0].kind,'private');assert.match(h.calls.sent[0].text,/会话/);
  const before=h.calls.prompts.length;
  await h.handleIncoming('private',23456,event(23456,'晚上好'),h.cfg);
  assert.equal(h.calls.prompts.length,before+1);
}));

const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function dispatchMentionWake(h,key='group:45678',reason='atMention'){
  const st=h.getSocialV2State(key);
  const dispatchReason=st.pendingWakeReason||reason;
  if(st.pendingWakeTimer){clearTimeout(st.pendingWakeTimer);st.pendingWakeTimer=null;}
  st.pendingWakeReason=null;
  await h.sendWakePromptV2(key,dispatchReason);
  for(let i=0;i<10;i++)await settle();
}

function finishPendingWakeTurn(h,key='group:45678'){
  const sessionId=h.state.sessions[key];
  assert.ok(sessionId,'the admitted wake must have a session');
  const turn='fixture-wake-'+Date.now()+'-'+Math.random();
  h.trackTurnEvent(sessionId,{type:'turn/start',data:{turn}});
  h.v2TurnStartAt.set(sessionId,Date.now());
  const {ended}=h.trackTurnEvent(sessionId,{type:'turn/end',data:{turn,reason:{kind:'completed'}}});
  assert.equal(ended?.turn,turn,'fixture turn must close through the real collector');
  h.v2TurnStartAt.delete(sessionId);
  h.pendingWakeKeys.delete(key);
  return h.replayPendingWakeReasonsV2(key);
}

test('reserved groups deliver exact at requests while nickname and other-account at stay silent',()=>fixture(async h=>{
  h.setMode('reserved');const before=effects(h);
  await h.handleIncoming('group',45678,event(12345,'鲸鲸 帮我看看',[OTHER_A]),h.cfg);
  await h.handleIncoming('group',45678,event(23456,'鲸鲸 帮我看看'),h.cfg);
  assert.deepEqual(effects(h),before);
  await h.handleIncoming('group',45678,event(23456,'请解释这个函数',[SELF]),h.cfg);
  for(let i=0;i<10&&!h.calls.prompts.length;i++)await settle();
  assert.equal(h.calls.prompts.length,1);
}));

test('reserved2 ignores all autonomous triggers and preserves bootstrap until the first genuine at',()=>fixture(async h=>{
  h.setMode('reserved2');const key='group:45678',st=h.getSocialV2State(key),env='fixture environment: only the current QQ may answer';
  h.setInitialPrompt(key,env);
  Object.assign(st.wakeConfig,{mode:'active',infinite:false,sleepUntil:new Date(Date.now()-1000).toISOString(),triggers:{atMention:true,nameMention:true,anyMessage:true,question:true,poke:true,probability:1,keywords:['鲸鲸'],speakers:['23456']}});
  const before=effects(h);
  await h.handleIncoming('group',45678,event(23456,'鲸鲸 帮我看看？'),h.cfg);
  await h.handleIncoming('group',45678,event(12345,'/reset',[OTHER_A]),h.cfg);
  await h.handlePokeNotice({post_type:'notice',notice_type:'notify',sub_type:'poke',group_id:45678,self_id:Number(SELF),user_id:23456,target_id:Number(SELF)});
  for(const reason of ['bootstrap','admin','atMention','nameMention','question','keyword:鲸鲸','poke','timeout','replyCheck','proactiveCheck']){
    h.scheduleWakeV2(key,reason);await h.sendWakePromptV2(key,reason);
  }
  h.setupSleepTimerV2(key);h.scheduleReplyCheckV2(key);h.scheduleProactiveCheckV2(key);
  assert.equal(st.pendingWakeTimer,null);assert.equal(st.sleepTimer,null);assert.equal(st.replyCheckTimer,null);
  assert.equal(st.bootstrapSent,false);assert.deepEqual(effects(h),before);
  await h.handleIncoming('group',45678,event(23456,'请解释这个函数',[SELF]),h.cfg);
  assert.equal(st.pendingWakeReason,'atMention');await dispatchMentionWake(h,key);
  assert.equal(h.calls.prompts.length,1);assert.equal(st.lastWakeReason,'atMention');
  const first=h.calls.prompts[0].content.map(part=>part.text||'').join('\n');
  assert.match(first,/【引导唤醒】/);assert.ok(first.includes(env));
  assert.equal(h.calls.prompts.length,1);assert.equal(st.lastWakeReason,'atMention');
}));

test('reserved2 follow-up self at wakes an already bootstrapped conversation without replaying its initial environment',()=>fixture(async h=>{
  h.setMode('reserved2');const key='group:45678',st=h.getSocialV2State(key),env='already delivered first environment';
  h.setInitialPrompt(key,env);st.bootstrapSent=true;
  await h.handleIncoming('group',45678,event(12345,'继续说明这个函数',[SELF]),h.cfg);
  assert.equal(st.pendingWakeReason,'atMention');await dispatchMentionWake(h,key);
  assert.equal(h.calls.prompts.length,1);assert.equal(st.lastWakeReason,'atMention');
  const followup=h.calls.prompts[0].content.map(part=>part.text||'').join('\n');
  assert.ok(!followup.includes(env),'a subsequent mention must not repeat first-run context');
}));

test('first exact-at bootstrap is not replayed by unmentioned active-window follow-ups',()=>fixture(async h=>{
  h.setMode('reserved2');const key='group:45678',st=h.getSocialV2State(key),env='first exact-at environment is delivered only once';
  h.setInitialPrompt(key,env);assert.equal(st.bootstrapSent,false);
  await h.handleIncoming('group',45678,event(23456,'解释一下刚才的函数',[SELF]),h.cfg);
  await dispatchMentionWake(h,key);
  assert.equal(h.calls.prompts.length,1);assert.equal(st.bootstrapSent,true);
  const first=h.calls.prompts[0].content.map(part=>part.text||'').join('\n');
  assert.ok(first.includes(env));assert.match(first,/【引导唤醒】/);
  await h.handleIncoming('group',45678,event(23456,'如果参数为空字符串呢？'),h.cfg);
  assert.equal(finishPendingWakeTurn(h,key)?.action,'replayed');
  await dispatchMentionWake(h,key,'groupFollowup');
  assert.equal(h.calls.prompts.length,2);assert.equal(st.lastWakeReason,'groupFollowup');
  const followup=h.calls.prompts.at(-1).content.map(part=>part.text||'').join('\n');
  assert.match(followup,/【活跃期续聊判断】/);assert.match(followup,/没有@你/);
  assert.ok(!followup.includes(env),'the first environment must not repeat in a follow-up');
  assert.doesNotMatch(followup,/【引导唤醒】|qq_wait_for_messages|qq_set_wake_config|qq_send_sticker|qq_collect_sticker/,
    'the limited follow-up prompt must not recommend tools that this scope cannot use');
}));

test('reserved2 exact self at opens a finite follow-up window for topic relevance checks',()=>fixture(async h=>{
  h.cfg.socialV2.wake.maxWakePerMinute=1;h.cfg.socialV2.wake.maxWakePerHour=1;
  h.setMode('reserved2');const key='group:45678',st=h.getSocialV2State(key);st.bootstrapSent=true;
  await h.handleIncoming('group',45678,event(23456,'剛才说的函数这里还需要判空吗',[SELF]),h.cfg);
  await dispatchMentionWake(h,key);
  assert.equal(h.calls.prompts.length,1);
  const unreadBefore=h.getSocialV2State(key).lastUnreadSeq;
  const promptsBefore=h.calls.prompts.length;
  await h.handleIncoming('group',45678,event(23456,'那如果输入是空字符串呢？'),h.cfg);
  assert.ok(st.lastUnreadSeq>unreadBefore,'the active-window follow-up should be recorded');
  const deferred=(st.pendingWakeReasons||[]).some(item=>item?.reason==='groupFollowup');
  assert.ok(deferred,'the follow-up is deferred while the exact-at turn is still active');
  const replay=finishPendingWakeTurn(h,key);
  assert.equal(replay?.action,'replayed','turn/end releases the relevant follow-up for dispatch');
  await dispatchMentionWake(h,key,'groupFollowup');
  assert.equal(h.calls.prompts.length,promptsBefore+1,'plain text follow-ups enter a new relevance-checking model turn despite the general wake budget');
  assert.equal(st.rateLimitRetryTimer,null,'a validated active-window follow-up does not wait behind the general wake budget');
  assert.equal(st.wakeTimes.length,2,'the follow-up remains included in wake accounting');
  const followup=h.buildWakePromptV2(key,'groupFollowup');
  assert.match(followup,/活跃期续聊判断/);
  assert.match(followup,/没有@你/);
}));

test('active group follow-ups do not renew the window and expire back to exact-at-only',()=>fixture(async h=>{
  h.cfg.social.activeDurationMinMs=1000;h.cfg.social.activeDurationMaxMs=1000;
  h.setMode('reserved2');const key='group:45678',st=h.getSocialV2State(key);st.bootstrapSent=true;
  await h.handleIncoming('group',45678,event(23456,'继续刚才的话题',[SELF]),h.cfg);
  await dispatchMentionWake(h,key);
  await h.handleIncoming('group',45678,event(23456,'同一话题的追问'),h.cfg);
  assert.ok((st.pendingWakeReasons||[]).some(item=>item?.reason==='groupFollowup')||st.lastWakeReason==='groupFollowup');
  const previousSeq=st.lastUnreadSeq;
  await new Promise(resolve=>setTimeout(resolve,1100));
  await h.handleIncoming('group',45678,event(23456,'活跃期过后再问同一件事'),h.cfg);
  assert.equal(st.lastUnreadSeq,previousSeq,'messages after expiry do not enter unread state');
}));

test('active unmentioned commands are chat candidates while attachments stay outside the model and task pipeline',()=>fixture(async h=>{
  h.cfg.socialV2.wake.maxWakePerMinute=0;h.cfg.socialV2.wake.maxWakePerHour=0;
  h.setMode('reserved2');const key='group:45678',st=h.getSocialV2State(key);st.bootstrapSent=true;
  await h.handleIncoming('group',45678,event(23456,'先看这个',[SELF]),h.cfg);await dispatchMentionWake(h,key);
  const replay=finishPendingWakeTurn(h,key);
  assert.equal(replay,null,'no follow-up was pending before the command-like messages');
  const before=effects(h);
  for(const body of ['/reset','停止','/权限','发张照片'])await h.handleIncoming('group',45678,event(12345,body),h.cfg);
  await dispatchMentionWake(h,key,'groupFollowup');
  const afterCommands=effects(h);
  assert.equal(afterCommands.prompts,before.prompts+1,'the model judges relevance instead of keyword rules suppressing the conversation');
  assert.equal(afterCommands.tasks,before.tasks);assert.equal(afterCommands.resets,before.resets);
  assert.equal(afterCommands.sent,before.sent);assert.equal(afterCommands.http,before.http);
  const seqBefore=st.lastUnreadSeq,promptsBefore=afterCommands.prompts;
  for(const type of ['image','record','video','file','forward','json','xml']){
    await h.handleIncoming('group',45678,event(23456,'继续刚才的话题',[],{message:[text('继续刚才的话题'),{type,data:{file:`fixture.${type}`,url:'https://example.invalid/fixture'}}]}),h.cfg);
  }
  assert.equal(st.lastUnreadSeq,seqBefore,'non-text media and structured payloads never enter unread context');
  assert.equal(h.calls.prompts.length,promptsBefore);
  assert.equal(st.pendingWakeReason,null);
}));

test('active group attention is invalidated across mode changes even after switching back',()=>fixture(async h=>{
  h.cfg.social.activeDurationMinMs=10000;h.cfg.social.activeDurationMaxMs=10000;
  const key='group:45678';
  await h.handleIncoming('group',45678,event(23456,'先看这个',[SELF]),h.cfg);
  const before=h.calls.prompts.length;
  h.setMode('chat');h.setMode('closed-agent');
  await h.handleIncoming('group',45678,event(23456,'继续刚才的话题'),h.cfg);
  assert.equal(h.calls.prompts.length,before,'a previous mode window cannot revive when the old mode returns');
}));

test('active group follow-up wake queues with its seed mention and is rejected after expiry',()=>fixture(async h=>{
  h.cfg.social.activeDurationMinMs=1000;h.cfg.social.activeDurationMaxMs=1000;
  h.setMode('reserved2');h.setReady(false);const key='group:45678',st=h.getSocialV2State(key);st.bootstrapSent=true;
  await h.handleIncoming('group',45678,event(23456,'先看下这段代码',[SELF]),h.cfg);await dispatchMentionWake(h,key);
  await h.handleIncoming('group',45678,event(23456,'这里的边界值怎么处理？'),h.cfg);
  assert.ok((st.pendingWakeReasons||[]).some(item=>item?.reason==='groupFollowup'));
  await new Promise(resolve=>setTimeout(resolve,1100));
  h.pendingWakeKeys.delete(key);
  h.replayPendingWakeReasonsV2(key);
  assert.equal((st.pendingWakeReasons||[]).some(item=>item?.reason==='groupFollowup'),false,'expired follow-ups are discarded when replayed');
  assert.equal(h.queued.get(key)?.length,1,'only the original exact-at wake remains queued');
  h.setReady(true);await h.flushQueue();
  for(let i=0;i<10&&!h.calls.prompts.length;i++)await settle();
  assert.equal(h.calls.prompts.length,1,'the exact-at wake is replayed but the expired follow-up is dropped');
  assert.equal(h.queued.size,0);
}));

test('offline reserved2 exact at recovers with its first environment and unmentioned messages never queue',()=>fixture(async h=>{
  h.setMode('reserved2');h.setReady(false);const key='group:45678',env='fixture first group environment survives offline recovery';
  h.setInitialPrompt(key,env);
  await h.handleIncoming('group',45678,event(23456,'鲸鲸 帮忙看看'),h.cfg);
  assert.equal(h.queued.size,0);assert.equal(h.calls.prompts.length,0);
  await h.handleIncoming('group',45678,event(23456,'请解释这个函数',[SELF]),h.cfg);await dispatchMentionWake(h,key);
  assert.equal(h.calls.prompts.length,0);assert.equal(h.queued.get(key)?.length,1);
  assert.equal(h.queued.get(key)[0].groupAdmission.bootstrap,true);
  h.setReady(true);await h.flushQueue();for(let i=0;i<10&&!h.calls.prompts.length;i++)await settle();
  assert.equal(h.calls.prompts.length,1);assert.equal(h.queued.size,0);
  const delivered=h.calls.prompts[0].content.map(part=>part.text||'').join('\n');
  assert.ok(delivered.includes(env));assert.match(delivered,/【引导唤醒】/);
}));
