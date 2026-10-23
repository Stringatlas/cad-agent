import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { ProviderModel, ModelError, type ModelAuth, type ModelTransport, type BoundModelScene } from '../../apps/server/src/agent/provider-model';
import { ProviderAuth, type ProviderCredential } from '../../apps/server/src/auth/provider-auth';
import { MODEL_CHAT_LIMITS as L, type ModelChatEvent, type ModelTurnRequest } from '@spatial/contracts';

const legacyKinds = (events: ModelChatEvent[]) => events.filter(e => e.kind !== 'request-inspection' && e.kind !== 'request-phase').map(e => e.kind);
const signal = () => new AbortController().signal;
class FakeAuth implements ModelAuth {
  generation = 'fake-generation'; listeners = new Set<() => void>();
  credentialHook?: () => Promise<ProviderCredential>;
  constructor(readonly mode: 'api-key' | 'chatgpt' = 'api-key') {}
  status() { return { mode: this.mode, authenticated: true, ready: true, planUsageEnabled: this.mode === 'chatgpt', selectedAccount: null, accounts: [] }; }
  credentialGeneration() { return this.generation; }
  onCredentialChange(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  credential(): Promise<ProviderCredential> { return this.credentialHook?.() ?? Promise.resolve({ mode: this.mode, bearer: 'synthetic-secret-never-live', baseUrl: 'https://should-be-ignored.invalid', constraints: { billing: this.mode === 'chatgpt' ? 'chatgpt-plan' : 'api-key', responsesOnly: this.mode === 'chatgpt' } }); }
  logout() { this.generation += '-changed'; for (const fn of this.listeners) fn(); }
}
const bound: BoundModelScene = { context: { mode: 'pole', toronto: [], geometryMutation: false }, async check() {}, async close() {} };
const message = (text = 'Hello') => ({ type: 'message', id: 'msg_fake', role: 'assistant', status: 'completed', phase: 'final_answer', content: [{ type: 'output_text', text, annotations: [] }] });
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const complete = (output: unknown[] = [message()]) => event({ type: 'response.completed', response: { status: 'completed', output } });
function sse(text: string, fragment = 7) {
  const bytes = new TextEncoder().encode(text); let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset + fragment)); offset += fragment;
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
function fixture(mode: 'api-key' | 'chatgpt' = 'api-key', now = Date.now) {
  const auth = new FakeAuth(mode); const requests: { url: string; init: RequestInit; body?: Record<string, unknown> }[] = [];
  const queue: (Response | (() => Response))[] = [];
  const transport: ModelTransport = async (url, init = {}) => {
    requests.push({ url: String(url), init, ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) } : {}) });
    if (String(url).endsWith('/models')) return Response.json(mode === 'api-key' ? { data: [{ id: 'model-one' }, { id: 'model-two' }] } :
      { models: [{ slug: 'hidden', display_name: 'Hidden', visibility: 'hide' }, { slug: 'model-one', display_name: 'Plan One', visibility: 'list' }, { slug: 'model-two', display_name: 'Plan Two', visibility: 'list' }] });
    const response = queue.shift(); if (!response) throw new Error('Missing synthetic response'); return typeof response === 'function' ? response() : response;
  };
  const model = new ProviderModel(auth, transport, now);
  const call = (extra: Partial<ModelTurnRequest> = {}): ModelTurnRequest => ({ requestId: 'request-one', conversationId: null,
    generation: auth.generation, model: 'model-one', text: 'Inspect my scene', scene: { mode: 'pole', toronto: [] }, ...extra });
  return { auth, model, requests, queue, call };
}
async function turn(f: ReturnType<typeof fixture>, call = f.call(), scene = bound) {
  const events: ModelChatEvent[] = []; await f.model.turn(call, scene, async e => { events.push(e); }, signal()); return events.filter(e => e.kind !== 'request-inspection' && e.kind !== 'request-phase');
}
const code = (name: string) => (e: unknown) => e instanceof ModelError && e.code === name;

const cloudScene: ModelTurnRequest['scene'] = { mode: 'cloud', toronto: [], cloud: {
  id: 'stpls3d-1', revision: 'a'.repeat(64), frameId: 'stpls3d-1-local-v1', localOrigin: [1, 2, 3], points: [],
} };

test('same-cloud continuation reaches provider with prior tool evidence and canonical source binding', async () => {
  const f = fixture(); await f.model.models(signal());
  const inspect = { type: 'function_call', namespace: 'scene', name: 'inspect_scene', call_id: 'cloud_inspect', arguments: '{}' };
  f.queue.push(sse(complete([inspect])), sse(complete()));
  const initial = await turn(f, f.call({ scene: cloudScene }));
  const conversationId = (initial.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
  const prior = f.requests.at(-1)!.body!.input as unknown[];
  assert(prior.some(value => (value as { type?: string }).type === 'function_call_output'));
  f.queue.push(sse(complete()));
  // Property ordering and attached references do not change source identity.
  const scene: ModelTurnRequest['scene'] = { ...cloudScene, cloud: { points: [{ name: 'Point 1', key: { sourceFileId: 1, sourceRow: 0 }, position: [0, 0, 0] }],
    localOrigin: [...cloudScene.cloud!.localOrigin] as [number, number, number], frameId: cloudScene.cloud!.frameId,
    revision: cloudScene.cloud!.revision, id: cloudScene.cloud!.id } };
  const events = await turn(f, f.call({ conversationId, scene, text: 'What did you learn?' }));
  assert.equal(events.at(-1)?.kind, 'done');
  assert.equal((events[0] as Extract<ModelChatEvent, { kind: 'start' }>).conversationId, conversationId);
  assert.deepEqual((f.requests.at(-1)!.body!.input as unknown[]).slice(0, prior.length), prior);
  assert.equal(f.requests.length, 4); f.model.close();
});

test('cloud continuation rejects source/model/account changes and expired history before inference', async () => {
  let now = 0; const f = fixture('api-key', () => now); await f.model.models(signal());
  f.queue.push(sse(complete())); const initial = await turn(f, f.call({ scene: cloudScene }));
  const conversationId = (initial.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
  for (const change of [{ id: 'stpls3d-2' }, { revision: 'b'.repeat(64) }, { frameId: 'other-local-v1' }, { localOrigin: [1, 2, 4] as const }]) {
    await assert.rejects(turn(f, f.call({ conversationId, scene: { ...cloudScene, cloud: { ...cloudScene.cloud!, ...change } } })), code('stale-conversation'));
  }
  await assert.rejects(turn(f, f.call({ conversationId, scene: cloudScene, model: 'model-two' })), code('stale-conversation'));
  await assert.rejects(turn(f, f.call({ conversationId, scene: cloudScene, generation: 'other-account' })), code('stale-account'));
  now = L.conversationTtlMs;
  await assert.rejects(turn(f, f.call({ conversationId, scene: cloudScene })), code('stale-conversation'));
  assert.equal(f.requests.length, 2);
  f.auth.logout(); await f.model.models(signal());
  await assert.rejects(turn(f, f.call({ conversationId, scene: cloudScene })), code('stale-conversation'));
  assert.equal(f.requests.length, 3); f.model.close();
});

test('cloud failed continuation and rejected done publication never replace successful history', async () => {
  const f = fixture(); await f.model.models(signal());
  f.queue.push(sse(complete())); const initial = await turn(f, f.call({ scene: cloudScene }));
  const conversationId = (initial.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
  f.queue.push(sse(event({ type: 'response.output_text.delta', delta: 'Partial cloud response' })));
  await assert.rejects(turn(f, f.call({ conversationId, scene: cloudScene, text: 'Failed cloud turn' })), code('interrupted-stream'));
  f.queue.push(sse(complete([message('Unpublished cloud response')])));
  await assert.rejects(f.model.turn(f.call({ conversationId, scene: cloudScene, text: 'Rejected completion' }), bound,
    async event => { if (event.kind === 'done') throw new Error('downstream disconnected'); }, signal()), /downstream disconnected/);
  f.queue.push(sse(complete()));
  await turn(f, f.call({ conversationId, scene: cloudScene, text: 'Explicit cloud retry' }));
  const replay = JSON.stringify(f.requests.at(-1)!.body!.input);
  for (const text of ['Failed cloud turn', 'Partial cloud response', 'Rejected completion', 'Unpublished cloud response']) assert(!replay.includes(text));
  assert(replay.includes('Explicit cloud retry')); f.model.close();
});

for (const mode of ['pole', 'toronto'] as const) test(`${mode}: mode-bound continuation remains valid`, async () => {
  const f = fixture(); await f.model.models(signal()); const scene = { mode, toronto: [] };
  f.queue.push(sse(complete())); const initial = await turn(f, f.call({ scene }));
  const conversationId = (initial.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
  f.queue.push(sse(complete())); const events = await turn(f, f.call({ conversationId, scene }));
  assert.equal(events.at(-1)?.kind, 'done'); assert.equal(f.requests.length, 3); f.model.close();
});

test('backpressure awaits downstream delta publication before tool continuation or completion', async () => {
  const f = fixture(); await f.model.models(signal());
  f.queue.push(sse(complete([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Before tool' }] }, { type: 'function_call', namespace: 'scene', name: 'inspect_scene', call_id: 'call_backpressure', arguments: '{}' }])), sse(complete()));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const emitted: ModelChatEvent[] = [];
  const pending = f.model.turn(f.call(), bound, async e => { emitted.push(e); if (e.kind === 'delta') await gate; }, signal());
  await tick(); assert.equal(f.requests.length, 2); assert.deepEqual(legacyKinds(emitted), ['start', 'delta']);
  await assert.rejects(f.model.models(signal()), code('busy'));
  release(); await pending; assert.equal(f.requests.length, 3); assert.equal(emitted.at(-1)?.kind, 'done'); f.model.close();
});
test('deadline aborts a stalled provider stream without retry and cancels its body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const f = fixture(); await f.model.models(signal()); let cancelled = false;
  f.queue.push(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }));
  const pending = assert.rejects(turn(f)); await tick(); t.mock.timers.tick(L.deadlineMs + 1); await pending;
  assert.equal(cancelled, true); assert.equal(f.requests.length, 2); f.model.close();
});
test('invalid UTF-8 and non-SSE response cancel without completion', async () => {
  const f = fixture(); await f.model.models(signal());
  f.queue.push(new Response(new Uint8Array([255]), { headers: { 'content-type': 'text/event-stream' } }));
  await assert.rejects(turn(f)); let cancelled = false;
  f.queue.push(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(turn(f), code('provider-format-html')); assert.equal(cancelled, true); f.model.close();
});
test('catalog caps bytes/model count and distinguishes absent authentication versus plan permission', async () => {
  const auth = new FakeAuth(); const model = new ProviderModel(auth, async () => Response.json({ data: Array.from({ length: 200 }, (_, i) => ({ id: `model-${i}` })) }));
  assert.equal((await model.models(signal())).models.length, L.models); model.close();
  const oversized = new ProviderModel(auth, async () => new Response(' '.repeat(L.providerBytes + 1)));
  assert.equal((await oversized.models(signal())).code, 'provider-limit'); oversized.close();
  const identity = new FakeAuth('chatgpt'); identity.status = () => ({ mode: 'chatgpt', ready: false, authenticated: true, planUsageEnabled: false, selectedAccount: null, accounts: [] });
  const plan = new ProviderModel(identity, async () => { assert.fail('Identity-only login must not invoke model API'); });
  assert.equal((await plan.models(signal())).code, 'plan-permission-required'); plan.close();
});
test('duplicate namespaced tool IDs are rejected before re-execution', async () => {
  const f = fixture(); await f.model.models(signal()); const tool = { type: 'function_call', name: 'inspect_scene', namespace: 'scene', call_id: 'call_duplicate', arguments: '{}' };
  f.queue.push(sse(complete([tool, tool]))); await assert.rejects(turn(f), code('unsupported-tool')); assert.equal(f.requests.length, 2); f.model.close();
});
test('disabled default makes no request and opaque auth generation rotates on logout/close', async () => {
  const auth = new ProviderAuth({ mode: 'disabled' }); const generation = auth.credentialGeneration(); let changes = 0;
  const off = auth.onCredentialChange(() => { changes++; });
  const model = new ProviderModel(auth, async () => { assert.fail('No external call permitted'); });
  assert.deepEqual(await model.models(signal()), { mode: 'disabled', ready: false, code: 'disabled', generation, models: [] });
  await auth.logout(); assert.notEqual(auth.credentialGeneration(), generation); assert.equal(changes, 1);
  off(); auth.close(); assert.equal(changes, 1); model.close();
});
for (const mode of ['api-key', 'chatgpt'] as const) test(`${mode}: correct catalog, fixed endpoints, exact mode-specific Responses fields and full opaque replay`, async () => {
  const f = fixture(mode); const catalog = await f.model.models(signal());
  assert.deepEqual(catalog.models, [{ id: 'model-one', label: mode === 'chatgpt' ? 'Plan One' : 'model-one' }, { id: 'model-two', label: mode === 'chatgpt' ? 'Plan Two' : 'model-two' }]);
  const reasoning = { type: 'reasoning', id: 'rs_fake', encrypted_content: 'opaque-encrypted-reasoning', summary: [] };
  f.queue.push(sse(event({ type: 'response.output_text.delta', delta: 'Hello 🌍' }) + complete([reasoning, message('Hello 🌍')])));
  const events = await turn(f); assert.deepEqual(events.map(e => e.kind), ['start', 'delta', 'done']);
  const id = (events.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
  const body = f.requests[1].body!;
  assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(Array.isArray(body.input), true);
  for (const field of ['previous_response_id', 'conversation', 'temperature', 'top_p', 'metadata', 'max_tool_calls', 'background']) assert.equal(field in body, false);
  assert.equal(body.max_output_tokens, mode === 'api-key' ? 4096 : undefined);
  assert.equal((body.tools as { type: string; name: string }[])[0].type, 'namespace');
  assert.equal((body.tools as { type: string; name: string }[])[0].name, 'scene');
  f.queue.push(sse(complete())); await turn(f, f.call({ conversationId: id, text: 'Continue' }));
  const input = f.requests[2].body!.input as unknown[];
  assert.deepEqual(input.slice(2, 4), [reasoning, message('Hello 🌍')]);
  for (const request of f.requests) {
    assert.match(request.url, /^https:\/\/api\.openai\.com\/v1\/(models|responses)$/u);
    assert.equal(request.init.redirect, 'error');
    assert.equal((request.init.headers as Record<string, string>).authorization, 'Bearer synthetic-secret-never-live');
  }
  assert.ok(!JSON.stringify(events).includes('synthetic-secret')); f.model.close();
});
for (const mode of ['api-key', 'chatgpt'] as const) test(`${mode}: split done-item events retain opaque reasoning and phase on the next user turn`, async () => {
  const f = fixture(mode); await f.model.models(signal());
  const reasoning = { type: 'reasoning', id: 'rs_done', summary: [], encrypted_content: 'opaque-done-only-🌍' };
  const final = message('Hello 🌍');
  const { phase: _phase, ...terminalMessage } = final;
  const item = (type: 'added' | 'done', output_index: number, value: unknown) => event({ type: `response.output_item.${type}`, output_index, item: value });
  f.queue.push(sse(item('added', 0, { ...reasoning, encrypted_content: 'incomplete-added-never-replay' }) +
    item('added', 1, { type: 'message', id: final.id, role: 'assistant', status: 'in_progress', phase: 'commentary', content: [] }) +
    item('done', 0, reasoning) + event({ type: 'response.output_text.delta', delta: 'Hello 🌍' }) + item('done', 1, final) +
    complete([{ type: 'reasoning', id: reasoning.id, summary: [] }, terminalMessage]) + 'data: [DONE]\n\n', mode === 'api-key' ? 1 : 7));
  const events = await turn(f); assert.deepEqual(events.map(e => e.kind), ['start', 'delta', 'done']);
  const id = (events.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
  f.queue.push(sse(complete())); await turn(f, f.call({ conversationId: id, text: 'Continue' }));
  const input = f.requests[2].body!.input as unknown[];
  assert.deepEqual(input.slice(2, 4), [reasoning, final]);
  assert.ok(!JSON.stringify(input).includes('incomplete-added-never-replay')); f.model.close();
});
test('split done-only reasoning and phase are replayed immediately for inspect_scene continuation', async () => {
  const f = fixture('chatgpt'); await f.model.models(signal());
  const reasoning = { type: 'reasoning', id: 'rs_tool_done', summary: [], encrypted_content: 'opaque-tool-done-only-🌍' };
  const commentary = { ...message('Inspecting.'), phase: 'commentary' };
  const { phase: _phase, ...terminalMessage } = commentary;
  const call = { type: 'function_call', id: 'fc_done', call_id: 'call_done', namespace: 'scene', name: 'inspect_scene', arguments: '{}', status: 'completed' };
  const output = [reasoning, commentary, call];
  f.queue.push(sse(output.map((item, output_index) => event({ type: 'response.output_item.done', output_index, item })).join('') +
    complete([{ type: 'reasoning', id: reasoning.id, summary: [] }, terminalMessage, call]), 3), sse(complete()));
  const events = await turn(f);
  assert.deepEqual(events.map(e => e.kind), ['start', 'delta', 'tool', 'delta', 'done']);
  assert.deepEqual((f.requests[2].body!.input as unknown[]).slice(2), [...output,
    { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(bound.context) }]); f.model.close();
});
test('added content is discarded even without a done event: only the full terminal item enters history', async () => {
  const f = fixture(); await f.model.models(signal());
  f.queue.push(sse(event({ type: 'response.output_item.added', output_index: 0,
    item: { type: 'message', id: 'msg_fake', role: 'assistant', status: 'in_progress', phase: 'commentary', content: [], added_only: 'never-replay' } }) + complete()));
  const events = await turn(f); const conversationId = (events.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
  f.queue.push(sse(complete())); await turn(f, f.call({ conversationId }));
  assert.deepEqual((f.requests[2].body!.input as unknown[])[2], message());
  assert.ok(!JSON.stringify(f.requests[2].body).includes('never-replay')); f.model.close();
});
{
  const reasoning = { type: 'reasoning', id: 'rs_done', summary: [], encrypted_content: 'opaque' };
  const done = (item: unknown = reasoning, output_index: unknown = 0) => event({ type: 'response.output_item.done', output_index, item });
  const added = (item: unknown = reasoning, output_index = 0) => event({ type: 'response.output_item.added', output_index, item });
  const cases: { name: string; stream: string; expected?: string }[] = [
    { name: 'duplicate done', stream: done() + done() + complete([reasoning]) },
    { name: 'conflicting duplicate done', stream: done() + done({ ...reasoning, encrypted_content: 'other' }) + complete([reasoning]) },
    { name: 'duplicate added', stream: added() + added() + complete([reasoning]) },
    { name: 'added after done', stream: done() + added() + complete([reasoning]) },
    { name: 'same id at different indices', stream: done() + done(reasoning, 1) + complete([reasoning, reasoning]) },
    { name: 'added/done id conflict', stream: added() + done({ ...reasoning, id: 'rs_other' }) + complete([reasoning]) },
    { name: 'added/done type conflict', stream: added() + done({ ...message(), id: reasoning.id }) + complete([reasoning]) },
    { name: 'done index gap with empty terminal', stream: done(reasoning, 1) + complete([]) },
    { name: 'unfinished added with empty terminal', stream: done() + added(message(), 1) + complete([]) },
    { name: 'added index absent from terminal', stream: added() + complete([]) },
    { name: 'terminal missing identity', stream: done() + complete([{ type: 'reasoning', summary: [] }]) },
    { name: 'terminal wrong identity', stream: done() + complete([{ ...reasoning, id: 'rs_other' }]) },
    { name: 'terminal wrong type', stream: done() + complete([{ ...message(), id: reasoning.id }]) },
    { name: 'terminal reordered', stream: done() + done(message(), 1) + complete([message(), reasoning]) },
    { name: 'terminal duplicate ids', stream: complete([reasoning, reasoning]) },
    { name: 'terminal conflicting ciphertext', stream: done() + complete([{ ...reasoning, encrypted_content: 'different' }]) },
    { name: 'terminal conflicting phase', stream: done(message()) + complete([{ ...message(), phase: 'commentary' }]) },
    { name: 'terminal conflicting text', stream: done(message()) + complete([message('Different')]) },
    { name: 'terminal conflicting content annotations', stream: done(message()) + complete([{ ...message(), content: [{ type: 'output_text', text: 'Hello', annotations: [{ type: 'different' }] }] }]) },
    { name: 'done in_progress', stream: done({ ...message(), status: 'in_progress' }) + complete() },
    { name: 'terminal incomplete', stream: done(message()) + complete([{ ...message(), status: 'incomplete' }]) },
    { name: 'done missing id', stream: done({ type: 'reasoning', summary: [] }) + complete([reasoning]) },
    { name: 'done missing index', stream: event({ type: 'response.output_item.done', item: reasoning }) + complete([reasoning]) },
    { name: 'done missing message content', stream: done({ type: 'message', id: 'msg_fake', role: 'assistant', status: 'completed' }) + complete() },
    { name: 'done invalid message content', stream: done({ ...message(), content: [{ type: 'output_text', text: 7 }] }) + complete() },
    { name: 'done refusal conflicts with delta', stream: event({ type: 'response.output_text.delta', delta: 'Not the refusal' }) +
      done({ ...message(), content: [{ type: 'refusal', refusal: 'Cannot comply' }] }) + complete([{ ...message(), content: [{ type: 'refusal', refusal: 'Cannot comply' }] }]) },
    { name: 'done unsupported function', stream: done({ type: 'function_call', id: 'fc_fake', call_id: 'call_fake', namespace: 'scene', name: 'create_box', arguments: '{}' }) +
      complete([{ type: 'function_call', id: 'fc_fake', call_id: 'call_fake', namespace: 'scene', name: 'create_box', arguments: '{}' }]), expected: 'unsupported-tool' },
    { name: 'done coerced type', stream: done({ ...reasoning, type: ['reasoning'] }) + complete([reasoning]), expected: 'unsupported-tool' },
    { name: 'unsupported done tool', stream: done({ type: 'web_search_call', id: 'tool_fake' }) + complete([]), expected: 'unsupported-tool' },
    { name: 'done without terminal', stream: done(), expected: 'interrupted-stream' },
    { name: 'done after terminal', stream: complete([reasoning]) + done() },
    { name: 'conflicting completed tool arguments', stream: done({ type: 'function_call', id: 'fc_fake', call_id: 'call_fake', namespace: 'scene', name: 'inspect_scene', arguments: '{}' }) +
      complete([{ type: 'function_call', id: 'fc_fake', call_id: 'call_fake', namespace: 'scene', name: 'inspect_scene', arguments: '{"other":1}' }]) },
    ...[-1, 0.5, '0', null, 1024].map(index => ({ name: `invalid done index ${JSON.stringify(index)}`, stream: done(reasoning, index) + complete([reasoning]) })),
  ];
  for (const { name, stream, expected = 'provider-protocol' } of cases) test(`completed output reconciliation rejects ${name} without committing history`, async () => {
    const f = fixture(); await f.model.models(signal()); const events: ModelChatEvent[] = [];
    f.queue.push(sse(stream, 5));
    await assert.rejects(f.model.turn(f.call(), bound, async e => { events.push(e); }, signal()), code(expected));
    assert.ok(!events.some(e => e.kind === 'done' || e.kind === 'tool')); assert.equal(f.requests.length, 2);
    f.queue.push(sse(complete())); await turn(f);
    assert.equal((f.requests[2].body!.input as unknown[]).length, 2); f.model.close();
  });
}

test('read-only namespaced inspect_scene dispatch returns bound context and replays all calls/results/reasoning', async () => {
  const f = fixture('chatgpt'); await f.model.models(signal());
  const call = { type: 'function_call', id: 'fc_fake', call_id: 'call_fake', namespace: 'scene', name: 'inspect_scene', arguments: '{}' };
  const reasoning = { type: 'reasoning', encrypted_content: 'opaque', summary: [] };
  f.queue.push(sse(complete([reasoning, call])), sse(complete()));
  const events = await turn(f); const tool = events.find(e => e.kind === 'tool')!; assert.deepEqual(tool, { kind: 'tool', requestId: 'request-one', name: 'inspect_scene', context: bound.context });
  const input = f.requests[2].body!.input as unknown[];
  assert.deepEqual(input.slice(2), [reasoning, call, { type: 'function_call_output', call_id: 'call_fake', output: JSON.stringify(bound.context) }]);
  assert.equal(events.at(-1)?.kind, 'done'); f.model.close();
});
for (const bad of [
  { type: 'function_call', name: 'create_box', namespace: 'scene', call_id: 'bad', arguments: '{}' },
  { type: 'function_call', name: 'inspect_scene', namespace: 'other', call_id: 'bad', arguments: '{}' },
  { type: 'function_call', name: 'inspect_scene', call_id: 'bad', arguments: '{}' },
  { type: 'function_call', name: 'inspect_scene', namespace: 'scene', call_id: 'bad', arguments: '{"path":"/secret"}' },
  { type: 'web_search_call' },
]) test(`unsupported tool rejected without additional request: ${JSON.stringify(bad)}`, async () => {
  const f = fixture(); await f.model.models(signal()); f.queue.push(sse(complete([bad])));
  await assert.rejects(turn(f), code('unsupported-tool')); assert.equal(f.requests.length, 2); f.model.close();
});
test('bounded tool loop does not retry or exceed the executed tool budget', async () => {
  const f = fixture(); await f.model.models(signal());
  for (let i = 0; i <= L.toolCalls; i++) f.queue.push(sse(complete([{ type: 'function_call', namespace: 'scene', name: 'inspect_scene', call_id: `call_${i}`, arguments: '{}' }])));
  await assert.rejects(turn(f), code('tool-limit')); assert.equal(f.requests.length, L.toolCalls + 2); f.model.close();
});
for (const [stream, expected] of [
  [event({ type: 'response.output_text.delta', delta: 'Partial' }), 'interrupted-stream'],
  [event({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'secret provider text' } } }), 'usage-limit'],
  [event({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_unavailable' } } }), 'plan-usage-unavailable'],
  [event({ type: 'response.incomplete', response: { status: 'incomplete' } }), 'provider-incomplete'],
  [complete() + complete(), 'provider-protocol'],
  [complete() + 'data: {', 'interrupted-stream'],
  [event({ type: 'response.output_text.delta', delta: 'Not the final text' }) + complete(), 'provider-protocol'],
  [event({ type: 'response.output_text.delta', delta: 'x'.repeat(L.outputChars + 1) }), 'output-limit'],
  [`data: ${'x'.repeat(L.frameBytes)}\n\n`, 'provider-limit'],
] as const) test(`SSE rejects incomplete/failure/protocol/limit: ${expected} (${stream.length} bytes)`, async () => {
  const f = fixture(); await f.model.models(signal()); f.queue.push(sse(stream, 1024));
  await assert.rejects(turn(f), code(expected)); assert.equal(f.requests.length, 2); f.model.close();
});
test('total SSE byte cap includes ignored/comment frames', async () => {
  const f = fixture(); await f.model.models(signal());
  const comment = ': ' + 'x'.repeat(Math.min(1000, L.frameBytes - 16)) + '\n\n';
  const stream = comment.repeat(Math.floor(L.providerBytes / Buffer.byteLength(comment)) + 1);
  assert.ok(Buffer.byteLength(comment) < L.frameBytes); assert.ok(Buffer.byteLength(stream) > L.providerBytes);
  f.queue.push(sse(stream, 8192));
  const events: ModelChatEvent[] = [];
  await assert.rejects(f.model.turn(f.call(), bound, async e => { events.push(e); }, signal()), code('provider-limit'));
  assert.equal(f.requests.length, 2); assert.ok(!events.some(e => e.kind === 'done' || e.kind === 'tool' || e.kind === 'delta')); f.model.close();
});
test('completion is not published or committed until SSE EOF', async () => {
  const f = fixture(); await f.model.models(signal()); let upstream!: ReadableStreamDefaultController<Uint8Array>;
  f.queue.push(new Response(new ReadableStream({ start(c) { upstream = c; c.enqueue(new TextEncoder().encode(complete())); } }), { headers: { 'content-type': 'text/event-stream' } }));
  const events: ModelChatEvent[] = []; const pending = f.model.turn(f.call(), bound, async e => { events.push(e); }, signal());
  await tick(); assert.deepEqual(legacyKinds(events), ['start', 'delta']); upstream.close(); await pending;
  assert.equal(events.at(-1)?.kind, 'done'); f.model.close();
});
test('caller abort while credentials await prevents any delayed model request', async () => {
  const f = fixture(); await f.model.models(signal()); let resolve!: (c: ProviderCredential) => void;
  f.auth.credentialHook = () => new Promise(r => { resolve = r; }); const controller = new AbortController();
  const pending = f.model.turn(f.call(), bound, async () => {}, controller.signal); await tick(); controller.abort();
  await assert.rejects(pending); resolve({ mode: 'api-key', bearer: 'fake-late', baseUrl: 'ignored', constraints: { billing: 'api-key', responsesOnly: false } });
  await tick(); assert.equal(f.requests.length, 1); f.model.close();
});
test('logout aborts stalled upstream reads promptly and invalidates catalog/conversations', async () => {
  const f = fixture(); await f.model.models(signal()); let cancelled = false;
  f.queue.push(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(event({ type: 'response.output_text.delta', delta: 'Partial' }))); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }));
  const events: ModelChatEvent[] = []; const pending = f.model.turn(f.call(), bound, async e => { events.push(e); }, signal());
  await tick(); f.auth.logout(); await assert.rejects(pending); assert.equal(cancelled, true);
  assert.ok(!events.some(e => e.kind === 'done')); await assert.rejects(turn(f), code('model-unavailable')); f.model.close();
});
test('concurrency, model/scene/generation binding and TTL are enforced before inference', async () => {
  let now = 0; const f = fixture('api-key', () => now); await f.model.models(signal()); f.queue.push(sse(complete()));
  const events = await turn(f); const id = (events.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
  await assert.rejects(turn(f, f.call({ conversationId: id, model: 'model-two' })), code('stale-conversation'));
  await assert.rejects(turn(f, f.call({ conversationId: id, scene: { mode: 'toronto', toronto: [] } })), code('stale-conversation'));
  await assert.rejects(turn(f, f.call({ generation: 'wrong' })), code('stale-account'));
  now = L.conversationTtlMs; await assert.rejects(turn(f, f.call({ conversationId: id })), code('stale-conversation'));
  assert.equal(f.requests.length, 2); f.model.close();
});
test('conversation count and per-conversation turn count are bounded', async () => {
  const f = fixture(); await f.model.models(signal()); let id: string | null = null;
  for (let i = 0; i < L.turns; i++) { f.queue.push(sse(complete())); const events = await turn(f, f.call({ conversationId: id })); id = (events.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId; }
  await assert.rejects(turn(f, f.call({ conversationId: id })), code('history-limit'));
  for (let i = 1; i < L.conversations; i++) { f.queue.push(sse(complete())); await turn(f); }
  await assert.rejects(turn(f), code('history-limit')); f.model.close();
});
test('partial failed continuation does not enter server-owned replay', async () => {
  const f = fixture(); await f.model.models(signal()); f.queue.push(sse(complete()));
  const events = await turn(f); const id = (events.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
  f.queue.push(sse(event({ type: 'response.output_text.delta', delta: 'Partial never replayed' })));
  await assert.rejects(turn(f, f.call({ conversationId: id, text: 'Failed user text' })));
  f.queue.push(sse(complete())); await turn(f, f.call({ conversationId: id, text: 'Actual retry' }));
  const input = JSON.stringify(f.requests.at(-1)?.body?.input); assert.ok(!input.includes('Failed user text')); assert.ok(!input.includes('Partial never replayed')); f.model.close();
});
for (const doneOnly of [true, false]) test(`${doneOnly ? 'done-only encrypted reasoning' : 'full replay'} history bytes bounded before further inference/publication`, async () => {
  const f = fixture(doneOnly ? 'chatgpt' : 'api-key'); await f.model.models(signal()); let conversationId: string | null = null;
  const payloadBytes = L.frameBytes - 4096;
  const turns = Math.floor(L.historyBytes / payloadBytes) + 1;
  assert.ok(turns < L.turns, 'Exercise byte budget, not turn budget');
  for (let i = 0; i < turns; i++) {
    const last = i === turns - 1;
    f.queue.push(() => {
      const input = f.requests.at(-1)!.body!.input as unknown[];
      const reasoning = { type: 'reasoning', id: `rs_history_${i}`, summary: [], encrypted_content: '' };
      const baseBytes = Buffer.byteLength(JSON.stringify([...input, reasoning, message('')]));
      const padding = last ? L.historyBytes + 1 - baseBytes : payloadBytes;
      assert.ok(padding > 0 && padding <= payloadBytes);
      reasoning.encrypted_content = 'e'.repeat(padding);
      const projectedBytes = Buffer.byteLength(JSON.stringify([...input, reasoning, message('')]));
      if (last) assert.equal(projectedBytes, L.historyBytes + 1);
      else assert.ok(projectedBytes <= L.historyBytes);
      const frames = doneOnly ? [event({ type: 'response.output_item.done', output_index: 0, item: reasoning }),
        complete([{ type: 'reasoning', id: reasoning.id, summary: [] }, message('')])] : [complete([reasoning, message('')])];
      assert.ok(frames.every(frame => Buffer.byteLength(frame) < L.frameBytes));
      return sse(frames.join(''), 16384);
    });
    const events: ModelChatEvent[] = [];
    const pending = f.model.turn(f.call({ conversationId }), bound, async e => { events.push(e); }, signal());
    if (last) {
      await assert.rejects(pending, code('history-limit'));
      assert.ok(!events.some(e => e.kind === 'done' || e.kind === 'tool' || e.kind === 'delta'));
    } else {
      await pending;
      assert.equal(events.at(-1)?.kind, 'done');
      conversationId = (events.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
    }
    assert.equal(f.requests.length, i + 2, 'No retry or further inference');
  }
  f.queue.push(sse(complete())); await turn(f, f.call({ conversationId }));
  assert.ok(!JSON.stringify(f.requests.at(-1)!.body!.input).includes(`rs_history_${turns - 1}`), 'Rejected output was not committed');
  f.model.close();
});
test('done-item reconciliation retains terminal-only raw fields while matching canonical shared fields', async () => {
  const f = fixture(); await f.model.models(signal());
  const reasoning = { type: 'reasoning', id: 'rs_raw', summary: [{ type: 'summary_text', text: 'Summary' }], encrypted_content: 'opaque-done-only' };
  const terminal = { type: 'reasoning', id: reasoning.id, summary: [{ text: 'Summary', type: 'summary_text' }], status: 'completed' };
  f.queue.push(sse(event({ type: 'response.output_item.done', output_index: 0, item: reasoning }) + complete([terminal, message()])));
  const events = await turn(f); const conversationId = (events.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
  f.queue.push(sse(complete())); await turn(f, f.call({ conversationId }));
  assert.deepEqual((f.requests[2].body!.input as unknown[])[2], { ...terminal, ...reasoning }); f.model.close();
});
test('done-item visible content cannot bypass output limits when no deltas were streamed', async () => {
  const f = fixture(); await f.model.models(signal()); const output = message('x'.repeat(L.outputChars + 1));
  f.queue.push(sse(event({ type: 'response.output_item.done', output_index: 0, item: output }) + complete([output]), 8192));
  await assert.rejects(turn(f), code('output-limit')); f.model.close();
});

test('official structured plan errors preserve safe recovery category for HTTP and SSE without provider text', async () => {
  for (const [provider, expected] of [
    ['subscription_sharing_user_not_eligible', 'plan-user-not-eligible'], ['subscription_sharing_unsupported_capability', 'unsupported-capability'],
    ['subscription_sharing_route_not_supported', 'unsupported-route'], ['subscription_sharing_invalid_user', 'reauthorize'],
    ['chatpass_v2_scope_not_authorized', 'plan-permission-required'],
  ]) {
    const auth = new FakeAuth('chatgpt');
    const model = new ProviderModel(auth, async () => Response.json({ error: { code: provider, message: 'private provider diagnostics', param: 'private' } }, { status: 403 }));
    const catalog = await model.models(signal()); assert.equal(catalog.code, expected); assert.ok(!JSON.stringify(catalog).includes('private')); model.close();
  }
  const f = fixture('chatgpt'); await f.model.models(signal()); f.queue.push(sse(event({ type: 'error', code: 'subscription_sharing_usage_limit_exceeded', message: 'private' })));
  await assert.rejects(turn(f), code('usage-limit')); f.model.close();
});
for (const mode of ['api-key', 'chatgpt'] as const) test(`${mode}: mixed text/refusal deltas stream before EOF and replay complete items`, async t => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const f = fixture(mode); await f.model.models(signal());
  const commentary = { ...message('Checking. '), id: 'msg_commentary', phase: 'commentary' };
  const refusal = { ...message(), id: 'msg_refusal', content: [{ type: 'refusal', refusal: 'Cannot comply.' }] };
  const output = [commentary, refusal];
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  f.queue.push(new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c; } }), { headers: { 'content-type': 'text/event-stream' } }));
  const events: ModelChatEvent[] = [];
  const pending = f.model.turn(f.call(), bound, async e => { events.push(e); }, signal());
  const text = event({ type: 'response.output_text.delta', delta: 'Checking. ' }) +
    event({ type: 'response.refusal.delta', delta: 'Cannot ' }) + event({ type: 'response.refusal.delta', delta: 'comply.' }) +
    output.map((item, output_index) => event({ type: 'response.output_item.done', output_index, item })).join('') + complete(output);
  // Split inside JSON/UTF-8 boundaries, and keep EOF withheld after provider completion.
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
  await tick();
  assert.equal(events.filter(e => e.kind === 'delta').map(e => e.text).join(''), 'Checking. Cannot comply.');
  assert.ok(!events.some(e => e.kind === 'done'));
  controller.close(); await pending;
  assert.equal(events.at(-1)?.kind, 'done');
  const conversationId = (events.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
  f.queue.push(sse(complete())); await turn(f, f.call({ conversationId }));
  assert.deepEqual((f.requests[2].body!.input as unknown[]).slice(2, 4), output);
  assert.equal(warnings.mock.calls.length, 0); f.model.close();
});

for (const mode of ['api-key', 'chatgpt'] as const) test(`${mode}: fixed parser diagnostics locate rejection without leaking provider data`, async t => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const secret = 'PRIVATE-prompt-response-ciphertext-token-header-error';
  const reasoning = { type: 'reasoning', id: secret, summary: [], encrypted_content: secret };
  const item = (value: unknown, index: unknown = 0) => event({ type: 'response.output_item.done', output_index: index, item: value });
  const cases: [string, () => Response, string?][] = [
    ['content-type', () => new Response(secret, { headers: { 'content-type': `text/plain; private=${secret}` } }), 'provider-format-text'],
    ['body', () => new Response(null, { headers: { 'content-type': 'text/event-stream' } })],
    ['event-json', () => sse(`data: {"${secret}":\n\n`)],
    ['delta-shape', () => sse(event({ type: 'response.refusal.delta', delta: { [secret]: secret } }))],
    ['item-index', () => sse(item(reasoning, secret))],
    ['item-json', () => sse(item({ ...reasoning, ...Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`key${i}`, secret])) })), 'copy-error'],
    ['frame-limit', () => sse(`data: ${secret}${'s'.repeat(L.frameBytes)}\n\n`, 16384), 'provider-limit'],
    ['item-shape', () => sse(item([secret]))],
    ['item-type', () => sse(item({ type: secret })), 'unsupported-tool'],
    ['item-id', () => sse(item({ ...reasoning, id: `${secret}\n` }))],
    ['item-status', () => sse(item({ ...reasoning, status: secret }))],
    ['message-shape', () => sse(item({ ...message(), role: secret }))],
    ['content-shape', () => sse(item({ ...message(), content: [{ type: secret, text: secret }] }))],
    ['identity-missing', () => sse(item({ type: 'reasoning', encrypted_content: secret }))],
    ['identity-index', () => sse(item(reasoning) + item(reasoning, 1))],
    ['identity-conflict', () => sse(event({ type: 'response.output_item.added', output_index: 0, item: reasoning }) + item({ ...reasoning, id: 'other' }))],
    ['item-duplicate', () => sse(item(reasoning) + item(reasoning))],
    ['terminal-shape', () => sse(event({ type: 'response.completed', response: { status: secret } }))],
    ['terminal-json', () => sse(complete(Array(1025).fill(null))), 'copy-error'],
    ['terminal-index', () => sse(item(reasoning, 1) + complete([]))],
    ['terminal-missing-id', () => sse(item(reasoning) + complete([{ type: 'reasoning', encrypted_content: secret }]))],
    ['snapshot-conflict', () => sse(item({ ...reasoning, [secret]: secret }) + complete([{ ...reasoning, [secret]: 'different' }]))],
    ['visible-output', () => sse(event({ type: 'response.output_text.delta', delta: secret }) + complete([message('different')]))],
    ['after-completion', () => sse(complete([message(secret)]) + event({ type: secret, secret }))],
    ['done-marker', () => sse('data: [DONE]\n\n')],
    ['stream-ending', () => sse(event({ type: 'private-ignored', [secret]: secret })), 'interrupted-stream'],
    ['provider-terminal-error', () => sse(event({ type: 'error', code: secret, message: secret })), 'provider-failed'],
  ];
  for (const [check, response, expected = 'provider-protocol'] of cases) {
    const f = fixture(mode); await f.model.models(signal());
    const r = response(); r.headers.set('x-request-id', secret); r.headers.set('authorization', `Bearer ${secret}`);
    f.queue.push(r); const events: ModelChatEvent[] = []; const before = warnings.mock.calls.length;
    await assert.rejects(f.model.turn(f.call(), bound, async e => { events.push(e); }, signal()),
      expected === 'copy-error' ? e => e instanceof TypeError : code(expected), check);
    assert.deepEqual(warnings.mock.calls.slice(before).map(c => c.arguments), [[
      `[model-provider] ${JSON.stringify({ operation: 'responses', check, httpStatus: 200, ...(check === 'content-type' ? { responseFormat: 'text' } : {}) })}`,
    ]]);
    assert.equal(f.requests.length, 2); assert.ok(!events.some(e => e.kind === 'done' || e.kind === 'tool'));
    f.queue.push(sse(complete())); await turn(f);
    assert.equal((f.requests[2].body!.input as unknown[]).length, 2); f.model.close();
  }
  assert.ok(!JSON.stringify(warnings.mock.calls).includes(secret));
});

for (const mode of ['api-key', 'chatgpt'] as const) test(`${mode}: non-SSE headers have closed format codes, bounded inspection, no retry or failed replay`, async t => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const secret = 'PRIVATE-provider-body-header-token';
  const cases: [string | undefined, string][] = [
    ['application/json', 'json'], [`Application/JSON; private=${secret}`, 'json'],
    ['text/html; charset=utf-8', 'html'], ['text/plain', 'text'],
    [`application/${secret}`, 'other'], ['application/problem+json', 'other'],
    ['application/json-seq', 'other'], ['text/event-stream-malformed', 'other'], ['text/event-stream , application/json', 'other'],
  ];
  for (const [contentType, format] of cases) {
    const f = fixture(mode); await f.model.models(signal()); f.queue.push(sse(complete()));
    const initial = await turn(f);
    const conversationId = (initial.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
    const priorInput = f.requests[1].body!.input as unknown[];
    let pulls = 0, cancelled = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { pulls++; c.enqueue(new TextEncoder().encode(secret)); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
    const response = new Response(body, { headers: contentType === undefined ? {} : { 'content-type': contentType } });
    response.headers.set('x-request-id', secret); f.queue.push(response);
    const events: ModelChatEvent[] = [], before = warnings.mock.calls.length;
    await assert.rejects(f.model.turn(f.call({ conversationId, text: secret }), bound, async e => { events.push(e); }, signal()), code(`provider-format-${format}`));
    assert.equal(pulls, 16); assert.equal(cancelled, 1); assert.equal(f.requests.length, 3);
    assert.deepEqual(legacyKinds(events), ['start']);
    assert.deepEqual(warnings.mock.calls.slice(before).map(c => c.arguments), [[
      `[model-provider] ${JSON.stringify({ operation: 'responses', check: 'content-type', httpStatus: 200, responseFormat: format })}`,
    ]]);
    f.queue.push(sse(complete())); await turn(f, f.call({ conversationId, text: 'Explicit subsequent send' }));
    const replay = f.requests[3].body!.input as unknown[];
    assert.deepEqual(replay.slice(0, priorInput.length), priorInput);
    assert.equal(JSON.stringify(replay).includes(secret), false); f.model.close();
  }
  assert.equal(JSON.stringify(warnings.mock.calls).includes(secret), false);
});

test('unexpected-format diagnostic sink failure preserves specific code and does not retry', async t => {
  t.mock.method(console, 'warn', () => { throw new Error('private log failure'); });
  const f = fixture(); await f.model.models(signal()); f.queue.push(Response.json({ private: 'not exposed' }));
  await assert.rejects(turn(f), code('provider-format-json')); assert.equal(f.requests.length, 2); f.model.close();
});

for (const mode of ['api-key', 'chatgpt'] as const) test(`${mode}: missing or empty MIME still requires valid SSE completion and EOF`, async () => {
  for (const header of [undefined, '', '   ']) {
    const f = fixture(mode); await f.model.models(signal());
    const response = sse(event({ type: 'response.output_text.delta', delta: 'Hello' }) + complete());
    if (header === undefined) response.headers.delete('content-type'); else response.headers.set('content-type', header);
    f.queue.push(response);
    const events = await turn(f);
    assert.deepEqual(events.map(e => e.kind), ['start', 'delta', 'done']);
    const conversationId = (events.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
    f.queue.push(sse(complete())); await turn(f, f.call({ conversationId, text: 'Continue' }));
    assert.deepEqual((f.requests[2].body!.input as unknown[])[2], message());
    assert.equal(f.requests.length, 3); f.model.close();
  }
});

for (const mode of ['api-key', 'chatgpt'] as const) test(`${mode}: missing MIME never accepts JSON, appearance alone, bad identity or failed streams`, async t => {
  t.mock.method(console, 'warn', () => {});
  const bad = [
    JSON.stringify({ output: [message()], status: 'completed' }), '<html>not SSE</html>',
    'data: not-json\n\n', event({ type: 'response.created' }),
    complete().trimEnd(), complete() + event({ type: 'response.created' }),
    event({ type: 'response.failed', response: { error: { code: 'private' } } }),
    event({ type: 'response.incomplete', response: {} }),
    event({ type: 'response.output_item.done', output_index: 0, item: message() }) + complete([{ ...message(), id: 'conflict' }]),
    event({ type: 'response.output_text.delta', delta: 'Not terminal text' }) + complete(),
    'x'.repeat(L.frameBytes + 1),
  ];
  for (const text of bad) {
    const f = fixture(mode); await f.model.models(signal()); f.queue.push(sse(complete()));
    const initial = await turn(f), conversationId = (initial.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
    const response = sse(text, 16384); response.headers.delete('content-type'); f.queue.push(response);
    const events: ModelChatEvent[] = [];
    await assert.rejects(f.model.turn(f.call({ conversationId, text: 'Failed turn must not be retained' }), bound, async e => { events.push(e); }, signal()));
    assert.equal(events.some(e => e.kind === 'done' || e.kind === 'tool'), false);
    assert.equal(f.requests.length, 3);
    f.queue.push(sse(complete())); await turn(f, f.call({ conversationId, text: 'Explicit retry' }));
    assert.equal(JSON.stringify(f.requests[3].body!.input).includes('Failed turn must not be retained'), false);
    f.model.close();
  }
  const f = fixture(mode); await f.model.models(signal());
  f.queue.push(new Response(new Uint8Array([255]))); await assert.rejects(turn(f));
  assert.equal(f.requests.length, 2); f.model.close();
});

for (const mode of ['api-key', 'chatgpt'] as const) test(`${mode}: empty terminal array retains only finalized contiguous items and opaque history`, async () => {
  const f = fixture(mode); await f.model.models(signal());
  const reasoning = { type: 'reasoning', id: 'rs_empty', encrypted_content: 'opaque-private-reasoning', summary: [] };
  const final = { ...message('No.'), content: [{ type: 'refusal', refusal: 'No.' }] };
  const output = [reasoning, final];
  const body = sse(event({ type: 'response.refusal.delta', delta: 'No.' }) + output.map((item, output_index) =>
    event({ type: 'response.output_item.added', output_index, item: { type: item.type, id: item.id } }) +
    event({ type: 'response.output_item.done', output_index, item })).join('') + complete([]), 3);
  body.headers.delete('content-type'); f.queue.push(body);
  const events = await turn(f); assert.deepEqual(events.map(e => e.kind), ['start', 'delta', 'done']);
  const conversationId = (events.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>).conversationId;
  f.queue.push(sse(complete())); await turn(f, f.call({ conversationId }));
  assert.deepEqual((f.requests[2].body!.input as unknown[]).slice(2, 4), output); f.model.close();
});

test('empty terminal tool snapshots wait for EOF before dispatch and retain complete call metadata', async () => {
  const f = fixture('chatgpt'); await f.model.models(signal()); let upstream!: ReadableStreamDefaultController<Uint8Array>;
  const tool = { type: 'function_call', id: 'fc_empty', call_id: 'call_empty', namespace: 'scene', name: 'inspect_scene', arguments: '{}', status: 'completed' };
  f.queue.push(new Response(new ReadableStream({ start(c) { upstream = c; c.enqueue(new TextEncoder().encode(
    event({ type: 'response.output_item.done', output_index: 0, item: tool }) + complete([]))); } })), sse(complete()));
  const events: ModelChatEvent[] = [];
  const pending = f.model.turn(f.call(), bound, async e => { events.push(e); }, signal());
  await tick(); assert.equal(f.requests.length, 2); assert.equal(events.some(e => e.kind === 'tool' || e.kind === 'done'), false);
  upstream.close(); await pending;
  assert.deepEqual(legacyKinds(events), ['start', 'tool', 'delta', 'done']);
  assert.deepEqual((f.requests[2].body!.input as unknown[])[2], tool); f.model.close();
});

test('missing MIME completion without EOF remains pending until cancellation and never commits', async () => {
  const f = fixture(); await f.model.models(signal()); let cancelled = false;
  f.queue.push(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(complete())); }, cancel() { cancelled = true; } })));
  const controller = new AbortController(), events: ModelChatEvent[] = [];
  const pending = f.model.turn(f.call(), bound, async e => { events.push(e); }, controller.signal);
  const rejected = assert.rejects(pending); await tick();
  assert.equal(events.some(e => e.kind === 'done'), false);
  controller.abort(); await rejected; assert.equal(cancelled, true);
  assert.equal(f.requests.length, 2);
  f.queue.push(sse(complete())); await turn(f);
  assert.equal((f.requests[2].body!.input as unknown[]).length, 2); f.model.close();
});

test('documented event stream media type with parameters and case variation still completes', async () => {
  const f = fixture(); await f.model.models(signal()); const r = sse(complete());
  r.headers.set('content-type', 'Text/Event-Stream;charset=utf-8'); f.queue.push(r);
  assert.equal((await turn(f)).at(-1)?.kind, 'done'); f.model.close();
});

test('refusal deltas obey the same combined output budget and terminal equality as text', async t => {
  const warnings = t.mock.method(console, 'warn', () => {});
  for (const [stream, expected, check] of [
    [event({ type: 'response.refusal.delta', delta: 'wrong' }) + complete([{ ...message(), content: [{ type: 'refusal', refusal: 'different' }] }]), 'provider-protocol', 'visible-output'],
    [event({ type: 'response.output_text.delta', delta: 'x' }) + event({ type: 'response.refusal.delta', delta: 'r'.repeat(L.outputChars) }), 'output-limit', 'delta-limit'],
  ]) {
    const f = fixture(); await f.model.models(signal()); f.queue.push(sse(stream, 16384));
    await assert.rejects(turn(f), code(expected));
    assert.equal(warnings.mock.calls.at(-1)?.arguments[0], `[model-provider] ${JSON.stringify({ operation: 'responses', check, httpStatus: 200 })}`);
    assert.equal(f.requests.length, 2); f.model.close();
  }
});

test('diagnostic sink failure cannot mask parser error, retry, or complete history', async t => {
  t.mock.method(console, 'warn', () => { throw new Error('private logger failure'); });
  const f = fixture(); await f.model.models(signal()); f.queue.push(sse('data: not-json\n\n'));
  await assert.rejects(turn(f), code('provider-protocol')); assert.equal(f.requests.length, 2);
  f.queue.push(sse(complete())); await turn(f); assert.equal((f.requests[2].body!.input as unknown[]).length, 2); f.model.close();
});

test('unavailable/mismatched mode catalog and transport errors are sanitized without paid fallback/retry', async () => {
  const auth = new FakeAuth('chatgpt'); let calls = 0;
  const model = new ProviderModel(auth, async () => { calls++; return Response.json({ data: [{ id: 'paid-only' }] }); });
  assert.equal((await model.models(signal())).code, 'provider-protocol'); assert.equal(calls, 1); model.close();
  const auth2 = new FakeAuth(); const model2 = new ProviderModel(auth2, async () => { throw new Error('Bearer secret provider failure'); });
  assert.equal(JSON.stringify(await model2.models(signal())).includes('secret'), false); model2.close();
});
