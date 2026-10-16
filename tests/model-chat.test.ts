import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate as tick } from 'node:timers/promises';
import { MODEL_CHAT_LIMITS as L, TORONTO_SEMANTIC_LABELS, canonicalModelTurnRequest, canonicalModelScene, canonicalModelCatalog, canonicalModelChatEvent,
  type ModelTurnRequest, type ModelChatEvent, type ModelCatalog, type ModelScene } from '@spatial/contracts';
import { createDemoServer } from '../apps/server/src/index';
import { ProjectSession } from '../apps/server/src/project-session';
import { ProviderAuth } from '../apps/server/src/provider-auth';
import { createModelChatRoutes } from '../apps/server/src/model-chat-routes';
import { bindModelScene } from '../apps/server/src/model-scene';
import { PotreeDataset } from '../apps/server/src/potree';

const freshSignal = () => new AbortController().signal;
async function listen(server: Server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`; }
async function close(server: Server) { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
const call = (generation = 'generation'): ModelTurnRequest => ({ requestId: 'request-one', conversationId: null, generation, model: 'model-one', text: 'Inspect these points', scene: { mode: 'demo', project: null, toronto: [] } });
const encoder = new TextEncoder();
const completed = (text = 'Scene inspected') => `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }] } })}\n\n`;
const response = (text = 'Scene inspected') => new Response(completed(text), { headers: { 'content-type': 'text/event-stream' } });
async function fixture(t: { after(fn: () => unknown): void }, transport?: typeof fetch) {
  const root = await mkdtemp(join(tmpdir(), 'spatial-model-http-'));
  const requests: Record<string, unknown>[] = [];
  const server = createDemoServer({ projectPath: join(root, 'project.json'), datasetRoot: join(root, 'absent-dataset'), provider: { mode: 'api-key', apiKey: 'fake-fixture-key' }, modelTransport: transport ?? (async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'model-one' }] });
    requests.push(JSON.parse(String(init?.body))); return response();
  }) });
  const base = await listen(server); t.after(async () => { await close(server); await rm(root, { recursive: true, force: true }); });
  const catalog: ModelCatalog = await (await fetch(base + '/chat/models')).json();
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(base + '/chat/turn', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { root, server, base, catalog, requests, post };
}
async function events(response: Response): Promise<ModelChatEvent[]> { assert.equal(response.status, 200); assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/u); return (await response.text()).trim().split('\n').map(line => canonicalModelChatEvent(JSON.parse(line))); }

test('HTTP route propagates closed format errors through canonical frames without provider details or retry', async t => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const secret = 'PRIVATE-format-header-body'; let calls = 0, format = 'json';
  const types: Record<string, string | undefined> = { json: 'application/json', html: 'text/html', text: 'text/plain', missing: undefined, other: `application/${secret}` };
  const f = await fixture(t, async url => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'model-one' }] });
    calls++; const contentType = types[format];
    return new Response(new TextEncoder().encode(secret), { headers: contentType === undefined ? {} : { 'content-type': contentType } });
  });
  for (format of Object.keys(types)) {
    const result = await events(await f.post(call(f.catalog.generation)));
    assert.deepEqual(result.map(e => e.kind), ['start', 'error']);
    assert.deepEqual(result.at(-1), { kind: 'error', requestId: 'request-one', code: `provider-format-${format}` });
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  assert.equal(calls, 5); assert.equal(warnings.mock.calls.length, 5);
  assert.equal(JSON.stringify(warnings.mock.calls).includes(secret), false);
});

test('canonical contract rejects extra fields/client history, frame mixing, duplicate names, wrong units and bounds', () => {
  assert.deepEqual(canonicalModelTurnRequest(call()), call());
  const point = { name: 'A', datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), key: { sourceFileId: 1, sourceRow: 0 }, position: [0, 0, 120], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] };
  for (const value of [{ ...call(), history: [] }, { ...call(), model: 'model?key=secret' }, { ...call(), text: 'x'.repeat(L.textChars + 1) }, { ...call(), text: ' ' }, { ...call(), generation: '' }]) assert.throws(() => canonicalModelTurnRequest(value));
  const scene = { mode: 'toronto', project: null, toronto: [point] };
  assert.deepEqual(canonicalModelScene(scene), scene);
  for (const value of [{ ...scene, mode: 'demo' }, { ...scene, toronto: [point, point] }, { ...scene, toronto: [{ ...point, units: 'mm' }] },
    { ...scene, toronto: [{ ...point, key: { sourceFileId: 5, sourceRow: 0 } }] }, { ...scene, toronto: [{ ...point, position: [Infinity, 0, 0] }] },
    { ...scene, toronto: [{ ...point, artifactRevision: 'wrong' }] }]) assert.throws(() => canonicalModelScene(value));
  assert.throws(() => canonicalModelCatalog({ mode: 'api-key', ready: false, code: 'failed', generation: 'opaque', models: [{ id: 'm', label: 'M' }] }));
  assert.throws(() => canonicalModelChatEvent({ kind: 'delta', requestId: 'r', text: 'x', bearer: 'secret' }));
  assert.throws(() => canonicalModelChatEvent({ kind: 'shell', requestId: 'r' }));
});
test('scene and catalog discriminants require strings without coercion', () => {
  for (const mode of [[], ['demo'], ['toronto'], ['pole'], ['disabled'], ['api-key'], ['chatgpt'], {},
    { toString: () => 'demo' }, { toString: () => 'disabled' }, new String('demo'), new String('disabled'), 0, 1, null, undefined]) {
    const scene = { mode, project: null, toronto: [] };
    assert.throws(() => canonicalModelScene(scene), TypeError);
    assert.throws(() => canonicalModelTurnRequest({ ...call(), scene }), TypeError);
    assert.throws(() => canonicalModelCatalog({ mode, ready: false, code: 'disabled', generation: 'opaque', models: [] }), TypeError);
  }
  for (const mode of ['demo', 'toronto', 'pole']) assert.equal(canonicalModelScene({ mode, project: null, toronto: [] }).mode, mode);
  for (const mode of ['disabled', 'api-key', 'chatgpt']) assert.equal(canonicalModelCatalog({ mode, ready: false, code: 'unavailable', generation: 'opaque', models: [] }).mode, mode);
  for (const models of [[], [{ id: 'model-one', label: 'Model' }]]) assert.throws(() => canonicalModelCatalog({ mode: 'disabled', ready: true, code: 'ready', generation: 'opaque', models }), TypeError);
});
test('non-demo empty authoritative revision bindings are retained, hidden selections and pole Toronto refs are rejected', () => {
  const project = { sessionId: 'session', projectRevision: 3, frameId: 'demo-local-v1', units: 'm', entityIds: [], points: [] };
  for (const mode of ['toronto', 'pole']) {
    assert.deepEqual(canonicalModelScene({ mode, project, toronto: [] }), { mode, project, toronto: [] });
    for (const hidden of [{ ...project, entityIds: ['proposal-box'] }, { ...project, points: [{ name: 'A', entityId: 'cloud', pointIndex: 0, position: [0, 0, 0] }] }]) {
      assert.throws(() => canonicalModelScene({ mode, project: hidden, toronto: [] }), TypeError);
    }
  }
  const point = { name: 'A', datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), key: { sourceFileId: 1, sourceRow: 0 }, position: [0, 0, 120], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] };
  assert.throws(() => canonicalModelScene({ mode: 'pole', project, toronto: [point] }), TypeError);
});
test('HTTP rejects coercible scene modes before provider inference', async t => {
  const f = await fixture(t);
  for (const mode of [['demo'], { mode: 'demo' }, 0, null]) {
    assert.equal((await f.post({ ...call(f.catalog.generation), scene: { mode, project: null, toronto: [] } })).status, 400);
  }
  assert.equal(f.requests.length, 0);
});

test('factory model routes preserve existing project API, server-only history and NDJSON terminal framing', async t => {
  const f = await fixture(t); const before = await (await fetch(f.base + '/project/session')).json();
  const result = await events(await f.post(call(f.catalog.generation)));
  assert.deepEqual(result.map(e => e.kind), ['start', 'delta', 'done']);
  const done = result.at(-1) as Extract<ModelChatEvent, { kind: 'done' }>;
  await events(await f.post({ ...call(f.catalog.generation), conversationId: done.conversationId, text: 'Continue' }));
  assert.equal((f.requests[1].input as unknown[]).length, 5);
  assert.deepEqual(await (await fetch(f.base + '/project/session')).json(), before, 'model chat never mutates project/approvals');
  assert.equal(JSON.stringify(result).includes('fake-fixture-key'), false);
  assert.equal((await fetch(f.base + '/health')).status, 200);
});
test('HTTP admission denies foreign origins/hosts, methods/query, body bounds/schema/config/history and stale generation', async t => {
  const f = await fixture(t); const request = call(f.catalog.generation);
  const foreignHeaders: Record<string, string>[] = [{ origin: 'https://evil.invalid' }, { host: 'evil.invalid' }, { 'sec-fetch-site': 'cross-site' }];
  for (const header of foreignHeaders) {
    const status = await new Promise<number>(resolve => {
      const body = JSON.stringify(request);
      const outgoing = httpRequest(new URL(f.base + '/chat/turn'), { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...header } }, reply => { reply.resume(); resolve(reply.statusCode!); });
      outgoing.end(body);
    });
    assert.equal(status, 403, JSON.stringify(header));
  }
  assert.equal((await fetch(f.base + '/chat/models?fresh=1')).status, 400);
  assert.equal((await fetch(f.base + '/chat/turn')).status, 400);
  assert.equal((await f.post({ ...request, text: 'x'.repeat(L.requestBytes) })).status, 400);
  for (const extra of [{ history: [] }, { transport: 'https://evil.invalid' }, { tool: 'create_box' }]) assert.equal((await f.post({ ...request, ...extra })).status, 400);
  const stale = await events(await f.post({ ...request, generation: 'old-generation' })); assert.equal(stale.at(-1)?.kind, 'error');
  assert.deepEqual(stale.at(-1), { kind: 'error', requestId: 'request-one', code: 'stale-account' }); assert.equal(f.requests.length, 0);
});
test('synthetic context requires exact authoritative point/ID/revision and includes selected box parameters', async t => {
  const f = await fixture(t); const info = await (await fetch(f.base + '/project/session')).json(); const snapshot = info.result.snapshot;
  const cloud = snapshot.project.entities.find((e: { kind: string }) => e.kind === 'point-cloud');
  const project = { sessionId: snapshot.sessionId, projectRevision: snapshot.project.revision, frameId: snapshot.frameId, units: 'm', entityIds: ['proposal-box'], points: [{ name: 'A', entityId: cloud.id, pointIndex: 0, position: cloud.points[0] }] };
  const request = { ...call(f.catalog.generation), scene: { mode: 'demo', project, toronto: [] } };
  await events(await f.post(request));
  const input = f.requests[0].input as { role: string; content: string }[];
  const context = JSON.parse(input[1].content.slice(input[1].content.indexOf('\n') + 1));
  assert.equal(context.project.source, 'synthetic-project'); assert.deepEqual(context.project.points[0].position, cloud.points[0]); assert.deepEqual(context.selectedGeometry[0].dimensions, [1.8, 1.2, 1.5]);
  for (const bad of [{ ...project, projectRevision: project.projectRevision + 1 }, { ...project, entityIds: ['nonexistent'] }, { ...project, points: [{ ...project.points[0], position: [999, 0, 0] }] }]) {
    const result = await events(await f.post({ ...request, scene: { ...request.scene, project: bad } })); assert.equal(result.at(-1)?.kind, 'error');
  }
  assert.equal(f.requests.length, 1);
});
test('provider HTTP/SSE failure is sanitized and does not emit done or retry', async t => {
  let requests = 0;
  const f = await fixture(t, async url => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'model-one' }] });
    requests++; return new Response('provider-secret-token-and-path', { status: 403 });
  });
  const result = await events(await f.post(call(f.catalog.generation))); assert.deepEqual(result.map(e => e.kind), ['start', 'error']);
  assert.equal((result.at(-1) as Extract<ModelChatEvent, { kind: 'error' }>).code, 'permission-denied'); assert.ok(!JSON.stringify(result).includes('secret')); assert.equal(requests, 1);
});
test('logout interrupts stalled stream immediately, does not publish completion and changes opaque generation', async t => {
  let streamStarted!: () => void; const started = new Promise<void>(r => { streamStarted = r; }); let cancelled = false;
  const f = await fixture(t, async url => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'model-one' }] });
    return new Response(new ReadableStream({ start(c) { c.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n')); streamStarted(); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  const pending = f.post(call(f.catalog.generation)); await started; const result = await pending; const text = assert.rejects(result.text());
  const logout = await fetch(f.base + '/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(logout.status, 200);
  await text; assert.equal(cancelled, true);
  const next: ModelCatalog = await (await fetch(f.base + '/chat/models')).json(); assert.notEqual(next.generation, f.catalog.generation); assert.equal(next.ready, false);
});
test('one admission covers a stalled request body and releases on caller abort without inference', async t => {
  const f = await fixture(t);
  let admitted!: () => void; const entered = new Promise<void>(resolve => { admitted = resolve; });
  f.server.once('request', () => { admitted(); });
  const slow = httpRequest(new URL(f.base + '/chat/turn'), { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 1000 } });
  slow.on('error', () => undefined); slow.write('{'); await entered; await tick();
  assert.equal((await fetch(f.base + '/chat/models')).status, 429); slow.destroy(); await tick(); await tick();
  assert.equal((await fetch(f.base + '/chat/models')).status, 200); assert.equal(f.requests.length, 0);
});
test('one admission covers provider operation and shutdown cancels before waiting for socket drain', async t => {
  let started!: () => void; const entered = new Promise<void>(r => { started = r; }); let cancelled = false;
  const f = await fixture(t, async url => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'model-one' }] });
    return new Response(new ReadableStream({ start(c) { c.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n')); started(); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  const pending = f.post(call(f.catalog.generation)); await entered; const result = await pending; const text = assert.rejects(result.text());
  assert.equal((await f.post(call(f.catalog.generation))).status, 429);
  const closing = new Promise<void>(resolve => f.server.close(() => resolve()));
  await text; await closing; assert.equal(cancelled, true);
});
async function datasetFixture(t: { after(fn: () => unknown): void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'spatial-model-dataset-'))); await mkdir(join(root, 'octree'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 1, hierarchy: { firstChunkSize: 22 }, boundingBox: { min: [-10, -10, 110], max: [10, 10, 130] }, scale: [.001, .001, .001], offset: [0, 0, 120], attributes: [
    { name: 'position', type: 'int32', size: 12, min: [-10, -10, 110], max: [10, 10, 130] }, { name: 'rgb', type: 'uint16', size: 6 },
    { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(28); payload.writeUInt16LE(1, 18); payload.writeFloatLE(6, 24);
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(1, 2); hierarchy.writeBigUInt64LE(28n, 14);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: [.001, .001, .001], semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS,
    sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? 1 : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
test('Toronto attachments revision-check original source metadata, stay unmapped and never claim exact record verification', async t => {
  const root = await datasetFixture(t); const info = await new PotreeDataset(root).info(); const authority = new ProjectSession(join(root, 'project.json'));
  const scene: ModelScene = { mode: 'toronto', project: null, toronto: [{ name: 'A', datasetId: 'toronto3d', artifactRevision: info.revision, key: { sourceFileId: 1, sourceRow: 0 }, position: [1, 2, 120], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }] };
  const result = await bindModelScene(scene, authority, root, freshSignal());
  const context = result.context as { project: null; toronto: { position: unknown; recordValidation: string; mapping: string }[] };
  assert.equal(context.project, null); assert.equal(context.toronto[0].recordValidation, 'unverified'); assert.equal(context.toronto[0].mapping, 'unmapped-to-project'); assert.deepEqual(context.toronto[0].position, [1, 2, 120], 'user attachment retained without pretending actual original [0,0,120] was validated');
  await result.check(); await result.close();
  for (const point of [{ ...scene.toronto[0], artifactRevision: '0'.repeat(64) }, { ...scene.toronto[0], key: { sourceFileId: 1, sourceRow: 1 } }, { ...scene.toronto[0], position: [1000, 0, 120] as const }]) await assert.rejects(bindModelScene({ ...scene, toronto: [point] }, authority, root, freshSignal()));
  const held = await bindModelScene(scene, authority, root, freshSignal());
  await writeFile(join(root, 'manifest.json'), '{}'); await assert.rejects(held.check()); await held.close();
});
test('authoritative revision changed during async inference suppresses completion and discards turn', async t => {
  const root = await mkdtemp(join(tmpdir(), 'spatial-model-stale-')); t.after(() => rm(root, { recursive: true, force: true }));
  const authority = new ProjectSession(join(root, 'project.json')); const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'fake-only' });
  let upstream!: ReadableStreamDefaultController<Uint8Array>; let entered!: () => void; const gate = new Promise<void>(r => { entered = r; });
  const routes = createModelChatRoutes(auth, authority, root, async url => String(url).endsWith('/models') ? Response.json({ data: [{ id: 'model-one' }] }) : new Response(new ReadableStream({ start(c) { upstream = c; entered(); } }), { headers: { 'content-type': 'text/event-stream' } }));
  const server = createServer((request, response) => { void routes.handle(request, response); }); const base = await listen(server);
  t.after(async () => { routes.close(); auth.close(); await close(server); });
  const catalog: ModelCatalog = await (await fetch(base + '/chat/models')).json();
  const pending = fetch(base + '/chat/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...call(catalog.generation), scene: { mode: 'demo', toronto: [], project: { ...authority.binding(), entityIds: ['proposal-box'], points: [] } } }) });
  await gate; const proposal = authority.propose({ ...authority.binding(), edit: { kind: 'update-box', entityId: 'proposal-box', center: [1, 2, 3], dimensions: [1, 1, 1] } });
  authority.approve({ ...authority.binding(), proposalId: proposal.proposalId, digest: proposal.digest, humanApproved: true });
  upstream.enqueue(encoder.encode(completed())); upstream.close();
  const result = await events(await pending); assert.equal(result.at(-1)?.kind, 'error'); assert.ok(!result.some(e => e.kind === 'done')); assert.equal((result.at(-1) as Extract<ModelChatEvent, { kind: 'error' }>).code, 'stale-scene');
});
