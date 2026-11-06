// Isolated HTTP regressions for the limited group follow-up tool authority.
// No production files, QQ messages, DSH process, or paid services are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {bridgeHarness} from './audit-bridge-harness.mjs';

const KEY = 'group:456';
const OTHER_KEY = 'group:789';
const SELF = '999';
const clone = (value) => JSON.parse(JSON.stringify(value));
const sentHttp = (h) => h.calls.http.filter((call) => /\/send_(group|private)_msg$/.test(call.url));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return {promise, resolve};
};
async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw Error('fixture condition did not become true');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function fixture(run) {
  const h = await bridgeHarness({config: {
    allow: {private: ['123', '222'], groups: ['456', '789']}, sendDelayMs: 0,
    socialV2: {proactive: {enabled: false}, wake: {preSleepWaitEnabled: false},
      send: {maxSendPerMinute: 100, maxSendPerHour: 1000}},
  }});
  h.setMode('reserved2');
  h.setSelfIdentity('大肥鱼', SELF);
  const st = h.getSocialV2State(KEY);
  const otherToken = h.getSocialV2State(OTHER_KEY).agentToken;
  const privateToken = h.getSocialV2State('private:222').agentToken;
  const server = h.startConsoleServer();
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const request = (route, {body, token = st.agentToken, admin = false, noToken = false, query = ''} = {}) => new Promise((resolve, reject) => {
    const headers = {'x-console-token': 'fixture-console-token'};
    if (!admin) { if (!noToken) headers['x-agent-token'] = token; headers['x-agent-call'] = '1'; }
    if (body !== undefined) headers['content-type'] = 'application/json';
    const req = http.request({hostname: '127.0.0.1', port: server.address().port,
      path: route + query, method: body === undefined ? 'GET' : 'POST', headers}, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({status: res.statusCode, data: JSON.parse(data)}); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => req.destroy(new Error('fixture HTTP request timed out')));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const admission = () => ({key: KEY, sourceId: 'fixture-followup',
    modeEpoch: h.getGroupAdmissionEpoch(), followup: true, activeUntil: Date.now() + 60000,
    event: {self_id: Number(SELF), message: [{type: 'at', data: {qq: SELF}}]},
  });
  const activate = async ({start = true, turn = 'fixture-followup-turn'} = {}) => {
    const rpcId = 'scope-followup-rpc';
    const originalPrompt = h.api.sessions.prompt;
    h.api.sessions.prompt = async (params) => ({...await originalPrompt(params), rpcId});
    let result;
    try { result = await h.deliverPrompt(KEY, 'fixture follow-up', {wakeReason: 'groupFollowup', groupAdmission: admission()}); }
    finally { h.api.sessions.prompt = originalPrompt; }
    assert.equal(result.ok, true);
    const sessionId = h.state.sessions[KEY];
    assert.ok(sessionId);
    if (start) {
      h.groupFollowupTurnEvent(sessionId, {type: 'turn/start', data: {turn}});
      h.groupFollowupTurnEvent(sessionId, {type: 'user/message', data: {source: {kind: 'user', rpcId}}});
    }
    const scope = h.groupFollowupScopeForToken(st.agentToken);
    assert.ok(scope, 'pending, active and revoked limited tokens must remain recognized');
    if (start) assert.equal(h.isGroupFollowupScopeActive(scope), true);
    return {scope, sessionId, turn, rpcId};
  };
  const append = (message) => {
    h.appendSocialV2Message(KEY, 'fixture-member', message, message, false, false,
      'fixture-message-' + (st.lastUnreadSeq + 1), [], '222', []);
    return st.lastUnreadSeq;
  };
  h.bot.getMessage = async (messageId) => ({message_id: messageId, group_id: 456,
    user_id: 222, sender: {nickname: 'fixture-member'}, message: [{type: 'text', data: {text: 'quoted topic'}}]});
  try { await run({h, st, request, activate, append, otherToken, privateToken}); }
  finally { await new Promise((resolve) => server.close(resolve)); await h.close(); }
}

const query = (key = KEY) => '?key=' + encodeURIComponent(key);
const variants = [
  {name: 'unified send-message', route: '/api/socialV2/send-message', body: (token, quoted = false) => ({key: KEY, messages: ['same topic reply'], ...(quoted ? {replyToMessageId: '9001'} : {})})},
  {name: 'legacy group send', route: '/api/send/group', body: (token, quoted = false) => ({groupId: '456', token, message: 'same topic reply', ...(quoted ? {replyToMessageId: '9001'} : {})})},
  {name: 'legacy quoted reply', route: '/api/send/reply', body: (token) => ({groupId: '456', token, message: 'same topic reply', replyToMessageId: '9001'})},
];

test('limited follow-up can read its group and send one plain-text reply through each send route', () => fixture(async ({h, st, request, activate, append}) => {
  await activate();
  append('the prior topic continues');
  for (const route of ['/api/socialV2/unread', '/api/socialV2/recent']) {
    const result = await request(route, {query: query()});
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.ok(result.data.messages.some((message) => message.text === 'the prior topic continues'));
  }
  const status = await request('/api/status');
  assert.equal(status.status, 200);
  assert.equal(status.data.ownerQQ, undefined);
  assert.equal(status.data.activity, undefined);
  const check = await request('/api/socialV2/check-send', {body: {key: KEY, token: st.agentToken, tool: 'sendGroup'}});
  assert.equal(check.status, 200, JSON.stringify(check.data));
  for (const variant of variants) {
    const result = await request(variant.route, {body: variant.body(st.agentToken)});
    assert.equal(result.status, 200, variant.name + ': ' + JSON.stringify(result.data));
    assert.equal(result.data.sent, 1);
  }
  assert.equal(sentHttp(h).length, variants.length);
  for (const call of sentHttp(h)) assert.equal(call.body.group_id, 456);
}));

test('limited follow-up cannot use another valid token or target another group or private chat', () => fixture(async ({h, st, request, activate, otherToken, privateToken}) => {
  await activate();
  const before = sentHttp(h).length;
  for (const key of [OTHER_KEY, 'private:222']) {
    const read = await request('/api/socialV2/unread', {query: query(key)});
    assert.equal(read.status, 403);
    const send = await request('/api/socialV2/send-message', {body: {key, messages: ['not allowed']}});
    assert.equal(send.status, 403);
  }
  for (const body of [
    {groupId: '789', token: otherToken, message: 'not allowed'},
    {groupId: '456', token: otherToken, message: 'not allowed'},
    {groupId: '456', token: '', message: 'not allowed'},
  ]) assert.equal((await request('/api/send/group', {body})).status, 403);
  assert.equal((await request('/api/send/private', {body: {userId: '222', token: privateToken, message: 'not allowed'}})).status, 403);
  assert.equal((await request('/api/socialV2/mark-read', {body: {key: KEY, token: otherToken, throughSeq: 0}})).status, 403);
  assert.equal((await request('/api/socialV2/check-send', {body: {key: OTHER_KEY, token: otherToken, tool: 'sendGroup'}})).status, 403);
  assert.equal((await request('/api/socialV2/check-send', {body: {key: KEY, token: st.agentToken, tool: 'sendPrivate'}})).status, 403);
  assert.equal((await request('/api/socialV2/unread', {query: query(), token: 'unknown-token'})).status, 403);
  assert.equal((await request('/api/send/group', {noToken: true, body: {groupId: '456', token: st.agentToken, message: 'not allowed', atUserId: '222'}})).status, 403);
  assert.equal((await request('/api/send/group', {noToken: true, body: {groupId: '789', token: otherToken, message: 'not allowed'}})).status, 403);
  assert.equal(sentHttp(h).length, before);
}));

test('limited follow-up rejects non-chat tools, media, mention injection and multi-message sends', () => fixture(async ({h, st, request, activate}) => {
  await activate();
  const baseline = {sent: sentHttp(h).length, config: clone(st.wakeConfig), prompts: h.calls.prompts.length};
  for (const [route, body] of [
    ['/api/socialV2/wake-config', {key: KEY, config: {mode: 'active'}}],
    ['/api/socialV2/send-burst', {key: KEY, messages: ['a', 'b']}],
    ['/api/socialV2/send-poke', {key: KEY, targetUserId: '222'}],
    ['/api/images/search', {key: KEY, messageId: '9001'}],
    ['/api/session/reset', {key: KEY}],
    ['/api/role', {role: null}],
  ]) assert.equal((await request(route, {body})).status, 403, route);
  for (const messages of [['one', 'two'], ['[CQ:image,file=not-a-real-file]'], ['[cq:at,qq=222]']]) {
    assert.equal((await request('/api/socialV2/send-message', {body: {key: KEY, messages}})).status, 403);
  }
  for (const body of [
    {key: KEY, messages: ['hello'], atUserId: '222'},
    {key: KEY, messages: ['hello'], atUserId: 'all'},
  ]) assert.equal((await request('/api/socialV2/send-message', {body})).status, 403);
  for (const body of [
    {groupId: '456', token: st.agentToken, message: '[CQ:image,file=not-a-real-file]'},
    {groupId: '456', token: st.agentToken, message: 'hello', atUserId: '222'},
  ]) assert.equal((await request('/api/send/group', {body})).status, 403);
  assert.equal(sentHttp(h).length, baseline.sent);
  assert.deepEqual(clone(st.wakeConfig), baseline.config);
  assert.equal(h.calls.prompts.length, baseline.prompts);
}));

test('follow-up mark-read requires a displayed watermark and does not change wake configuration', () => fixture(async ({st, request, activate, append}) => {
  await activate();
  Object.assign(st.wakeConfig, {mode: 'diving', infinite: false, sleepUntil: Date.now() + 60000,
    noActionCount: 4, confirmedAt: 1234, confirmedBy: 'fixture'});
  append('displayed topic');
  const read = await request('/api/socialV2/unread', {query: query()});
  append('new arrival after read');
  st.preSleepWaitObservedAt = 123;
  st.preSleepWaitSatisfiedAt = 456;
  const wakeBefore = clone(st.wakeConfig);
  const noCursor = await request('/api/socialV2/mark-read', {body: {key: KEY}});
  assert.equal(noCursor.status, 400);
  assert.equal(st.unread.length, 2);
  const invalidCursor = await request('/api/socialV2/mark-read', {body: {key: KEY, throughSeq: 2}});
  assert.equal(invalidCursor.status, 400);
  const result = await request('/api/socialV2/mark-read', {body: {key: KEY, throughSeq: read.data.readThroughSeq}});
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.markedCount, 1);
  assert.deepEqual(Array.from(st.unread, (message) => message.seq), [2]);
  assert.deepEqual(clone(st.wakeConfig), wakeBefore);
  assert.equal(st.preSleepWaitObservedAt, 123);
  assert.equal(st.preSleepWaitSatisfiedAt, 456);
}));

test('pending and revoked follow-up tokens stay restricted instead of becoming ordinary full tokens', () => fixture(async ({h, st, request, activate}) => {
  const {sessionId, turn, rpcId} = await activate({start: false});
  const assertDenied = async () => {
    assert.equal((await request('/api/socialV2/unread', {query: query()})).status, 403);
    assert.equal((await request('/api/socialV2/wake-config', {body: {key: KEY, config: {mode: 'active'}}})).status, 403);
    assert.equal((await request('/api/send/group', {body: {groupId: '456', token: st.agentToken, message: 'not allowed'}})).status, 403);
    assert.equal((await request('/api/send/group', {noToken: true, body: {groupId: '456', token: st.agentToken, message: 'not allowed', atUserId: '222'}})).status, 403);
  };
  await assertDenied();
  h.groupFollowupTurnEvent(sessionId, {type: 'turn/start', data: {turn}});
  h.groupFollowupTurnEvent(sessionId, {type: 'user/message', data: {source: {kind: 'user', rpcId}}});
  assert.equal((await request('/api/socialV2/unread', {query: query()})).status, 200);
  h.groupFollowupTurnEvent(sessionId, {type: 'turn/end', data: {turn}});
  await assertDenied();
  h.clearGroupFollowupScopes();
  await assertDenied();
  assert.equal(sentHttp(h).length, 0);
}));

for (const variant of variants) {
  test(variant.name + ' rechecks follow-up permission after asynchronous quoted-message resolution', () => fixture(async ({h, st, request, activate}) => {
    const {sessionId, turn} = await activate();
    const entered = deferred(), released = deferred();
    h.bot.getMessage = async () => { entered.resolve(); return released.promise; };
    const response = request(variant.route, {body: variant.body(st.agentToken, true)});
    await entered.promise;
    h.groupFollowupTurnEvent(sessionId, {type: 'turn/end', data: {turn}});
    released.resolve({group_id: 456, user_id: 222, message: [{type: 'text', data: {text: 'quoted topic'}}]});
    const result = await response;
    assert.equal(result.status, 403, JSON.stringify(result.data));
    assert.equal(sentHttp(h).length, 0);
    assert.equal(st.sendTimes.length, 0, 'failed scope checks must not consume sending quota');
  }));

  test(variant.name + ' rechecks follow-up expiry after waiting in the shared delivery queue', () => fixture(async ({h, st, request, activate}) => {
    const {scope} = await activate();
    const entered = deferred(), released = deferred();
    const send = h.bot.sendGroupMessage.bind(h.bot);
    h.bot.sendGroupMessage = async (...args) => { entered.resolve(); await released.promise; return send(...args); };
    const blocker = h.sendToQQ(KEY, 'fixture queue blocker');
    await entered.promise;
    const response = request(variant.route, {body: variant.body(st.agentToken)});
    await until(() => st.sendTimes.length === 1);
    scope.activeUntil = Date.now() - 1;
    released.resolve();
    await blocker;
    const result = await response;
    assert.equal(result.status, 403, JSON.stringify(result.data));
    assert.equal(sentHttp(h).length, 0);
    assert.equal(st.sendTimes.length, 0, 'expired queued replies must release sending quota');
    assert.deepEqual(Array.from(h.calls.sent, (call) => call.text), ['fixture queue blocker']);
  }));
}

test('real console mode round-trip invalidates the group attention window and old admission epoch', () => fixture(async ({h, request}) => {
  h.setMode('closed-agent');
  const event = (messageId, mention) => ({self_id: Number(SELF), group_id: 456, user_id: 222,
    message_id: messageId, sender: {nickname: 'fixture-member'},
    message: [...(mention ? [{type: 'at', data: {qq: SELF}}] : []), {type: 'text', data: {text: 'continue the same topic'}}]});
  await h.handleIncoming('group', 456, event('mode-at-self', true), h.cfg);
  const epoch = h.getGroupAdmissionEpoch();
  const first = await request('/api/mode', {admin: true, body: {mode: 'chat'}});
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const second = await request('/api/mode', {admin: true, body: {mode: 'closed-agent'}});
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(h.getGroupAdmissionEpoch(), epoch + 2);
  const promptCount = h.calls.prompts.length;
  await h.handleIncoming('group', 456, event('mode-unmentioned', false), h.cfg);
  assert.equal(h.calls.prompts.length, promptCount, 'old active window cannot revive after a mode round-trip');
  const sameModeEpoch = h.getGroupAdmissionEpoch();
  await request('/api/mode', {admin: true, body: {mode: 'closed-agent'}});
  assert.equal(h.getGroupAdmissionEpoch(), sameModeEpoch, 'unchanged normalized mode preserves the current epoch');
}));
