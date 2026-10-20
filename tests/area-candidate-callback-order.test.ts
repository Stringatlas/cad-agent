import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { ModelScene, ModelTurnRequest } from '@spatial/contracts';
import { ModelChatController } from '../apps/web/src/model-chat-client';
function deferred() { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const scene: ModelScene = { mode: 'toronto', project: null, toronto: [], areaOfInterest: { datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285,4841948,0], corners: [[0,0,0],[100,0,0],[100,100,0],[0,100,0]] } };
function fixture(callback: (result: unknown, current: () => boolean) => Promise<void>) {
  const order: string[] = [];
  const client = new ModelChatController(() => {}, async (path, init) => {
    if (path === '/chat/models') return Response.json({ mode: 'api-key', ready: true, generation: 'account-one', code: 'ready', models: [{ id: 'fixture-model', label: 'Fixture' }] });
    if (path === '/chat/browser-result') return new Response(null, { status: 204 });
    const request = JSON.parse(String(init?.body)) as ModelTurnRequest;
    const events = [{ kind: 'start', requestId: request.requestId, conversationId: 'conversation-one', model: request.model },
      { kind: 'tool', requestId: request.requestId, name: 'scan_area_candidates', context: { kind: 'area-candidate-result', result: { opaque: true } } },
      { kind: 'browser-request', requestId: request.requestId, toolCallId: 'capture-one', nonce: 'nonce-one', action: { kind: 'capture', request: { kind: 'current' } } },
      { kind: 'done', requestId: request.requestId, conversationId: 'conversation-one' }];
    return new Response(events.map(e => JSON.stringify(e) + '\n').join(''), { headers: { 'content-type': 'application/x-ndjson' } });
  }, undefined, undefined, { onareacandidates: async (result, current) => { order.push('markers-enter'); await callback(result, current); order.push('markers-ready'); }, oncapture: async () => { order.push('capture'); throw new Error('No camera'); } });
  return { client, order, async ready() { client.bind(scene); await client.refreshModels(); } };
}
test('candidate publication is awaited before next scene capture in the same stream chunk', { timeout: 2000 }, async t => {
  const entered = deferred(), published = deferred(); const f = fixture(async (r,current) => { assert.deepEqual(r, { opaque: true }); assert.ok(current()); entered.resolve(); await published.promise; });
  t.after(() => { published.resolve(); f.client.dispose(); }); await f.ready(); const send = f.client.send('Scan this large area then capture'); await entered.promise; await setImmediate();
  assert.deepEqual(f.order, ['markers-enter']); published.resolve(); await send; assert.deepEqual(f.order, ['markers-enter','markers-ready','capture']); assert.equal(f.client.view.phase, 'completed');
});
test('cancelled candidate publication cannot capture or complete stale turn', { timeout: 2000 }, async t => {
  const entered = deferred(), published = deferred(); let current!: () => boolean;
  const f = fixture(async (_r,c) => { current = c; entered.resolve(); await published.promise; });
  t.after(() => { published.resolve(); f.client.dispose(); }); await f.ready(); const send = f.client.send('Scan'); await entered.promise; f.client.cancel(); await send;
  assert.equal(current(), false); assert.equal(f.client.view.phase, 'cancelled'); assert.deepEqual(f.order, ['markers-enter']); published.resolve(); await setImmediate(); assert.ok(!f.order.includes('capture'));
});
test('rejected candidate publication fails closed before capture', { timeout: 2000 }, async t => {
  const f = fixture(async () => { throw new Error('Stale source'); }); t.after(() => f.client.dispose()); await f.ready(); await f.client.send('Scan'); assert.equal(f.client.view.phase, 'error'); assert.deepEqual(f.order, ['markers-enter']);
});
