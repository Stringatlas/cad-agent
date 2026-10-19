import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ModelChatController, MODEL_CLIENT_LIMITS, MODEL_INSPECTION_HISTORY_BYTES, streamModelTurn, validateModelEvent, type ModelChatView } from '../apps/web/src/model-chat-client';
import { MODEL_INSPECTION_LIMITS, type ModelChatEvent, type ModelRequestInspection, type ModelScene, type ModelTurnRequest } from '../packages/contracts/src/index';

const scene: ModelScene = { mode: 'toronto', project: null, toronto: [] };
const catalog = { mode: 'chatgpt', ready: true, generation: 'inspection-generation', code: 'ready', models: [{ id: 'fixture-model', label: 'Fixture model' }, { id: 'other-model', label: 'Other model' }] };
const request: ModelTurnRequest = { requestId: 'inspection-request', conversationId: null, generation: catalog.generation, model: 'fixture-model', text: 'Inspect only', scene };
const encode = new TextEncoder();
const delay = () => new Promise(resolve => setTimeout(resolve, 0));
const lines = (events: unknown[]) => events.map(e => JSON.stringify(e) + '\n').join('');
const response = (events: unknown[]) => new Response(lines(events), { headers: { 'Content-Type': 'application/x-ndjson' } });
const start = (r = request) => ({ kind: 'start', requestId: r.requestId, conversationId: r.conversationId ?? 'inspection-conversation', model: r.model });
const done = (r = request) => ({ kind: 'done', requestId: r.requestId, conversationId: r.conversationId ?? 'inspection-conversation' });
function inspection(r = request, round = 1, padding = ''): ModelRequestInspection {
  return { round, mode: 'chatgpt', continuation: r.conversationId !== null,
    bodyJson: JSON.stringify({ model: r.model, instructions: 'Read-only scene inspection', input: [{ role: 'user', content: r.text }], scene: r.scene, ...(padding ? { fixturePadding: padding } : {}) }),
    omissions: ['credentials-and-headers', 'opaque-reasoning'] };
}
const snapshot = (r = request, round = 1, padding = '') => ({ kind: 'request-inspection', requestId: r.requestId, inspection: inspection(r, round, padding) });
const phase = (r = request, round = 1, value = 'dispatched') => ({ kind: 'request-phase', requestId: r.requestId, round, phase: value });
function rounds(r = request, count = 3, padding = '') {
  return [start(r), ...Array.from({ length: count }, (_, i) => [snapshot(r, i + 1, padding), phase(r, i + 1), phase(r, i + 1, 'completed'),
    ...(i < count - 1 ? [{ kind: 'tool', requestId: r.requestId, name: 'inspect_scene', context: { round: i + 1 } }] : [])]).flat(),
  { kind: 'delta', requestId: r.requestId, text: 'Visible answer, not a geometry edit.' }, done(r)];
}
function controlled() {
  let sink!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { sink = c; }, cancel() { cancelled = true; } });
  return { response: new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }),
    push(events: unknown[]) { sink.enqueue(encode.encode(lines(events))); }, close() { sink.close(); }, get cancelled() { return cancelled; } };
}
function fixture(turn: (r: ModelTurnRequest) => Response | Promise<Response> = r => response(rounds(r)), deadline = 1000) {
  const requests: ModelTurnRequest[] = [], views: ModelChatView[] = [], calls: string[] = [];
  const client = new ModelChatController(v => views.push(v), async (path, init) => {
    calls.push(String(path));
    if (path === '/chat/models') return new Response(JSON.stringify(catalog));
    const r = JSON.parse(init!.body as string) as ModelTurnRequest; requests.push(r); return turn(r);
  }, deadline, 1000);
  client.bind(scene);
  return { client, requests, views, calls };
}
async function ready(f: ReturnType<typeof fixture>) { await f.client.refreshModels(); }
const lastSnapshots = (client: ModelChatController) => client.view.messages.at(-1)!.inspections!;

// Transport and contracts are exercised together; these are inert NDJSON fixtures, not live provider requests.
test('inspection validation freezes accepted snapshots and rejects wrong bindings, bounds and unknown shapes', () => {
  const good = validateModelEvent(snapshot(), request);
  assert.ok(Object.isFrozen(good)); assert.ok(Object.isFrozen((good as { inspection: unknown }).inspection));
  const s = inspection();
  const cases: unknown[] = [
    { ...snapshot(), requestId: 'wrong-request' },
    { ...snapshot(), secret: 'unexpected' },
    ...[{ ...s, round: 0 }, { ...s, round: MODEL_INSPECTION_LIMITS.rounds + 1 }, { ...s, round: 1.5 }, { ...s, mode: 'disabled' },
      { ...s, continuation: true }, { ...s, bodyJson: JSON.stringify({ model: 'wrong-model' }) },
      { ...s, bodyJson: 'not json' }, { ...s, bodyJson: '[]' }, { ...s, bodyJson: JSON.stringify({ model: request.model, padding: '界'.repeat(MODEL_INSPECTION_LIMITS.snapshotBytes / 3) }) },
      { ...s, omissions: [] }, { ...s, omissions: ['credentials-and-headers', 'credentials-and-headers'] },
      { ...s, omissions: ['credentials-and-headers', 'unknown'] }, { ...s, apiKey: 'not-allowed' }]
      .map(inspection => ({ ...snapshot(), inspection })),
    phase(request, 0), phase(request, MODEL_INSPECTION_LIMITS.rounds + 1), phase(request, 1, 'prepared'), phase(request, 1, 'interrupted'),
    { ...phase(), requestId: 'wrong-request' }, { ...phase(), source: 'client' },
  ];
  for (const bad of cases) assert.throws(() => validateModelEvent(bad, request), JSON.stringify(bad).slice(0, 200));
  assert.throws(() => validateModelEvent(snapshot(), { ...request, conversationId: 'existing-conversation' }));
});

test('all three request rounds and an explicit continuation preserve snapshots and server lifecycle', async () => {
  const f = fixture();
  try {
    await ready(f); assert.equal(f.requests.length, 0);
    await f.client.send('first');
    const first = f.client.view.messages[1]!;
    assert.deepEqual(first.inspections?.map(s => [s.round, s.phase, s.source, s.continuation]), [[1, 'completed', 'server', false], [2, 'completed', 'server', false], [3, 'completed', 'server', false]]);
    assert.equal(first.tools.length, 2); assert.equal(f.client.view.continuationActive, true);
    await f.client.send('second');
    assert.equal(f.requests[1]!.conversationId, 'inspection-conversation');
    assert.ok(lastSnapshots(f.client).every(s => s.continuation && s.phase === 'completed' && s.source === 'server'));
    assert.deepEqual(f.client.view.messages[1], first);
    assert.equal(JSON.parse(lastSnapshots(f.client)[0]!.bodyJson).input[0].content, 'second');
    assert.deepEqual(Object.keys(f.requests[1]!).sort(), ['conversationId', 'generation', 'model', 'requestId', 'scene', 'text']);
  } finally { f.client.dispose(); }
});

test('malicious duplicate, out-of-order and unfinished inspection streams never publish done', async t => {
  const s = snapshot(), dispatched = phase(), completed = phase(request, 1, 'completed');
  const cases: [string, unknown[]][] = [
    ['before start', [s]], ['phase before snapshot', [phase()]], ['duplicate snapshot', [s, s]],
    ['skipped first round', [snapshot(request, 2)]], ['next round before completion', [s, dispatched, snapshot(request, 2)]],
    ['completed before dispatch', [s, completed]], ['duplicate dispatch', [s, dispatched, dispatched]],
    ['duplicate completed', [s, dispatched, completed, completed]], ['wrong round phase', [s, phase(request, 2)]],
    ['after failed', [s, phase(request, 1, 'failed'), dispatched]], ['after cancelled', [s, phase(request, 1, 'cancelled'), snapshot(request, 2)]],
    ['unfinished prepared', [s]], ['unfinished dispatched', [s, dispatched]],
    ['failed cannot be done', [s, phase(request, 1, 'failed')]], ['cancelled cannot be done', [s, phase(request, 1, 'cancelled')]],
    ['wrong snapshot identity', [{ ...s, requestId: 'stale-request' }]],
    ['wrong phase identity', [s, { ...dispatched, requestId: 'stale-request' }]],
    ['continuation mismatch', [{ ...s, inspection: { ...inspection(), continuation: true } }]],
    ['model mismatch', [{ ...s, inspection: { ...inspection(), bodyJson: JSON.stringify({ model: 'other-model' }) } }]],
    ['too large', [snapshot(request, 1, 'x'.repeat(MODEL_INSPECTION_LIMITS.snapshotBytes))]],
    ['fourth round', [...rounds().slice(1, -2), snapshot(request, 4)]],
  ];
  for (const [name, middle] of cases) await t.test(name, async () => {
    const received: ModelChatEvent[] = [];
    const events = name === 'before start' ? [...middle, done()] : [start(), ...middle, done()];
    await assert.rejects(streamModelTurn(request, new AbortController().signal, e => received.push(e), async () => response(events)));
    assert.ok(!received.some(e => e.kind === 'done'));
  });
});

test('prepared and dispatched snapshots render client-local terminal states on cancel, reset, error, disconnect and deadline', async t => {
  for (const stage of ['prepared', 'dispatched'] as const) {
    for (const ending of ['cancel', 'scene', 'model', 'account', 'error', 'disconnect', 'deadline'] as const) await t.test(`${stage}/${ending}`, async () => {
      const c = controlled(), f = fixture(() => c.response, ending === 'deadline' ? 80 : 1000);
      try {
        await ready(f); const pending = f.client.send('pending'); await delay();
        const r = f.requests[0]!;
        c.push([start(r), snapshot(r), ...(stage === 'dispatched' ? [phase(r)] : [])]); await delay();
        assert.equal(lastSnapshots(f.client)[0]!.phase, stage); assert.equal(lastSnapshots(f.client)[0]!.source, 'server');
        if (ending === 'cancel') f.client.cancel();
        if (ending === 'scene') f.client.bind({ ...scene, mode: 'pole' });
        if (ending === 'model') f.client.selectModel('other-model');
        if (ending === 'account') f.client.accountChanged();
        if (ending === 'error') { c.push([{ kind: 'error', requestId: r.requestId, code: 'provider-unavailable' }]); c.close(); }
        if (ending === 'disconnect') c.close();
        await pending;
        const s = lastSnapshots(f.client)[0]!;
        assert.equal(s.source, 'client');
        assert.equal(s.phase, ending === 'error' || ending === 'disconnect' ? 'interrupted' : 'cancelled');
        assert.equal(f.client.view.messages.at(-1)!.state, 'incomplete');
        assert.equal(f.client.view.continuationActive, false); assert.equal(f.requests.length, 1);
        assert.ok(!f.views.some(v => v.phase === 'completed'));
        if (ending !== 'error' && ending !== 'disconnect') assert.equal(c.cancelled, true);
      } finally { f.client.dispose(); }
    });
  }
});

test('completed provider response is not rewritten as cancelled or proof of whole-turn completion', async t => {
  for (const ending of ['cancel', 'scene', 'error', 'disconnect'] as const) await t.test(ending, async () => {
    const c = controlled(), f = fixture(() => c.response);
    try {
      await ready(f); const pending = f.client.send('pending'); await delay(); const r = f.requests[0]!;
      c.push([start(r), snapshot(r), phase(r), phase(r, 1, 'completed'), done(r)]); await delay();
      assert.equal(f.client.view.phase, 'streaming'); assert.equal(f.client.view.continuationActive, false);
      assert.equal(lastSnapshots(f.client)[0]!.phase, 'completed');
      if (ending === 'cancel') f.client.cancel();
      if (ending === 'scene') f.client.bind({ ...scene, mode: 'pole' });
      if (ending === 'error') { c.push([{ kind: 'error', requestId: r.requestId, code: 'provider-unavailable' }]); c.close(); }
      // Even a valid done followed by an invalid trailing byte cannot complete the chat.
      if (ending === 'disconnect') { c.push([{ invalid: true }]); c.close(); }
      await pending;
      assert.equal(lastSnapshots(f.client)[0]!.phase, 'completed'); assert.equal(lastSnapshots(f.client)[0]!.source, 'server');
      assert.equal(f.client.view.messages.at(-1)!.state, 'incomplete'); assert.equal(f.client.view.continuationActive, false);
    } finally { f.client.dispose(); }
  });
});

test('explicit server failed/cancelled phases remain server facts after turn failure', async () => {
  for (const terminal of ['failed', 'cancelled']) {
    const f = fixture(r => response([start(r), snapshot(r), phase(r), phase(r, 1, terminal), { kind: 'error', requestId: r.requestId, code: 'provider-unavailable' }]));
    try { await ready(f); await f.client.send('fail'); assert.equal(lastSnapshots(f.client)[0]!.phase, terminal); assert.equal(lastSnapshots(f.client)[0]!.source, 'server'); }
    finally { f.client.dispose(); }
  }
});

test('display-only history is distinct from active continuation and no retained inspection is automatically replayed', async () => {
  const f = fixture();
  try {
    await ready(f); await f.client.send('historical-text'); const historical = f.client.view.messages[1]!;
    f.client.bind({ ...scene, mode: 'pole' });
    assert.equal(f.client.view.continuationActive, false); assert.match(f.client.view.historyNotice!, /reference only, not sent to the model/);
    assert.deepEqual(f.client.view.messages[1], historical);
    await f.client.refreshModels(); await delay(); assert.equal(f.requests.length, 1);
    await f.client.send('fresh-context'); assert.equal(f.requests[1]!.conversationId, null);
    assert.ok(!JSON.stringify(f.requests[1]).includes('historical-text')); assert.ok(!JSON.stringify(f.requests[1]).includes('bodyJson'));
    assert.equal(f.client.view.continuationActive, true);
    assert.ok(lastSnapshots(f.client).every(s => !s.continuation));
    await f.client.send('explicit-continuation'); assert.equal(f.requests[2]!.conversationId, 'inspection-conversation');
    assert.ok(lastSnapshots(f.client).every(s => s.continuation));
    const fresh = fixture(); try { assert.deepEqual(fresh.client.view.messages, []); assert.equal(fresh.calls.length, 0); } finally { fresh.client.dispose(); }
  } finally { f.client.dispose(); }
});

test('inspection retention is independently bounded across 16 turns; evictions are counted while old text remains', async () => {
  const f = fixture(r => response(rounds(r, 3, '界'.repeat(9000))));
  try {
    await ready(f);
    for (let turn = 0; turn < MODEL_CLIENT_LIMITS.maxTurns; ++turn) {
      assert.equal(await f.client.send(`turn-${turn}`), true); assert.equal(f.client.view.phase, 'completed');
      const messages = f.client.view.messages;
      const bytes = encode.encode(JSON.stringify(messages.map(m => m.inspections ?? []))).length;
      assert.ok(bytes <= MODEL_INSPECTION_HISTORY_BYTES, `retention ${bytes} > ${MODEL_INSPECTION_HISTORY_BYTES}`);
      const retained = messages.reduce((sum, m) => sum + (m.inspections?.length ?? 0), 0);
      const dropped = messages.reduce((sum, m) => sum + (m.inspectionsDropped ?? 0), 0);
      assert.equal(retained + dropped, (turn + 1) * 3);
      assert.equal(messages[0]!.text, 'turn-0'); assert.equal(messages[1]!.text, 'Visible answer, not a geometry edit.');
      assert.ok(messages.every(m => m.state === 'complete'));
    }
    assert.ok(f.client.view.messages[1]!.inspectionsDropped! > 0);
    assert.equal(await f.client.send('turn-17'), false); assert.equal(f.requests.length, 16);
    assert.equal(f.client.view.code, 'history-limit-new-chat-required');
    f.client.newChat(); assert.equal(f.client.view.messages.length, 0); assert.equal(f.client.view.continuationActive, false);
    assert.equal(f.client.view.historyNotice, undefined);
    await f.client.send('after-reset'); assert.equal(f.requests.at(-1)!.conversationId, null);
    assert.equal(f.client.view.messages.length, 2); assert.equal(f.client.view.messages[1]!.inspectionsDropped, undefined);
  } finally { f.client.dispose(); }
});

test('inspector UI shows plain effective body, omissions, local-vs-server caveats and visible eviction counts without storage', () => {
  const ui = readFileSync(new URL('../apps/web/src/ModelChat.svelte', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../apps/web/src/model-chat-client.ts', import.meta.url), 'utf8');
  for (const id of ['model-request-inspector', 'model-request-round', 'model-request-body', 'model-request-omissions', 'model-inspection-evicted', 'model-continuation']) assert.ok(ui.includes(`data-testid="${id}"`));
  assert.ok(ui.includes('{message.inspectionsDropped}')); assert.ok(ui.includes('{JSON.stringify(JSON.parse(inspection.bodyJson), null, 2)}'));
  assert.match(ui, /inspection.source === 'client'/); assert.match(ui, /Local monitoring ended; provider completion or cancellation is not confirmed/);
  assert.match(ui, /This alone does not establish completion of the whole chat turn/);
  assert.match(ui, /retained messages are display-only/); assert.match(ui, /Memory only; New chat or reload clears/);
  assert.ok(!ui.includes('{@html')); assert.ok(!/localStorage|sessionStorage|indexedDB/.test(ui + client));
});
