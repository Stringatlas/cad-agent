import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { candidateSource } from './fixtures/area-candidate-source';
import { bindModelScene } from '../apps/server/src/model-scene';
import { getSemanticDiskIndex } from '../apps/server/src/semantic-disk-index';
import { canonicalPerceptionQuery, type ModelPointQuery } from '../apps/server/src/model-perception';
import { PointOverrideSession } from '../apps/server/src/point-overrides';
import { TorontoCadSession } from '../apps/server/src/toronto-cad-session';
import { SpatialPageIndex } from '../apps/server/src/spatial-page-index';
const signal = new AbortController().signal;
const scene = { mode: 'toronto' as const, toronto: [] };
// The tool boundary intentionally returns unknown. Validate containers before
// inspecting their fields, then retain the exact behavioral assertions below.
function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function records(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value)); return value.map(record);
}
function numbers(value: unknown): number[] {
  assert.ok(Array.isArray(value));
  assert.ok(value.every(n => typeof n === 'number' && Number.isFinite(n)));
  return value as number[];
}
function text(value: unknown): string { assert.equal(typeof value, 'string'); return value as string; }
function perceptionTools(bound: Awaited<ReturnType<typeof bindModelScene>>) {
  assert.ok(bound.queryPoints); assert.ok(bound.groundElevation);
  const { queryPoints, groundElevation } = bound;
  return {
    queryPoints: async (args: ModelPointQuery, signal: AbortSignal) => record(await queryPoints(args, signal)),
    groundElevation: async (args: { x: number; y: number }, signal: AbortSignal) => record(await groundElevation(args, signal)),
  };
}
async function fixture(t: { after(fn: () => unknown): void }) {
  const f = await candidateSource([
    { xyz: [0, 0, 0], label: 1 }, { xyz: [1, 0, 1], label: 6 },
    { xyz: [1, 1, 2], label: 6 }, { xyz: [2, 2, 2], label: 7 },
  ]);
  const bound = await bindModelScene(scene, f.root, signal);
  t.after(async () => { await bound.close(); await f.close(); });
  return { ...f, bound, tools: perceptionTools(bound) };
}
test('Toronto perception is available without attached point, AOI, image or editing authority', async t => {
  const f = await fixture(t), context = f.bound.context as any;
  assert.deepEqual(context.sceneBounds, f.snapshot.dataset.bounds);
  assert.equal(context.spatialFrame.frameId, 'toronto3d-local-v1');
  assert.equal(context.spatialFrame.units, 'm'); assert.deepEqual(context.spatialFrame.localOrigin, [627285, 4841948, 0]);
  assert.equal(context.capabilities.queryPoints, true);
  const nearest = await f.tools.queryPoints({ operation: 'nearest', position: [.9, 0, 1], maxResults: 1, label: null }, signal);
  const point = record(nearest.point);
  assert.deepEqual(point.position, [1, 0, 1]); assert.equal(point.semanticType, 'Pole');
  assert.deepEqual(point.key, { sourceFileId: 1, sourceRow: 1 });
  assert.deepEqual(point.selectReference, { kind: 'toronto-point', key: point.key });
  assert.equal(record(nearest.binding).artifactRevision, f.snapshot.dataset.revision);
  assert.equal(nearest.domain, 'original-source-points'); assert.equal(nearest.independentVerification, false);
  const radius = await f.tools.queryPoints({ operation: 'radius', position: [0, 0, 0], radiusMeters: 10, maxResults: 2 }, signal);
  assert.equal(radius.totalCount, 4); assert.equal(records(radius.points).length, 2); assert.equal(radius.truncated, true);
  assert.equal(radius.selection, 'deterministic-capped-subset-not-ranked');
  assert.equal((await f.tools.queryPoints({ operation: 'nearest', position: [0, 0, 0], label: 8, maxResults: 1 }, signal)).point, null);
});
test('box queries have inclusive exact label counts and capped matching witnesses, including ground', async t => {
  const f = await fixture(t), bounds = { min: [0, 0, 0] as const, max: [1, 1, 2] as const };
  const all = await f.tools.queryPoints({ operation: 'box', bounds, maxResults: 2 }, signal);
  assert.equal(all.totalCount, 3); assert.equal(records(all.points).length, 2); assert.equal(all.truncated, true);
  assert.equal(numbers(all.countsByLabel)[1], 1); assert.equal(numbers(all.countsByLabel)[6], 2);
  const poles = await f.tools.queryPoints({ operation: 'box', bounds, label: 6, maxResults: 1 }, signal);
  assert.equal(poles.totalCount, 2); assert.equal(records(poles.points).length, 1); assert.equal(records(poles.points)[0].semanticType, 'Pole');
  assert.equal(numbers(poles.countsByLabel)[1], 0); assert.equal(poles.truncated, true);
  const ground = await f.tools.queryPoints({ operation: 'box', bounds, label: 1, maxResults: 2 }, signal);
  assert.equal(ground.totalCount, 1); assert.equal(records(ground.points)[0].semanticType, 'Ground');
});
test('perception validates/copies inputs; cancellation, disposal and changed source fail closed', async t => {
  const f = await fixture(t);
  for (const invalid of [
    { operation: 'nearest', position: [NaN, 0, 0], maxResults: 1 },
    { operation: 'nearest', position: [1e7 + 1, 0, 0], maxResults: 1 },
    { operation: 'radius', position: [0, -1e7 - 1, 0], radiusMeters: 1, maxResults: 1 },
    { operation: 'box', bounds: { min: [0, 0, 0], max: [1, 1, 1e7 + 1] }, maxResults: 1 },
    { operation: 'nearest', position: [0, 0, 0], label: 'null', maxResults: 1 },
    { operation: 'nearest', position: [0, 0, 0], label: false, maxResults: 1 },
    { operation: 'nearest', position: [0, 0, 0], label: NaN, maxResults: 1 },
    { operation: 'radius', position: [0, 0, 0], radiusMeters: -1, maxResults: 1 },
    { operation: 'box', bounds: { min: [0, 0, 0], max: [-1, 1, 1] }, maxResults: 1 },
    { operation: 'nearest', position: [0, 0, 0], maxResults: 65 },
    { operation: 'nearest', position: [0, 0, 0], label: 9, maxResults: 1 },
    { operation: 'nearest', position: [0, 0, 0], maxResults: 1, revision: 'forged' },
  ]) await assert.rejects(f.tools.queryPoints(invalid as unknown as ModelPointQuery, signal), { code: 'invalid-spatial-query' });
  const input: ModelPointQuery = { operation: 'box', bounds: { min: [0, 0, 0], max: [2, 2, 2] }, maxResults: 1 };
  const copy = canonicalPerceptionQuery(input); (input.bounds!.min as unknown as number[])[0] = 99;
  assert.equal(copy.bounds!.min[0], 0);
  assert.deepEqual(canonicalPerceptionQuery({ operation: 'nearest', position: [-1e7, 1e7, 0], label: null, maxResults: 1 }),
    { operation: 'nearest', position: [-1e7, 1e7, 0], label: null, maxResults: 1 });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.tools.queryPoints({ operation: 'nearest', position: [0, 0, 0], maxResults: 1 }, abort.signal), { name: 'AbortError' });
  await writeFile(join(f.root, 'octree/octree.bin'), Buffer.alloc(112));
  await assert.rejects(f.tools.queryPoints({ operation: 'nearest', position: [0, 0, 0], maxResults: 1 }, signal), { code: 'stale-revision' });
  await f.bound.close();
  await assert.rejects(f.tools.groundElevation({ x: 0, y: 0 }, signal), { code: 'stale-scene' });
});
test('mid-query cancellation and post-read artifact replacement never publish a result', async t => {
  const f = await fixture(t), original = SpatialPageIndex.prototype.nearest;
  t.after(() => { SpatialPageIndex.prototype.nearest = original; });
  const abort = new AbortController();
  SpatialPageIndex.prototype.nearest = async function(position, options) {
    const result = await original.call(this, position, options); abort.abort(); return result;
  };
  await assert.rejects(f.tools.queryPoints({ operation: 'nearest', position: [0, 0, 0], maxResults: 1 }, abort.signal), { name: 'AbortError' });
  SpatialPageIndex.prototype.nearest = async function() { throw new RangeError('Spatial time budget exceeded'); };
  const budget = await f.tools.queryPoints({ operation: 'nearest', position: [0, 0, 0], maxResults: 1 }, signal);
  assert.equal(budget.complete, false); assert.equal(budget.reason, 'spatial-query-resource-limit'); assert.equal(budget.points, undefined);
  SpatialPageIndex.prototype.nearest = async function(position, options) {
    const result = await original.call(this, position, options);
    await writeFile(join(f.root, 'octree/octree.bin'), Buffer.alloc(112)); return result;
  };
  await assert.rejects(f.tools.queryPoints({ operation: 'nearest', position: [0, 0, 0], maxResults: 1 }, signal), { code: 'stale-revision' });
});
test('perception shares a busy guard and disposal during a query never publishes observations', async t => {
  const f = await fixture(t), original = SpatialPageIndex.prototype.nearest;
  t.after(() => { SpatialPageIndex.prototype.nearest = original; });
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  SpatialPageIndex.prototype.nearest = async function(position, options) {
    const result = await original.call(this, position, options);
    enter(); await released; return result;
  };
  const pending = f.tools.queryPoints({ operation: 'nearest', position: [0, 0, 0], maxResults: 1 }, signal);
  // Attach rejection handling before deliberately closing the bound scene.
  const rejected = assert.rejects(pending, { code: 'stale-scene' });
  try {
    await entered;
    assert.deepEqual(await f.tools.groundElevation({ x: 0, y: 0 }, signal),
      { status: 'unavailable', complete: false, reason: 'spatial-query-busy' });
    assert.deepEqual(await f.tools.queryPoints({ operation: 'nearest', position: [0, 0, 0], maxResults: 1 }, signal),
      { status: 'unavailable', complete: false, reason: 'spatial-query-busy' });
    await f.bound.close();
  } finally { release(); }
  await rejected;
});
test('ground elevation reports supported source minima/interpolation and missing preprocessing honestly', async t => {
  const f = await fixture(t), old = process.env.SPATIAL_PREPROCESSING_PATH;
  const path = join(f.root, 'terrain.json'); process.env.SPATIAL_PREPROCESSING_PATH = path;
  t.after(() => { if (old === undefined) delete process.env.SPATIAL_PREPROCESSING_PATH; else process.env.SPATIAL_PREPROCESSING_PATH = old; });
  assert.equal((await f.tools.groundElevation({ x: .5, y: .5 }, signal)).status, 'unavailable');
  const { index } = await getSemanticDiskIndex(f.snapshot);
  const cells = [0, 1].flatMap(x => [0, 1].map(y => ({ x, y, points: 3, elevation: x * .1, maxElevation: x * .1 })));
  await writeFile(path, JSON.stringify({ version: 'scene-preprocessing-v1', complete: true,
    binding: { datasetId: 'toronto3d', artifactRevision: f.snapshot.dataset.revision, frameId: 'toronto3d-local-v1', units: 'm', coordinates: f.snapshot.dataset.coordinates,
      indexHash: index.hash, sourceHash: index.sourceHash, instanceManifestHash: 'a'.repeat(64), membershipHash: 'b'.repeat(64) }, instances: [],
    ground: { cellMeters: 1, origin: [0, 0], labels: [1, 2], method: 'observed-cell-minimum-v1', minimumSupport: 3, points: 12, cells } }));
  const exact = await f.tools.groundElevation({ x: .5, y: .5 }, signal);
  assert.equal(record(exact.ground).status, 'available'); assert.equal(record(exact.ground).elevation, 0); assert.equal(record(exact.ground).method, 'observed-cell-center');
  const interpolated = await f.tools.groundElevation({ x: 1, y: 1 }, signal);
  assert.equal(record(interpolated.ground).elevation, .05); assert.equal(record(interpolated.ground).method, 'cell-center-triangulation-v1');
  assert.equal(interpolated.domain, 'original-source-ground'); assert.match(text(record(interpolated.binding).preprocessingHash), /^[a-f0-9]{64}$/);
  assert.equal(record((await f.tools.groundElevation({ x: 50, y: 50 }, signal)).ground).status, 'unavailable');
  await assert.rejects(f.tools.groundElevation({ x: Infinity, y: 0 }, signal), { code: 'invalid-ground-query' });
});
test('original perception stays explicit with edited state, and bound authority revisions are checked', async t => {
  const f = await fixture(t), points = new PointOverrideSession(f.root), cad = new TorontoCadSession(f.root);
  t.after(async () => { await points.close(); await cad.close(); });
  const before = await points.execute('snapshot') as any;
  const proposal = await points.execute('propose', { sessionId: before.sessionId, revision: before.revision, artifactRevision: before.artifactRevision,
    points: [{ key: { sourceFileId: 1, sourceRow: 1 }, position: [1, 0, 1] }], translation: [10, 0, 0] }) as any;
  const moved = await points.execute('approve', { sessionId: before.sessionId, revision: before.revision, proposalId: proposal.proposalId }) as any;
  const bound = await bindModelScene(scene, f.root, signal, undefined, { points, cad }); t.after(() => bound.close());
  const tools = perceptionTools(bound);
  const nearest = await tools.queryPoints({ operation: 'nearest', position: [1, 0, 1], maxResults: 1 }, signal);
  assert.deepEqual(record(nearest.point).position, [1, 0, 1]); assert.match(text(nearest.limitations), /accepted point edits.*excluded/);
  await points.execute('undo', { sessionId: before.sessionId, revision: 1, transactionId: moved.nextUndoTransactionId });
  await assert.rejects(tools.queryPoints({ operation: 'nearest', position: [1, 0, 1], maxResults: 1 }, signal), { code: 'stale-scene' });
});
test('empty Toronto context without installed artifact has no factual tools; pole remains separate', async t => {
  const root = await mkdtemp(join(tmpdir(), 'perception-no-artifact-')); t.after(() => rm(root, { recursive: true, force: true }));
  const bound = await bindModelScene(scene, root, signal); t.after(() => bound.close());
  assert.equal((bound.context as any).capabilities.queryPoints, false); assert.equal((bound as any).queryPoints, undefined);
  const pole = await bindModelScene({ ...scene, mode: 'pole' }, root, signal); t.after(() => pole.close());
  assert.equal((pole as any).queryPoints, undefined);
});
