import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once, EventEmitter } from 'node:events';
import { request as httpRequest, type ServerResponse } from 'node:http';
import { streamClosestPole } from '../../apps/server/src/spatial/pole-transport';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { CROP_BATCH_POINTS, TORONTO_SEMANTIC_LABELS, type TorontoSemanticLabel, type NearestPoleRequest, type NearestPoleToolOutcome, type PointObservation, type SearchEvidence, type VerificationEvidence } from '@spatial/contracts';
import { PotreeDataset } from '../../apps/server/src/datasets/potree';
import { queryClosestPole } from '../../apps/server/src/spatial/semantic-query';
import { queryIndexedClosestPole } from '../../apps/server/src/spatial/pole-index';
import { createIsolatedDemoServer as createDemoServer } from '../../scripts/isolated-demo-server';
import { createDetailPickCache, createPolePickCache, poleGestureKind, isPoleClick, type PoleSelection } from '../../apps/web/src/scenes/toronto/inspection/pole-picking';
import { createPoleChannel, fetchClosestPole, validatePoleResult, type PoleState, type PoleLoader } from '../../apps/web/src/scenes/toronto/inspection/pole-client';

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
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? count : 0 })) }));
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

test('bounded detail pick batches preserve binary64/provenance and detach inputs/revision until disposal', async () => {
  const f = await fixture();
  try {
    const positions = [0.123456789123, -0.987654321987, 120.000000001], ids = [4, 0xffffffff];
    const dataset = structuredClone(f.sample.dataset);
    const cache = createDetailPickCache(dataset, positions, ids), selected = cache.resolve(0)!;
    assert.deepEqual(selected.position, positions); assert.deepEqual(selected.key, { sourceFileId: 4, sourceRow: 0xffffffff });
    assert.notEqual(selected.position[0], Math.fround(selected.position[0]));
    positions[0] = 99; ids[0] = 1; (dataset as { revision: string }).revision = '0'.repeat(64);
    assert.deepEqual(cache.resolve(0), selected); assert.equal(cache.resolve(0)!.artifactRevision, f.sample.dataset.revision);
    for (const index of [-1, 0.5, 1, NaN, Infinity]) assert.equal(cache.resolve(index), undefined);
    const second = cache.resolve(0)!; (second.position as unknown as number[])[0] = 77; (second.key as { sourceRow: number }).sourceRow = 3;
    assert.deepEqual(cache.resolve(0), selected, 'Resolved selections do not mutate the cache');
    cache.dispose(); cache.dispose(); assert.equal(cache.resolve(0), undefined);
    const maximum = createDetailPickCache(f.sample.dataset, Array(CROP_BATCH_POINTS * 3).fill(0), Array.from({ length: CROP_BATCH_POINTS * 2 }, (_, i) => i % 2 === 0 ? 1 : i / 2 - .5));
    assert.ok(maximum.resolve(CROP_BATCH_POINTS - 1)); maximum.dispose();
    assert.throws(() => createDetailPickCache(f.sample.dataset, Array((CROP_BATCH_POINTS + 1) * 3).fill(0), Array((CROP_BATCH_POINTS + 1) * 2).fill(1)));
    assert.throws(() => createDetailPickCache(f.sample.dataset, [0, 0], [1, 0]));
    assert.throws(() => createDetailPickCache(f.sample.dataset, [0, 0, 120], []));
    assert.throws(() => createDetailPickCache({ ...f.sample.dataset, revision: 'stale' }, [0, 0, 120], [1, 0]));
    for (const bad of [[0, 0], [5, 0], [1, -1], [1, 2 ** 32], [1, .5]]) {
      const invalid = createDetailPickCache(f.sample.dataset, [0, 0, 120], bad); assert.equal(invalid.resolve(0), undefined); invalid.dispose();
    }
    const nonfinite = createDetailPickCache(f.sample.dataset, [NaN, 0, 120], [1, 0]); assert.equal(nonfinite.resolve(0), undefined); nonfinite.dispose();
  } finally { await f.clean(); }
});

test('category-bound channel supersedes Pole with non-Pole; rejects mismatched label and binds all nine options', async () => {
  const f = await fixture();
  try {
    const pole = await queryClosestPole(f.root, f.request);
    const roadRequest = { ...f.request, filter: { ...f.request.filter, value: 1 as const } };
    const road = await queryClosestPole(f.root, roadRequest);
    const states: PoleState[] = [], pending: { request: NearestPoleRequest; signal: AbortSignal; progress: Parameters<PoleLoader>[2]; resolve: (r: NearestPoleToolOutcome) => void }[] = [];
    const channel = createPoleChannel(s => states.push(s), (request, signal, progress) => new Promise(resolve => pending.push({ request, signal, progress, resolve })));
    const first = channel.select(f.selection, 6), second = channel.select(f.selection, 1);
    assert.ok(pending[0].signal.aborted); assert.equal(pending[1].request.filter.value, 1);
    assert.deepEqual(pending[1].request.domain, { kind: 'whole-dataset' });
    pending[0].progress({ phase: 'verify', scannedPoints: 3, payloadBytes: 84 });
    pending[0].resolve(rebind(pole, pending[0].request)); await first; assert.equal(states.at(-1)!.phase, 'resolving');
    pending[1].resolve(rebind(road, pending[1].request)); await second; assert.equal(states.at(-1)!.phase, 'verified-found');
    const latest = states.at(-1)!.result; assert.ok(latest?.status === 'verified-found'); assert.equal(latest.nearest!.label, 1);
    const third = channel.select(f.selection, 8); channel.cancel(); const length = states.length;
    assert.ok(pending[2].signal.aborted); pending[2].resolve(rebind(pole, pending[2].request)); await third; assert.equal(states.length, length);
    assert.equal(states.at(-1)!.phase, 'cancelled-incomplete'); channel.dispose();
    assert.equal(validatePoleResult(road, roadRequest).status, 'verified-found');
    assert.throws(() => validatePoleResult(road, f.request));
    if (road.status === 'verified-found') assert.throws(() => validatePoleResult({ ...road, nearest: { ...road.nearest, label: 6 } }, roadRequest));
    const mismatch = createPoleChannel(s => states.push(s), async request => rebind(pole, request));
    await mismatch.select(f.selection, 1); assert.equal(states.at(-1)!.phase, 'error'); mismatch.dispose();
    const labels: number[] = [], requests: NearestPoleRequest[] = [];
    const all = createPoleChannel(() => {}, async request => { labels.push(request.filter.value); requests.push(request); return { status: 'incomplete', complete: false, reason: 'resource' }; });
    for (const value of Object.keys(TORONTO_SEMANTIC_LABELS)) await all.select(f.selection, Number(value) as TorontoSemanticLabel);
    assert.deepEqual(labels, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const request of requests) { assert.deepEqual(request.input, f.request.input); assert.deepEqual(request.domain, { kind: 'whole-dataset' }); }
    for (const invalid of [-1, 9, .5, NaN]) await assert.rejects(all.select(f.selection, invalid as TorontoSemanticLabel), /Invalid semantic category/);
    assert.equal(labels.length, 9); all.dispose();
  } finally { await f.clean(); }
});

test('full-resolution crop provenance picks flow through generalized HTTP channel at binary64, without restricting the query domain', async () => {
  const f = await fixture(3, true, 0.123456789123), originalFetch = globalThis.fetch;
  const server = createDemoServer({ datasetRoot: f.root }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const states: PoleState[] = [], requests: NearestPoleRequest[] = [], urls: string[] = [];
  const channel = createPoleChannel(s => states.push(s));
  try {
    let selected: PoleSelection | undefined;
    const caches: ReturnType<typeof createDetailPickCache>[] = [];
    for await (const event of new PotreeDataset(f.root).crop({ min: [0.123, -.001, 119.999], max: [0.124, .001, 120.001] })) {
      if (event.type === 'batch') {
        assert.ok(event.sourceIds); const cache = createDetailPickCache(f.sample.dataset, event.positions, event.sourceIds); caches.push(cache);
        selected = cache.resolve(0);
      }
    }
    assert.ok(selected); assert.deepEqual(selected.key, { sourceFileId: 1, sourceRow: 0 });
    assert.equal(selected.position[0], 0.123456789123); assert.notEqual(selected.position[0], Math.fround(selected.position[0]));
    globalThis.fetch = (async (input, init) => {
      const path = String(input); urls.push(path); const request = JSON.parse(new URL(path, base).searchParams.get('request')!); requests.push(request);
      assert.equal(new URL(path, base).pathname, '/datasets/toronto3d/closest-label');
      return originalFetch(new URL(path, base), init);
    }) as typeof fetch;
    await channel.select(selected, 6); let result = states.at(-1)!.result;
    assert.ok(result?.status === 'verified-found'); assert.deepEqual(result.queryPosition, selected.position);
    assert.equal(result.nearest!.key.sourceRow, 2); assert.ok(result.nearest!.position[0] > .124, 'Winner outside the displayed crop is still searched');
    await channel.select(selected, 1); result = states.at(-1)!.result;
    assert.ok(result?.status === 'verified-found'); assert.equal(result.nearest!.label, 1); assert.equal(result.nearest!.distanceMeters, 0);
    assert.deepEqual(result.queryPosition, selected.position); assert.equal(urls.length, 2);
    for (const request of requests) { assert.deepEqual(request.input, { kind: 'point-ref', key: selected.key }); assert.deepEqual(request.domain, { kind: 'whole-dataset' }); }
    for (const cache of caches) { cache.dispose(); assert.equal(cache.resolve(0), undefined); }
  } finally { channel.dispose(); globalThis.fetch = originalFetch; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await f.clean(); }
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
        { search: { ...indexed.search, payloadBytes: 0 } },
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

test('disk result validator rejects malformed coverage, incomplete partitions, bytes, empty evidence and algorithm downgrades', async () => {
  const f = await fixture();
  try {
    const found = await queryIndexedClosestPole(f.root, f.request);
    assert.ok(found.status === 'verified-found');
    assert.equal(validatePoleResult(found, f.request).status, 'verified-found');
    assert.equal(found.search.scannedPoints, 3, 'Disk scans count mixed-category page records, not category population');
    assert.equal(found.search.index!.points, 2);
    for (const phase of ['search', 'verification'] as const) {
      const evidence = found[phase], disk = evidence.disk!;
      for (const malformed of [undefined, null, [], {}, { ...disk, extra: 1 }]) {
        assert.throws(() => validatePoleResult({ ...found, [phase]: { ...evidence, disk: malformed } }, f.request), `${phase}: malformed disk evidence`);
      }
      for (const key of Object.keys(disk) as (keyof typeof disk)[]) {
        const { [key]: omitted, ...missing } = disk;
        assert.throws(() => validatePoleResult({ ...found, [phase]: { ...evidence, disk: missing } }, f.request), `${phase}: missing ${key}`);
        for (const invalid of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
          assert.throws(() => validatePoleResult({ ...found, [phase]: { ...evidence, disk: { ...disk, [key]: invalid } } }, f.request), `${phase}: invalid ${key}`);
        }
      }
      for (const patch of [
        { totalPages: 2 }, { visitedPages: 0 }, { excludedPages: 1 }, { prunedPages: 1 }, { coveredPoints: 2 },
        { cacheBytes: 119 }, { cacheBytes: 121 }, { maxCacheReadBytes: 0 }, { maxCacheReadBytes: 39 },
        { maxCacheReadBytes: 121 }, { maxCacheReadBytes: 163841 },
        { visitedPages: 0, excludedPages: 1, cacheBytes: 0, maxCacheReadBytes: 0 },
      ]) assert.throws(() => validatePoleResult({ ...found, [phase]: { ...evidence, disk: { ...disk, ...patch } } }, f.request), `${phase}: inconsistent coverage ${JSON.stringify(patch)}`);
      for (const scannedPoints of [0, 4, 4097]) assert.throws(() => validatePoleResult({ ...found, [phase]: { ...evidence, scannedPoints } }, f.request));
    }
    for (const patch of [
      { search: { ...found.search, algorithm: 'pole-category-index-v1' } },
      { search: { ...found.search, algorithm: 'potree-semantic-full-scan-v1' } },
      { verification: { ...found.verification, verifier: 'pole-category-linear-v1' } },
      { verification: { ...found.verification, verifier: 'linear-record-oracle-v1' } },
      { search: { ...found.search, algorithm: 'pole-category-index-v1' }, verification: { ...found.verification, verifier: 'pole-category-linear-v1' } },
    ]) assert.throws(() => validatePoleResult({ ...found, ...patch }, f.request), 'Disk evidence cannot be downgraded to a legacy algorithm');

    const absent = { ...f.request, filter: { ...f.request.filter, value: 8 as const } };
    const empty = await queryIndexedClosestPole(f.root, absent);
    assert.ok(empty.status === 'verified-none'); assert.equal(validatePoleResult(empty, absent).status, 'verified-none');
    for (const phase of ['search', 'verification'] as const) {
      const evidence: SearchEvidence | VerificationEvidence = empty[phase];
      assert.deepEqual(evidence.disk, { totalPages: 1, visitedPages: 0, excludedPages: 1, prunedPages: 0, coveredPoints: 3, cacheBytes: 0, maxCacheReadBytes: 0 });
      assert.equal(evidence.scannedPoints, 0); assert.equal(evidence.matchingPoints, 0); assert.equal(evidence.payloadBytes, 0);
      for (const patch of [{ payloadBytes: 28 }, { scannedPoints: 1 }, { disk: { ...evidence.disk, maxCacheReadBytes: 40 } },
        { disk: { ...evidence.disk, cacheBytes: 40 } }, { disk: { ...evidence.disk, excludedPages: 0 } }]) {
        assert.throws(() => validatePoleResult({ ...empty, [phase]: { ...evidence, ...patch } }, absent), `${phase}: invalid empty evidence`);
      }
    }
    assert.equal(empty.sourceReads!.payloadBytes, 56, 'Empty point-ref still independently resolves both inputs, with no winner read');
  } finally { await f.clean(); }
});

test('disk validator requires exact page-size accounting and no distance pruning without a winner', async () => {
  const f = await fixture();
  try {
    const found = await queryIndexedClosestPole(f.root, f.request); assert.ok(found.status === 'verified-found');
    const absent = { ...f.request, filter: { ...f.request.filter, value: 8 as const } };
    const empty = await queryIndexedClosestPole(f.root, absent); assert.ok(empty.status === 'verified-none');
    const accepted: string[] = [];
    for (const phase of ['search', 'verification'] as const) {
      const evidence: SearchEvidence | VerificationEvidence = found[phase];
      const emptyEvidence: SearchEvidence | VerificationEvidence = empty[phase];
      const cases = [
        // The only page contains exactly three physical records. Coordinated
        // counter/byte forgery must not masquerade as one completely visited page.
        { name: 'partial-page undercount', request: f.request, value: { ...found, [phase]: { ...evidence, scannedPoints: 1,
          disk: { ...evidence.disk, cacheBytes: 40, maxCacheReadBytes: 40 } } } },
        { name: 'false maximum read', request: f.request, value: { ...found, [phase]: { ...evidence, disk: { ...evidence.disk, maxCacheReadBytes: 40 } } } },
        // Strict distance pruning requires that this phase already has a winner.
        { name: 'empty distance pruning', request: absent, value: { ...empty, [phase]: { ...emptyEvidence,
          disk: { ...emptyEvidence.disk, excludedPages: 0, prunedPages: 1 } } } },
      ];
      for (const candidate of cases) {
        try { validatePoleResult(candidate.value, candidate.request); accepted.push(`${phase}: ${candidate.name}`); } catch {}
      }
    }
    assert.deepEqual(accepted, [], 'Client must reject coordinated impossible page evidence, not only single-field mismatches');
  } finally { await f.clean(); }
});

test('validator retains strict legacy category-index and exhaustive-oracle compatibility', async () => {
  const f = await fixture();
  try {
    const oracle = await queryClosestPole(f.root, f.request);
    assert.ok(oracle.status === 'verified-found'); assert.equal(oracle.search.algorithm, 'potree-semantic-full-scan-v1');
    assert.equal(validatePoleResult(oracle, f.request).status, 'verified-found');
    const indexed = await queryIndexedClosestPole(f.root, f.request); assert.ok(indexed.status === 'verified-found');
    // Model the historical wire format, not a production fallback: legacy indexes
    // contain only category records and the independent verifier exhausts them.
    const { disk: searchDisk, ...search } = indexed.search, { disk: verifierDisk, ...verification } = indexed.verification;
    const legacy = { ...indexed,
      search: { ...search, algorithm: 'pole-category-index-v1', scannedPoints: 2, payloadBytes: 0 },
      verification: { ...verification, verifier: 'pole-category-linear-v1', scannedPoints: 2 } };
    assert.equal(validatePoleResult(legacy, f.request).status, 'verified-found');
    for (const patch of [
      { search: { ...legacy.search, scannedPoints: 3 } }, { search: { ...legacy.search, payloadBytes: 28 } },
      { verification: { ...legacy.verification, scannedPoints: 1 } }, { verification: { ...legacy.verification, verifier: 'semantic-disk-page-verifier-v1' } },
      { search: { ...legacy.search, disk: searchDisk } }, { verification: { ...legacy.verification, disk: verifierDisk } },
    ]) assert.throws(() => validatePoleResult({ ...legacy, ...patch }, f.request));
    assert.throws(() => validatePoleResult({ ...oracle, search: { ...oracle.search, disk: searchDisk } }, f.request));
  } finally { await f.clean(); }
});

test('real HTTP reuses independent verifier, ignores sample omission/LOD; validation and loopback protections', async () => {
  const f = await fixture(); const server = createDemoServer({ datasetRoot: f.root }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`;
  const path = `/datasets/toronto3d/closest-pole?${new URLSearchParams({ request: JSON.stringify(f.request) })}`;
  try {
    const response = await fetch(base + path); assert.equal(response.status, 200); const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    const result = validatePoleResult(events.at(-1).result, f.request); assert.equal(result.status, 'verified-found');
    if (result.status === 'verified-found') {
      assert.equal(result.search.algorithm, 'semantic-disk-page-index-v1'); assert.equal(result.verification.verifier, 'semantic-disk-page-verifier-v1');
      assert.equal(result.nearest!.key.sourceRow, 2); assert.equal(result.nearest!.distanceMeters, .125); assert.equal(f.sample.sourceIds[1], 0);
      for (const evidence of [result.search, result.verification]) {
        assert.deepEqual(evidence.disk, { totalPages: 1, visitedPages: 1, excludedPages: 0, prunedPages: 0, coveredPoints: 3, cacheBytes: 120, maxCacheReadBytes: 120 });
        assert.equal(evidence.scannedPoints, 3); assert.equal(evidence.index!.points, 2);
        assert.equal(evidence.payloadBytes, 28); assert.equal(evidence.resolutionPayloadBytes, 28);
      }
    }
    await new PotreeDataset(f.root).observe({ budget: 2, depth: 0 });
    const repeat = (await (await fetch(base + path)).text()).trim().split('\n').map(line => JSON.parse(line)); assert.deepEqual(repeat.at(-1).result.nearest, events.at(-1).result.nearest);
    assert.equal(repeat.at(-1).result.sourceReads.payloadBytes, 4 * 28, 'Both phases independently read the selected and winning original records');
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
