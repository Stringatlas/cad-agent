import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { ModelScene, ModelTurnRequest } from '@spatial/contracts';
import { ModelChatController } from '../apps/web/src/model-chat-client';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const scene: ModelScene = {
  mode: 'toronto', toronto: [],
  areaOfInterest: { datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), frameId: 'toronto3d-local-v1', units: 'm',
    localOrigin: [627285, 4841948, 0], corners: [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]] },
};

function fixture(onplacementsearch: (result: unknown, current: () => boolean) => Promise<void>) {
  const order: string[] = [], browserResults: unknown[] = [], turns: ModelTurnRequest[] = [];
  const client = new ModelChatController(() => {}, async (path, init) => {
    if (path === '/chat/models') return Response.json({ mode: 'api-key', ready: true, generation: 'account-one', code: 'ready', models: [{ id: 'fixture-model', label: 'Fixture' }] });
    if (path === '/chat/browser-result') {
      browserResults.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 });
    }
    assert.equal(path, '/chat/turn');
    const request = JSON.parse(String(init?.body)) as ModelTurnRequest; turns.push(request);
    const events = [
      { kind: 'start', requestId: request.requestId, conversationId: 'conversation-one', model: request.model },
      ...(turns.length === 1 ? [
        // The controller treats the bounded result as opaque; shortlist schema validation belongs to the UI bridge.
        { kind: 'tool', requestId: request.requestId, name: 'search_placement_sites', context: { kind: 'placement-search-result', result: { searchId: 'search-one' } } },
        { kind: 'browser-request', requestId: request.requestId, toolCallId: 'capture-one', nonce: 'nonce-one', action: { kind: 'capture', request: { kind: 'current' } } },
      ] : []),
      { kind: 'done', requestId: request.requestId, conversationId: 'conversation-one' },
    ];
    // Put all events in one chunk so ordering cannot accidentally rely on network pacing.
    return new Response(events.map(event => JSON.stringify(event) + '\n').join(''), { headers: { 'content-type': 'application/x-ndjson' } });
  }, undefined, undefined, {
    onplacementsearch: async (result, current) => { order.push('placement-enter'); await onplacementsearch(result, current); order.push('placement-resolved'); },
    oncapture: async () => {
      order.push('capture');
      // No WebGL/browser is needed: unavailable captures are a supported protocol result.
      throw new Error('Fixture has no camera');
    },
  });
  return { client, order, browserResults, turns, async ready() { client.bind(scene); await client.refreshModels(); } };
}

test('placement publication completes before a following current-view capture, even within one stream chunk', { timeout: 2000 }, async t => {
  const entered = deferred(), publication = deferred();
  const f = fixture(async (result, current) => {
    assert.deepEqual(result, { searchId: 'search-one' }); assert.equal(current(), true);
    entered.resolve(); await publication.promise; assert.equal(current(), true);
  });
  t.after(() => { publication.resolve(); f.client.dispose(); });
  await f.ready(); const send = f.client.send('Search, then capture the current scene');
  await entered.promise; await setImmediate();
  assert.deepEqual(f.order, ['placement-enter']); assert.equal(f.browserResults.length, 0); assert.equal(f.client.view.phase, 'streaming');
  publication.resolve(); assert.equal(await send, true);
  assert.deepEqual(f.order, ['placement-enter', 'placement-resolved', 'capture']);
  assert.equal(f.browserResults.length, 1); assert.equal(f.client.view.phase, 'completed');
});

test('cancelling a deferred placement publication settles without waiting and cannot capture or complete a stale turn', { timeout: 2000 }, async t => {
  const entered = deferred(), publication = deferred(); let isCurrent!: () => boolean;
  const f = fixture(async (_result, current) => { isCurrent = current; entered.resolve(); await publication.promise; });
  t.after(() => { publication.resolve(); f.client.dispose(); });
  await f.ready(); const send = f.client.send('Search, then capture'); await entered.promise;
  f.client.cancel();
  // Await before resolving publication: an un-abortable callback would hang here.
  assert.equal(await send, true); assert.equal(isCurrent(), false); assert.equal(f.client.view.phase, 'cancelled');
  assert.deepEqual(f.order, ['placement-enter']); assert.equal(f.browserResults.length, 0);
  assert.equal(await f.client.send('Start a fresh turn'), true);
  assert.equal(f.turns[1]?.conversationId, null); assert.equal(f.client.view.phase, 'completed');
  const messages = f.client.view.messages;
  publication.resolve(); await setImmediate();
  assert.deepEqual(f.order, ['placement-enter', 'placement-resolved']); assert.equal(f.browserResults.length, 0);
  assert.equal(f.client.view.phase, 'completed'); assert.deepEqual(f.client.view.messages, messages);
});

test('a rejected placement publication fails closed before the later capture', { timeout: 2000 }, async t => {
  const entered = deferred(), publication = deferred();
  const f = fixture(async () => { entered.resolve(); await publication.promise; });
  t.after(() => { publication.resolve(); f.client.dispose(); });
  await f.ready(); const send = f.client.send('Search, then capture'); await entered.promise;
  publication.reject(new Error('Placement authority changed'));
  assert.equal(await send, true); assert.equal(f.client.view.phase, 'error');
  assert.deepEqual(f.order, ['placement-enter']); assert.equal(f.browserResults.length, 0);
  assert.equal(f.client.view.messages.at(-1)?.state, 'incomplete');
});
