import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AreaCandidateSettings } from '@spatial/contracts';
import { searchAreaCandidates, validateAreaCandidateSettings } from '../apps/server/src/area-candidate-search';
import { getSemanticDiskIndex } from '../apps/server/src/semantic-disk-index';
import { candidateSource, denseGround } from './fixtures/area-candidate-source';
const settings: AreaCandidateSettings = { spacingMeters: 1, clearanceRadiusMeters: .2, maxGroundReliefMeters: .1, minPoleDistanceMeters: 0, ranking: 'flat-ground' };
const authorities = { pointAuthority: { sessionId: 'point-test', revision: 0 }, cadAuthority: { sessionId: 'cad-test', revision: 0 } };
const signal = () => new AbortController().signal;

test('100x100m complete one-pass original-source reduction, stable ranked diverse points without terrain/CAD', async t => {
  const points = denseGround(100), f = await candidateSource(points); t.after(() => f.close());
  const { index } = await getSemanticDiskIndex(f.snapshot), readPage = index.readPage.bind(index), seen = new Set<number>();
  index.readPage = async (p, s) => { assert.ok(!seen.has(p.start), 'physical page reread'); seen.add(p.start); return readPage(p, s); };
  const result = await searchAreaCandidates(f.snapshot, f.area(100), settings, authorities, signal());
  assert.equal(result.status, 'complete'); assert.equal(result.evidence.sourcePointsExamined, 120000); assert.equal(result.evidence.areaPoints, points.length);
  assert.equal(result.evidence.pagesRead, Math.ceil(points.length / 4096)); assert.equal(result.evidence.cellsEvaluated, 10000); assert.equal(result.evidence.cellMeters, .5);
  assert.equal(result.candidates.length, 5); assert.ok(result.binding.sourceHash); assert.deepEqual(result.binding.pointAuthority, authorities.pointAuthority);
  result.candidates.forEach((c, i) => { assert.equal(c.rank, i + 1); assert.equal(c.groundPoints, 3); assert.equal(c.position[2], 0); assert.equal(c.groundReliefMeters, 0); assert.equal(c.poleDistanceMeters, null);
    result.candidates.slice(0, i).forEach(other => assert.ok(Math.hypot(c.position[0] - other.position[0], c.position[1] - other.position[1]) >= 1)); });
  index.readPage = readPage;
  const repeat = await searchAreaCandidates(f.snapshot, f.area(100), settings, authorities, signal()); assert.deepEqual(result.candidates, repeat.candidates);
});

test('missing/insufficient support, relief, and every non-ground class at any elevation reject cells', async t => {
  const raw = denseGround(3).filter(p => p.xyz[0] !== .25 || p.xyz[1] !== .25);
  raw.push({ xyz: [1.25, .25, 100], label: 0 }, { xyz: [2.25, .25, .2], label: 1 });
  const f = await candidateSource(raw); t.after(() => f.close());
  const result = await searchAreaCandidates(f.snapshot, f.area(3), settings, authorities, signal()); assert.equal(result.status, 'complete');
  assert.ok(result.candidates.length); assert.ok(result.candidates.every(c => c.position[1] !== .25));
  const sparse = await candidateSource([{ xyz: [.25, .25, 0], label: 1 }]); t.after(() => sparse.close());
  assert.deepEqual((await searchAreaCandidates(sparse.snapshot, sparse.area(3), settings, authorities, signal())).candidates, []);
});

test('pole proximity includes outside-area high poles and reports conservative quantized lower bound; numerical rankings', async t => {
  const poles = [{ xyz: [-2, .2, 900] as const, label: 6 }, { xyz: [20, 20, -50] as const, label: 6 }];
  const f = await candidateSource([...denseGround(8), ...poles]); t.after(() => f.close());
  const near = await searchAreaCandidates(f.snapshot, f.area(8), { ...settings, ranking: 'near-poles' }, authorities, signal());
  const far = await searchAreaCandidates(f.snapshot, f.area(8), { ...settings, ranking: 'far-from-poles' }, authorities, signal());
  assert.equal(near.status, 'complete'); assert.equal(far.status, 'complete'); assert.ok(near.candidates[0].poleDistanceMeters! < far.candidates[0].poleDistanceMeters!);
  for (const c of [...near.candidates, ...far.candidates]) {
    const exact = Math.min(...poles.map(p => Math.hypot(c.position[0] - p.xyz[0], c.position[1] - p.xyz[1])));
    assert.ok(c.poleDistanceMeters! <= exact + 1e-12); assert.ok(exact <= c.poleDistanceMeters! + Math.SQRT2 * .5 + 1e-12);
  }
  const threshold = await searchAreaCandidates(f.snapshot, f.area(8), { ...settings, minPoleDistanceMeters: 5, ranking: 'near-poles' }, authorities, signal());
  assert.ok(threshold.candidates.every(c => c.poleDistanceMeters! >= 5));
});

test('rotated AOI excludes AABB-only points and uses observed ground not reference plane', async t => {
  const f = await candidateSource([...denseGround(8), { xyz: [0, 0, 100], label: 8 }]); t.after(() => f.close());
  const area = { ...f.area(8), corners: [[4, 0, 100], [8, 4, 100], [4, 8, 100], [0, 4, 100]] as const };
  const result = await searchAreaCandidates(f.snapshot, area, { ...settings, spacingMeters: 2 }, authorities, signal());
  assert.equal(result.status, 'complete'); assert.ok(result.evidence.areaPoints < 8 * 8 * 12); assert.ok(result.candidates.length);
  result.candidates.forEach(c => { assert.equal(c.position[2], 0); assert.ok(Math.abs(c.position[0] - 4) + Math.abs(c.position[1] - 4) <= 4); });
});

test('clearance disk rejects obstacle cells and missing neighbor support, never assumes an equipment box', async t => {
  const f = await candidateSource([...denseGround(5), { xyz: [2.25, 2.25, 50], label: 8 }]); t.after(() => f.close());
  const result = await searchAreaCandidates(f.snapshot, f.area(5), { ...settings, clearanceRadiusMeters: 1 }, authorities, signal());
  assert.equal(result.status, 'complete'); assert.ok(result.candidates.length);
  result.candidates.forEach(c => { assert.ok(c.groundPoints > 3); assert.equal(c.observedObstacleCells, 0); assert.ok(Math.hypot(c.position[0] - 2.25, c.position[1] - 2.25) > 1); });
});

test('cancel, request budgets, and source mutation fail closed without partial shortlist', async t => {
  const f = await candidateSource(denseGround(5)); t.after(() => f.close());
  const controller = new AbortController(); controller.abort();
  const cancelled = await searchAreaCandidates(f.snapshot, f.area(5), settings, authorities, controller.signal);
  assert.equal(cancelled.status, 'incomplete'); assert.equal(cancelled.reason, 'cancelled'); assert.deepEqual(cancelled.candidates, []);
  const tooLarge = await searchAreaCandidates(f.snapshot, f.area(1000), settings, authorities, signal()); assert.equal(tooLarge.reason, 'area-cell-budget'); assert.deepEqual(tooLarge.candidates, []);
  const { index } = await getSemanticDiskIndex(f.snapshot), readPage = index.readPage.bind(index);
  index.readPage = async (page, s) => { const bytes = await readPage(page, s); await writeFile(join(f.root, 'octree/octree.bin'), Buffer.alloc(f.snapshot.payloadSize)); return bytes; };
  const mutated = await searchAreaCandidates(f.snapshot, f.area(5), settings, authorities, signal()); assert.equal(mutated.status, 'incomplete'); assert.deepEqual(mutated.candidates, []);
  index.readPage = readPage;
});

test('mid-pass cancellation discards all reduced cells and emits no partial candidates', async t => {
  const f = await candidateSource(denseGround(30)); t.after(() => f.close());
  const { index } = await getSemanticDiskIndex(f.snapshot), original = index.readPage.bind(index), controller = new AbortController();
  index.readPage = async (page, s) => { const bytes = await original(page, s); controller.abort(); return bytes; };
  const result = await searchAreaCandidates(f.snapshot, f.area(30), settings, authorities, controller.signal);
  assert.equal(result.status, 'incomplete'); assert.equal(result.reason, 'cancelled'); assert.deepEqual(result.candidates, []); assert.equal(result.evidence.pagesRead, 1);
  index.readPage = original;
});

test('strict numerical preferences and frame binding validate before expensive reads', async t => {
  for (const patch of [{ spacingMeters: 0 }, { clearanceRadiusMeters: 26 }, { maxGroundReliefMeters: NaN }, { minPoleDistanceMeters: -1 }, { ranking: 'anything' }, { secret: true }]) assert.throws(() => validateAreaCandidateSettings({ ...settings, ...patch }));
  const f = await candidateSource(denseGround(2)); t.after(() => f.close());
  await assert.rejects(searchAreaCandidates(f.snapshot, { ...f.area(2), artifactRevision: 'stale' }, settings, authorities, signal()), /mismatch/);
  await assert.rejects(searchAreaCandidates(f.snapshot, { ...f.area(2), corners: [[0,0,0],[2,0,0],[4,4,0],[0,2,0]] }, settings, authorities, signal()), /rectangle/);
});
