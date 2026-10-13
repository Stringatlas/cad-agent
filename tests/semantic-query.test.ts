import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalPoleRequest, type NearestPoleRequest, type PointWitness, type Vec3, type NearestPoleToolOutcome } from '@spatial/contracts';
import { executeNearestPole } from '../packages/agent-harness/src/semantic-query';
import { SemanticArtifact, SEMANTIC_LIMITS } from '../apps/server/src/semantic-artifact';
import { queryClosestPole, PotreeSemanticSource } from '../apps/server/src/semantic-query';
import { LinearRecordVerifier } from '../apps/server/src/semantic-verifier';
import { PotreeDataset } from '../apps/server/src/potree';

function node(type: number, mask: number, count: number, offset: number, size: number) {
  const b = Buffer.alloc(22); b[0] = type; b[1] = mask; b.writeUInt32LE(count, 2); b.writeBigUInt64LE(BigInt(offset), 6); b.writeBigUInt64LE(BigInt(size), 14); return b;
}
const fixturePoints = [
  { p: [1, 0, 120], file: 2, row: 0, label: 6 }, { p: [0, 0, 120], file: 1, row: 0, label: 1 },
  { p: [-1, 0, 120], file: 1, row: 1, label: 6 }, { p: [1, 0, 120], file: 2, row: 1, label: 6 },
  { p: [0.125, 0, 120], file: 1, row: 2, label: 6 }, { p: [0.001, 0, 120], file: 1, row: 3, label: 4 },
  { p: [9, 9, 129], file: 3, row: 0, label: 6 },
];
type FixturePoint = typeof fixturePoints[number];
async function fixture(points: FixturePoint[] = structuredClone(fixturePoints), single = false) {
  const root = await mkdtemp(join(tmpdir(), 'spatial-semantic-'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: points.length, hierarchy: { firstChunkSize: single ? 22 : 66 },
    boundingBox: { min: [-20, -20, 100], max: [20, 20, 140] }, scale: [0.001, 0.001, 0.001], offset: [0, 0, 120], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-20, -20, 100], max: [20, 20, 140] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 },
    ] };
  const payload = Buffer.alloc(points.length * 28);
  points.forEach((p, i) => {
    p.p.forEach((n, axis) => payload.writeInt32LE(Math.round((n - metadata.offset[axis]) * 1000), i * 28 + axis * 4));
    payload.writeUInt16LE(65535, i * 28 + 12); payload.writeUInt16LE(p.file, i * 28 + 18); payload.writeUInt32LE(p.row, i * 28 + 20); payload.writeFloatLE(p.label, i * 28 + 24);
  });
  const hierarchy = single ? node(1, 0, points.length, 0, payload.length) : Buffer.concat([
    node(0, 129, 2, 0, 56), node(2, 128, 2, 66, 44), node(1, 0, 1, 168, 28),
    node(0, 128, 2, 56, 56), node(2, 0, 2, 110, 22), node(1, 0, 2, 112, 56),
  ]);
  const counts = [1, 2, 3, 4].map(file => points.filter(p => p.file === file).length);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: [0.001, 0.001, 0.001],
    semantic_attribute: 'scalar_Label', semantic_classes: { '6': 'Pole' }, sources: counts.map((points, i) => ({ source_file_id: i + 1, file: `L00${i + 1}.ply`, points })) };
  await mkdir(join(root, 'octree')); await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata));
  await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  return { root, payload, hierarchy, metadata, points, clean: () => rm(root, { recursive: true, force: true }) };
}
async function request(root: string, input: NearestPoleRequest['input'] = { kind: 'coordinate', position: [0, 0, 120] }, domain: NearestPoleRequest['domain'] = { kind: 'whole-dataset' }): Promise<NearestPoleRequest> {
  const snapshot = await SemanticArtifact.open(root);
  try { return { requestId: 'test', datasetId: 'toronto3d', expectedArtifactRevision: snapshot.dataset.revision, units: 'm', frameId: 'toronto3d-local-v1',
    input, filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: 6 }, metric: 'euclidean-3d', domain }; }
  finally { await snapshot.close(); }
}
function oracle(points: FixturePoint[], q: Vec3, domain: NearestPoleRequest['domain']): PointWitness | null {
  const ranked = points.filter(p => p.label === 6 && (domain.kind !== 'aabb' || p.p.every((n, i) => n >= domain.min[i] && n <= domain.max[i]))).map(p => {
    const dx = p.p[0] - q[0], dy = p.p[1] - q[1], dz = p.p[2] - q[2], d2 = (dx * dx + dy * dy) + dz * dz;
    return { key: { sourceFileId: p.file, sourceRow: p.row }, position: p.p as unknown as Vec3, label: 6 as const, distanceSquared: d2, distanceMeters: Math.sqrt(d2) };
  });
  ranked.sort((a, b) => a.distanceSquared - b.distanceSquared || a.key.sourceFileId - b.key.sourceFileId || a.key.sourceRow - b.key.sourceRow);
  return ranked[0] ?? null;
}
function verified(value: NearestPoleToolOutcome) { assert.ok(value.status === 'verified-found' || value.status === 'verified-none', JSON.stringify(value)); return value; }

test('whole query reaches ancestors/deep proxies omitted by samples; repeat and LOD independent', async () => {
  const f = await fixture();
  try {
    const sampled = new PotreeDataset(f.root), before = await sampled.observe({ budget: 1, depth: 0 });
    const r = await request(f.root), result = verified(await queryClosestPole(f.root, r));
    assert.deepEqual(result.nearest, oracle(f.points, [0, 0, 120], r.domain));
    assert.deepEqual(result.nearest!.key, { sourceFileId: 1, sourceRow: 2 });
    assert.equal(result.search.scannedPoints, 7); assert.equal(result.search.matchingPoints, 5);
    assert.equal(result.search.hierarchyChunks, 3); assert.equal(result.search.payloadNodes, 4);
    assert.equal(result.search.payloadBytes, f.payload.length); assert.equal(result.verification.payloadBytes, f.payload.length);
    assert.equal(result.sourceReads!.payloadBytes, f.payload.length * 2);
    assert.ok(result.sourceReads!.metadataBytes > result.search.metadataBytes);
    assert.deepEqual(await queryClosestPole(f.root, r), result);
    await sampled.sample({ budget: 2, depth: 0 }, 'display');
    assert.deepEqual(await sampled.observe({ budget: 1, depth: 0 }), before);
    assert.deepEqual(verified(await queryClosestPole(f.root, await request(f.root, { kind: 'coordinate', position: [1, 0, 120] }))).nearest!.key, { sourceFileId: 2, sourceRow: 0 });
  } finally { await f.clean(); }
});

test('inclusive region, empty/no Pole, deterministic ties and reference zero-distance', async () => {
  const f = await fixture();
  try {
    for (const domain of [{ kind: 'aabb', min: [0.125, -0.5, 119], max: [1, 0.5, 120] },
      { kind: 'aabb', min: [0, -0.5, 119], max: [0.01, 0.5, 121] }, { kind: 'aabb', min: [30, 30, 150], max: [31, 31, 151] }] as const) {
      const r = await request(f.root, undefined, domain);
      const result = verified(await queryClosestPole(f.root, r)); assert.deepEqual(result.nearest, oracle(f.points, [0, 0, 120], domain));
    }
    const reference = await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 2 } });
    const zero = verified(await queryClosestPole(f.root, reference)); assert.equal(zero.nearest!.distanceMeters, 0);
    assert.equal(zero.search.resolutionPoints, 7); assert.equal(zero.verification.resolutionPoints, 7);
    const tieDomain = { kind: 'aabb', min: [-2, -1, 119], max: [2, 1, 121] } as const;
    f.payload.writeFloatLE(1, 4 * 28 + 24); f.points[4].label = 1; await writeFile(join(f.root, 'octree/octree.bin'), f.payload);
    const tie = verified(await queryClosestPole(f.root, await request(f.root, undefined, tieDomain)));
    assert.deepEqual(tie.nearest!.key, { sourceFileId: 1, sourceRow: 1 });
    for (let i = 0; i < f.points.length; i++) f.payload.writeFloatLE(1, i * 28 + 24);
    await writeFile(join(f.root, 'octree/octree.bin'), f.payload);
    assert.equal(verified(await queryClosestPole(f.root, await request(f.root))).status, 'verified-none');
  } finally { await f.clean(); }
});

test('request validation is strict; caller mutation cannot change captured query', async () => {
  const f = await fixture();
  try {
    const r = await request(f.root);
    for (const bad of [{ ...r, input: { kind: 'coordinate', position: [NaN, 0, 0] } }, { ...r, units: 'mm' }, { ...r, frameId: 'demo-local' },
      { ...r, filter: { ...r.filter, attribute: 'classification' } }, { ...r, metric: 'horizontal' }, { ...r, path: '/etc/passwd' },
      { ...r, domain: { kind: 'aabb', min: [0, 0, 0], max: [0, 1, 1] } }, { ...r, input: { kind: 'point-ref', key: { sourceFileId: 0, sourceRow: -1 } } }]) {
      assert.throws(() => canonicalPoleRequest(bad)); assert.deepEqual(await queryClosestPole(f.root, bad), { status: 'error', code: 'invalid-input' });
    }
    assert.deepEqual(await queryClosestPole(f.root, { ...r, expectedArtifactRevision: '0'.repeat(64) }), { status: 'error', code: 'stale-revision' });
    assert.deepEqual(await queryClosestPole(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 4 } })), { status: 'error', code: 'unknown-point' });
    const pending = queryClosestPole(f.root, r); (r.input as unknown as { position: number[] }).position[0] = 100;
    assert.deepEqual(verified(await pending).nearest!.key, { sourceFileId: 1, sourceRow: 2 });
    verified(await queryClosestPole(f.root, await request(f.root, { kind: 'coordinate', position: [1000, 1000, 1000] })));
  } finally { await f.clean(); }
});

test('independent verifier rejects forged winner, null, position, distance, count and binding', async () => {
  const f = await fixture(); const snapshot = await SemanticArtifact.open(f.root);
  try {
    const r = await request(f.root), source = new PotreeSemanticSource(snapshot), checker = new LinearRecordVerifier(snapshot);
    const a = await source.nearestPole(r); assert.equal(a.status, 'complete'); if (a.status !== 'complete') return;
    for (const patch of [{ nearest: null }, { queryPosition: [1, 0, 120] },
      { nearest: { ...a.nearest!, label: 1 } }, { nearest: { ...a.nearest!, position: [0, 0, 120] } },
      { nearest: { ...a.nearest!, distanceMeters: 0 } }, { nearest: { ...a.nearest!, key: { sourceFileId: 2, sourceRow: 0 } } },
      { evidence: { ...a.evidence, matchingPoints: 0 } }, { evidence: { ...a.evidence, scannedPoints: 6 } },
      { evidence: { ...a.evidence, hierarchyChunks: 0 } }, { evidence: { ...a.evidence, hierarchyBytes: 0 } }, { evidence: { ...a.evidence, payloadNodes: 0 } },
      { evidence: { ...a.evidence, requestHash: '0'.repeat(64) } }, { evidence: { ...a.evidence, completion: 'partial' } }]) {
      assert.equal((await checker.verify(r, { ...a, ...patch } as typeof a)).status, 'rejected');
    }
    assert.equal((await executeNearestPole(r, { dataset: snapshot.dataset, nearestPole: async () => ({ ...a, nearest: null }) }, checker)).status, 'verification-rejected');
  } finally { await snapshot.close(); await f.clean(); }
});

test('cancellation before/during resolution/search/verification never certifies, then retry works', async () => {
  const f = await fixture();
  try {
    for (const phase of ['pre', 'resolve', 'search', 'verify-resolve', 'verify']) {
      const controller = new AbortController(); if (phase === 'pre') controller.abort();
      const r = await request(f.root, phase.includes('resolve') ? { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 2 } } : undefined);
      const result = await queryClosestPole(f.root, r, controller.signal, event => { if (event.phase === phase) controller.abort(); });
      assert.deepEqual(result, { status: 'incomplete', complete: false, reason: 'cancelled' });
    }
    verified(await queryClosestPole(f.root, await request(f.root)));
  } finally { await f.clean(); }
});

test('artifact mutation and replacement during verification are stale, symlinks/missing assets fail', async () => {
  const f = await fixture();
  try {
    const r = await request(f.root), snapshot = await SemanticArtifact.open(f.root);
    try {
      const source = new PotreeSemanticSource(snapshot), answer = await source.nearestPole(r); assert.equal(answer.status, 'complete');
      await writeFile(join(f.root, 'octree/octree.bin'), f.payload);
      if (answer.status === 'complete') assert.deepEqual(await new LinearRecordVerifier(snapshot).verify(r, answer), { status: 'error', code: 'stale-revision' });
    } finally { await snapshot.close(); }
    const second = await SemanticArtifact.open(f.root);
    try { await rename(join(f.root, 'octree/octree.bin'), join(f.root, 'old.bin')); await writeFile(join(f.root, 'octree/octree.bin'), f.payload); await assert.rejects(second.check(), /changed/i); }
    finally { await second.close(); }
    await rm(join(f.root, 'octree/octree.bin')); await symlink(join(f.root, 'old.bin'), join(f.root, 'octree/octree.bin'));
    await assert.rejects(SemanticArtifact.open(f.root), /Symlink/);
    assert.equal((await queryClosestPole(f.root, r)).status, 'error');
  } finally { await f.clean(); }
});

test('corrupt hierarchy, unreachable ranges, labels/rows and duplicate selected provenance fail', async () => {
  const f = await fixture();
  try {
    for (const change of [(b: Buffer) => b.writeBigUInt64LE(0n, 28), (b: Buffer) => b.writeUInt32LE(3, 68),
      (b: Buffer) => { b[66] = 2; }, (b: Buffer) => { b[1] = 131; }, (b: Buffer) => b.writeBigUInt64LE(2n ** 63n, 6),
      (b: Buffer) => b.writeBigUInt64LE(112n, 28)]) {
      const b = Buffer.from(f.hierarchy); change(b); await writeFile(join(f.root, 'octree/hierarchy.bin'), b);
      assert.deepEqual(await queryClosestPole(f.root, await request(f.root)), { status: 'error', code: 'corrupt-data' });
    }
    await writeFile(join(f.root, 'octree/hierarchy.bin'), f.hierarchy);
    for (const change of [(b: Buffer) => b.writeFloatLE(NaN, 24), (b: Buffer) => b.writeUInt32LE(100, 20),
      (b: Buffer) => b.writeInt32LE(1000000, 0)]) {
      const b = Buffer.from(f.payload); change(b); await writeFile(join(f.root, 'octree/octree.bin'), b);
      assert.deepEqual(await queryClosestPole(f.root, await request(f.root)), { status: 'error', code: 'corrupt-data' });
    }
    const duplicate = Buffer.from(f.payload); duplicate.writeUInt16LE(1, 18); duplicate.writeUInt32LE(2, 20);
    await writeFile(join(f.root, 'octree/octree.bin'), duplicate);
    assert.deepEqual(await queryClosestPole(f.root, await request(f.root, { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 2 } })), { status: 'error', code: 'corrupt-data' });
    await writeFile(join(f.root, 'octree/octree.bin'), f.payload.subarray(0, f.payload.length - 1));
    assert.deepEqual(await queryClosestPole(f.root, await request(f.root)), { status: 'error', code: 'corrupt-data' });
  } finally { await f.clean(); }
});

test('large valid nodes split reads; exceeds old point cap without retaining arrays', async () => {
  const points = Array.from({ length: 160001 }, (_, row) => ({ p: [0, 0, 120], file: 1, row, label: row === 160000 ? 6 : 1 }));
  const f = await fixture(points, true);
  try {
    const result = verified(await queryClosestPole(f.root, await request(f.root)));
    assert.equal(result.nearest!.key.sourceRow, 160000); assert.equal(result.search.scannedPoints, 160001);
    assert.ok(f.payload.length > SEMANTIC_LIMITS.readBytes); assert.ok(result.search.maxReadBytes <= SEMANTIC_LIMITS.readBytes);
    assert.ok(result.verification.maxReadBytes <= SEMANTIC_LIMITS.readBytes);
  } finally { await f.clean(); }
});

test('levels beyond sample depth and adjacent binary64 distances retain exact ranking', async () => {
  const f = await fixture([{ p: [0, 0, 120], file: 1, row: 1, label: 6 }, { p: [1, 0, 120], file: 1, row: 0, label: 6 }], true);
  try {
    const chain = Buffer.concat(Array.from({ length: 7 }, (_, i) => node(i < 6 ? 0 : 1, i < 6 ? 1 : 0, i < 6 ? 0 : 2, 0, i < 6 ? 0 : 56)));
    f.metadata.hierarchy.firstChunkSize = chain.length;
    await writeFile(join(f.root, 'octree/metadata.json'), JSON.stringify(f.metadata)); await writeFile(join(f.root, 'octree/hierarchy.bin'), chain);
    for (const q of [[0.5, 0, 120], [0.5 - Number.EPSILON, 0, 120], [0.5 + Number.EPSILON, 0, 120]] as const) {
      const r = await request(f.root, { kind: 'coordinate', position: q });
      assert.deepEqual(verified(await queryClosestPole(f.root, r)).nearest, oracle(f.points, q, r.domain));
    }
    const overDepth = Buffer.concat(Array.from({ length: 26 }, (_, i) => node(i < 25 ? 0 : 1, i < 25 ? 1 : 0, i < 25 ? 0 : 2, 0, i < 25 ? 0 : 56)));
    f.metadata.hierarchy.firstChunkSize = overDepth.length;
    await writeFile(join(f.root, 'octree/metadata.json'), JSON.stringify(f.metadata)); await writeFile(join(f.root, 'octree/hierarchy.bin'), overDepth);
    assert.deepEqual(await queryClosestPole(f.root, await request(f.root)), { status: 'error', code: 'corrupt-data' });
  } finally { await f.clean(); }
});

test('executor guards ignored cancellation, simulated failures and verifier binding', async () => {
  const f = await fixture(), snapshot = await SemanticArtifact.open(f.root);
  try {
    const r = await request(f.root), source = new PotreeSemanticSource(snapshot), verifier = new LinearRecordVerifier(snapshot);
    const a = await source.nearestPole(r); assert.equal(a.status, 'complete'); if (a.status !== 'complete') return;
    const controller = new AbortController();
    assert.deepEqual(await executeNearestPole(r, { dataset: snapshot.dataset, nearestPole: async () => { controller.abort(); return a; } }, verifier, controller.signal), { status: 'incomplete', complete: false, reason: 'cancelled' });
    for (const reason of ['resource', 'transport'] as const) {
      assert.deepEqual(await executeNearestPole(r, { dataset: snapshot.dataset, nearestPole: async () => ({ status: 'incomplete', complete: false, reason }) }, verifier), { status: 'incomplete', complete: false, reason });
    }
    const originalRead = snapshot.read.bind(snapshot);
    for (const [code, reason] of [['ENOMEM', 'resource'], ['EIO', 'transport']] as const) {
      snapshot.read = async () => { throw Object.assign(new Error('Injected read failure'), { code }); };
      assert.deepEqual(await source.nearestPole(r), { status: 'incomplete', complete: false, reason });
    }
    snapshot.read = originalRead;
    verified(await executeNearestPole(r, source, verifier));
    const v = await verifier.verify(r, a); assert.equal(v.status, 'verified'); if (v.status !== 'verified') return;
    assert.equal((await executeNearestPole(r, source, { verify: async () => ({ ...v, evidence: { ...v.evidence, artifactRevision: '0'.repeat(64) } }) })).status, 'verification-rejected');
  } finally { await snapshot.close(); await f.clean(); }
});
