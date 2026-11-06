import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocialV1} from '../src/features/social-v1.mjs';
import {createEvents} from '../src/features/events.mjs';
import {createTurnCollector} from '../src/dsh-client.js';

const key = 'group:45678', sessionId = 'session-group-followup', token = 'followup-test-token';
const seed = {self_id: 99999, message: [{type: 'at', data: {qq: '99999'}}]};

function fixture() {
  let mode = 'reserved2', epoch = 1, next = 0;
  const state = {sessions: {[key]: sessionId}};
  const wakeState = {agentToken: token};
  const responses = [], prompts = [];
  const deps = {
    get currentMode() { return mode; }, get groupAdmissionEpoch() { return epoch; },
    cfg: {}, dshReady: true, state, socialV2: {paused: false, conversations: new Map([[key, wakeState]])},
    social: {exitingSessions: new Set()}, pendingWakeKeys: new Set(), queued: new Map(),
    isSessionAllowedInCurrentMode: () => true,
    isCurrentSession: (k, sid) => state.sessions[k] === sid,
    ensureSession: async () => sessionId,
    canReplayGroupMessage: (k, proof) => proof.key === k && proof.modeEpoch === epoch
      && (proof.followup !== true || proof.activeUntil > Date.now()),
    getSocialV2State: () => wakeState, buildWakePromptV2: (k, reason) => 'fixture wake reason=' + reason,
    buildWakeSnapshotV2: () => null, withSlangContext: (value) => value,
    shouldAuditKey: () => false, disarmPendingWakeLease() {}, log() {},
    sayBridge: async () => {}, canonicalV2Key: (value) => value, noteModelMessagesV2() {},
    api: {sessions: {prompt: async (params) => {
      prompts.push(params);
      return responses.length ? responses.shift()()
        : {rpcId: 'rpc-' + (++next), result: {ok: true, value: {accepted: true}}};
    }}},
  };
  const api = createSocialV1(deps);
  const admission = (followup = true) => ({key, sourceId: 'source-' + Math.random(), modeEpoch: epoch,
    event: seed, ...(followup ? {followup: true, activeUntil: Date.now() + 60000} : {})});
  return {
    ...api, deps, responses, prompts, admission,
    dispatch: (proof = admission()) => api.deliverPromptNow(key, 'fixture', {
      wakeReason: proof.followup ? 'groupFollowup' : 'atMention', groupAdmission: proof,
    }),
    start: (turn) => api.groupFollowupTurnEvent(sessionId, {type: 'turn/start', data: {turn}}),
    receipt: (turn, rpcId) => api.groupFollowupTurnEvent(sessionId, {
      type: 'user/message', data: {turn, source: {kind: 'user', rpcId}, content: [{type: 'text', text: 'fixture'}]},
    }),
    end: (turn, kind = 'completed') => api.groupFollowupTurnEvent(sessionId, {
      type: 'turn/end', data: {turn, reason: {kind}},
    }),
    setMode(value) { mode = value; epoch += 1; },
  };
}

async function activate(h, turn = 1, rpcId = 'rpc-1') {
  await h.dispatch();
  const scope = h.groupFollowupScopeForToken(token);
  h.start(turn); h.receipt(turn, rpcId);
  assert.equal(h.isGroupFollowupScopeActive(scope), true);
  return scope;
}

test('accepted follow-up token is restricted while waiting for its exact live message receipt', async () => {
  const h = fixture(); await h.dispatch();
  const scope = h.groupFollowupScopeForToken(token);
  assert.equal(scope.status, 'pending'); assert.equal(h.hasGroupFollowupScope(), true);
  h.start(1); assert.equal(h.isGroupFollowupScopeActive(scope), false);
  h.receipt(1, 'foreign-rpc'); assert.equal(h.isGroupFollowupScopeActive(scope), false);
  h.receipt(1, 'rpc-1'); assert.equal(h.isGroupFollowupScopeActive(scope), true);
});

test('exact completed, cancelled and failed turn ends retain a denying tombstone and return their scope', async () => {
  for (const kind of ['completed', 'cancelled', 'failed']) {
    const h = fixture(), scope = await activate(h);
    assert.equal(h.end(99, kind), null);
    assert.equal(h.isGroupFollowupScopeActive(scope), true);
    assert.equal(h.groupFollowupTurnEvent(sessionId, {type: 'turn/end', data: {reason: {kind}}}), null);
    assert.equal(h.end(1, kind), scope);
    assert.equal(h.groupFollowupScopeForToken(token), scope);
    assert.equal(scope.status, 'revoked'); assert.equal(h.isGroupFollowupScopeActive(scope), false);
    assert.equal(h.end(1, kind), null);
  }
});

test('expired active scope stays recognized and its exact turn end still identifies a follow-up', async () => {
  const h = fixture(), scope = await activate(h);
  scope.activeUntil = Date.now() - 1;
  assert.equal(h.isGroupFollowupScopeActive(scope), false);
  assert.equal(h.groupFollowupScopeForToken(token), scope);
  assert.equal(h.end(1), scope);
});

test('Mux and key reset cleanup revoke both pending and active scopes without restoring ordinary authority', async () => {
  for (const active of [false, true]) {
    const h = fixture(); await h.dispatch(); const scope = h.groupFollowupScopeForToken(token);
    if (active) { h.start(1); h.receipt(1, 'rpc-1'); }
    h.clearGroupFollowupScopes();
    assert.equal(h.groupFollowupScopeForToken(token), scope);
    assert.equal(h.hasGroupFollowupScope(), true);
    assert.equal(h.isGroupFollowupScopeActive(scope), false);
    if (active) assert.equal(h.end(1), scope);
    else { h.start(1); h.receipt(1, 'rpc-1'); assert.equal(h.isGroupFollowupScopeActive(scope), false); }
    h.clearGroupFollowupScopes(key);
    assert.equal(h.groupFollowupScopeForToken(token), scope);
  }
});

test('new exact at restores ordinary authority only after its own consumed RPC receipt', async () => {
  const h = fixture(), scope = await activate(h); h.end(1);
  await h.dispatch(h.admission(false));
  assert.equal(h.groupFollowupScopeForToken(token), scope);
  h.start(2); assert.equal(h.groupFollowupScopeForToken(token), scope);
  h.receipt(2, 'foreign-rpc'); assert.equal(h.groupFollowupScopeForToken(token), scope);
  h.receipt(2, 'rpc-2'); assert.equal(h.groupFollowupScopeForToken(token), null);
});

test('a fresh exact at after a lost end may restore authority, but a pre-Mux queued at cannot', async () => {
  const h = fixture(), scope = await activate(h);
  await h.dispatch(h.admission(false)); h.clearGroupFollowupScopes();
  h.start(2); h.receipt(2, 'rpc-2'); assert.equal(h.groupFollowupScopeForToken(token), scope);
  await h.dispatch(h.admission(false)); h.start(3); h.receipt(3, 'rpc-3');
  assert.equal(h.groupFollowupScopeForToken(token), null);
});

test('RPC receipt arriving before prompt response binds only after the matching response', async () => {
  const h = fixture(); let release;
  h.responses.push(() => new Promise((resolve) => { release = resolve; }));
  const delivery = h.dispatch(); await new Promise((resolve) => setImmediate(resolve));
  const scope = h.groupFollowupScopeForToken(token);
  h.start(1); h.receipt(1, 'early-rpc'); assert.equal(h.isGroupFollowupScopeActive(scope), false);
  release({rpcId: 'early-rpc', result: {ok: true, value: {accepted: true}}}); await delivery;
  assert.equal(h.isGroupFollowupScopeActive(scope), true); assert.equal(h.end(1), scope);
});

test('missing RPC correlation never grants later full authority', async () => {
  const h = fixture(), scope = await activate(h); h.end(1);
  h.responses.push(() => ({result: {ok: true, value: {accepted: true}}}));
  await h.dispatch(h.admission(false)); h.start(2); h.receipt(2, 'unknown-rpc');
  assert.equal(h.groupFollowupScopeForToken(token), scope);
});

test('a scope revoked by mode epoch or session replacement cannot be reactivated by a late receipt', async () => {
  for (const change of ['mode', 'session']) {
    const h = fixture(); await h.dispatch(); const scope = h.groupFollowupScopeForToken(token);
    if (change === 'mode') h.setMode('chat'); else h.deps.state.sessions[key] = 'replacement';
    h.start(1); h.receipt(1, 'rpc-1');
    assert.equal(h.isGroupFollowupScopeActive(scope), false);
    assert.equal(h.groupFollowupScopeForToken(token), scope);
    assert.equal(h.end(1), scope);
  }
});


test('follow-up always keeps its restricted prompt even when its original mention was bootstrap', async () => {
  const h = fixture();
  h.deps.buildWakeSnapshotV2 = () => ({messages: [], recent: [], partial: true, readThroughSeq: 0});
  await h.dispatch({...h.admission(), bootstrap: true});
  const prompt = h.prompts[0].content.map((part) => part.text || '').join('\n');
  assert.match(prompt, /fixture wake reason=groupFollowup/);
  assert.doesNotMatch(prompt, /fixture wake reason=bootstrap/);
  assert.match(prompt, /当前群发送单条纯文本回复/);
  assert.match(prompt, /qq_mark_read/);
  assert.doesNotMatch(prompt, /qq_wait_for_messages|qq_set_wake_config/);
});


test('an exact end before HTTP response suppresses ordinary wake accounting without activating tools', async () => {
  const h = fixture(); let release;
  h.responses.push(() => new Promise((resolve) => { release = resolve; }));
  const delivery = h.dispatch(); await new Promise((resolve) => setImmediate(resolve));
  const scope = h.groupFollowupScopeForToken(token);
  const wake = h.deps.getSocialV2State(key); wake.wakeConfig = {noActionCount: 1};
  h.deps.pendingWakeKeys.add(key);
  const reminders = [], afterEnd = [], stop = new Error('fixture mux stopped');
  const deps = {...h.deps, createTurnCollector, reverse: new Map([[sessionId, key]]),
    social: {silentTurns: new Map(), exitingSessions: new Set()},
    groupFollowupTurnEvent: h.groupFollowupTurnEvent,
    groupFollowupTurnMayBePending: h.groupFollowupTurnMayBePending,
    clearGroupFollowupScopes: h.clearGroupFollowupScopes,
    observeOrchestratorFrame() {}, recordSessionUsage() {}, taskEvent: () => false,
    replayPendingWakeReasonsV2() {}, saveSocialV2State() {}, clearAllPendingWakeLeases() {},
    buildWakeReminderPromptV2: () => 'fixture reminder',
    deliverPrompt: async (...args) => { reminders.push(args); return {ok: true}; },
    armPendingWakeLease() {}, noteModelHealthy() {}, sleep: async () => { throw stop; },
    api: {events: {mux: async function* () {
      const frame = (event) => ({payload: {type: 'session/event', sessionId, event}});
      yield frame({type: 'turn/start', data: {turn: 'early-end'}});
      yield frame({type: 'user/message', data: {source: {kind: 'user', rpcId: 'early-rpc'}}});
      yield frame({type: 'turn/end', data: {turn: 'early-end', reason: {kind: 'completed'}}});
      afterEnd.push(wake.wakeConfig.noActionCount, reminders.length, h.isGroupFollowupScopeActive(scope));
      release({rpcId: 'early-rpc', result: {ok: true, value: {accepted: true}}}); await delivery;
      afterEnd.push(h.isGroupFollowupScopeActive(scope));
    }}},
  };
  for (const name of ['collectors', 'v2TurnStartAt', 'pendingSendToolCalls', 'toolCallNames',
    'turnActualModels', 'sessionActualModels', 'wakeConfigMissCount', 'activeWaits']) deps[name] = new Map();
  for (const name of ['turnLeaseNoted', 'sendToolSucceededSessions', 'wakeConfigUpdatedKeys',
    'markReadCalledKeys']) deps[name] = new Set();
  await assert.rejects(createEvents(deps).pumpMux(), (error) => error === stop);
  assert.deepEqual(afterEnd, [1, 0, false, false]);
  assert.equal(h.groupFollowupScopeForToken(token), scope);
});

test('pending-end suppression requires the exact live end and an observed RPC receipt', async () => {
  const h = fixture(); let release;
  h.responses.push(() => new Promise((resolve) => { release = resolve; }));
  const delivery = h.dispatch(); await new Promise((resolve) => setImmediate(resolve));
  const end = (turn) => ({type: 'turn/end', data: {turn, reason: {kind: 'completed'}}});
  h.start('pending-end');
  assert.equal(h.groupFollowupTurnMayBePending(sessionId, end('pending-end')), false);
  h.receipt('pending-end', 'early-rpc');
  assert.equal(h.groupFollowupTurnMayBePending(sessionId, end('pending-end')), true);
  for (const event of [end('another-turn'), end(undefined), {type: 'turn/start', data: {turn: 'pending-end'}}]) {
    assert.equal(h.groupFollowupTurnMayBePending(sessionId, event), false);
  }
  assert.equal(h.groupFollowupTurnMayBePending('other-session', end('pending-end')), false);
  h.end('pending-end');
  assert.equal(h.groupFollowupTurnMayBePending(sessionId, end('pending-end')), false);
  release({rpcId: 'early-rpc', result: {ok: true, value: {accepted: true}}}); await delivery;
  assert.equal(h.isGroupFollowupScopeActive(h.groupFollowupScopeForToken(token)), false);
});
