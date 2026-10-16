import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readFile, open, rename, symlink, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalPoleRequest, TORONTO_SEMANTIC_LABELS, type TorontoSemanticLabel, type NearestPoleRequest, type NearestPoleToolOutcome } from '@spatial/contracts';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createIsolatedDemoServer as createDemoServer } from '../scripts/isolated-demo-server';
import { SemanticArtifact, SEMANTIC_LIMITS } from '../apps/server/src/semantic-artifact';
import { queryClosestPole } from '../apps/server/src/semantic-query';
import { queryIndexedClosestPole, preparePoleIndex, dropPoleIndexMemoryCache } from '../apps/server/src/pole-index';
import { getSemanticDiskIndex, pagePoints } from '../apps/server/src/semantic-disk-index';
import { verifySemanticDisk } from '../apps/server/src/semantic-disk-verifier';

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
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1, 2, 3, 4].map(file => ({ source_file_id: file,
      file: `L00${file}.ply`, points: points.filter(p => p.file === file).length })) };
  await mkdir(join(root, 'octree')); await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const caches = new Set<string>();
  return { root, payload, hierarchy, metadata, points, setCache: (path: string) => { caches.add(path); },
    clean: async () => { dropPoleIndexMemoryCache(); await rm(root, { recursive: true, force: true }); await Promise.all([...caches].map(cache => rm(cache, { recursive: true, force: true }))); } };
}
async function request(root: string, input: NearestPoleRequest['input'] = { kind: 'coordinate', position: [0, 0, 120] }, domain: NearestPoleRequest['domain'] = { kind: 'whole-dataset' }, label: TorontoSemanticLabel = 6): Promise<NearestPoleRequest> {
  const snapshot = await SemanticArtifact.open(root);
  try { return { requestId: 'index-test', datasetId: 'toronto3d', expectedArtifactRevision: snapshot.dataset.revision, units: 'm', frameId: 'toronto3d-local-v1',
    input, filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: label }, metric: 'euclidean-3d', domain }; }
  finally { await snapshot.close(); }
}
function verified(value: NearestPoleToolOutcome) { assert.ok(value.status === 'verified-found' || value.status === 'verified-none', JSON.stringify(value)); return value; }
function diskEvidence(a: ReturnType<typeof verified>) {
  for (const evidence of [a.search, a.verification]) {
    const disk = evidence.disk!; assert.ok(disk);
    assert.equal(disk.totalPages, Math.ceil(a.dataset.totalPoints / pagePoints));
    assert.equal(disk.visitedPages + disk.excludedPages + disk.prunedPages, disk.totalPages);
    assert.equal(disk.coveredPoints, a.dataset.totalPoints);
    assert.equal(disk.cacheBytes, evidence.scannedPoints * 40);
    assert.ok(disk.maxCacheReadBytes <= pagePoints * 40);
    assert.ok(evidence.scannedPoints <= a.dataset.totalPoints);
    assert.equal(disk.visitedPages === 0, evidence.scannedPoints === 0);
    assert.ok(evidence.matchingPoints <= evidence.index!.points);
  }
}
async function compare(root: string, r: NearestPoleRequest) {
  const a = verified(await queryIndexedClosestPole(root, r)), oracle = verified(await queryClosestPole(root, r));
  assert.deepEqual(a.nearest, oracle.nearest); assert.deepEqual(a.queryPosition, oracle.queryPosition);
  assert.equal(a.search.matchingPoints, oracle.search.matchingPoints); assert.equal(a.verification.matchingPoints, oracle.verification.matchingPoints);
  assert.equal(a.search.algorithm, 'semantic-disk-page-index-v1'); assert.equal(a.search.completion, 'indexed');
  assert.equal(a.verification.verifier, 'semantic-disk-page-verifier-v1');
  assert.deepEqual(a.search.index, a.verification.index); assert.match(a.search.index!.hash, /^[a-f0-9]{64}$/);
  diskEvidence(a); return a;
}
async function countHints(root: string, counts: unknown[][]) {
  const path = join(root, 'manifest.json'), manifest = JSON.parse((await readFile(path)).toString());
  manifest.sources.forEach((source: { label_counts?: unknown }, i: number) => { source.label_counts = counts[i]; });
  await writeFile(path, JSON.stringify(manifest));
}
const oversizedCounts = () => Array.from({ length: 4 }, () => Array<number>(9).fill(999999999));

test('huge histograms never select full-source fallback; all labels share the complete disk index', async () => {
  const points: Point[] = [];
  for (let label = 0; label <= 8; label++) points.push({ p: [1, 0, 120], file: 2, row: label, label }, { p: [-1, 0, 120], file: 1, row: label, label });
  const f = await fixture(points);
  try {
    await countHints(f.root, oversizedCounts());
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); assert.equal(prep.sourceReads.payloadBytes, f.payload.length);
    for (const label of Object.keys(TORONTO_SEMANTIC_LABELS).map(Number) as TorontoSemanticLabel[]) {
      const same = await preparePoleIndex(f.root, undefined, undefined, label);
      assert.equal(same.directory, prep.directory); assert.equal(same.indexHash, prep.indexHash); assert.equal(same.indexedPoints, 2);
      const variants = [await request(f.root, undefined, undefined, label),
        await request(f.root, { kind: 'coordinate', position: [.5 - Number.EPSILON, 0, 120] }, undefined, label),
        await request(f.root, { kind: 'point-ref', key: { sourceFileId: 2, sourceRow: label } }, undefined, label),
        await request(f.root, undefined, { kind: 'aabb', min: [-1, -1, 119], max: [0, 1, 121] }, label),
        await request(f.root, undefined, { kind: 'aabb', min: [3, 3, 119], max: [4, 4, 121] }, label)];
      for (const r of variants) {
        const a = await compare(f.root, r);
        assert.equal(a.sourceReads!.payloadBytes, (a.nearest ? 56 : 0) + (r.input.kind === 'point-ref' ? 56 : 0));
      }
    }
    assert.deepEqual(await queryIndexedClosestPole(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 4, sourceRow: 0 } })), { status: 'error', code: 'unknown-point' });
  } finally { await f.clean(); }
});

test('missing, malformed, understated and exaggerated histogram hints never affect actual counts', async () => {
  const f = await fixture();
  try {
    const variants: unknown[][][] = [Array.from({ length: 4 }, () => Array(9).fill(0)), oversizedCounts(),
      oversizedCounts().map((counts, i) => i === 3 ? [] : counts),
      oversizedCounts().map((counts, i) => i === 3 ? counts.map(() => '99999999') : counts),
      oversizedCounts().map((counts, i) => i === 3 ? counts.map(() => -1) : counts)];
    for (const counts of variants) {
      await countHints(f.root, counts);
      const prep = await preparePoleIndex(f.root); f.setCache(prep.directory);
      assert.equal(prep.cache, 'built'); assert.equal(prep.indexedPoints, 5);
      await compare(f.root, await request(f.root));
    }
  } finally { await f.clean(); }
});

test('resource failures never trigger fallback at build or search checkpoints', async () => {
  for (const error of [new RangeError('Category index resource bound'), new RangeError('Spatial index resource bound'),
    Object.assign(new Error('out of memory'), { code: 'ENOMEM' })]) {
    const f = await fixture();
    try {
      const phases: string[] = [];
      assert.deepEqual(await queryIndexedClosestPole(f.root, await request(f.root), undefined, p => {
        phases.push(p.phase); if (p.phase === 'index') throw error;
      }), { status: 'incomplete', complete: false, reason: 'resource' });
      assert.deepEqual(phases, ['index']);
      const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); assert.equal(prep.cache, 'built'); phases.length = 0;
      assert.deepEqual(await queryIndexedClosestPole(f.root, await request(f.root), undefined, p => {
        phases.push(p.phase); if (p.phase === 'search') throw error;
      }), { status: 'incomplete', complete: false, reason: 'resource' });
      assert.deepEqual(phases, ['search']);
    } finally { await f.clean(); }
  }
});

test('all nine categories: ties/reference/AABB/empty parity and common persistent bindings', async () => {
  const points: Point[] = [];
  for (let label = 0; label <= 8; label++) points.push({ p: [1, 0, 120], file: 2, row: label, label }, { p: [-1, 0, 120], file: 1, row: label, label });
  const f = await fixture(points), hashes = new Set<string>(), directories = new Set<string>(), requestHashes = new Set<string>();
  try {
    for (const label of Object.keys(TORONTO_SEMANTIC_LABELS).map(Number) as TorontoSemanticLabel[]) {
      const r = await request(f.root, undefined, undefined, label); assert.equal(canonicalPoleRequest(r).filter.value, label);
      const prep = await preparePoleIndex(f.root, undefined, undefined, label); f.setCache(prep.directory);
      hashes.add(prep.indexHash); directories.add(prep.directory);
      const a = await compare(f.root, r); requestHashes.add(a.search.requestHash);
      assert.equal(a.nearest!.label, label); assert.deepEqual(a.nearest!.key, { sourceFileId: 1, sourceRow: label });
      assert.equal(a.search.index!.points, 2); assert.equal(a.search.matchingPoints, 2);
      await compare(f.root, await request(f.root, { kind: 'coordinate', position: [Number.EPSILON, 0, 120] }, undefined, label));
      const ref = await compare(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 2, sourceRow: label } }, undefined, label));
      assert.equal(ref.nearest!.distanceSquared, 0);
      await compare(f.root, await request(f.root, undefined, { kind: 'aabb', min: [-1, -1, 119], max: [0, 1, 121] }, label));
      assert.equal((await compare(f.root, await request(f.root, undefined, { kind: 'aabb', min: [3, 3, 119], max: [4, 4, 121] }, label))).status, 'verified-none');
      dropPoleIndexMemoryCache();
      const reloaded = await preparePoleIndex(f.root, undefined, undefined, label);
      assert.equal(reloaded.cache, 'loaded'); assert.equal(reloaded.indexHash, prep.indexHash); assert.equal(reloaded.sourceReads.payloadBytes, 0);
    }
    assert.equal(hashes.size, 1); assert.equal(directories.size, 1); assert.equal(requestHashes.size, 9);
  } finally { await f.clean(); }
});

test('absent categories certify zero points; invalid labels rejected before reads', async () => {
  const f = await fixture([{ p: [0, 0, 120], file: 1, row: 0, label: 6 }]);
  try {
    const base = await request(f.root);
    for (const label of [0, 1, 2, 3, 4, 5, 7, 8] as TorontoSemanticLabel[]) {
      const prep = await preparePoleIndex(f.root, undefined, undefined, label); f.setCache(prep.directory);
      const a = await compare(f.root, { ...base, filter: { ...base.filter, value: label } });
      assert.equal(a.status, 'verified-none'); assert.equal(a.search.index!.points, 0); assert.equal(a.sourceReads!.payloadBytes, 0);
      assert.equal(a.search.disk!.excludedPages, 1); assert.equal(a.search.disk!.cacheBytes, 0);
    }
    for (const label of [-1, 9, .5, NaN, Infinity, '6', null]) {
      const bad = { ...base, filter: { ...base.filter, value: label } };
      assert.throws(() => canonicalPoleRequest(bad));
      assert.deepEqual(await queryIndexedClosestPole('/nonexistent', bad), { status: 'error', code: 'invalid-input' });
      assert.deepEqual(await queryClosestPole('/nonexistent', bad), { status: 'error', code: 'invalid-input' });
      await assert.rejects(preparePoleIndex('/nonexistent', undefined, undefined, label as TorontoSemanticLabel), TypeError);
    }
  } finally { await f.clean(); }
});

test('concurrent different categories share one build but never share winners or request evidence', async () => {
  const f = await fixture([{ p: [1, 0, 120], file: 1, row: 0, label: 6 }, { p: [-1, 0, 120], file: 1, row: 1, label: 7 }]);
  try {
    const requests = await Promise.all([request(f.root), request(f.root, undefined, undefined, 7)]);
    const results = (await Promise.all(requests.map(r => queryIndexedClosestPole(f.root, r)))).map(verified);
    assert.deepEqual(results.map(r => r.nearest!.label), [6, 7]);
    assert.equal(results[0].search.index!.hash, results[1].search.index!.hash);
    assert.notEqual(results[0].search.requestHash, results[1].search.requestHash);
    assert.equal(results.reduce((n, r) => n + r.sourceReads!.payloadBytes, 0), f.payload.length + 112);
    f.setCache((await preparePoleIndex(f.root)).directory);
  } finally { await f.clean(); }
});

test('closest-label HTTP admits every category; legacy closest-pole enforces label 6', async () => {
  const f = await fixture(Array.from({ length: 9 }, (_, row) => ({ p: [row, 0, 120], file: 1, row, label: row })));
  const server = createDemoServer({ datasetRoot: f.root }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/datasets/toronto3d`;
  try {
    f.setCache((await preparePoleIndex(f.root)).directory);
    for (const label of Object.keys(TORONTO_SEMANTIC_LABELS).map(Number) as TorontoSemanticLabel[]) {
      const r = await request(f.root, undefined, undefined, label);
      const response = await fetch(`${base}/closest-label?request=${encodeURIComponent(JSON.stringify(r))}`); assert.equal(response.status, 200);
      const frames = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
      assert.equal(frames[0].request.filter.value, label);
      const result = verified(frames.at(-1).result); assert.equal(result.nearest!.label, label); diskEvidence(result);
      const legacy = await fetch(`${base}/closest-pole?request=${encodeURIComponent(JSON.stringify(r))}`);
      assert.equal(legacy.status, label === 6 ? 200 : 400); await legacy.text();
    }
    const r = await request(f.root);
    for (const value of [-1, 9, '6', .1]) {
      const response = await fetch(`${base}/closest-label?request=${encodeURIComponent(JSON.stringify({ ...r, filter: { ...r.filter, value } }))}`);
      assert.equal(response.status, 400); await response.text();
    }
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await f.clean(); }
});

test('oracle parity: adjacent binary64 inputs, inclusive AABB, direct references and empty domains', async () => {
  const f = await fixture();
  try {
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); assert.equal(prep.indexedPoints, 5);
    for (const p of [[0, 0, 120], [.5, 0, 120], [.5 - Number.EPSILON, 0, 120], [.5 + Number.EPSILON, 0, 120], [1000, 1000, 1000]] as const) await compare(f.root, await request(f.root, { kind: 'coordinate', position: p }));
    for (const domain of [{ kind: 'aabb', min: [.125, -.5, 119], max: [1, .5, 120] }, { kind: 'aabb', min: [0, -.5, 119], max: [.01, .5, 121] },
      { kind: 'aabb', min: [-2, -1, 119], max: [-.5, 1, 121] }] as const) await compare(f.root, await request(f.root, undefined, domain));
    const ref = await compare(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 2 } }));
    assert.equal(ref.nearest!.distanceSquared, 0); assert.equal(ref.search.resolutionPoints, 1); assert.equal(ref.verification.resolutionPoints, 1);
    assert.equal(ref.sourceReads!.payloadBytes, 112); assert.equal(ref.search.scannedPoints, f.points.length, 'mixed pages scan all records, not only selected labels');
    assert.equal(verified(await queryIndexedClosestPole(f.root, await request(f.root))).sourceReads!.payloadBytes, 56);
    assert.deepEqual(await queryIndexedClosestPole(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 4, sourceRow: 0 } })), { status: 'error', code: 'unknown-point' });
  } finally { await f.clean(); }
});

test('random multi-page domains/categories exactly match the retained exhaustive oracle', async () => {
  let seed = 719; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const points = Array.from({ length: 12500 }, (_, row) => ({ p: [Math.round((random() - .5) * 150000) / 1000, Math.round((random() - .5) * 150000) / 1000, 110 + Math.round(random() * 20000) / 1000], file: 1, row, label: row % 9 }));
  const f = await fixture(points);
  try {
    f.setCache((await preparePoleIndex(f.root)).directory);
    for (let i = 0; i < 18; i++) {
      const x = (random() - .5) * 160, y = (random() - .5) * 160;
      await compare(f.root, await request(f.root, { kind: 'coordinate', position: [x, y, 120] }, i % 2 ? { kind: 'whole-dataset' } : { kind: 'aabb', min: [x - 12, y - 12, 105], max: [x + 12, y + 12, 130] }, (i % 9) as TorontoSemanticLabel));
    }
    await compare(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 849 } }));
  } finally { await f.clean(); }
});

test('numeric provenance ties and adjacent binary64 distances match exhaustive oracle', async () => {
  const f = await fixture([{ p: [0, 0, 120], file: 2, row: 0, label: 6 }, { p: [1, 0, 120], file: 1, row: 0, label: 6 }]);
  try {
    f.setCache((await preparePoleIndex(f.root)).directory);
    for (const x of [.5, .5 - Number.EPSILON, .5 + Number.EPSILON]) {
      const a = await compare(f.root, await request(f.root, { kind: 'coordinate', position: [x, 0, 120] }));
      assert.equal(a.nearest!.key.sourceFileId, x < .5 ? 2 : 1);
    }
  } finally { await f.clean(); }
});

function pagedPoints() {
  return Array.from({ length: pagePoints * 5 }, (_, physical): Point => {
    const page = Math.floor(physical / pagePoints), row = physical % pagePoints;
    return { p: page === 0 ? [1, 1, 121] : page === 1 ? [-1, -1, 119] : page === 2 ? [40, 40, 120] : page === 3 ? [0, 0, 120] : [row % 2 ? 80 : 40, 0, 120],
      file: page === 0 ? 2 : 1, row: page === 0 ? row : physical - pagePoints, label: page === 3 ? 1 : 6 };
  });
}
test('multi-page tie boundaries, independent reductions, pruning and partial-AABB exact counts', async () => {
  const f = await fixture(pagedPoints());
  try {
    f.setCache((await preparePoleIndex(f.root)).directory);
    const whole = await compare(f.root, await request(f.root)); assert.deepEqual(whole.nearest!.key, { sourceFileId: 1, sourceRow: 0 });
    for (const evidence of [whole.search, whole.verification]) {
      assert.equal(evidence.scannedPoints, pagePoints * 2); assert.equal(evidence.matchingPoints, pagePoints * 4);
      assert.equal(evidence.disk!.visitedPages, 2); assert.equal(evidence.disk!.excludedPages, 1); assert.equal(evidence.disk!.prunedPages, 2);
    }
    const domain = { kind: 'aabb', min: [-2, -2, 119], max: [50, 50, 121] } as const;
    const partial = await compare(f.root, await request(f.root, undefined, domain));
    for (const evidence of [partial.search, partial.verification]) {
      assert.equal(evidence.matchingPoints, pagePoints * 3 + pagePoints / 2);
      assert.equal(evidence.scannedPoints, pagePoints * 3, 'far partial page must still be visited for exact domain count');
      assert.equal(evidence.disk!.visitedPages, 3); assert.equal(evidence.disk!.prunedPages, 1); assert.equal(evidence.disk!.excludedPages, 1);
    }
    // Standalone verifier has no production answer/radius parameter and reverses tied page order.
    const snapshot = await SemanticArtifact.open(f.root);
    try {
      const { index } = await getSemanticDiskIndex(snapshot), reads: number[] = [], readPage = index.readPage.bind(index);
      index.readPage = async (page, signal) => { reads.push(page.start); return readPage(page, signal); };
      try {
        const checked = await verifySemanticDisk(snapshot, index, await request(f.root));
        assert.deepEqual(checked.winner, whole.nearest); assert.equal(checked.matching, whole.search.matchingPoints);
        assert.deepEqual(reads, [pagePoints, 0]);
      } finally { index.readPage = readPage; }
    } finally { await snapshot.close(); }
  } finally { await f.clean(); }
});

test('independent L-infinity verifier establishes its own radius and visits more pages than Euclidean search', async () => {
  const f = await fixture(Array.from({ length: pagePoints * 3 }, (_, row) => ({ p: row < pagePoints ? [2, 2, 122] : row < 2 * pagePoints ? [3, 0, 120] : [50, 50, 120], file: 1, row, label: 6 })));
  try {
    f.setCache((await preparePoleIndex(f.root)).directory);
    const a = await compare(f.root, await request(f.root)); assert.equal(a.nearest!.distanceSquared, 9);
    assert.equal(a.search.disk!.visitedPages, 1); assert.equal(a.search.disk!.prunedPages, 2);
    assert.equal(a.verification.disk!.visitedPages, 2); assert.equal(a.verification.disk!.prunedPages, 1);
    assert.equal(a.search.matchingPoints, pagePoints * 3); assert.equal(a.verification.matchingPoints, pagePoints * 3);
  } finally { await f.clean(); }
});

test('no Poles certifies whole coverage without any warm record/source payload reads', async () => {
  const f = await fixture([{ p: [0, 0, 120], file: 1, row: 0, label: 1 }]);
  try {
    f.setCache((await preparePoleIndex(f.root)).directory);
    const a = await compare(f.root, await request(f.root)); assert.equal(a.status, 'verified-none'); assert.equal(a.search.index!.points, 0);
    assert.equal(a.sourceReads!.payloadBytes, 0); assert.equal(a.search.disk!.cacheBytes, 0); assert.equal(a.verification.disk!.cacheBytes, 0);
  } finally { await f.clean(); }
});

test('persisted restart loads metadata only; concurrent callers share one complete build', async () => {
  const f = await fixture();
  try {
    const r = await request(f.root), outcomes = await Promise.all([queryIndexedClosestPole(f.root, r), queryIndexedClosestPole(f.root, r)]);
    const a = verified(outcomes[0]), b = verified(outcomes[1]); assert.deepEqual(a.nearest, b.nearest);
    assert.equal(a.sourceReads!.payloadBytes + b.sourceReads!.payloadBytes, f.payload.length + 112);
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); assert.equal(prep.cache, 'memory'); dropPoleIndexMemoryCache();
    const reload = await preparePoleIndex(f.root); assert.equal(reload.cache, 'loaded'); assert.equal(reload.sourceReads.payloadBytes, 0); assert.equal(reload.indexHash, prep.indexHash);
    const ref = verified(await queryIndexedClosestPole(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 0 } })));
    assert.equal(ref.sourceReads!.payloadBytes, 112); assert.ok(ref.sourceReads!.maxReadBytes <= SEMANTIC_LIMITS.metadataBytes);
  } finally { await f.clean(); }
});

test('cancellation never publishes partial state; every phase cancels and retry succeeds', async () => {
  const f = await fixture();
  try {
    const r = await request(f.root), controller = new AbortController();
    assert.deepEqual(await queryIndexedClosestPole(f.root, r, controller.signal, p => { if (p.phase === 'index') controller.abort(); }), { status: 'incomplete', complete: false, reason: 'cancelled' });
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); assert.equal(prep.cache, 'built');
    for (const phase of ['resolve', 'search', 'verify-resolve', 'verify']) {
      const abort = new AbortController(), phases: string[] = [];
      const result = await queryIndexedClosestPole(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 0 } }), abort.signal, p => { phases.push(p.phase); if (p.phase === phase) abort.abort(); });
      assert.deepEqual(result, { status: 'incomplete', complete: false, reason: 'cancelled' }); assert.equal(phases.at(-1), phase);
    }
    const aborted = new AbortController(); aborted.abort();
    assert.deepEqual(await queryIndexedClosestPole(f.root, r, aborted.signal), { status: 'incomplete', complete: false, reason: 'cancelled' });
    verified(await queryIndexedClosestPole(f.root, r));
  } finally { await f.clean(); }
});

test('empty/all-excluded domains still emit cancellable search and verification in phase order', async () => {
  const f = await fixture();
  try {
    f.setCache((await preparePoleIndex(f.root)).directory);
    const r = await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 0 } }, { kind: 'aabb', min: [90, 90, 130], max: [91, 91, 131] });
    const phases: string[] = []; assert.equal(verified(await queryIndexedClosestPole(f.root, r, undefined, p => phases.push(p.phase))).status, 'verified-none');
    assert.deepEqual(phases, ['resolve', 'search', 'verify-resolve', 'verify']);
    for (const phase of ['search', 'verify']) {
      const controller = new AbortController();
      assert.deepEqual(await queryIndexedClosestPole(f.root, r, controller.signal, p => { if (p.phase === phase) controller.abort(); }), { status: 'incomplete', complete: false, reason: 'cancelled' });
    }
  } finally { await f.clean(); }
});

test('aborted cold-build owner never poisons its concurrent waiter', async () => {
  const f = await fixture();
  try {
    const r = await request(f.root), controllers = [new AbortController(), new AbortController()], phases: string[][] = [[], []];
    let owner: number | undefined;
    const outcomes = await Promise.all(controllers.map((controller, caller) => queryIndexedClosestPole(f.root, r, controller.signal, p => {
      phases[caller].push(p.phase); if (p.phase === 'index' && owner === undefined) { owner = caller; controller.abort(); }
    })));
    assert.notEqual(owner, undefined); const actualOwner = owner!, waiter = 1 - actualOwner;
    assert.deepEqual(phases[actualOwner], ['index']); assert.equal(phases[waiter].filter(phase => phase === 'index').length, 1);
    assert.deepEqual(outcomes[actualOwner], { status: 'incomplete', complete: false, reason: 'cancelled' });
    assert.equal(verified(outcomes[waiter]).sourceReads!.payloadBytes, f.payload.length + 56);
    f.setCache((await preparePoleIndex(f.root)).directory);
  } finally { await f.clean(); }
});

test('same-revision identity changes invalidate cache; in-flight source mutation cannot certify', async () => {
  const f = await fixture();
  try {
    const r = await request(f.root), before = await preparePoleIndex(f.root); f.setCache(before.directory);
    const path = join(f.root, 'manifest.json'); await writeFile(path, await readFile(path));
    assert.equal((await request(f.root)).expectedArtifactRevision, r.expectedArtifactRevision);
    const after = await preparePoleIndex(f.root); f.setCache(after.directory); assert.equal(after.cache, 'built'); assert.notEqual(after.indexHash, before.indexHash);
    let mutation: Promise<void> | undefined;
    const result = await queryIndexedClosestPole(f.root, r, undefined, p => { if (p.phase === 'verify' && !mutation) mutation = writeFile(join(f.root, 'octree/octree.bin'), f.payload); });
    await mutation; assert.deepEqual(result, { status: 'error', code: 'stale-revision' });
    assert.deepEqual(await queryIndexedClosestPole(f.root, { ...r, expectedArtifactRevision: '0'.repeat(64) }), { status: 'error', code: 'stale-revision' });
  } finally { await f.clean(); }
});

test('warm and loaded cache corruption is rejected, never rebuilt or full-source scanned silently', async () => {
  for (const warm of [false, true]) for (const asset of ['records.bin', 'pages.bin', 'source-1.bin', 'index.json']) {
    const f = await fixture();
    try {
      const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); if (!warm) dropPoleIndexMemoryCache();
      const path = join(prep.directory, asset), bytes = await readFile(path); bytes[0] ^= 1; await writeFile(path, bytes);
      const phases: string[] = [];
      assert.deepEqual(await queryIndexedClosestPole(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 0 } }), undefined, p => phases.push(p.phase)), { status: 'error', code: 'corrupt-data' }, `${warm}/${asset}`);
      assert.equal(phases.includes('index'), false);
    } finally { await f.clean(); }
  }
});

test('cache page checksum is checked on load independently of record-file stat binding', async () => {
  const f = await fixture();
  try {
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); dropPoleIndexMemoryCache();
    const path = join(prep.directory, 'records.bin'), bytes = await readFile(path); bytes[0] ^= 1; await writeFile(path, bytes);
    // Metadata-only preparation intentionally does not scan records, but interactive reads authenticate the page.
    assert.equal((await preparePoleIndex(f.root)).cache, 'loaded');
    assert.deepEqual(await queryIndexedClosestPole(f.root, await request(f.root)), { status: 'error', code: 'corrupt-data' });
  } finally { await f.clean(); }
});

test('active cache mutation/replacement/symlink/truncation during search cannot certify', async () => {
  for (const mode of ['mutate', 'replace', 'symlink', 'truncate']) {
    const f = await fixture();
    try {
      const prep = await preparePoleIndex(f.root); f.setCache(prep.directory);
      const path = join(prep.directory, 'records.bin'); let mutation: Promise<void> | undefined;
      const a = await queryIndexedClosestPole(f.root, await request(f.root), undefined, p => {
        if (p.phase !== 'search' || mutation) return;
        mutation = (async () => {
          if (mode === 'mutate') { const bytes = await readFile(path); bytes[0] ^= 1; await writeFile(path, bytes); }
          if (mode === 'replace') { await writeFile(`${path}.new`, await readFile(path)); await rename(`${path}.new`, path); }
          if (mode === 'symlink') { await rename(path, `${path}.old`); await symlink(`${path}.old`, path); }
          if (mode === 'truncate') await truncate(path, 40);
        })();
      });
      await mutation; assert.deepEqual(a, { status: 'error', code: 'corrupt-data' }, mode);
    } finally { await f.clean(); }
  }
});

test('invalid common metadata rejected even with a recomputed manifest hash', async () => {
  for (const mutate of [(h: any) => { h.counts[6]--; h.counts[7]++; }, (h: any) => { h.totalPoints++; },
    (h: any) => { h.config.pagePoints = 1; }, (h: any) => { h.version = 'pole-category-index-v1'; }]) {
    const f = await fixture();
    try {
      const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); dropPoleIndexMemoryCache();
      const path = join(prep.directory, 'index.json'), header = JSON.parse((await readFile(path)).toString());
      delete header.hash; mutate(header); header.hash = createHash('sha256').update(JSON.stringify(header)).digest('hex'); await writeFile(path, JSON.stringify(header));
      assert.deepEqual(await queryIndexedClosestPole(f.root, await request(f.root)), { status: 'error', code: 'corrupt-data' });
    } finally { await f.clean(); }
  }
});

test('original winning label/position/provenance and shared lookup are checked in both phases', async () => {
  // Deliberately self-consistent cache forgeries are not ordinary corruption; direct
  // original-record witnesses must reject them rather than trusting fresh cache hashes.
  for (const field of ['label', 'position', 'key', 'physical']) {
    const f = await fixture([{ p: [1, 0, 120], file: 1, row: 0, label: 6 }, { p: [2, 0, 120], file: 1, row: 1, label: 7 }]);
    try {
      const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); dropPoleIndexMemoryCache();
      const records = await readFile(join(prep.directory, 'records.bin'));
      if (field === 'label') { records.writeUInt32LE(7, 36); records.writeUInt32LE(6, 76); }
      if (field === 'position') records.writeDoubleLE(.5, 0);
      if (field === 'key') records.writeUInt32LE(1, 28);
      if (field === 'physical') records.writeUInt32LE(1, 32);
      await writeFile(join(prep.directory, 'records.bin'), records);
      const pages = await readFile(join(prep.directory, 'pages.bin')); Buffer.from(createHash('sha256').update(records).digest('hex'), 'hex').copy(pages, 8);
      await writeFile(join(prep.directory, 'pages.bin'), pages);
      const path = join(prep.directory, 'index.json'), header = JSON.parse((await readFile(path)).toString()); delete header.hash;
      header.pageMetadataHash = createHash('sha256').update(pages).digest('hex'); header.hash = createHash('sha256').update(JSON.stringify(header)).digest('hex'); await writeFile(path, JSON.stringify(header));
      assert.deepEqual(await queryIndexedClosestPole(f.root, await request(f.root)), { status: 'error', code: 'corrupt-data' }, field);
      const snapshot = await SemanticArtifact.open(f.root);
      try { const { index } = await getSemanticDiskIndex(snapshot); await assert.rejects(verifySemanticDisk(snapshot, index, await request(f.root)), /mismatch/); }
      finally { await snapshot.close(); }
    } finally { await f.clean(); }
  }
});

test('cold preparation rejects duplicate/missing provenance, invalid labels/positions/schema and hierarchy', async () => {
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
    const path = join(f.root, 'manifest.json'), manifest = JSON.parse((await readFile(path)).toString()); manifest.semantic_classes[7] = 'Wrong category';
    await writeFile(path, JSON.stringify(manifest)); const phases: string[] = [];
    assert.deepEqual(await queryIndexedClosestPole(f.root, await request(f.root), undefined, p => phases.push(p.phase)), { status: 'error', code: 'corrupt-data' }); assert.deepEqual(phases, []);
  } finally { await f.clean(); }
});

test('large bounded build and distant non-Pole reference never rescan the dataset interactively', async () => {
  const f = await fixture(Array.from({ length: 160001 }, (_, row) => ({ p: [0, 0, 120], file: 1, row, label: row === 160000 ? 6 : 1 })));
  try {
    const prep = await preparePoleIndex(f.root); f.setCache(prep.directory); assert.equal(prep.sourceReads.payloadBytes, f.payload.length); assert.ok(prep.sourceReads.maxReadBytes <= SEMANTIC_LIMITS.readBytes);
    const r = await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 151515 } });
    const a = verified(await queryIndexedClosestPole(f.root, r)); assert.equal(a.nearest!.key.sourceRow, 160000); assert.equal(a.sourceReads!.payloadBytes, 112);
    assert.equal(a.search.scannedPoints, 257); assert.equal(a.verification.scannedPoints, 257); diskEvidence(a);
    dropPoleIndexMemoryCache(); const b = verified(await queryIndexedClosestPole(f.root, r)); assert.deepEqual(b.nearest, a.nearest); assert.equal(b.sourceReads!.payloadBytes, 112);
    const file = await open(join(prep.directory, 'source-1.bin'), 'r');
    try { const bytes = Buffer.alloc(4); await file.read(bytes, 0, 4, 151515 * 4); assert.equal(bytes.readUInt32LE(), 151515); } finally { await file.close(); }
  } finally { await f.clean(); }
});
