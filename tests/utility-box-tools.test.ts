import assert from 'node:assert/strict';
import test from 'node:test';
import { type ModelScene, type ModelTurnRequest } from '@spatial/contracts';
import { ProviderAuth } from '../apps/server/src/provider-auth';
import { ProviderModel, type BoundModelScene } from '../apps/server/src/provider-model';
import { validateModelEvent } from '../apps/web/src/model-chat-client';
const scene: ModelScene = { mode: 'toronto', toronto: [{ name: 'Point 1', datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), key: { sourceFileId: 1, sourceRow: 0 }, position: [1, 1, 0],
  frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }] };
test('utility tool dispatcher rejects missing/extra/forged arguments and model approval before authority dispatch', async t => {
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'fixture-only' }); let output: unknown[] = [], calls = 0;
  const model = new ProviderModel(auth, async url => String(url).endsWith('/models') ? Response.json({ data: [{ id: 'test-model' }] }) : new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
  t.after(() => { model.close(); auth.close(); }); const signal = new AbortController().signal, catalog = await model.models(signal);
  const bound: BoundModelScene = { context: {}, async check() {}, async close() {}, async assessUtilityBox() { calls++; }, async proposeUtilityBox() { calls++; } };
  const request: ModelTurnRequest = { requestId: 'utility', conversationId: null, generation: catalog.generation, model: 'test-model', text: 'Assess Point 1', scene };
  for (const [name, args] of [
    ['approve', { assessmentId: 'a'.repeat(36) }], ['accept', {}], ['approve_utility_box', {}],
    ['assess_utility_box', { pointName: 'Point 1', dimensions: [1, 1, 1] }],
    ['assess_utility_box', { pointName: 'Point 99', dimensions: [1, 1, 1], frontAccessMeters: 1 }],
    ['assess_utility_box', { pointName: 'Point 1', dimensions: [0, 1, 1], frontAccessMeters: 1 }],
    ['assess_utility_box', { pointName: 'Point 1', dimensions: [1, 1, 1], frontAccessMeters: -1 }],
    ['assess_utility_box', { pointName: 'Point 1', dimensions: [1, 1, 1], frontAccessMeters: 1, revision: 0 }],
    ['propose_utility_box', { assessmentId: 'fabricated' }],
    ['propose_utility_box', { assessmentId: 'a'.repeat(36), center: [1, 1, 1] }],
  ] as const) {
    output = [{ type: 'function_call', namespace: 'scene', name, call_id: 'malicious', arguments: JSON.stringify(args) }];
    await assert.rejects(model.turn(request, bound, async () => {}, signal));
  }
  assert.equal(calls, 0);
  for (const name of ['assess_utility_box', 'propose_utility_box'] as const) {
    const event = { kind: 'tool', requestId: request.requestId, name, context: {} };
    assert.equal(validateModelEvent(event, request).kind, 'tool');
    assert.throws(() => validateModelEvent(event, { ...request, scene: { mode: 'pole', toronto: [] } }));
    assert.throws(() => validateModelEvent(event, { ...request, scene: { ...scene, toronto: [] } }));
  }
});
