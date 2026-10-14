import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TORONTO_SEMANTIC_LABELS, PROJECT_FRAME_ID, canonicalChatRequest, inspectionCommand, type ChatRequest, type ChatResponse } from '@spatial/contracts';
import { createDemoProject } from '@spatial/project-state';
import { ReadonlyToolRuntime } from '../packages/agent-harness/src/index';
import { createDemoServer } from '../apps/server/src/index';
import { createChatRoutes } from '../apps/server/src/chat-routes';
import { prepareReadonlyTools } from '../apps/server/src/tool-adapter';
import { PotreeDataset } from '../apps/server/src/potree';
import { fetchProject, fetchInspection, ChatController, type ChatEntry, validateChatResponse } from '../apps/web/src/chat-client';

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'spatial-chat-fixture-')));
  await mkdir(join(root, 'octree'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 9, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-10, -10, 110], max: [10, 10, 130] }, scale: [.001, .001, .001], offset: [0, 0, 120], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-10, -10, 110], max: [10, 10, 130] }, { name: 'rgb', type: 'uint16', size: 6 },
      { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(9 * 28), hierarchy = Buffer.alloc(22);
  for (let i = 0; i < 9; i++) { payload.writeInt32LE(i * 1000, i * 28); payload.writeUInt16LE(1, i * 28 + 18); payload.writeUInt32LE(i, i * 28 + 20); payload.writeFloatLE(i, i * 28 + 24); }
  hierarchy[0] = 1; hierarchy.writeUInt32LE(9, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: [.001, .001, .001], semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS,
    sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? 9 : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  return root;
}
async function listen(server: Server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); const a = server.address(); assert.ok(a && typeof a !== 'string'); return `http://127.0.0.1:${a.port}`; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
const call = (sessionId = 'session', command = 'metadata'): ChatRequest => ({ sessionId, projectRevision: 0, generation: 1, requestId: 'request-1', command });
const terminal = (r: ChatRequest, state: ChatResponse['state'] = 'rejected'): ChatResponse => { const { command: _, ...b } = r; return { ...b, state, code: 'test' }; };
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; };

test('command grammar and envelope fail closed without arbitrary paths/tools/config', () => {
  assert.deepEqual(inspectionCommand('metadata'), { tool: 'dataset.metadata', args: {} });
  assert.deepEqual(inspectionCommand('observe 4096 3'), { tool: 'dataset.observe', args: { lod: { budget: 4096, depth: 3 } } });
  for (const text of ['observe 4097 3', 'observe 0 0', 'observe 2 4', 'observe 01 0', 'metadata ', 'read /tmp/file', 'dataset.nearest-label', 'move box']) assert.equal(inspectionCommand(text), null, text);
  assert.throws(() => canonicalChatRequest({ ...call(), directory: '/secret' }));
  assert.throws(() => canonicalChatRequest({ ...call(), generation: -1 }));
});

test('actual HTTP + prepared dispatcher + browser client share project and preserve canonical evidence/sample bounds', async () => {
  const root = await fixture(), server = createDemoServer({ datasetRoot: root }), base = await listen(server), original = globalThis.fetch;
  globalThis.fetch = (input, init) => original(typeof input === 'string' && input.startsWith('/') ? base + input : input, init);
  try {
    const snapshot = await fetchProject(new AbortController().signal);
    assert.equal(snapshot.frameId, PROJECT_FRAME_ID); assert.deepEqual(snapshot.project, JSON.parse(JSON.stringify(createDemoProject())));
    const request = { ...call(snapshot.sessionId), projectRevision: snapshot.project.revision };
    const result = await fetchInspection(request, new AbortController().signal);
    assert.equal(result.state, 'completed'); assert.equal(result.reply?.request?.tool, 'dataset.metadata'); assert.equal(result.reply?.outcome.status, 'observed');
    assert.equal(result.reply?.request?.binding.frameId, 'toronto3d-local-v1'); assert.notEqual(result.reply?.request?.binding.artifactRevision, String(snapshot.project.revision));
    assert.equal(result.evidence?.requestId, result.reply?.request?.requestId); assert.match(result.evidence!.semanticHash, /^[a-f0-9]{64}$/);
    const sample = await fetchInspection({ ...request, command: 'observe 3 0' }, new AbortController().signal);
    assert.equal(sample.state, 'completed');
    if (sample.reply?.outcome.status !== 'observed' || sample.reply.outcome.kind !== 'observation') throw new Error('Not a real sample');
    assert.equal(sample.reply.outcome.data.count, 3); assert.deepEqual(sample.reply.outcome.data.labels, [0, 3, 6]); assert.equal(sample.reply.outcome.coverage, 'bounded-first-chunk-sample');
    assert.equal((await fetchInspection({ ...request, command: 'move box' }, new AbortController().signal)).code, 'unsupported-command');
    assert.equal((await fetchInspection({ ...request, projectRevision: request.projectRevision + 1 }, new AbortController().signal)).code, 'stale-project');
    assert.equal((await fetchInspection({ ...request, sessionId: 'stale-session' }, new AbortController().signal)).state, 'rejected');
    assert.deepEqual((await fetchProject(new AbortController().signal)).project, snapshot.project, 'inspection never mutates geometry');
    assert.throws(() => validateChatResponse({ ...result, generation: 999 }, request));
    assert.throws(() => validateChatResponse({ ...terminal(request), state: 'completed' }, request));
    for (const changed of [{ units: 'mm' }, { handedness: 'left' }, { upAxis: 'Y' }, { localOrigin: [1000, 2000, 10] }]) {
      const corrupt = JSON.parse(JSON.stringify(result)); Object.assign(corrupt.reply.outcome.data.coordinates, changed);
      assert.throws(() => validateChatResponse(corrupt, request), 'client rejects inconsistent returned dataset frame');
    }
    const wrongLod = JSON.parse(JSON.stringify(sample)); wrongLod.reply.outcome.data.lod.budget = 4;
    assert.throws(() => validateChatResponse(wrongLod, { ...request, command: 'observe 3 0' }), 'client binds returned observation LOD');
  } finally { globalThis.fetch = original; await close(server); await rm(root, { recursive: true, force: true }); }
});

test('HTTP denies oversized/unknown/foreign inputs and reports dataset unavailable without paths', async () => {
  const server = createDemoServer({ datasetRoot: '/not-a-real-secret-root' }), base = await listen(server);
  try {
    const snapshot = await fetch(base + '/project'), sessionId = snapshot.headers.get('X-Spatial-Session')!, project = await snapshot.json();
    const request = { ...call(sessionId), projectRevision: project.revision };
    const post = (body: unknown, headers = {}) => fetch(base + '/chat/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const unavailable = await (await post(request)).json(); assert.equal(unavailable.state, 'error'); assert.equal(unavailable.code, 'dataset-unavailable'); assert.ok(!JSON.stringify(unavailable).includes('secret-root'));
    assert.equal((await post({ ...request, extra: 'x' })).status, 400);
    assert.equal((await post({ ...request, command: 'x'.repeat(2000) })).status, 413);
    assert.equal((await post(request, { Origin: 'https://evil.invalid' })).status, 403);
    const foreignHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(base + '/chat/inspect', { method: 'POST', headers: { Host: 'evil.invalid', 'Content-Type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end(JSON.stringify(request));
    });
    assert.equal(foreignHost, 403);
  } finally { await close(server); }
});

test('actual dispatcher rejection/incomplete/error stay distinct through HTTP', async () => {
  const root = await fixture(), project = createDemoProject(); let outcome: unknown = { status: 'incomplete', complete: false, reason: 'resource' };
  const routes = createChatRoutes(project, 'session', root, async (...args) => {
    const prepared = await prepareReadonlyTools(...args);
    return { ...prepared, createRuntime: id => new ReadonlyToolRuntime(id, prepared.binding, prepared.configuration, {
      metadata: async () => outcome, observe: async () => outcome, nearest: async () => outcome,
    }, prepared.hash) };
  });
  const server = createServer(async (req, res) => { await routes(req, res); }), base = await listen(server);
  try {
    const post = async () => (await fetch(base + '/chat/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...call(), projectRevision: project.revision }) })).json() as Promise<ChatResponse>;
    assert.equal((await post()).state, 'incomplete');
    outcome = { status: 'verification-rejected', reason: '/private-path' }; const rejected = await post(); assert.equal(rejected.state, 'rejected'); assert.ok(!JSON.stringify(rejected).includes('private-path'));
    outcome = { status: 'error', code: 'unavailable' }; assert.equal((await post()).state, 'error');
  } finally { await close(server); await rm(root, { recursive: true, force: true }); }
});

test('HTTP abort propagates into trusted preparation; admission remains bounded while pending', async () => {
  const entered = deferred<void>(), aborted = deferred<void>();
  const project = createDemoProject();
  const routes = createChatRoutes(project, 'session', '/trusted', async (_root, _options, signal) => {
    entered.resolve();
    await new Promise<void>((_r, reject) => { signal!.addEventListener('abort', () => { aborted.resolve(); reject(new Error('cancelled')); }, { once: true }); });
    throw new Error('unreachable');
  });
  const server = createServer(async (req, res) => { await routes(req, res); }), base = await listen(server), controller = new AbortController();
  const request = { ...call(), projectRevision: project.revision };
  try {
    const pending = fetch(base + '/chat/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
    await entered.promise;
    const busy = await (await fetch(base + '/chat/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })).json();
    assert.equal(busy.state, 'incomplete'); assert.equal(busy.code, 'preparing-busy');
    controller.abort(); await assert.rejects(pending); await aborted.promise;
  } finally { controller.abort(); await close(server); }
});

test('HTTP abort reaches an executing dispatcher adapter and a later request can complete', async () => {
  const root = await fixture(), entered = deferred<void>(), aborted = deferred<void>(), project = createDemoProject();
  const dataset = new PotreeDataset(root); let calls = 0;
  const routes = createChatRoutes(project, 'session', root, async (...args) => {
    const prepared = await prepareReadonlyTools(...args);
    return { ...prepared, createRuntime: id => new ReadonlyToolRuntime(id, prepared.binding, prepared.configuration, {
      metadata: async signal => {
        if (++calls === 1) {
          entered.resolve();
          await new Promise<void>((_resolve, reject) => { signal.addEventListener('abort', () => { aborted.resolve(); reject(new Error('cancelled')); }, { once: true }); });
        }
        signal.throwIfAborted(); return dataset.info();
      }, observe: (lod, signal) => dataset.observe(lod, signal), nearest: async () => ({ status: 'error', code: 'unavailable' }),
    }, prepared.hash) };
  });
  const server = createServer(async (req, res) => { await routes(req, res); }), base = await listen(server), controller = new AbortController();
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...call(), projectRevision: project.revision }) };
  try {
    const pending = fetch(base + '/chat/inspect', { ...options, signal: controller.signal });
    await entered.promise; controller.abort(); await assert.rejects(pending); await aborted.promise;
    const completed = await (await fetch(base + '/chat/inspect', options)).json();
    assert.equal(completed.state, 'completed'); assert.equal(completed.reply.outcome.status, 'observed'); assert.equal(calls, 2);
  } finally { controller.abort(); await close(server); await rm(root, { recursive: true, force: true }); }
});

test('client pending/cancel/new generation/session/revision/disposal suppress noncooperative late results', async () => {
  const events: ChatEntry[] = [], waits: ReturnType<typeof deferred<ChatResponse>>[] = [], requests: ChatRequest[] = [], signals: AbortSignal[] = [];
  const c = new ChatController({ sessionId: 'session', projectRevision: 0 }, e => events.push(e), (r, s) => { requests.push(r); signals.push(s); const w = deferred<ChatResponse>(); waits.push(w); return w.promise; });
  let pending = c.submit('metadata'); assert.equal(events.at(-1)?.state, 'pending'); c.cancel(); assert.equal(events.at(-1)?.state, 'cancelled'); assert.ok(signals[0].aborted);
  waits[0].resolve(terminal(requests[0])); await pending; assert.equal(events.length, 2);
  pending = c.submit('metadata'); const fresh = c.submit('observe 1 0'); waits[1].resolve(terminal(requests[1])); await pending; assert.equal(events.at(-1)?.state, 'pending');
  waits[2].resolve(terminal(requests[2])); await fresh; assert.equal(events.at(-1)?.state, 'rejected');
  for (const binding of [{ sessionId: 'new-session', projectRevision: 0 }, { sessionId: 'new-session', projectRevision: 1 }]) {
    pending = c.submit('metadata'); const count: number = events.length; c.bind(binding); waits.at(-1)!.resolve(terminal(requests.at(-1)!)); await pending; assert.equal(events.length, count); assert.ok(signals.at(-1)!.aborted);
  }
  pending = c.submit('metadata'); const count = events.length; c.dispose(); waits.at(-1)!.resolve(terminal(requests.at(-1)!)); await pending; assert.equal(events.length, count); await c.submit('metadata'); assert.equal(events.length, count);
});

test('client server-unavailable error is explicit; project bootstrap never falls back to browser seed', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('network unavailable'); };
  try {
    await assert.rejects(fetchProject(new AbortController().signal));
    const entries: ChatEntry[] = [], c = new ChatController({ sessionId: 'session', projectRevision: 0 }, e => entries.push(e));
    await c.submit('metadata'); assert.deepEqual(entries.map(e => e.state), ['pending', 'error']); c.dispose();
  } finally { globalThis.fetch = original; }
});
