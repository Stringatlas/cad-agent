import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_CHAT_LIMITS } from '../packages/contracts/src/index';
import type { ModelCatalog, ModelScene, ModelTurnRequest } from '../packages/contracts/src/index';
import { MODEL_CLIENT_LIMITS, ModelChatController, streamModelTurn } from '../apps/web/src/model-chat-client';

const scene: ModelScene = { mode: 'toronto', project: null, toronto: [] };
const catalog: ModelCatalog = { mode: 'chatgpt', ready: true, generation: 'exploration-account', code: 'ready', models: [{ id: 'fixture-model', label: 'Fixture' }] };
const request: ModelTurnRequest = { requestId: 'exploration-request', conversationId: null, generation: catalog.generation, model: 'fixture-model', text: 'Explore and inspect alternatives.', scene };
const line = (event: unknown) => `${JSON.stringify(event)}\n`;
const start = (r: ModelTurnRequest) => ({ kind: 'start', requestId: r.requestId, conversationId: r.conversationId ?? 'exploration-conversation', model: r.model });
const done = (r: ModelTurnRequest) => ({ kind: 'done', requestId: r.requestId, conversationId: r.conversationId ?? 'exploration-conversation' });
const tool = (r: ModelTurnRequest, iteration: number) => ({ kind: 'tool', requestId: r.requestId, name: 'inspect_scene', context: { iteration, status: 'observed' } });
const response = (events: unknown[]) => new Response(events.map(line).join(''), { headers: { 'Content-Type': 'application/x-ndjson' } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('exploration client consumes the complete shared scene-tool budget and rejects the next action', async () => {
  assert.equal(MODEL_CLIENT_LIMITS.maxTools, MODEL_CHAT_LIMITS.toolCalls);
  let received = 0;
  const observations = Array.from({ length: MODEL_CHAT_LIMITS.toolCalls }, (_, i) => tool(request, i));
  assert.equal(await streamModelTurn(request, new AbortController().signal, event => { if (event.kind === 'tool') received++; },
    async () => response([start(request), ...observations, done(request)])), 'exploration-conversation');
  assert.equal(received, MODEL_CHAT_LIMITS.toolCalls);
  await assert.rejects(streamModelTurn(request, new AbortController().signal, () => {},
    async () => response([start(request), ...observations, tool(request, observations.length), done(request)])), /Tool budget/);
});

test('cancelling sustained exploration releases the stream and starts a fresh explicit turn without replay', async () => {
  const requests: ModelTurnRequest[] = [];
  let body!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const fetcher: typeof fetch = async (path, init) => {
    if (path === '/chat/models') return new Response(JSON.stringify(catalog));
    const r = JSON.parse(init!.body as string) as ModelTurnRequest;
    requests.push(r);
    if (requests.length !== 2) return response([start(r), done(r)]);
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      body = controller;
      controller.enqueue(new TextEncoder().encode([start(r),
        ...Array.from({ length: MODEL_CHAT_LIMITS.toolCalls - 1 }, (_, i) => tool(r, i)),
        { kind: 'delta', requestId: r.requestId, text: 'Partial exploration, not a final assessment.' }].map(line).join('')));
    }, cancel() { cancelled = true; } });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
  };
  const client = new ModelChatController(() => {}, fetcher);
  try {
    client.bind(scene); await client.refreshModels();
    await client.send('Establish initial context.');
    const exploring = client.send('Explore alternatives.');
    for (let i = 0; i < 100 && client.view.messages.at(-1)?.tools.length !== MODEL_CHAT_LIMITS.toolCalls - 1; i++) await tick();
    assert.equal(client.view.phase, 'streaming');
    assert.equal(client.view.messages.at(-1)?.tools.length, MODEL_CHAT_LIMITS.toolCalls - 1);
    assert.equal(requests[1]?.conversationId, 'exploration-conversation');
    client.cancel(); await exploring;
    assert.equal(cancelled, true);
    assert.equal(client.view.phase, 'cancelled');
    assert.equal(client.view.messages.at(-1)?.state, 'incomplete');
    assert.equal(client.view.continuationActive, false);
    assert.throws(() => body.enqueue(new TextEncoder().encode(line(done(requests[1]!)))));
    assert.equal(await client.send('Restart explicitly from the current scene.'), true);
    assert.equal(requests.length, 3);
    assert.equal(requests[2]?.conversationId, null);
    assert.equal(requests[2]?.text, 'Restart explicitly from the current scene.');
    assert.equal('history' in requests[2]!, false);
    assert.equal(client.view.phase, 'completed');
    assert.equal(client.view.messages[3]?.state, 'incomplete');
  } finally { client.dispose(); }
});

test('confirmed failed exploration clears streamed revisions before explicit retry restores the committed checkpoint', async () => {
  const { canonicalSceneMarkSnapshot } = await import('@spatial/contracts');
  const checkpoint = canonicalSceneMarkSnapshot({ kind: 'scene-marks', annotationRevision: 1,
    binding: { artifactRevision: 'a'.repeat(64), frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0] },
    marks: [{ id: 'checkpoint', rank: 1, position: [1, 2, 3], rationale: 'Initial hypothesis.', uncertainty: 'Unverified.' }] });
  const streamed = canonicalSceneMarkSnapshot({ ...checkpoint, annotationRevision: 2,
    marks: [{ ...checkpoint.marks[0]!, position: [4, 5, 6] }] });
  const requests: ModelTurnRequest[] = [], revisions: (number | undefined)[] = [];
  let visible: typeof checkpoint | undefined;
  const fetcher: typeof fetch = async (path, init) => {
    if (path === '/chat/models') return Response.json(catalog);
    const r = JSON.parse(String(init?.body)) as ModelTurnRequest; requests.push(r);
    const marks = (name: 'get_scene_marks' | 'set_scene_marks', context: typeof checkpoint) => ({ kind: 'tool', requestId: r.requestId, name, context });
    if (requests.length === 1) return response([start(r), marks('set_scene_marks', checkpoint), done(r)]);
    if (requests.length === 2) return response([start(r), marks('set_scene_marks', streamed), { kind: 'error', requestId: r.requestId, code: 'tool-limit' }]);
    assert.equal(visible, undefined, 'Failed-turn revision must be removed before any retry event');
    return response([start(r), marks('get_scene_marks', checkpoint), done(r)]);
  };
  const client = new ModelChatController(() => {}, fetcher, undefined, undefined, { onscenemarks(value) {
    const next = value === undefined ? undefined : canonicalSceneMarkSnapshot(value);
    if (next && visible) assert.ok(next.annotationRevision >= visible.annotationRevision, 'A stale streamed revision must not block rollback to the committed checkpoint');
    visible = next; revisions.push(next?.annotationRevision);
  } });
  try {
    client.bind(scene); await client.refreshModels(); revisions.length = 0;
    await client.send('Establish hypotheses.'); assert.deepEqual(visible, checkpoint);
    await client.send('Explore further.');
    assert.equal(client.view.phase, 'error'); assert.equal(client.view.code, 'tool-limit');
    assert.equal(client.view.continuationActive, true); assert.equal(visible, undefined);
    assert.equal(client.view.messages.at(-1)?.state, 'incomplete');
    await client.send('Retry explicitly from retained hypotheses.');
    assert.equal(client.view.phase, 'completed'); assert.deepEqual(visible, checkpoint);
    assert.deepEqual(revisions, [1, 2, undefined, 1]);
    assert.equal(requests[2]!.conversationId, requests[1]!.conversationId);
    assert.equal(requests[2]!.conversationId, 'exploration-conversation');
    assert.equal('history' in requests[2]!, false);
  } finally { client.dispose(); }
});
