import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once, EventEmitter } from 'node:events';
import { request as httpRequest, type ServerResponse } from 'node:http';
import { streamClosestPole } from '../apps/server/src/pole-transport';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import type { NearestPoleRequest, NearestPoleToolOutcome, PointObservation } from '@spatial/contracts';
import { PotreeDataset } from '../apps/server/src/potree';
import { queryClosestPole } from '../apps/server/src/semantic-query';
import { queryIndexedClosestPole } from '../apps/server/src/pole-index';
import { createDemoServer } from '../apps/server/src/index';
import { createPolePickCache, poleGestureKind, isPoleClick, type PoleSelection } from '../apps/web/src/pole-picking';
import { createPoleChannel, fetchClosestPole, validatePoleResult, type PoleState, type PoleLoader } from '../apps/web/src/pole-client';

async function fixture(count = 3, pole = true, xOffset = 0) {
  const root = await mkdtemp(join(tmpdir(), 'spatial-pole-ui-')); await mkdir(join(root, 'octree'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: count, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-20, -20, 100], max: [20, 20, 140] }, scale: [0.001, 0.001, 0.001], offset: [xOffset, 0, 120], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-20, -20, 100], max: [20, 20, 140] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(count * 28);
  for (let i = 0; i < count; i++) {
    payload.writeInt32LE(i === 1 ? 10000 : i === 2 ? 125 : 0, i * 28); payload.writeUInt16LE(65535, i * 28 + 12);
    payload.writeUInt16LE(1, i * 28 + 18); payload.writeUInt32LE(i, i * 28 + 20); payload.writeFloatLE(pole && i > 0 ? 6 : 1, i * 28 + 24);
  }
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(count, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: [0.001, 0.001, 0.001],
    semantic_attribute: 'scalar_Label', semantic_classes: { '6': 'Pole' }, sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? count : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const dataset = new PotreeDataset(root);
  const sample: PointObservation = count <= 100000 ? await dataset.sample({ budget: 1, depth: 0 }, 'display') : { dataset: await dataset.info(), count: 1, positions: [0, 0, 120], sourceIds: [1, 0], purpose: 'display', lod: { budget: 1, depth: 0 }, algorithm: 'potree-bfs-even-v1', candidatePoints: count, bytesRead: 0, nodes: ['r'], sampleHash: '0'.repeat(64), colors: [255, 0, 0], labels: [1] };
  const selection = createPolePickCache(sample).resolve(0)!;
  const request: NearestPoleRequest = { requestId: 'fixture', datasetId: 'toronto3d', expectedArtifactRevision: sample.dataset.revision, units: 'm', frameId: 'toronto3d-local-v1',
    input: { kind: 'point-ref', key: selection.key }, filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: 6 }, metric: 'euclidean-3d', domain: { kind: 'whole-dataset' } };
  return { root, sample, selection, request, clean: () => rm(root, { recursive: true, force: true }) };
}

function rebind(result: NearestPoleToolOutcome, request: NearestPoleRequest) {
  if (result.status !== 'verified-found' && result.status !== 'verified-none') return result;
  const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  return { ...result, request, search: { ...result.search, requestHash: hash }, verification: { ...result.verification, requestHash: hash } };
}

test('pick caches preserve binary64 provenance, reject disposed/replaced hints; Shift precedence and click/drag/cancel', async () => {
  const f = await fixture();
  try {
    const sample: PointObservation = { ...f.sample, positions: [0.123456789123, 0, 120], sourceIds: [4, 846038] };
    const cache = createPolePickCache(sample), selected = cache.resolve(0)!;
    assert.equal(selected.position[0], 0.123456789123); assert.notEqual(selected.position[0], Math.fround(selected.position[0]));
    assert.deepEqual(selected.key, { sourceFileId: 4, sourceRow: 846038 });
    (sample.positions as number[])[0] = 99; (sample.sourceIds as number[])[0] = 1; assert.deepEqual(cache.resolve(0), selected);
    assert.equal(cache.resolve(-1), undefined); assert.equal(cache.resolve(1), undefined); (sample as unknown as { count: number }).count = 10; assert.equal(cache.resolve(1), undefined);
    cache.dispose(); assert.equal(cache.resolve(0), undefined);
    for (const modifier of ['metaKey', 'ctrlKey']) {
      const e = { button: 0, shiftKey: false, metaKey: false, ctrlKey: false, [modifier]: true };
      assert.equal(poleGestureKind(e, true), 'query'); assert.equal(poleGestureKind(e, false), undefined);
      assert.equal(poleGestureKind({ ...e, shiftKey: true }, true), 'shift'); assert.equal(poleGestureKind({ ...e, button: 2 }, true), undefined);
    }
    assert.equal(poleGestureKind({ button: 0, shiftKey: false, metaKey: false, ctrlKey: false }, true), undefined);
    assert.ok(isPoleClick(2, false, true)); assert.ok(!isPoleClick(8, false, true)); assert.ok(!isPoleClick(0, true, true)); assert.ok(!isPoleClick(0, false, false));
    assert.equal(createPolePickCache({ ...f.sample, sourceIds: [0, 0] }).resolve(0), undefined);
  } finally { await f.clean(); }
});

test('query channel supersession/cancel/clear/disposal/revision suppress ignored abort and stale progress/results', async () => {
  const f = await fixture();
  try {
    const base = await queryClosestPole(f.root, f.request);
    const pending: { request: NearestPoleRequest; signal: AbortSignal; progress: Parameters<PoleLoader>[2]; resolve: (r: NearestPoleToolOutcome) => void }[] = [];
    const states: PoleState[] = [];
    const channel = createPoleChannel(s => states.push(s), (request, signal, progress) => new Promise(resolve => pending.push({ request, signal, progress, resolve })));
    const first = channel.select(f.selection), second = channel.select(f.selection);
    assert.ok(pending[0].signal.aborted);
    pending[0].progress({ phase: 'verify', scannedPoints: 3, payloadBytes: 84 }); assert.equal(states.at(-1)!.phase, 'resolving');
    pending[0].resolve(rebind(base, pending[0].request)); await first; assert.equal(states.at(-1)!.phase, 'resolving');
    pending[1].resolve(rebind(base, pending[1].request)); await second; assert.equal(states.at(-1)!.phase, 'verified-found');
    for (const action of ['cancel', 'clear', 'dispose', 'revision'] as const) {
      const values: PoleState[] = [], deferred: typeof pending = [];
      const c = createPoleChannel(s => values.push(s), (request, signal, progress) => new Promise(resolve => deferred.push({ request, signal, progress, resolve })));
      const run = c.select(f.selection);
      if (action === 'revision') c.revision('0'.repeat(64)); else c[action]();
      assert.ok(deferred[0].signal.aborted); const length = values.length;
      deferred[0].progress({ phase: 'search', scannedPoints: 3, payloadBytes: 84 }); deferred[0].resolve(rebind(base, deferred[0].request)); await run; assert.equal(values.length, length);
      if (action === 'cancel') assert.equal(values.at(-1)!.phase, 'cancelled-incomplete');
      if (action === 'clear') assert.deepEqual(values.at(-1), { phase: 'idle' });
      if (action === 'revision') assert.equal(values.at(-1)!.phase, 'error-stale');
    }
    const c = createPoleChannel(s => states.push(s), async () => ({ status: 'error', code: 'stale-revision' })); await c.select(f.selection); assert.equal(states.at(-1)!.phase, 'error-stale');
    const wrong = createPoleChannel(s => states.push(s), async request => rebind(base, request)); await wrong.select({ ...f.selection, position: [99, 0, 120] }); assert.equal(states.at(-1)!.phase, 'error');
    const empty = createPoleChannel(s => states.push(s), async () => ({ status: 'incomplete', complete: false, reason: 'resource' })); await empty.select(f.selection); assert.equal(states.at(-1)!.phase, 'error');
    channel.dispose();
  } finally { await f.clean(); }
});

test('query channel detaches nested proxy selections and retries published provenance without rounding', async () => {
  const f = await fixture(3, true, 0.123456789123);
  try {
    const base = await queryClosestPole(f.root, f.request);
    const original = { ...f.selection, key: { ...f.selection.key }, position: [...f.selection.position] as [number, number, number] };
    const proxied = (value: PoleSelection): PoleSelection => new Proxy(value, {
      get(target, property, receiver) {
        if (property === 'key') return new Proxy(target.key, {});
        if (property === 'position') return new Proxy(target.position, {});
        return Reflect.get(target, property, receiver);
      },
    });
    const states: PoleState[] = [], requests: NearestPoleRequest[] = [];
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const channel = createPoleChannel(state => states.push(state), async request => {
      requests.push(request); await ready; return rebind(base, request);
    });
    try {
      const run = channel.select(proxied(original));
      original.key.sourceFileId = 4; original.key.sourceRow = 846038;
      original.position[0] = 99; original.position[1] = 98; original.position[2] = 97;
      original.artifactRevision = '0'.repeat(64);
      release(); await assert.doesNotReject(run);
      assert.equal(states[0].phase, 'resolving');
      assert.deepEqual(states[0].selection, f.selection);
      assert.notEqual(states[0].selection!.key, original.key);
      assert.notEqual(states[0].selection!.position, original.position);
      assert.deepEqual(structuredClone(states[0].selection), f.selection);
      assert.equal(states[0].selection!.position[0], 0.123456789123);
      assert.notEqual(states[0].selection!.position[0], Math.fround(states[0].selection!.position[0]));
      const completed = states.at(-1)!;
      assert.equal(completed.phase, 'verified-found');
      await assert.doesNotReject(channel.select(proxied(completed.selection!)));
      const retried = states.at(-1)!;
      assert.equal(retried.phase, 'verified-found');
      assert.deepEqual(retried.selection, f.selection);
      assert.notEqual(retried.selection, completed.selection);
      assert.notEqual(retried.selection!.key, completed.selection!.key);
      assert.notEqual(retried.selection!.position, completed.selection!.position);
      assert.equal(requests.length, 2);
      for (const request of requests) {
        assert.equal(request.datasetId, f.selection.datasetId);
        assert.equal(request.expectedArtifactRevision, f.selection.artifactRevision);
        assert.deepEqual(request.input, { kind: 'point-ref', key: f.selection.key });
        assert.deepEqual(request.domain, { kind: 'whole-dataset' });
      }
      assert.notEqual(requests[0].requestId, requests[1].requestId);
      assert.ok(completed.result?.status === 'verified-found' && retried.result?.status === 'verified-found');
      assert.deepEqual(retried.result.nearest, completed.result.nearest);
      assert.deepEqual(retried.result.dataset, completed.result.dataset);
      assert.deepEqual(retried.result.queryPosition, completed.result.queryPosition);
    } finally { channel.dispose(); }
  } finally { await f.clean(); }
});

test('bounded stream validates binding, progress, evidence, terminal+EOF and permits verified empty/zero distance', async () => {
  const f = await fixture(), originalFetch = globalThis.fetch;
  try {
    const result = await queryClosestPole(f.root, f.request);
    const binding = { requestId: f.request.requestId, artifactRevision: f.request.expectedArtifactRevision };
    const start = { type: 'start', ...binding, request: f.request }, end = { type: 'result', ...binding, result };
    const stream = (frames: unknown[], tail = '') => {
      const bytes = new TextEncoder().encode(frames.map(v => JSON.stringify(v) + '\n').join('') + tail);
      let at = 0;
      return new Response(new ReadableStream({ pull(controller) { if (at === bytes.length) controller.close(); else { controller.enqueue(bytes.slice(at, at + 17)); at = Math.min(at + 17, bytes.length); } } }), { headers: { 'content-type': 'application/x-ndjson' } });
    };
    const run = async (frames: unknown[], tail = '') => {
      globalThis.fetch = (async () => stream(frames, tail)) as typeof fetch;
      return fetchClosestPole(f.request, new AbortController().signal, () => {});
    };
    assert.deepEqual(await run([start, end]), result);
    for (const frames of [[end], [start], [start, end, end], [start, { ...end, requestId: 'stale' }], [start, { ...end, result: { ...result, complete: false } }],
      [start, { type: 'progress', ...binding, progress: { phase: 'verify', scannedPoints: 1, payloadBytes: 28 } }, { type: 'progress', ...binding, progress: { phase: 'search', scannedPoints: 1, payloadBytes: 28 } }, end]]) await assert.rejects(run(frames));
    await assert.rejects(run([start, end], 'junk')); await assert.rejects(run([start], ' '.repeat(65537)));
    if (result.status === 'verified-found') {
      assert.throws(() => validatePoleResult({ ...result, nearest: { ...result.nearest, distanceSquared: 3 } }, f.request));
      assert.throws(() => validatePoleResult({ ...result, verification: { ...result.verification, scannedPoints: 2 } }, f.request));
      await assert.rejects(run([start, { ...end, result: { ...result, search: { ...result.search, requestHash: '0'.repeat(64) }, verification: { ...result.verification, requestHash: '0'.repeat(64) } } }]));
    }
    const indexed = await queryIndexedClosestPole(f.root, f.request);
    assert.equal(validatePoleResult(indexed, f.request).status, 'verified-found');
    if (indexed.status === 'verified-found') {
      for (const patch of [
        { search: { ...indexed.search, completion: 'exhausted' } },
        { search: { ...indexed.search, index: { ...indexed.search.index, points: 0 } } },
        { verification: { ...indexed.verification, index: { ...indexed.verification.index, hash: '0'.repeat(64) } } },
        { verification: { ...indexed.verification, verifier: 'linear-record-oracle-v1' } },
        { verification: { ...indexed.verification, scannedPoints: 0 } },
        { search: { ...indexed.search, resolutionPoints: 3 } },
        { search: { ...indexed.search, payloadBytes: 28 } },
      ]) assert.throws(() => validatePoleResult({ ...indexed, ...patch }, f.request));
      assert.deepEqual(await run([start, { ...end, result: indexed }]), indexed);
      assert.deepEqual(await run([start, { type: 'progress', ...binding, progress: { phase: 'index', scannedPoints: 3, payloadBytes: 84 } },
        { type: 'progress', ...binding, progress: { phase: 'resolve', scannedPoints: 1, payloadBytes: 28 } }, { ...end, result: indexed }]), indexed);
    }
    const poleRequest = { ...f.request, input: { kind: 'point-ref' as const, key: { sourceFileId: 1, sourceRow: 2 } } };
    const zero = validatePoleResult(await queryClosestPole(f.root, poleRequest), poleRequest); assert.equal(zero.status, 'verified-found'); if (zero.status === 'verified-found') assert.equal(zero.nearest!.distanceMeters, 0);
    const none = await fixture(3, false);
    try { const empty = validatePoleResult(await queryClosestPole(none.root, none.request), none.request); assert.equal(empty.status, 'verified-none'); }
    finally { await none.clean(); }
  } finally { globalThis.fetch = originalFetch; await f.clean(); }
});

test('real HTTP reuses independent verifier, ignores sample omission/LOD; validation and loopback protections', async () => {
  const f = await fixture(); const server = createDemoServer({ datasetRoot: f.root }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`;
  const path = `/datasets/toronto3d/closest-pole?${new URLSearchParams({ request: JSON.stringify(f.request) })}`;
  try {
    const response = await fetch(base + path); assert.equal(response.status, 200); const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    const result = validatePoleResult(events.at(-1).result, f.request); assert.equal(result.status, 'verified-found');
    if (result.status === 'verified-found') { assert.equal(result.verification.verifier, 'pole-category-linear-v1'); assert.equal(result.nearest!.key.sourceRow, 2); assert.equal(result.nearest!.distanceMeters, .125); assert.equal(f.sample.sourceIds[1], 0); }
    await new PotreeDataset(f.root).observe({ budget: 2, depth: 0 });
    const repeat = (await (await fetch(base + path)).text()).trim().split('\n').map(line => JSON.parse(line)); assert.deepEqual(repeat.at(-1).result.nearest, events.at(-1).result.nearest);
    assert.ok(repeat.at(-1).result.sourceReads.payloadBytes <= 3 * 28);
    for (const [suffix, headers, method, status] of [
      ['', { origin: 'http://evil.example' }, 'GET', 403], ['', { range: 'bytes=0-10' }, 'GET', 416],
      ['', {}, 'POST', 404], ['&path=/tmp', {}, 'GET', 400], ['&request={}', {}, 'GET', 400],
    ] as const) { const r = await fetch(base + path + suffix, { headers, method }); assert.equal(r.status, status); await r.body?.cancel(); }
    await new Promise<void>((resolve, reject) => { const r = httpRequest(base + path, { headers: { host: 'evil.example' } }, response => { assert.equal(response.statusCode, 403); response.resume(); response.once('end', resolve); }); r.once('error', reject); r.end(); });
    assert.equal((await fetch(base + '/datasets/toronto3d/closest-pole?request={}')).status, 400);
    const stale = { ...f.request, expectedArtifactRevision: '0'.repeat(64) }; const r = await fetch(base + '/datasets/toronto3d/closest-pole?' + new URLSearchParams({ request: JSON.stringify(stale) }));
    assert.deepEqual(JSON.parse((await r.text()).trim().split('\n').at(-1)!).result, { status: 'error', code: 'stale-revision' });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await f.clean(); }
});

test('shared two-operation admission and disconnect cancellation release slots without queue', async () => {
  const f = await fixture(500_000); const server = createDemoServer({ datasetRoot: f.root }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const path = '/datasets/toronto3d/closest-pole?' + new URLSearchParams({ request: JSON.stringify(f.request) });
  const first = new AbortController(), second = new AbortController();
  try {
    const a = await fetch(base + path, { signal: first.signal }); const b = await fetch(base + path, { signal: second.signal }); assert.equal(a.status, 200); assert.equal(b.status, 200);
    const busy = await fetch(base + '/datasets/toronto3d'); assert.equal(busy.status, 429); await busy.body?.cancel();
    first.abort(); second.abort(); await Promise.allSettled([a.body!.cancel(), b.body!.cancel()]);
    let released = false;
    for (let i = 0; i < 50; i++) { const r = await fetch(base + '/datasets/toronto3d'); await r.body?.cancel(); if (r.status === 200) { released = true; break; } await delay(20); }
    assert.ok(released, 'Disconnect must release shared admission');
    const r = await fetch(base + path, { signal: first.signal }).catch(() => undefined); assert.equal(r, undefined);
  } finally { first.abort(); second.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await delay(50); await f.clean(); }
});


test('socket backpressure admits one frame at a time; stalled disconnect aborts without terminal publication', async () => {
  const f = await fixture();
  try {
    class SlowSocket extends EventEmitter {
      frames: unknown[] = [];
      pendingDrain = false;
      ended = false;
      destroyed = false;
      destroy() { this.destroyed = true; }
      setHeader() {}
      write(line: string) {
        assert.ok(!this.pendingDrain, 'No writes while a frame awaits drain');
        assert.ok(Buffer.byteLength(line) <= 65536);
        this.frames.push(JSON.parse(line)); this.pendingDrain = true; return false;
      }
      end() { this.ended = true; }
      drain() { this.pendingDrain = false; this.emit('drain'); }
    }
    const slow = new SlowSocket(), controller = new AbortController();
    const operation = streamClosestPole(f.root, f.request, slow as unknown as ServerResponse, controller);
    assert.equal(slow.frames.length, 1); await delay(10); assert.equal(slow.frames.length, 1, 'Start must backpressure query output'); slow.drain();
    let done = false; const settled = operation.then(() => { done = true; });
    for (let i = 0; i < 100 && !done; i++) { if (slow.pendingDrain) slow.drain(); await delay(10); }
    await settled; assert.ok(slow.ended);
    assert.equal((slow.frames.at(-1) as { type: string }).type, 'result');
    assert.equal(validatePoleResult((slow.frames.at(-1) as { result: unknown }).result, f.request).status, 'verified-found');
    const cancelled = new SlowSocket(), abort = new AbortController();
    const interrupted = streamClosestPole(f.root, f.request, cancelled as unknown as ServerResponse, abort);
    abort.abort(); await assert.rejects(interrupted); assert.equal(cancelled.frames.length, 1); assert.equal(cancelled.ended, false);
    const broken = new SlowSocket();
    const write = broken.write.bind(broken);
    broken.write = line => { if (broken.frames.length) throw new Error('Injected socket failure'); return write(line); };
    const failure = streamClosestPole(f.root, f.request, broken as unknown as ServerResponse, new AbortController());
    const rejected = assert.rejects(failure); broken.drain(); await rejected;
    assert.ok(broken.destroyed, 'Unexpected transport failure must end the HTTP body'); assert.equal(broken.ended, false);
  } finally { await f.clean(); }
});
