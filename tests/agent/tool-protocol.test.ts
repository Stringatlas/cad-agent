import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { TOOL_SCHEMA_VERSION, TOOL_VERSION, canonicalToolRequest, nearestRequestForTool, canonicalProtocolJson,
  detachedProtocolValue, assertPreparedArtifactIdentity, PREPARED_ASSETS,
  type ToolRequest, type DatasetInfo, type PointObservation, type ToolBinding, type NearestPoleRequest } from '@spatial/contracts';
import { ReadonlyToolRuntime, semanticToolOutcome, type ReadonlyToolAdapter, type ToolConfiguration } from '../../packages/agent-harness/src/index';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const revision = 'a'.repeat(64), config = 'b'.repeat(64);
const binding: ToolBinding = { datasetId: 'toronto3d', artifactRevision: revision, artifactDigest: 'c'.repeat(64), units: 'm', frameId: 'toronto3d-local-v1' };
const info: DatasetInfo = { id: 'toronto3d', revision, coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }, bounds: { min: [-10, -10, -10], max: [10, 10, 10] }, totalPoints: 1 };
const configuration: ToolConfiguration = { budgets: { maxCalls: 100, maxConcurrency: 2, deadlineMs: 1000, maxEvidenceBytes: 100000 },
  nearest: { algorithm: 'semantic-disk-page-index-v1', verifier: 'semantic-disk-page-verifier-v1', configHashes: Array(9).fill(config) } };
function call(tool: ToolRequest['tool'] = 'dataset.metadata', requestId = 'request'): ToolRequest {
  const common = { schemaVersion: TOOL_SCHEMA_VERSION, toolVersion: TOOL_VERSION, runId: 'run', requestId, binding: { ...binding } };
  if (tool === 'dataset.metadata') return { ...common, tool, args: {} };
  if (tool === 'dataset.observe') return { ...common, tool, args: { lod: { budget: 1, depth: 0 } } };
  return { ...common, tool, args: { input: { kind: 'coordinate', position: [0, 0, 0] }, filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: 6 }, metric: 'euclidean-3d', domain: { kind: 'whole-dataset' } } };
}
function observe(): PointObservation {
  const arrays = { positions: [1, 0, 0], colors: [0, 0, 0], sourceIds: [1, 0], labels: [6] };
  return { dataset: structuredClone(info), purpose: 'harness', lod: { budget: 1, depth: 0 }, algorithm: 'potree-bfs-even-v1', candidatePoints: 1, count: 1, bytesRead: 50, nodes: ['r'], sampleHash: hash(JSON.stringify(arrays)), ...arrays };
}
function verified(request: NearestPoleRequest) {
  const common = { scannedPoints: 1, matchingPoints: 1, hierarchyChunks: 0, payloadNodes: 0, hierarchyBytes: 0, payloadBytes: 28, metadataBytes: 200,
    maxReadBytes: 200, resolutionPoints: request.input.kind === 'point-ref' ? 1 : 0, resolutionPayloadBytes: 0, artifactRevision: revision,
    requestHash: hash(JSON.stringify(request)), index: { points: 1, hash: 'd'.repeat(64) }, disk: {
      totalPages: 1, visitedPages: 1, excludedPages: 0, prunedPages: 0, coveredPoints: 1, cacheBytes: 40, maxCacheReadBytes: 40 } };
  return { status: 'verified-found', complete: true, request: structuredClone(request), dataset: structuredClone(info), queryPosition: [0, 0, 0],
    nearest: { key: { sourceFileId: 1, sourceRow: 0 }, position: [1, 0, 0], label: request.filter.value, distanceSquared: 1, distanceMeters: 1 },
    search: { ...structuredClone(common), algorithm: 'semantic-disk-page-index-v1', arithmetic: 'xyz-binary64-v1', configHash: config, traversalHash: 'e'.repeat(64), completion: 'indexed' },
    verification: { ...structuredClone(common), verifier: 'semantic-disk-page-verifier-v1', transcriptHash: 'f'.repeat(64) } };
}
function runtime(overrides: Partial<ReadonlyToolAdapter> = {}, c = configuration) {
  return new ReadonlyToolRuntime('run', binding, c, { metadata: async () => structuredClone(info), observe: async () => observe(), nearest: async r => verified(r), ...overrides }, hash);
}

test('strict allowlist, versions, fields, finite/bounded arguments and detached canonical calls', () => {
  const q = call('dataset.nearest-label'); const canonical = canonicalToolRequest(q);
  assert.deepEqual(canonical, q);
  assert.notEqual(canonical.binding, q.binding); assert.notEqual(canonical.args, q.args);
  const common = call();
  for (const bad of [null, [], { ...common, unknown: true }, { ...common, tool: 'mutate' }, { ...common, schemaVersion: 'v2' },
    { ...common, toolVersion: 'v2' }, { ...common, runId: '../secret' }, { ...common, binding: { ...binding, revision: 1 } },
    { ...common, binding: { ...binding, artifactRevision: 'not-a-hash' } }, { ...common, args: { path: '/private/secret' } },
    { ...common, binding: { ...binding, units: 'mm' } }, { ...common, binding: { ...binding, frameId: 'world' } }]) assert.throws(() => canonicalToolRequest(bad));
  for (const lod of [{ budget: 0, depth: 0 }, { budget: 4097, depth: 0 }, { budget: Infinity, depth: 0 }, { budget: 1, depth: NaN }, { budget: 1, depth: 4 }, { budget: 1, depth: 0, path: 'secret' }]) {
    assert.throws(() => canonicalToolRequest({ ...call('dataset.observe'), args: { lod } }));
  }
  assert.equal(q.tool, 'dataset.nearest-label');
  if (q.tool !== 'dataset.nearest-label') return;
  for (const args of [{ ...q.args, extra: true }, { ...q.args, input: { kind: 'coordinate', position: [NaN, 0, 0] } },
    { ...q.args, input: { kind: 'coordinate', position: new Array(3) } },
    { ...q.args, filter: { ...q.args.filter, value: 9 } }, { ...q.args, metric: '2d' },
    { ...q.args, input: { kind: 'point-ref', key: { sourceFileId: 0, sourceRow: 0 } } },
    { ...q.args, domain: { kind: 'aabb', min: [1, 0, 0], max: [0, 1, 1] } }]) assert.throws(() => canonicalToolRequest({ ...q, args }));
  assert.throws(() => canonicalToolRequest({ ...common, [Symbol('extra')]: true }));
  assert.throws(() => canonicalToolRequest(Object.defineProperty({ ...common }, 'args', { get: () => ({}) })));
  assert.equal(canonicalProtocolJson({ z: -0, a: 2 }), '{"a":2,"z":0}');
});

test('all three tools carry coverage, detached results and canonical all-label/domain forwarding', async () => {
  const r = runtime(); const a = await r.execute(call());
  assert.equal(a.outcome.status, 'observed');
  if (a.outcome.status === 'observed') { assert.equal(a.outcome.coverage, 'metadata-only'); assert.notEqual(a.outcome.data, info); }
  const observation = await r.execute(call('dataset.observe', 'observation'));
  assert.equal(observation.outcome.status, 'observed');
  if (observation.outcome.status === 'observed') assert.equal(observation.outcome.coverage, 'bounded-first-chunk-sample');
  const forwarded: NearestPoleRequest[] = [];
  const forward = runtime({ nearest: async request => { forwarded.push(request); return { status: 'incomplete', complete: false, reason: 'resource' }; } });
  for (let label = 0; label < 9; label++) {
    const q = call('dataset.nearest-label', `label-${label}`);
    if (q.tool !== 'dataset.nearest-label') throw new Error('Fixture');
    const domain = label % 2 ? { kind: 'aabb' as const, min: [-2, -2, -2] as const, max: [2, 2, 2] as const } : { kind: 'whole-dataset' as const };
    const input = label % 2 ? { kind: 'point-ref' as const, key: { sourceFileId: 1, sourceRow: label } } : q.args.input;
    const canonical = canonicalToolRequest({ ...q, args: { ...q.args, filter: { ...q.args.filter, value: label }, domain, input } });
    const result = await forward.execute(canonical);
    assert.deepEqual(result.outcome, { status: 'incomplete', complete: false, reason: 'resource' });
    assert.deepEqual(forwarded.at(-1), nearestRequestForTool(canonical as Extract<ToolRequest, { tool: 'dataset.nearest-label' }>));
  }
});

test('invalid/stale binding and repeat IDs fail before adapter work; budgets are strict', async () => {
  let calls = 0;
  const r = runtime({ metadata: async () => { calls++; return info; } }, { ...configuration, budgets: { ...configuration.budgets, maxCalls: 1 } });
  assert.deepEqual((await r.execute({ ...call(), binding: { ...binding, artifactRevision: '0'.repeat(64) } })).outcome, { status: 'error', code: 'stale-binding' });
  assert.deepEqual((await r.execute({ ...call(), binding: { ...binding, artifactDigest: '0'.repeat(64) } })).outcome, { status: 'error', code: 'stale-binding' });
  assert.deepEqual((await r.execute({ ...call(), runId: 'different' })).outcome, { status: 'error', code: 'stale-binding' });
  assert.equal((await r.execute({ ...call(), args: { path: 'secret' } })).request, null); assert.equal(calls, 0);
  assert.equal((await r.execute(call())).outcome.status, 'observed');
  assert.deepEqual((await r.execute(call())).outcome, { status: 'error', code: 'invalid-input' });
  assert.deepEqual((await r.execute(call('dataset.metadata', 'new'))).outcome, { status: 'error', code: 'budget' }); assert.equal(calls, 1);
  for (const budgets of [{ ...configuration.budgets, maxCalls: 0 }, { ...configuration.budgets, maxConcurrency: NaN }, { ...configuration.budgets, deadlineMs: -1 }, { ...configuration.budgets, maxEvidenceBytes: Infinity }]) assert.throws(() => runtime({}, { ...configuration, budgets }));
  assert.throws(() => runtime({}, { ...configuration, nearest: { ...configuration.nearest, configHashes: new Array<string>(9) } }));
});

test('returned observations and metadata reject stale/damaged/wrong-purpose/unknown data', async () => {
  for (const bad of [{ ...info, revision: '0'.repeat(64) }, { ...info, extra: 'secret' }, { ...info, coordinates: { ...info.coordinates, localOrigin: [0, 0, 0] } }]) {
    assert.deepEqual((await runtime({ metadata: async () => bad }).execute(call())).outcome, { status: 'error', code: 'corrupt-data' });
  }
  for (const bad of [{ ...observe(), purpose: 'display' }, { ...observe(), count: 2 }, { ...observe(), lod: { budget: 2, depth: 0 } },
    { ...observe(), sampleHash: '0'.repeat(64) }, { ...observe(), positions: [NaN, 0, 0] }, { ...observe(), positions: new Array(3) }, { ...observe(), sourceIds: [0, 0] },
    { ...observe(), secret: 'credential' }, { ...observe(), nodes: ['arbitrary/path'] }]) {
    assert.deepEqual((await runtime({ observe: async () => bad }).execute(call('dataset.observe'))).outcome, { status: 'error', code: 'corrupt-data' });
  }
});

test('trusted verified outcomes retained; forged status, request, witness, configuration and evidence rejected', async () => {
  const q = call('dataset.nearest-label'); if (q.tool !== 'dataset.nearest-label') throw new Error('Fixture');
  const raw = verified(nearestRequestForTool(q));
  assert.equal((await runtime().execute(q)).outcome.status, 'verified-found');
  const mutations: ((r: ReturnType<typeof verified>) => unknown)[] = [
    r => ({ ...r, status: 'complete' }), r => ({ ...r, complete: false }), r => ({ ...r, secret: 'credentials' }),
    r => ({ ...r, status: 'verified-none' }), r => ({ ...r, request: { ...r.request, requestId: 'different' } }),
    r => ({ ...r, dataset: { ...r.dataset, revision: '0'.repeat(64) } }), r => ({ ...r, queryPosition: [1, 0, 0] }),
    r => ({ ...r, nearest: { ...r.nearest, label: 1 } }), r => ({ ...r, nearest: { ...r.nearest, distanceSquared: .5 } }),
    r => ({ ...r, nearest: { ...r.nearest, key: { sourceFileId: 0, sourceRow: 0 } } }),
    r => ({ ...r, search: { ...r.search, requestHash: '0'.repeat(64) } }), r => ({ ...r, search: { ...r.search, configHash: '0'.repeat(64) } }),
    r => ({ ...r, verification: { ...r.verification, artifactRevision: '0'.repeat(64) } }), r => ({ ...r, verification: { ...r.verification, matchingPoints: 0 } }),
    r => ({ ...r, verification: { ...r.verification, verifier: 'forged' } }), r => ({ ...r, search: { ...r.search, disk: { ...r.search.disk, coveredPoints: 0 } } }),
    r => ({ ...r, verification: { ...r.verification, disk: undefined } }), r => ({ ...r, sourceReads: { secret: 'key' } }),
  ];
  for (const mutate of mutations) {
    const result = await runtime({ nearest: async () => mutate(structuredClone(raw)) }).execute(q);
    assert.deepEqual(result.outcome, { status: 'verification-rejected', reason: 'evidence-binding' });
  }
  const none = structuredClone(raw);
  const empty = { ...none, status: 'verified-none', nearest: null,
    search: { ...none.search, matchingPoints: 0, index: { ...none.search.index, points: 0 } },
    verification: { ...none.verification, matchingPoints: 0, index: { ...none.verification.index, points: 0 } } };
  assert.equal((await runtime({ nearest: async () => empty }).execute(q)).outcome.status, 'verified-none');
});

for (const absent of [true, false]) test(`whole-dataset indexed proofs reject ${absent ? 'false absence' : 'found undercounts'}; AABB permits category subsets`, async () => {
  const q = call('dataset.nearest-label'); if (q.tool !== 'dataset.nearest-label') throw new Error('Fixture');
  for (const algorithm of ['semantic-disk-page-index-v1', 'pole-category-index-v1'] as const) {
    const c = { ...configuration, nearest: { ...configuration.nearest, algorithm,
      verifier: algorithm === 'semantic-disk-page-index-v1' ? 'semantic-disk-page-verifier-v1' as const : 'pole-category-linear-v1' as const } };
    const answer = (request: NearestPoleRequest) => {
      const r = verified(request);
      const proof = { scannedPoints: 2, matchingPoints: absent ? 0 : 1, index: { points: 2, hash: 'd'.repeat(64) } };
      const search = { ...r.search, ...proof, algorithm, disk: { ...r.search.disk, coveredPoints: 2, cacheBytes: 80 } };
      const verification = { ...r.verification, ...proof, verifier: c.nearest.verifier, disk: { ...r.verification.disk, coveredPoints: 2, cacheBytes: 80 } };
      if (algorithm === 'pole-category-index-v1') { Reflect.deleteProperty(search, 'disk'); Reflect.deleteProperty(verification, 'disk'); }
      return { ...r, status: absent ? 'verified-none' : 'verified-found', nearest: absent ? null : r.nearest,
        dataset: { ...r.dataset, totalPoints: 2 }, search, verification };
    };
    const adapter = { nearest: async (request: NearestPoleRequest) => answer(request) };
    assert.deepEqual((await runtime(adapter, c).execute(q)).outcome, { status: 'verification-rejected', reason: 'evidence-binding' });
    const aabb: ToolRequest = { ...q, args: { ...q.args, domain: { kind: 'aabb', min: [-2, -2, -2], max: [2, 2, 2] } } };
    assert.equal((await runtime(adapter, c).execute(aabb)).outcome.status, absent ? 'verified-none' : 'verified-found');
  }
});

test('changing observation array accessors are rejected without reading them', async () => {
  const sample = observe(); let reads = 0;
  Object.defineProperty(sample.positions, '0', { enumerable: true, configurable: true, get: () => ++reads <= 3 ? 1 : 8 });
  const reply = await runtime({ observe: async () => sample }).execute(call('dataset.observe'));
  assert.deepEqual(reply.outcome, { status: 'error', code: 'corrupt-data' });
  assert.equal(reads, 0);
});

const badArrays: readonly [string, (array: unknown[]) => void][] = [
  ['accessor', a => { Object.defineProperty(a, '0', { enumerable: true, get: () => { throw new Error('must not invoke accessor'); } }); }],
  ['symbol', a => { Object.defineProperty(a, Symbol('extra'), { value: 1 }); }],
  ['property', a => { Object.defineProperty(a, 'extra', { value: 1, enumerable: true }); }],
  ['prototype', a => { Object.setPrototypeOf(a, Object.create(Array.prototype)); }],
  ['iterator', a => { Object.defineProperty(a, Symbol.iterator, { value: function* () { yield* [0, 0, 0]; } }); }],
  ['map', a => { Object.defineProperty(a, 'map', { value: Array.prototype.map }); }],
  ['toJSON', a => { Object.defineProperty(a, 'toJSON', { value: () => [0, 0, 0] }); }],
  ['sparse', a => { Reflect.deleteProperty(a, '0'); }],
  ['hidden-element', a => { Object.defineProperty(a, '0', { enumerable: false }); }],
];

test('strict arrays apply to request coordinates/domains, canonical detachment, configuration and artifact identity', async () => {
  const q = call('dataset.nearest-label'); if (q.tool !== 'dataset.nearest-label') throw new Error('Fixture');
  for (const [name, damage] of badArrays) {
    const coordinates = [0, 0, 0]; damage(coordinates);
    assert.throws(() => canonicalToolRequest({ ...q, args: { ...q.args, input: { kind: 'coordinate', position: coordinates } } }), name);
    assert.throws(() => canonicalToolRequest({ ...q, args: { ...q.args, domain: { kind: 'aabb', min: coordinates, max: [2, 2, 2] } } }), name);
    assert.throws(() => canonicalProtocolJson(coordinates), name); assert.throws(() => detachedProtocolValue(coordinates), name);
    const configHashes = Array(9).fill(config); damage(configHashes);
    assert.throws(() => runtime({}, { ...configuration, nearest: { ...configuration.nearest, configHashes } }), name);
    const assets = PREPARED_ASSETS.map(asset => ({ name: asset, size: 1, sha256: config })); damage(assets);
    assert.throws(() => assertPreparedArtifactIdentity({ revision, digest: config, assets }), name);
    assert.deepEqual((await runtime().execute({ ...q, args: { ...q.args, input: { kind: 'coordinate', position: coordinates } } })).outcome,
      { status: 'error', code: 'invalid-input' }, name);
  }
});

test('strict arrays apply to metadata, observation nodes/content, returned queries and witnesses', async () => {
  const q = call('dataset.nearest-label'); if (q.tool !== 'dataset.nearest-label') throw new Error('Fixture');
  for (const [name, damage] of badArrays) {
    for (const location of ['localOrigin', 'min', 'max'] as const) {
      const d = structuredClone(info); damage((location === 'localOrigin' ? d.coordinates.localOrigin : d.bounds[location]) as unknown as unknown[]);
      assert.deepEqual((await runtime({ metadata: async () => d }).execute(call())).outcome, { status: 'error', code: 'corrupt-data' }, `${name}/${location}`);
    }
    for (const field of ['nodes', 'positions', 'colors', 'sourceIds', 'labels'] as const) {
      const o = observe(); damage(o[field] as unknown[]);
      assert.deepEqual((await runtime({ observe: async () => o }).execute(call('dataset.observe'))).outcome,
        { status: 'error', code: 'corrupt-data' }, `${name}/${field}`);
    }
    for (const field of ['queryPosition', 'witness', 'request'] as const) {
      const r = verified(nearestRequestForTool(q));
      const array = field === 'queryPosition' ? r.queryPosition : field === 'witness' ? r.nearest.position : r.request.input.kind === 'coordinate' ? r.request.input.position : [];
      damage(array as unknown[]);
      assert.deepEqual((await runtime({ nearest: async () => r }).execute(q)).outcome,
        { status: 'verification-rejected', reason: 'evidence-binding' }, `${name}/${field}`);
    }
  }
});

test('ordinary frozen arrays publish an inert bounded sample with its recomputed content hash', async () => {
  const o = observe(); for (const a of [o.nodes, o.positions, o.colors, o.sourceIds, o.labels, o.dataset.coordinates.localOrigin, o.dataset.bounds.min, o.dataset.bounds.max]) Object.freeze(a);
  const frozenHashes = Object.freeze(Array(9).fill(config));
  const reply = await runtime({ observe: async () => o }, { ...configuration, nearest: { ...configuration.nearest, configHashes: frozenHashes } }).execute(call('dataset.observe'));
  assert.equal(reply.outcome.status, 'observed');
  if (reply.outcome.status !== 'observed' || reply.outcome.kind !== 'observation') throw new Error('Fixture');
  const data = reply.outcome.data;
  assert.equal(hash(JSON.stringify({ positions: data.positions, colors: data.colors, sourceIds: data.sourceIds, labels: data.labels })), data.sampleHash);
  assert.notEqual(data.positions, o.positions);
  const maxArrays = { positions: Array(4096 * 3).fill(0), colors: Array(4096 * 3).fill(0), sourceIds: Array.from({ length: 4096 * 2 }, (_, i) => i % 2 ? 0 : 1), labels: Array(4096).fill(6) };
  const maxSample = { ...observe(), dataset: { ...structuredClone(info), totalPoints: 4096 }, lod: { budget: 4096, depth: 3 },
    candidatePoints: 4096, count: 4096, ...maxArrays, sampleHash: hash(JSON.stringify(maxArrays)) };
  assert.equal((await runtime({ observe: async () => maxSample }).execute({ ...call('dataset.observe'), args: { lod: maxSample.lod } })).outcome.status, 'observed');
  const huge = new Array(100000000); let reads = 0;
  Object.defineProperty(huge, '0', { get: () => { reads++; return 1; } });
  assert.deepEqual((await runtime({ observe: async () => ({ ...observe(), positions: huge }) }).execute(call('dataset.observe'))).outcome,
    { status: 'error', code: 'corrupt-data' }); assert.equal(reads, 0);
});

test('error, resource and verification rejection are distinct and adapter freeform text is never returned', async () => {
  const outcomes = [ { status: 'error', code: 'unknown-point' }, { status: 'incomplete', complete: false, reason: 'resource' },
    { status: 'verification-rejected', reason: 'secret=/private/credential' } ];
  for (const outcome of outcomes) {
    const reply = await runtime({ nearest: async () => outcome }).execute(call('dataset.nearest-label'));
    assert.equal(reply.outcome.status, outcome.status); assert.ok(!JSON.stringify(reply).includes('credential'));
  }
  const unavailable = await runtime({ nearest: async () => { throw new Error('secret exception'); } }).execute(call('dataset.nearest-label'));
  assert.deepEqual(unavailable.outcome, { status: 'error', code: 'unavailable' });
  assert.deepEqual((await runtime({ observe: async () => outcomes[1] }).execute(call('dataset.observe'))).outcome, outcomes[1]);
  assert.deepEqual((await runtime({ metadata: async () => outcomes[1] }).execute(call())).outcome, outcomes[1]);
});

test('caller cancellation, deadline, late resolution and rejection do not publish success or bypass concurrency', async () => {
  let resolve!: (value: unknown) => void, seen!: AbortSignal;
  const r = runtime({ metadata: signal => { seen = signal; return new Promise(r => { resolve = r; }); } },
    { ...configuration, budgets: { ...configuration.budgets, maxConcurrency: 1 } });
  const controller = new AbortController(); const first = r.execute(call(), controller.signal);
  assert.throws(() => r.traceRecords(), /unpublished/);
  assert.deepEqual((await r.execute(call('dataset.metadata', 'busy'))).outcome, { status: 'error', code: 'busy' });
  controller.abort(); assert.deepEqual((await first).outcome, { status: 'incomplete', complete: false, reason: 'cancelled' }); assert.ok(seen.aborted);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.deepEqual((await r.execute(call('dataset.metadata', 'still-busy'))).outcome, { status: 'error', code: 'busy' });
  resolve(info); await sleep(0);
  assert.equal(r.traceRecords().length, 1); assert.equal(r.traceRecords()[0].status, 'incomplete');
  const later = r.execute(call('dataset.metadata', 'later')); resolve(info); assert.equal((await later).outcome.status, 'observed');
  let reject!: (error: Error) => void;
  const deadline = runtime({ metadata: signal => { seen = signal; return new Promise((_r, r) => { reject = r; }); } },
    { ...configuration, budgets: { ...configuration.budgets, deadlineMs: 5 } });
  assert.deepEqual((await deadline.execute(call())).outcome, { status: 'incomplete', complete: false, reason: 'deadline' }); assert.ok(seen.aborted);
  reject(new Error('late secret')); await sleep(0); assert.equal(deadline.traceRecords().length, 1);
  const aborted = new AbortController(); aborted.abort(); let work = 0;
  assert.deepEqual((await runtime({ metadata: async () => { work++; return info; } }).execute(call(), aborted.signal)).outcome,
    { status: 'incomplete', complete: false, reason: 'cancelled' }); assert.equal(work, 0);
});

test('monotonic deadlines suppress synchronous event-loop-blocking late success; success cleans listeners/timers', async () => {
  const configurationWithDeadline = { ...configuration, budgets: { ...configuration.budgets, deadlineMs: 2 } };
  let child!: AbortSignal;
  const late = await runtime({ metadata: async signal => { child = signal; const until = performance.now() + 10;
    while (performance.now() < until) { /* deliberately noncooperative trusted adapter */ }
    return info; } }, configurationWithDeadline).execute(call());
  assert.deepEqual(late.outcome, { status: 'incomplete', complete: false, reason: 'deadline' }); assert.ok(child.aborted);
  const controller = new AbortController();
  const timely = runtime({ metadata: async signal => { child = signal; return info; } }, { ...configuration, budgets: { ...configuration.budgets, deadlineMs: 50 } });
  assert.equal((await timely.execute(call(), controller.signal)).outcome.status, 'observed');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  await sleep(55); assert.equal(child.aborted, false);
});

test('canonical semantic outcomes ignore physical read/cache/timing work, never semantic changes', async () => {
  const a = await runtime().execute(call('dataset.nearest-label'));
  const b = await runtime({ nearest: async request => { const r = verified(request); r.search.payloadBytes += 10; r.verification.metadataBytes += 10;
    r.search.traversalHash = '0'.repeat(64); r.verification.transcriptHash = '0'.repeat(64); r.search.index.hash = '1'.repeat(64); r.verification.index.hash = '1'.repeat(64);
    return { ...r, sourceReads: { metadataBytes: 100, hierarchyBytes: 22, payloadBytes: 100, maxReadBytes: 100 } }; } }).execute(call('dataset.nearest-label'));
  assert.equal(a.outcome.status, 'verified-found'); assert.equal(b.outcome.status, 'verified-found');
  assert.deepEqual(semanticToolOutcome(a.outcome), semanticToolOutcome(b.outcome));
  const observation = observe();
  const c = await runtime({ observe: async () => ({ ...observation, bytesRead: 999 }) }).execute(call('dataset.observe'));
  const d = await runtime().execute(call('dataset.observe'));
  assert.deepEqual(semanticToolOutcome(c.outcome), semanticToolOutcome(d.outcome));
});
