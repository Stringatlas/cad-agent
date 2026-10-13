import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { NearestPoleRequest, NearestPoleToolOutcome } from '@spatial/contracts';
import { SemanticArtifact, SEMANTIC_LIMITS } from '../apps/server/src/semantic-artifact';
import { queryClosestPole } from '../apps/server/src/semantic-query';
import { queryIndexedClosestPole, preparePoleIndex, dropPoleIndexMemoryCache } from '../apps/server/src/pole-index';

type Point = { p: number[]; file: number; row: number; label: number };
async function fixture(points: Point[] = [
  { p: [1, 0, 120], file: 2, row: 0, label: 6 }, { p: [0, 0, 120], file: 1, row: 0, label: 1 },
  { p: [-1, 0, 120], file: 1, row: 1, label: 6 }, { p: [1, 0, 120], file: 2, row: 1, label: 6 },
  { p: [.125, 0, 120], file: 1, row: 2, label: 6 }, { p: [.001, 0, 120], file: 1, row: 3, label: 4 },
  { p: [9, 9, 129], file: 3, row: 0, label: 6 },
]) {
  const root = await mkdtemp(join(tmpdir(), 'spatial-pole-index-test-'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: points.length, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-100, -100, 100], max: [100, 100, 140] }, scale: [.001, .001, .001], offset: [0, 0, 120], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-100, -100, 100], max: [100, 100, 140] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 },
    ] };
  const payload = Buffer.alloc(points.length * 28);
  points.forEach((p, i) => {
    p.p.forEach((n, axis) => payload.writeInt32LE(Math.round((n - metadata.offset[axis]) * 1000), i * 28 + axis * 4));
    payload.writeUInt16LE(p.file, i * 28 + 18); payload.writeUInt32LE(p.row, i * 28 + 20); payload.writeFloatLE(p.label, i * 28 + 24);
  });
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(points.length, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: [.001, .001, .001],
    semantic_attribute: 'scalar_Label', semantic_classes: { '6': 'Pole' }, sources: [1, 2, 3, 4].map(file => ({ source_file_id: file,
      file: `L00${file}.ply`, points: points.filter(p => p.file === file).length })) };
  await mkdir(join(root, 'octree')); await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  let cache: string | undefined;
  return { root, payload, hierarchy, metadata, points, setCache: (path: string) => { cache = path; },
    clean: async () => { dropPoleIndexMemoryCache(); await rm(root, { recursive: true, force: true }); if (cache) await rm(cache, { recursive: true, force: true }); } };
}
async function request(root: string, input: NearestPoleRequest['input'] = { kind: 'coordinate', position: [0, 0, 120] }, domain: NearestPoleRequest['domain'] = { kind: 'whole-dataset' }): Promise<NearestPoleRequest> {
  const snapshot = await SemanticArtifact.open(root);
  try { return { requestId: 'index-test', datasetId: 'toronto3d', expectedArtifactRevision: snapshot.dataset.revision, units: 'm', frameId: 'toronto3d-local-v1',
    input, filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: 6 }, metric: 'euclidean-3d', domain }; }
  finally { await snapshot.close(); }
}
function verified(value: NearestPoleToolOutcome) { assert.ok(value.status === 'verified-found' || value.status === 'verified-none', JSON.stringify(value)); return value; }
async function compare(root: string, r: NearestPoleRequest) {
  const a = verified(await queryIndexedClosestPole(root, r)), oracle = verified(await queryClosestPole(root, r));
  assert.deepEqual(a.nearest, oracle.nearest); assert.deepEqual(a.queryPosition, oracle.queryPosition);
  assert.equal(a.search.matchingPoints, oracle.search.matchingPoints); assert.equal(a.verification.matchingPoints, oracle.verification.matchingPoints);
  assert.equal(a.search.algorithm, 'pole-category-index-v1'); assert.equal(a.search.completion, 'indexed');
  assert.equal(a.verification.verifier, 'pole-category-linear-v1'); assert.equal(a.verification.scannedPoints, a.search.index!.points);
  assert.deepEqual(a.search.index, a.verification.index); assert.match(a.search.index!.hash, /^[a-f0-9]{64}$/);
  return a;
}

test('indexed oracle parity: ties, adjacent binary64 queries, inclusive AABB, references and empty domains', async () => {
  const f = await fixture();
  try {
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); assert.equal(prep.indexedPoints, 5);
    for (const p of [[0, 0, 120], [.5, 0, 120], [.5 - Number.EPSILON, 0, 120], [.5 + Number.EPSILON, 0, 120], [1000, 1000, 1000]] as const) await compare(f.root, await request(f.root, { kind: 'coordinate', position: p }));
    for (const domain of [{ kind: 'aabb', min: [.125, -.5, 119], max: [1, .5, 120] }, { kind: 'aabb', min: [0, -.5, 119], max: [.01, .5, 121] },
      { kind: 'aabb', min: [-2, -1, 119], max: [-.5, 1, 121] }] as const) await compare(f.root, await request(f.root, undefined, domain));
    const ref = await compare(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 2 } }));
    assert.equal(ref.nearest!.distanceSquared, 0); assert.equal(ref.search.resolutionPoints, 1); assert.equal(ref.verification.resolutionPoints, 1);
    assert.equal(ref.sourceReads!.payloadBytes, 84); assert.ok(ref.search.scannedPoints < f.points.length);
    assert.equal(verified(await queryIndexedClosestPole(f.root, await request(f.root))).sourceReads!.payloadBytes, 28);
    assert.deepEqual(await queryIndexedClosestPole(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 4, sourceRow: 0 } })), { status: 'error', code: 'unknown-point' });
  } finally { await f.clean(); }
});

test('random spatial/domain results exactly equal retained exhaustive oracle', async () => {
  let seed = 719; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const points = Array.from({ length: 1500 }, (_, row) => ({ p: [Math.round((random() - .5) * 150000) / 1000, Math.round((random() - .5) * 150000) / 1000, 110 + Math.round(random() * 20000) / 1000], file: 1, row, label: row % 3 ? 1 : 6 }));
  const f = await fixture(points);
  try {
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory);
    for (let i = 0; i < 16; i++) {
      const x = (random() - .5) * 160, y = (random() - .5) * 160;
      await compare(f.root, await request(f.root, { kind: 'coordinate', position: [x, y, 120] }, i % 2 ? { kind: 'whole-dataset' } : { kind: 'aabb', min: [x - 12, y - 12, 105], max: [x + 12, y + 12, 130] }));
    }
    await compare(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 849 } }));
  } finally { await f.clean(); }
});

test('numeric provenance tie-breaking and adjacent binary64 distances match exhaustive oracle', async () => {
  const f = await fixture([{ p: [0, 0, 120], file: 2, row: 0, label: 6 }, { p: [1, 0, 120], file: 1, row: 0, label: 6 }]);
  try {
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory);
    for (const x of [.5, .5 - Number.EPSILON, .5 + Number.EPSILON]) {
      const a = await compare(f.root, await request(f.root, { kind: 'coordinate', position: [x, 0, 120] }));
      assert.equal(a.nearest!.key.sourceFileId, x < .5 ? 2 : 1);
    }
  } finally { await f.clean(); }
});

test('no Poles still certifies complete category and zero source payload reads on warm query', async () => {
  const f = await fixture([{ p: [0, 0, 120], file: 1, row: 0, label: 1 }]);
  try {
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory);
    const a = await compare(f.root, await request(f.root)); assert.equal(a.status, 'verified-none'); assert.equal(a.search.index!.points, 0); assert.equal(a.sourceReads!.payloadBytes, 0);
  } finally { await f.clean(); }
});

test('persistent restart loads only category; two concurrent callers share one full build', async () => {
  const f = await fixture();
  try {
    const r = await request(f.root), outcomes = await Promise.all([queryIndexedClosestPole(f.root, r), queryIndexedClosestPole(f.root, r)]);
    const a = verified(outcomes[0]), b = verified(outcomes[1]); assert.deepEqual(a.nearest, b.nearest);
    assert.equal(a.sourceReads!.payloadBytes + b.sourceReads!.payloadBytes, f.payload.length + 56);
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); assert.equal(prep.cache, 'memory');
    dropPoleIndexMemoryCache();
    const reload = await preparePoleIndex(f.root); assert.equal(reload.cache, 'loaded'); assert.equal(reload.sourceReads.payloadBytes, 0); assert.equal(reload.indexHash, prep.indexHash);
    const ref = verified(await queryIndexedClosestPole(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 0 } })));
    assert.equal(ref.sourceReads!.payloadBytes, 84); assert.ok(ref.sourceReads!.maxReadBytes <= SEMANTIC_LIMITS.metadataBytes);
  } finally { await f.clean(); }
});

test('cancellation never publishes partial state; all query phases cancel and retry', async () => {
  const f = await fixture();
  try {
    const r = await request(f.root), controller = new AbortController();
    assert.deepEqual(await queryIndexedClosestPole(f.root, r, controller.signal, p => { if (p.phase === 'index') controller.abort(); }), { status: 'incomplete', complete: false, reason: 'cancelled' });
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); assert.equal(prep.cache, 'built');
    for (const phase of ['resolve', 'search', 'verify-resolve', 'verify']) {
      const abort = new AbortController();
      const result = await queryIndexedClosestPole(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 0 } }), abort.signal, p => { if (p.phase === phase) abort.abort(); });
      assert.deepEqual(result, { status: 'incomplete', complete: false, reason: 'cancelled' });
    }
    verified(await queryIndexedClosestPole(f.root, r));
  } finally { await f.clean(); }
});

test('an aborted build owner does not poison a concurrent waiter', async () => {
  const f = await fixture();
  try {
    const r = await request(f.root), controllers = [new AbortController(), new AbortController()];
    const phases: string[][] = [[], []];
    let started = 0, owner: number | undefined, aborts = 0;
    // Snapshot opens race before the build gate: launch order does not identify its owner.
    const queries = controllers.map((controller, caller) => {
      started++;
      return queryIndexedClosestPole(f.root, r, controller.signal, p => {
        phases[caller].push(p.phase);
        if (p.phase === 'index' && owner === undefined) {
          assert.equal(started, 2, 'both queries must begin before cold-build progress');
          owner = caller; aborts++; controller.abort();
        }
      });
    });
    const outcomes = await Promise.all(queries);
    assert.notEqual(owner, undefined, 'a cold build must report index progress');
    const actualOwner = owner!, waiter = 1 - actualOwner;
    assert.equal(aborts, 1, 'abort only the first build, never the waiter rebuild');
    assert.equal(controllers[actualOwner].signal.aborted, true);
    assert.equal(controllers[waiter].signal.aborted, false);
    assert.deepEqual(phases[actualOwner], ['index'], 'owner stops at its first build checkpoint');
    assert.equal(phases[waiter].filter(phase => phase === 'index').length, 1, 'waiter must rebuild after cancellation');
    assert.ok(phases[waiter].includes('search') && phases[waiter].includes('verify'));
    assert.deepEqual(outcomes[actualOwner], { status: 'incomplete', complete: false, reason: 'cancelled' });
    const survivor = verified(outcomes[waiter]);
    assert.equal(survivor.sourceReads!.payloadBytes, f.payload.length + 28, 'waiter rebuilds and reads the original winner');
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); assert.equal(prep.cache, 'memory');
  } finally { await f.clean(); }
});

test('same revision identity change invalidates cache, and in-flight mutation cannot certify', async () => {
  const f = await fixture(); let oldCache: string | undefined;
  try {
    const r = await request(f.root), before = await preparePoleIndex(f.root); oldCache = before.directory;
    const path = join(f.root, 'manifest.json'); await writeFile(path, await readFile(path)); // same fingerprint, new ctime
    assert.equal((await request(f.root)).expectedArtifactRevision, r.expectedArtifactRevision);
    const after = await preparePoleIndex(f.root); f.setCache(after.directory); assert.equal(after.cache, 'built'); assert.notEqual(after.indexHash, before.indexHash);
    let mutation: Promise<void> | undefined;
    const result = await queryIndexedClosestPole(f.root, r, undefined, p => { if (p.phase === 'verify' && !mutation) mutation = writeFile(join(f.root, 'octree/octree.bin'), f.payload); });
    await mutation; assert.deepEqual(result, { status: 'error', code: 'stale-revision' });
  } finally { await f.clean(); if (oldCache) await rm(oldCache, { recursive: true, force: true }); }
});

test('persistent category/lookup corruption is rejected, never sampled/rebuilt silently', async () => {
  for (const asset of ['poles.bin', 'source-1.bin', 'index.json']) {
    const f = await fixture();
    try {
      const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); dropPoleIndexMemoryCache();
      const path = join(prep.directory, asset), bytes = await readFile(path); bytes[0] ^= 1; await writeFile(path, bytes);
      const a = await queryIndexedClosestPole(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 0 } }));
      assert.deepEqual(a, { status: 'error', code: 'corrupt-data' }, asset);
    } finally { await f.clean(); }
  }
});

test('cold build rejects duplicate/missing provenance, invalid labels/positions and invalid hierarchy', async () => {
  for (const mutate of [(b: Buffer) => b.writeUInt32LE(9, 20), (b: Buffer) => b.writeFloatLE(NaN, 24), (b: Buffer) => b.writeInt32LE(1000000, 0),
    (b: Buffer) => { b.writeUInt16LE(1, 18); b.writeUInt32LE(0, 20); }]) {
    const f = await fixture();
    try { mutate(f.payload); await writeFile(join(f.root, 'octree/octree.bin'), f.payload); assert.deepEqual(await queryIndexedClosestPole(f.root, await request(f.root)), { status: 'error', code: 'corrupt-data' }); }
    finally { await f.clean(); }
  }
  const f = await fixture();
  try {
    f.hierarchy.writeBigUInt64LE(28n, 6); await writeFile(join(f.root, 'octree/hierarchy.bin'), f.hierarchy);
    assert.deepEqual(await queryIndexedClosestPole(f.root, await request(f.root)), { status: 'error', code: 'corrupt-data' });
  } finally { await f.clean(); }
});

test('large bounded cold build and distant non-Pole lookup do not scan the dataset again', async () => {
  const f = await fixture(Array.from({ length: 160001 }, (_, row) => ({ p: [0, 0, 120], file: 1, row, label: row === 160000 ? 6 : 1 })));
  try {
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); assert.equal(prep.sourceReads.payloadBytes, f.payload.length); assert.ok(prep.sourceReads.maxReadBytes <= SEMANTIC_LIMITS.readBytes);
    const r = await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 151515 } });
    const a = verified(await queryIndexedClosestPole(f.root, r)); assert.equal(a.nearest!.key.sourceRow, 160000); assert.equal(a.sourceReads!.payloadBytes, 84);
    dropPoleIndexMemoryCache(); const b = verified(await queryIndexedClosestPole(f.root, r)); assert.deepEqual(b.nearest, a.nearest); assert.equal(b.sourceReads!.payloadBytes, 84);
    // Verify the physical direct map points to the selected key's real record.
    const file = await open(join(prep.directory, 'source-1.bin'), 'r');
    try { const bytes = Buffer.alloc(4); await file.read(bytes, 0, 4, 151515 * 4); assert.equal(bytes.readUInt32LE(), 151515); } finally { await file.close(); }
  } finally { await f.clean(); }
});
