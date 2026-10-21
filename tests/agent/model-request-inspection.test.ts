import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { canonicalModelChatEvent, MODEL_INSPECTION_LIMITS as L, type ModelChatEvent, type ModelTurnRequest } from '@spatial/contracts';
import { ProviderModel, type ModelAuth, type ModelTransport } from '../../apps/server/src/agent/provider-model';
import { inspectModelRequest } from '../../apps/server/src/agent/model-request-inspection';

const secret = 'SYNTHETIC-CREDENTIAL-NEVER-LIVE';
const opaque = 'OPAQUE-REASONING-DO-NOT-EXPOSE';
const message = { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Visible answer' }] };
const reasoning = { type: 'reasoning', encrypted_content: opaque, summary: [{ text: opaque }], arbitrary: opaque };
const tool = (id: number) => ({ type: 'function_call', namespace: 'scene', name: 'inspect_scene', call_id: `call_${id}`, arguments: '{}' });
const sse = (output: unknown[]) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const scene = { context: { mode: 'pole', frameId: 'pole-local-v1', units: 'm', points: [{ name: 'Point 1', position: [1, 2, 3] }] }, async check() {}, async close() {} };
function fixture(mode: 'api-key' | 'chatgpt' = 'api-key') {
  const bodies: Record<string, unknown>[] = [], events: ModelChatEvent[] = [];
  let next: () => Promise<Response> = async () => sse([message]);
  const auth: ModelAuth = { status: () => ({ mode, authenticated: true, ready: true, planUsageEnabled: true, selectedAccount: null, accounts: [] }),
    credentialGeneration: () => 'gen', onCredentialChange: () => () => {}, credential: async () => ({ mode, bearer: secret, baseUrl: 'ignored', constraints: { billing: mode === 'chatgpt' ? 'chatgpt-plan' : 'api-key', responsesOnly: mode === 'chatgpt' } }) };
  const transport: ModelTransport = async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json(mode === 'api-key' ? { data: [{ id: 'model-one' }] } : { models: [{ slug: 'model-one', display_name: 'Model', visibility: 'list' }] });
    bodies.push(JSON.parse(String(init?.body))); return next();
  };
  const model = new ProviderModel(auth, transport);
  const call = (conversationId: string | null = null): ModelTurnRequest => ({ requestId: 'request-one', conversationId, generation: 'gen', model: 'model-one', text: 'Inspect A', scene: { mode: 'pole', toronto: [] } });
  const run = (conversationId: string | null = null, signal = new AbortController().signal) => model.turn(call(conversationId), scene, async e => { events.push(canonicalModelChatEvent(e)); }, signal);
  return { model, bodies, events, run, setNext(fn: () => Promise<Response>) { next = fn; } };
}
const inspections = (events: ModelChatEvent[]) => events.filter(e => e.kind === 'request-inspection');
const phases = (events: ModelChatEvent[]) => events.filter(e => e.kind === 'request-phase').map(e => [e.round, e.phase]);
for (const mode of ['api-key', 'chatgpt'] as const) test(`${mode}: effective body parity, real instructions and scene input roles with truthful lifecycle`, async () => {
  const f = fixture(mode); await f.model.models(new AbortController().signal); await f.run();
  const snapshot = inspections(f.events)[0].inspection;
  assert.deepEqual(JSON.parse(snapshot.bodyJson), f.bodies[0]);
  assert.equal(snapshot.mode, mode); assert.equal(snapshot.continuation, false);
  assert.deepEqual(snapshot.omissions, ['credentials-and-headers']);
  assert.equal(typeof JSON.parse(snapshot.bodyJson).instructions, 'string');
  assert.deepEqual((JSON.parse(snapshot.bodyJson).input as { role: string }[]).map(v => v.role), ['user', 'developer']);
  assert.ok(snapshot.bodyJson.includes('pole-local-v1')); assert.ok(!snapshot.bodyJson.includes('"role":"system"'));
  assert.equal(JSON.parse(snapshot.bodyJson).max_output_tokens, mode === 'api-key' ? 4096 : undefined);
  assert.deepEqual(phases(f.events), [[1, 'dispatched'], [1, 'completed']]);
  assert.ok(!JSON.stringify(f.events).includes(secret)); f.model.close();
});
test('all three rounds and active server continuation expose visible calls/results/history but never opaque reasoning', async () => {
  const f = fixture(); await f.model.models(new AbortController().signal); let round = 0;
  f.setNext(async () => sse(++round <= 2 ? [reasoning, tool(round)] : [message]));
  await f.run();
  assert.deepEqual(inspections(f.events).map(e => e.inspection.round), [1, 2, 3]);
  assert.deepEqual(phases(f.events), [[1, 'dispatched'], [1, 'completed'], [2, 'dispatched'], [2, 'completed'], [3, 'dispatched'], [3, 'completed']]);
  const third = inspections(f.events)[2].inspection;
  assert.ok(third.omissions.includes('opaque-reasoning'));
  const body = JSON.parse(third.bodyJson);
  assert.deepEqual(body.input.slice(2, 5), [{ type: 'reasoning', omitted: 'opaque-reasoning' }, tool(1), { type: 'function_call_output', call_id: 'call_1', output: JSON.stringify(scene.context) }]);
  assert.ok(JSON.stringify(f.bodies).includes(opaque)); assert.ok(!JSON.stringify(f.events).includes(opaque));
  const done = f.events.at(-1); assert.ok(done?.kind === 'done'); f.events.length = 0;
  await f.run(done.conversationId);
  const continuation = inspections(f.events)[0].inspection;
  assert.equal(continuation.continuation, true); assert.equal(continuation.round, 1);
  assert.ok(continuation.bodyJson.includes('Visible answer')); assert.ok(continuation.omissions.includes('opaque-reasoning'));
  assert.ok(!JSON.stringify(f.events).includes(opaque)); f.model.close();
});
test('HTTP failure and rejected fetch are dispatched then failed, never completed; no retry', async () => {
  for (const next of [async () => new Response('private response', { status: 503 }), async () => { throw new Error(secret); }]) {
    const f = fixture(); await f.model.models(new AbortController().signal); f.setNext(next);
    await assert.rejects(f.run()); assert.deepEqual(phases(f.events), [[1, 'dispatched'], [1, 'failed']]);
    assert.equal(f.bodies.length, 1); assert.ok(!JSON.stringify(f.events).includes(secret)); f.model.close();
  }
});
test('cancellation while fetch pending settles inspection cancelled without completion/retry', async () => {
  const f = fixture(); await f.model.models(new AbortController().signal); f.setNext(() => new Promise(() => {}));
  const abort = new AbortController(), pending = f.run(null, abort.signal); const rejected = assert.rejects(pending);
  await tick(); abort.abort(); await rejected;
  assert.deepEqual(phases(f.events), [[1, 'dispatched'], [1, 'cancelled']]); assert.equal(f.bodies.length, 1); f.model.close();
});
test('prepared inspection cancellation never falsely dispatches', async () => {
  const f = fixture(); await f.model.models(new AbortController().signal); const abort = new AbortController();
  await assert.rejects(f.model.turn({ requestId: 'r', conversationId: null, generation: 'gen', model: 'model-one', text: 'Hi', scene: { mode: 'pole', toronto: [] } }, scene,
    async e => { f.events.push(e); if (e.kind === 'request-inspection') abort.abort(); }, abort.signal));
  assert.equal(inspections(f.events).length, 1); assert.deepEqual(phases(f.events), [[1, 'cancelled']]); assert.equal(f.bodies.length, 0); f.model.close();
});
test('allowlist omits arbitrary provider extensions/headers/credentials with explicit markers and bounded truncation', () => {
  const snapshot = inspectModelRequest({ model: 'm', instructions: 'Actual instructions', authorization: secret,
    headers: { authorization: secret }, input: [reasoning, { ...message, private: secret,
      content: [{ type: 'output_text', text: 'Visible', annotations: [{ secret }] }] }, { type: 'function_call', name: 'inspect_scene', namespace: 'scene', call_id: 'c', arguments: '{}', credential: secret }], tools: [] }, 'api-key', 1, false);
  assert.deepEqual(new Set(snapshot.omissions), new Set(['credentials-and-headers', 'opaque-reasoning', 'unrecognized-fields']));
  assert.ok(!snapshot.bodyJson.includes(secret)); assert.ok(!snapshot.bodyJson.includes(opaque));
  for (const value of ['🌍'.repeat(50000), '\\"\n'.repeat(50000)]) {
    const bounded = inspectModelRequest({ model: 'm', instructions: 'Actual instructions', input: Array.from({ length: 200 }, () => ({ role: 'user', content: value })), tools: [] }, 'chatgpt', 1, false);
    assert.ok(Buffer.byteLength(bounded.bodyJson) <= L.snapshotBytes); assert.ok(bounded.omissions.includes('truncated'));
    assert.ok(bounded.bodyJson.includes('truncated')); assert.ok(bounded.bodyJson.includes('Actual instructions'));
    canonicalModelChatEvent({ kind: 'request-inspection', requestId: 'r', inspection: bounded });
  }
});
test('provider completion without EOF stays dispatched and cancellation never reports completed', async () => {
  const f = fixture(); await f.model.models(new AbortController().signal); let closed = false;
  const terminal = `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [message] } })}\n\n`;
  f.setNext(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(terminal)); }, cancel() { closed = true; } }), { headers: { 'content-type': 'text/event-stream' } }));
  const controller = new AbortController(), pending = f.run(null, controller.signal); const rejected = assert.rejects(pending);
  await tick(); assert.deepEqual(phases(f.events), [[1, 'dispatched']]); controller.abort(); await rejected;
  assert.deepEqual(phases(f.events), [[1, 'dispatched'], [1, 'cancelled']]); assert.equal(closed, true); f.model.close();
});
test('inspection contract rejects unsafe sizes, shapes, unknown markers and coerced lifecycle discriminants', () => {
  const inspection = inspectModelRequest({ model: 'm', input: [], tools: [] }, 'api-key', 1, false);
  for (const patch of [{ round: 0 }, { round: L.rounds + 1 }, { mode: ['api-key'] }, { continuation: 'yes' }, { bodyJson: '"not-object"' }, { bodyJson: '{' },
    { bodyJson: JSON.stringify({ text: '🌍'.repeat(L.snapshotBytes) }) }, { omissions: [] }, { omissions: ['credentials-and-headers', 'secret'] }, { bearer: secret }])
    assert.throws(() => canonicalModelChatEvent({ kind: 'request-inspection', requestId: 'r', inspection: { ...inspection, ...patch } }));
  for (const phase of [['failed'], {}, 'prepared', 'unknown']) assert.throws(() => canonicalModelChatEvent({ kind: 'request-phase', requestId: 'r', round: 1, phase }));
});
