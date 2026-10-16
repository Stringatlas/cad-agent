import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ModelChatController, ModelTurnFailure, MODEL_CLIENT_LIMITS as L, fetchModelCatalog, streamModelTurn, validateModelCatalog, validateModelEvent, modelFailureDescription, type ModelChatView } from '../apps/web/src/model-chat-client';
import type { ModelCatalog, ModelScene, ModelTurnRequest } from '../packages/contracts/src/index';

const catalog: ModelCatalog = { mode: 'chatgpt', ready: true, generation: 'account-generation-one', code: 'ready', models: [{ id: 'fixture-model', label: 'Fixture model' }, { id: 'other-model', label: 'Other model' }] };
const scene: ModelScene = { mode: 'toronto', project: null, toronto: [] };
const request: ModelTurnRequest = { requestId: 'test-request', conversationId: null, generation: catalog.generation, model: 'fixture-model', text: 'Inspect scene A and B.', scene };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const events = (r = request) => [{ kind: 'start', requestId: r.requestId, conversationId: r.conversationId ?? 'conversation-fixture', model: r.model },
  { kind: 'delta', requestId: r.requestId, text: 'Bound context only. No CAD edit.' }, { kind: 'done', requestId: r.requestId, conversationId: r.conversationId ?? 'conversation-fixture' }];
function ndjson(values: unknown[], suffix = '') { return values.map(v => JSON.stringify(v) + '\n').join('') + suffix; }
function stream(text: string) { return new Response(text, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } }); }
function controlled() {
  let controller!: ReadableStreamDefaultController<Uint8Array>; let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel() { cancelled = true; } });
  return { response: new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }),
    push(text: string) { controller.enqueue(new TextEncoder().encode(text)); }, close() { controller.close(); }, get cancelled() { return cancelled; } };
}
const delay = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
function fixture(turn?: (r: ModelTurnRequest, init: RequestInit) => Response | Promise<Response>, timeout = 1000) {
  const calls: { path: string; init: RequestInit }[] = [], views: ModelChatView[] = [];
  const fetcher: typeof fetch = async (path, init) => {
    calls.push({ path: String(path), init: init! });
    if (path === '/chat/models') return json(catalog);
    const r = JSON.parse(init!.body as string) as ModelTurnRequest;
    return turn ? turn(r, init!) : stream(ndjson(events(r)));
  };
  const client = new ModelChatController(v => views.push(v), fetcher, timeout, timeout);
  client.bind(scene);
  return { client, calls, views };
}
async function ready(f: ReturnType<typeof fixture>) { await f.client.refreshModels(); f.client.selectModel('fixture-model'); }

test('model catalog and inference require distinct explicit user actions; no automatic model selection or inference', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(await f.client.send('hello'), false);
  await f.client.refreshModels(); assert.deepEqual(f.calls.map(c => c.path), ['/chat/models']);
  assert.equal(f.client.view.model, ''); assert.equal(await f.client.send('hello'), false);
  f.client.selectModel('unconfigured-model'); assert.equal(f.client.view.model, '');
  f.client.selectModel('fixture-model'); assert.equal(f.calls.length, 1); assert.equal(await f.client.send('hello'), true);
  assert.equal(f.client.view.phase, 'completed'); f.client.dispose();
});

test('default fetch forwarding preserves the native browser global receiver', async () => {
  const original = globalThis.fetch; const calls: string[] = [];
  globalThis.fetch = async function (this: unknown, path, init) {
    assert.equal(this, globalThis); calls.push(String(path));
    return path === '/chat/models' ? json(catalog) : stream(ndjson(events(JSON.parse(init!.body as string))));
  };
  const client = new ModelChatController(() => {});
  try { client.bind(scene); await client.refreshModels(); client.selectModel('fixture-model'); await client.send('hello'); assert.equal(client.view.phase, 'completed'); assert.deepEqual(calls, ['/chat/models', '/chat/turn']); }
  finally { client.dispose(); globalThis.fetch = original; }
});

test('exact routes and no redirect/cache/credential leaks; only user text, handle and scene are posted', async () => {
  const f = fixture(); await ready(f); await f.client.send('first'); await f.client.send('second');
  for (const c of f.calls) { assert.equal(c.init.credentials, 'same-origin'); assert.equal(c.init.cache, 'no-store'); assert.equal(c.init.redirect, 'error'); assert.ok(c.init.signal instanceof AbortSignal); }
  assert.equal(f.calls[0]!.init.method, 'GET'); assert.equal(f.calls[0]!.init.body, undefined);
  const first = JSON.parse(f.calls[1]!.init.body as string), second = JSON.parse(f.calls[2]!.init.body as string);
  assert.deepEqual(Object.keys(first).sort(), ['requestId', 'conversationId', 'generation', 'model', 'text', 'scene'].sort());
  assert.equal(first.conversationId, null); assert.equal(second.conversationId, 'conversation-fixture'); assert.notEqual(first.requestId, second.requestId);
  assert.deepEqual(first.scene, scene); assert.equal(second.text, 'second'); assert.equal(f.client.view.messages.length, 4); f.client.dispose();
});

test('catalog schemas fail closed on unknown fields, duplicates, disabled readiness and invalid bounds', () => {
  for (const bad of [null, [], { ...catalog, secrets: 'hidden' }, { ...catalog, mode: 'unknown' }, { ...catalog, ready: 'true' },
    { ...catalog, generation: '' }, { ...catalog, code: 'bad code' }, { ...catalog, mode: 'disabled' }, { ...catalog, ready: false },
    { ...catalog, models: [catalog.models[0], catalog.models[0]] }, { ...catalog, models: Array(L.maxModels + 1).fill(catalog.models[0]) },
    { ...catalog, models: [{ id: 'bad id', label: 'x' }] }, { ...catalog, models: [{ id: 'ok', label: '<script>\u0000' }] }]) assert.throws(() => validateModelCatalog(bad));
  assert.deepEqual(validateModelCatalog(catalog), catalog);
});

test('catalog body is bounded and invalid UTF8/failure bodies never publish', async () => {
  for (const response of [new Response('SECRET PROVIDER ERROR', { status: 403 }), new Response('x'.repeat(L.catalogBytes + 1)),
    new Response(new Uint8Array([0xff])), json({ ...catalog, credential: 'SECRET' })]) {
    await assert.rejects(fetchModelCatalog(new AbortController().signal, async () => response));
  }
});

test('stream incrementally decodes split UTF8 and publishes sanitized read-only tool context', async () => {
  const text = ndjson([events()[0], { kind: 'delta', requestId: request.requestId, text: 'A → B 🌍' },
    { kind: 'tool', requestId: request.requestId, name: 'inspect_scene', context: { mode: 'toronto', project: null, mapping: 'unmapped' } }, events()[2]]);
  const bytes = new TextEncoder().encode(text), received: unknown[] = [];
  const body = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3)); c.close(); } });
  assert.equal(await streamModelTurn(request, new AbortController().signal, e => received.push(e), async () => new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })), 'conversation-fixture');
  assert.equal((received[1] as { text: string }).text, 'A → B 🌍'); assert.equal((received[2] as { name: string }).name, 'inspect_scene');
  assert.equal((received.at(-1) as { kind: string }).kind, 'done');
});

test('done is withheld until valid EOF; streamed text is incomplete until then', async () => {
  const c = controlled(), f = fixture(() => c.response); await ready(f);
  const pending = f.client.send('hello'); await delay(); c.push(ndjson(events(JSON.parse(f.calls.at(-1)!.init.body as string)))); await delay();
  assert.equal(f.client.view.phase, 'streaming'); assert.equal(f.client.view.messages.at(-1)!.state, 'streaming');
  c.close(); await pending; assert.equal(f.client.view.phase, 'completed'); assert.equal(f.client.view.messages.at(-1)!.state, 'complete'); f.client.dispose();
});

test('strict identities, sequence, framing and schema reject malicious or truncated streams', async t => {
  const [start, delta, done] = events();
  const cases: [string, string][] = [
    ['no terminal', ndjson([start, delta])], ['no start', ndjson([delta, done])], ['empty stream', ''],
    ['no final newline', ndjson([start, delta]) + JSON.stringify(done)], ['duplicate start', ndjson([start, start, done])],
    ['duplicate terminal', ndjson([start, done, done])], ['trailing whitespace frame', ndjson([start, done], '\n')],
    ['after terminal', ndjson([start, done, delta])], ['wrong request', ndjson([start, { ...delta, requestId: 'stale-request' }, done])],
    ['wrong model', ndjson([{ ...start, model: 'wrong' }, done])], ['wrong conversation', ndjson([start, { ...done, conversationId: 'wrong' }])],
    ['unknown field', ndjson([start, { ...delta, secret: 'bad' }, done])], ['unknown event', ndjson([start, { kind: 'publish-cad', requestId: request.requestId }, done])],
    ['unknown tool', ndjson([start, { kind: 'tool', requestId: request.requestId, name: 'create_box', context: {} }, done])],
    ['unbounded frame', ndjson([start]) + 'x'.repeat(L.frameBytes + 1)], ['empty delta', ndjson([start, { ...delta, text: '' }, done])],
    ['bad code', ndjson([{ kind: 'error', requestId: request.requestId, code: 'SECRET <script>' }])],
  ];
  for (const [name, text] of cases) await t.test(name, async () => { const received: string[] = []; await assert.rejects(streamModelTurn(request, new AbortController().signal, e => received.push(e.kind), async () => stream(text))); assert.ok(!received.includes('done')); });
});

test('continuing request rejects another conversation start', async () => {
  await assert.rejects(streamModelTurn({ ...request, conversationId: 'existing' }, new AbortController().signal, () => {}, async () => stream(ndjson(events()))));
});

test('provider errors retain partial text distinctly incomplete, omit unsafe failure bodies and reset server history', async () => {
  let fail = true;
  const f = fixture(r => fail ? stream(ndjson([events(r)[0], { kind: 'delta', requestId: r.requestId, text: 'Partial reasoning, not complete.' }, { kind: 'error', requestId: r.requestId, code: 'provider-unavailable' }])) : stream(ndjson(events(r))));
  await ready(f); await f.client.send('first'); assert.equal(f.client.view.phase, 'error'); assert.equal(f.client.view.code, 'provider-unavailable');
  assert.equal(f.client.view.messages.at(-1)!.state, 'incomplete'); assert.match(f.client.view.messages.at(-1)!.text, /Partial/);
  fail = false; await f.client.send('fresh'); assert.equal(JSON.parse(f.calls.at(-1)!.init.body as string).conversationId, null); f.client.dispose();
});

test('total output, stream, tool count and request text/body budgets fail closed', async () => {
  const start = events()[0], done = events()[2], delta = { kind: 'delta', requestId: request.requestId, text: 'x'.repeat(L.outputChars) };
  for (const text of [ndjson([start, delta, delta, done]), ndjson([start, ...Array(L.maxTools + 1).fill({ kind: 'tool', requestId: request.requestId, name: 'inspect_scene', context: {} }), done])]) {
    await assert.rejects(streamModelTurn(request, new AbortController().signal, () => {}, async () => stream(text)));
  }
  await assert.rejects(streamModelTurn(request, new AbortController().signal, () => {}, async () => stream('x'.repeat(L.streamBytes + 1))));
  await assert.rejects(streamModelTurn(request, new AbortController().signal, () => {}, async () => new Response(ndjson(events()), { headers: { 'Content-Type': 'text/html' } })));
  let calls = 0; const f: typeof fetch = async () => { calls++; return stream(''); };
  for (const text of ['', ' ', 'x'.repeat(L.textChars + 1)]) await assert.rejects(streamModelTurn({ ...request, text }, new AbortController().signal, () => {}, f));
  assert.equal(calls, 0);
  assert.throws(() => validateModelEvent({ kind: 'tool', requestId: request.requestId, name: 'inspect_scene', context: { data: 'x'.repeat(L.frameBytes) } }, request));
});

test('explicit cancellation aborts body, preserves incomplete text and suppresses late completion', async () => {
  const c = controlled(), f = fixture(() => c.response); await ready(f); const pending = f.client.send('hello'); await delay();
  const r = JSON.parse(f.calls.at(-1)!.init.body as string); c.push(ndjson([events(r)[0], events(r)[1]])); await delay();
  f.client.cancel(); await pending; assert.equal(f.client.view.phase, 'cancelled'); assert.equal(f.client.view.messages.at(-1)!.state, 'incomplete'); assert.equal(c.cancelled, true);
  assert.equal(f.calls.at(-1)!.init.signal!.aborted, true); assert.ok(!f.views.some(v => v.phase === 'completed')); f.client.dispose();
});

test('body deadline includes after-done hang, marks partial incomplete and releases pending read', async () => {
  const c = controlled(), f = fixture(r => { c.push(ndjson(events(r))); return c.response; }, 20); await ready(f); await f.client.send('hello');
  assert.equal(f.client.view.phase, 'error'); assert.equal(f.client.view.code, 'deadline-incomplete'); assert.equal(f.client.view.messages.at(-1)!.state, 'incomplete'); assert.equal(c.cancelled, true); f.client.dispose();
});

test('catalog header and body deadlines bound even injected fetch ignoring abort', async () => {
  const hanging = new ModelChatController(() => {}, () => new Promise(() => {}), 10, 10);
  hanging.bind(scene); await hanging.refreshModels(); assert.equal(hanging.view.catalogPhase, 'error'); hanging.dispose();
  const c = controlled(), body = new ModelChatController(() => {}, async () => c.response, 10, 10);
  await body.refreshModels(); assert.equal(body.view.catalogPhase, 'error'); assert.equal(c.cancelled, true); body.dispose();
});

test('catalog cancellation suppresses a late response from fetch that ignores abort', async () => {
  let resolve!: (r: Response) => void;
  const client = new ModelChatController(() => {}, () => new Promise<Response>(r => resolve = r)); client.bind(scene);
  const pending = client.refreshModels(); client.cancel(); await pending; resolve(json(catalog)); await delay();
  assert.equal(client.view.catalog, undefined); assert.equal(client.view.catalogPhase, 'idle'); client.dispose();
});

test('scene/model/account/new-chat/dispose changes cancel and suppress late in-flight turns', async t => {
  for (const change of ['scene', 'model', 'account', 'new', 'dispose'] as const) await t.test(change, async () => {
    const c = controlled(), f = fixture(() => c.response); await ready(f); const pending = f.client.send('hello'); await delay();
    const r = JSON.parse(f.calls.at(-1)!.init.body as string); c.push(ndjson([events(r)[0], events(r)[1]])); await delay(); const before = f.views.length;
    if (change === 'scene') f.client.bind({ ...scene, mode: 'pole' });
    if (change === 'model') f.client.selectModel('other-model');
    if (change === 'account') f.client.accountChanged();
    if (change === 'new') f.client.newChat();
    if (change === 'dispose') f.client.dispose();
    await pending; await delay(); assert.equal(c.cancelled, true); assert.ok(!f.views.slice(before).some(v => v.phase === 'completed'));
    if (change !== 'dispose') assert.equal(f.client.view.messages.length, 0);
    if (change === 'account') { assert.equal(f.client.view.catalog, undefined); assert.equal(f.client.view.model, ''); }
    f.client.dispose();
  });
});

test('a late turn response from fetch ignoring abort cannot revive cancelled history', async () => {
  let resolve!: (response: Response) => void;
  const f = fixture(() => new Promise<Response>(r => resolve = r)); await ready(f);
  const pending = f.client.send('hello'); await delay(); f.client.accountChanged(); await pending;
  const c = controlled(); resolve(c.response); await delay();
  assert.equal(c.cancelled, true); assert.equal(f.client.view.messages.length, 0); assert.equal(f.client.view.phase, 'idle'); f.client.dispose();
});

test('same scene is stable, while scene and model changes drop conversation handle and prior history', async () => {
  const f = fixture(); await ready(f); await f.client.send('first'); f.client.bind(JSON.parse(JSON.stringify(scene))); assert.equal(f.client.view.messages.length, 2);
  f.client.bind({ ...scene, mode: 'pole' }); assert.equal(f.client.view.messages.length, 0); await f.client.send('new-scene'); assert.equal(JSON.parse(f.calls.at(-1)!.init.body as string).conversationId, null);
  f.client.selectModel('other-model'); assert.equal(f.client.view.messages.length, 0); await f.client.send('new-model'); assert.equal(JSON.parse(f.calls.at(-1)!.init.body as string).conversationId, null); f.client.dispose();
});

test('one active request only and history cap requires explicit New chat', async () => {
  const f = fixture(); await ready(f);
  for (let i = 0; i < L.maxTurns; i++) assert.equal(await f.client.send(`turn ${i}`), true);
  const count = f.calls.length; assert.equal(await f.client.send('over limit'), false); assert.equal(f.calls.length, count); assert.equal(f.client.view.code, 'history-limit-new-chat-required');
  f.client.newChat(); assert.equal(await f.client.send('new'), true); f.client.dispose();
  const c = controlled(), g = fixture(() => c.response); await ready(g); const pending = g.client.send('first'); await delay(); assert.equal(await g.client.send('second'), false); assert.equal(g.calls.length, 2); g.client.cancel(); await pending; g.client.dispose();
});

const formatCodes = ['provider-format-json', 'provider-format-html', 'provider-format-text', 'provider-format-missing', 'provider-format-other'] as const;

test('classified provider failure codes propagate unchanged only after clean transport EOF, without retries', async t => {
  for (const code of formatCodes) await t.test(code, async () => {
    const received: string[] = []; let calls = 0;
    await assert.rejects(streamModelTurn(request, new AbortController().signal, e => received.push(e.kind), async () => {
      calls++; return stream(ndjson([{ kind: 'error', requestId: request.requestId, code }]));
    }), error => error instanceof ModelTurnFailure && error.code === code);
    assert.deepEqual(received, []); assert.equal(calls, 1);
  });
});

test('each failed message retains its classification through later sends; failed continuation history is not committed or retried', async t => {
  for (const code of formatCodes) await t.test(code, async () => {
    let turns = 0;
    const f = fixture(r => ++turns === 2 ? stream(ndjson([events(r)[0], { kind: 'error', requestId: r.requestId, code }])) : stream(ndjson(events(r))));
    try {
      await ready(f); await f.client.send('completed first'); await f.client.send('failure');
      assert.equal(f.client.view.phase, 'error'); assert.equal(f.client.view.code, code); assert.equal(turns, 2);
      const failed = f.client.view.messages.at(-1)!;
      assert.equal(failed.failureCode, code); assert.equal(failed.state, 'incomplete'); assert.equal(failed.text, '');
      assert.equal(JSON.parse(f.calls.at(-1)!.init.body as string).conversationId, 'conversation-fixture');
      assert.ok(!f.views.slice(f.views.findIndex(v => v.messages.length === 4)).some(v => v.phase === 'completed'));
      await delay(); assert.equal(turns, 2); // No automatic retry or provider fallback.
      await f.client.send('explicit new send');
      assert.equal(f.client.view.phase, 'completed'); assert.equal(f.client.view.code, 'completed'); assert.equal(turns, 3);
      assert.equal(JSON.parse(f.calls.at(-1)!.init.body as string).conversationId, null);
      assert.equal(f.client.view.messages[3], failed); assert.equal(f.client.view.messages[3]!.failureCode, code);
      assert.equal(f.client.view.messages.at(-1)!.failureCode, undefined);
      assert.deepEqual(f.calls.map(c => c.path), ['/chat/models', '/chat/turn', '/chat/turn', '/chat/turn']);
    } finally { f.client.dispose(); }
  });
});

test('a classified error cannot bypass EOF, trailing-frame validation or request identity', async () => {
  const c = controlled(), f = fixture(() => c.response); await ready(f);
  try {
    const pending = f.client.send('failure at EOF'); await delay(); const r = JSON.parse(f.calls.at(-1)!.init.body as string);
    c.push(ndjson([{ kind: 'error', requestId: r.requestId, code: 'provider-format-json' }])); await delay();
    assert.equal(f.client.view.phase, 'streaming'); assert.equal(f.client.view.messages.at(-1)!.failureCode, undefined);
    c.close(); await pending;
    assert.equal(f.client.view.phase, 'error'); assert.equal(f.client.view.messages.at(-1)!.failureCode, 'provider-format-json');
  } finally { f.client.dispose(); }
  for (const text of [ndjson([{ kind: 'error', requestId: request.requestId, code: 'provider-format-json' }], '\n'),
    ndjson([{ kind: 'error', requestId: 'wrong-request', code: 'provider-format-json' }])]) {
    await assert.rejects(streamModelTurn(request, new AbortController().signal, () => {}, async () => stream(text)), error => !(error instanceof ModelTurnFailure));
  }
});

test('cancel and deadline failures are retained on their own messages', async () => {
  const c = controlled(), f = fixture(() => c.response); await ready(f);
  try {
    const pending = f.client.send('cancel'); await delay(); f.client.cancel(); await pending;
    assert.equal(f.client.view.messages.at(-1)!.failureCode, 'cancelled-new-conversation-required');
  } finally { f.client.dispose(); }
  const d = controlled(), g = fixture(() => d.response, 20); await ready(g);
  try { await g.client.send('deadline'); assert.equal(g.client.view.messages.at(-1)!.failureCode, 'deadline-incomplete'); }
  finally { g.client.dispose(); }
});

test('format failure presenter uses closed header-only descriptions with explicit recovery and no inference/body claims', () => {
  const expected = [/declared JSON/, /declared HTML/, /declared text/, /did not declare/, /unsupported response format/];
  for (const [index, code] of formatCodes.entries()) {
    const description = modelFailureDescription(code);
    assert.equal(description.title, 'Provider response format rejected'); assert.match(description.detail, expected[index]!);
    assert.match(description.detail, /HTTP 200 headers/); assert.match(description.detail, /No completed answer was accepted/);
    assert.match(description.detail, /HTTP 200 does not prove inference succeeded/);
    assert.match(description.recovery, /server protocol diagnostics/); assert.match(description.recovery, /no automatic retry or fallback/);
  }
  assert.equal(new Set(formatCodes.map(code => modelFailureDescription(code).detail)).size, 5);
});

test('failure presenter distinguishes protocol, usage, auth, incomplete and interrupted failures with closed fallback', () => {
  const groups: [string[], RegExp, RegExp][] = [
    [['provider-protocol'], /protocol validation/, /protocol diagnostics/],
    [['usage-limit', 'plan-usage-unavailable'], /usage unavailable/, /do not repeatedly retry/],
    [['reauthorize', 'credential-unavailable', 'stale-account'], /authorization unavailable/, /sign in again/],
    [['permission-denied', 'plan-permission-required', 'plan-user-not-eligible'], /not authorized/, /permissions and eligibility/],
    [['provider-incomplete'], /incomplete response/, /request limits/],
    [['interrupted-stream', 'invalid-or-unavailable-stream'], /interrupted or unavailable/, /protocol diagnostics/],
    [['deadline-incomplete'], /deadline exceeded/, /server diagnostics/],
    [['cancelled-new-conversation-required', 'cancelled'], /cancelled/, /next send starts a new server conversation/],
    [['history-limit', 'history-limit-new-chat-required'], /history limit/, /New chat/],
    [['provider-unavailable'], /provider unavailable/, /No automatic retry or fallback/],
  ];
  for (const [codes, title, recovery] of groups) for (const code of codes) {
    const description = modelFailureDescription(code); assert.match(description.title, title); assert.match(description.recovery, recovery);
    assert.ok(description.detail.length > 0);
  }
  const fallback = modelFailureDescription(undefined);
  for (const code of ['provider-secret-sentinel', 'provider-format-xml', '__proto__', 'constructor', '<script>SECRET</script>', 'Bearer SECRET', 'a'.repeat(10000)]) {
    assert.deepEqual(modelFailureDescription(code), fallback); assert.ok(!JSON.stringify(modelFailureDescription(code)).includes(code));
  }
});

test('failed assistant UI renders the retained message presenter with prominent recovery, never provider markup', () => {
  const source = readFileSync(new URL('../apps/web/src/ModelChat.svelte', import.meta.url), 'utf8');
  assert.ok(source.includes('modelFailureDescription(message.failureCode)'));
  assert.ok(source.includes('data-testid="model-message-failure"')); assert.ok(source.includes('<strong>{failure.title}</strong>'));
  assert.ok(source.includes('{failure.detail}')); assert.ok(source.includes('<b>Next step:</b> {failure.recovery}'));
  assert.ok(source.includes('border-left: 4px solid')); assert.ok(!source.includes('{@html'));
});
