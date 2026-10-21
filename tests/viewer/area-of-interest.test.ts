import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { canonicalModelScene, TORONTO_SEMANTIC_LABELS, type ModelAreaOfInterest, type ModelScene } from '@spatial/contracts';
import { projectAreaOfInterest } from '../../apps/web/src/scenes/toronto/placement/area-of-interest';
import { modelScene } from '../../apps/web/src/chat/model-chat-client';
import { bindModelScene } from '../../apps/server/src/agent/model-scene';
import { SemanticArtifact } from '../../apps/server/src/spatial/semantic-artifact';
import { ModelError } from '../../apps/server/src/agent/provider-model';

const revision = 'a'.repeat(64);
const area = (): ModelAreaOfInterest => ({ datasetId: 'toronto3d', artifactRevision: revision,
  frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0],
  corners: [[1, 2, 120], [7, 10, 120], [3, 13, 120], [-3, 5, 120]] });
const scene = (a = area()): ModelScene => ({ mode: 'toronto', toronto: [], areaOfInterest: a });
const signal = () => new AbortController().signal;
const closeTo = (actual: number, expected: number, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
function camera() {
  const result = new THREE.PerspectiveCamera(55, 800 / 600, .1, 1000);
  result.up.set(0, 0, 1); result.position.set(35, -42, 80); result.lookAt(0, 0, 12); result.updateMatrixWorld();
  return result;
}

test('projection yields a rotated true XY rectangle, not a perspective quadrilateral or axis-aligned bounds', () => {
  const c = camera(), start = { x: 260, y: 210 }, end = { x: 560, y: 410 }, z = 12;
  const corners = projectAreaOfInterest(c, start, end, 800, 600, z);
  const [p, q, s, t] = corners.map(point => new THREE.Vector3(...point));
  const u = q.clone().sub(p), v = t.clone().sub(p);
  assert.ok(Math.abs(u.x) > 1 && Math.abs(u.y) > 1, 'rectangle must retain screen yaw');
  assert.ok(u.length() > .01 && v.length() > .01); closeTo(u.dot(v), 0);
  for (const point of corners) closeTo(point[2], z);
  assert.ok(s.distanceTo(q.clone().add(t).sub(p)) < 1e-8);
  // Both diagonal endpoints must be the actual screen-ray/plane intersections.
  for (const [pixel, projected] of [[start, p], [end, s]] as const) {
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(pixel.x / 400 - 1, 1 - pixel.y / 300), c);
    const expected = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), new THREE.Vector3());
    assert.ok(expected && expected.distanceTo(projected) < 1e-8);
  }
  assert.deepEqual(canonicalModelScene(scene({ ...area(), corners })).areaOfInterest?.corners, corners);
});

test('reversing a drag preserves its rectangle footprint and reverses the starting corner', () => {
  const c = camera(), start = { x: 240, y: 190 }, end = { x: 580, y: 430 };
  const forward = projectAreaOfInterest(c, start, end, 800, 600, 12);
  const backward = projectAreaOfInterest(c, end, start, 800, 600, 12);
  for (let i = 0; i < 4; i++) for (let axis = 0; axis < 3; axis++) closeTo(backward[i][axis], forward[(i + 2) % 4][axis]);
  assert.doesNotThrow(() => canonicalModelScene(scene({ ...area(), corners: backward })));
});

test('projection rejects horizon, backward-plane, far-plane, invalid viewport and degenerate drags', () => {
  const c = camera(), center = { x: 400, y: 300 }, end = { x: 500, y: 400 };
  for (const [width, height, z] of [[0, 600, 12], [800, -1, 12], [NaN, 600, 12], [800, 600, Infinity]]) {
    assert.throws(() => projectAreaOfInterest(c, center, end, width, height, z));
  }
  assert.throws(() => projectAreaOfInterest(c, { x: NaN, y: 300 }, end, 800, 600, 12));
  assert.throws(() => projectAreaOfInterest(c, center, center, 800, 600, 12), /larger area/);
  assert.throws(() => projectAreaOfInterest(c, center, { x: 500, y: 300 }, 800, 600, 12), /larger area/);
  const horizon = new THREE.PerspectiveCamera(55, 800 / 600, .1, 1000);
  horizon.up.set(0, 0, 1); horizon.position.set(0, 0, 20); horizon.lookAt(1, 0, 20);
  assert.throws(() => projectAreaOfInterest(horizon, center, end, 800, 600, 0), /Look down/);
  c.lookAt(35, -42, 100);
  assert.throws(() => projectAreaOfInterest(c, center, end, 800, 600, 12), /Look down/);
  const distant = camera(); distant.far = 1;
  assert.throws(() => projectAreaOfInterest(distant, center, end, 800, 600, 12), /Look down/);
});

test('canonicalModelScene keeps AOI optional and clones all mutable AOI arrays', () => {
  for (const mode of ['toronto', 'pole'] as const) {
    const result = canonicalModelScene({ mode, toronto: [] });
    assert.equal(Object.hasOwn(result, 'areaOfInterest'), false);
  }
  const input = area(), result = canonicalModelScene(scene(input)).areaOfInterest!;
  assert.deepEqual(result, input); assert.notEqual(result, input);
  assert.notEqual(result.localOrigin, input.localOrigin); assert.notEqual(result.corners, input.corners);
  result.corners.forEach((corner, i) => assert.notEqual(corner, input.corners[i]));
  (input.corners[0] as unknown as number[])[0] = 999;
  assert.equal(result.corners[0][0], 1);
});

test('canonicalModelScene strictly validates AOI binding, fields, mode and revision', () => {
  const invalid: unknown[] = [null, {}, { ...area(), extra: true }, { ...area(), datasetId: 'other' },
    { ...area(), frameId: 'world' }, { ...area(), units: 'ft' }, { ...area(), localOrigin: [0, 0, 0] },
    { ...area(), artifactRevision: '' }, { ...area(), artifactRevision: 'z'.repeat(64) }];
  for (const a of invalid) assert.throws(() => canonicalModelScene({ ...scene(), areaOfInterest: a }));
  for (const field of Object.keys(area())) {
    const a = { ...area() } as Record<string, unknown>; delete a[field];
    assert.throws(() => canonicalModelScene({ ...scene(), areaOfInterest: a }), field);
  }
  for (const mode of ['demo', 'pole']) assert.throws(() => canonicalModelScene({ ...scene(), mode }));
  const point = { name: 'Point 1', datasetId: 'toronto3d', artifactRevision: revision,
    key: { sourceFileId: 1, sourceRow: 0 }, position: [0, 0, 120], frameId: 'toronto3d-local-v1',
    units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] };
  assert.doesNotThrow(() => canonicalModelScene({ ...scene(), toronto: [point] }));
  assert.throws(() => canonicalModelScene({ ...scene(), toronto: [{ ...point, artifactRevision: 'b'.repeat(64) }] }), /rectangle/);
});

test('canonicalModelScene rejects nonrectangular, nonplanar, nonfinite and degenerate AOIs', () => {
  const invalid = [[], area().corners.slice(0, 3), [...area().corners, [0, 0, 120]],
    [[0, 0, 0], [1, 0, 0], [2, 1, 0], [0, 1, 0]], // Broken parallelogram.
    [[0, 0, 0], [1, 0, 0], [2, 1, 0], [1, 1, 0]], // Skew parallelogram.
    [[0, 0, 0], [1, 1, 0], [1, 0, 0], [0, 1, 0]], // Crossed ordering.
    [[0, 0, 0], [0, 0, 0], [0, 1, 0], [0, 1, 0]],
    [[0, 0, 0], [.009, 0, 0], [.009, 1, 0], [0, 1, 0]]];
  for (const corners of invalid) assert.throws(() => canonicalModelScene({ ...scene(), areaOfInterest: { ...area(), corners } }));
  for (const position of [[NaN, 2, 120], [Infinity, 2, 120], [1e7 + 1, 2, 120], [1, 2], [1, 2, 120, 4], [1, 2, 121]]) {
    assert.throws(() => canonicalModelScene({ ...scene(), areaOfInterest: { ...area(), corners: [position, ...area().corners.slice(1)] } }));
  }
});

test('modelScene includes AOI only in active Toronto mode and freezes the canonical copy', () => {
  const input = area();
  const toronto = modelScene('toronto', [], input);
  assert.deepEqual(toronto.areaOfInterest, input); assert.notEqual(toronto.areaOfInterest, input);
  assert.ok(Object.isFrozen(toronto.areaOfInterest)); assert.ok(Object.isFrozen(toronto.areaOfInterest!.corners[0]));
  for (const mode of ['pole'] as const) {
    const result = modelScene(mode, [], input);
    assert.equal(Object.hasOwn(result, 'areaOfInterest'), false);
  }
  assert.equal(modelScene('toronto', []).areaOfInterest, undefined);
});

// Minimal uncompressed artifact from model-nearest-tool; no spatial index is needed for AOI binding.
async function artifactFixture(t: { after(fn: () => unknown): void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'spatial-model-aoi-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'octree'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 3, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-10, -10, 110], max: [10, 10, 130] }, scale: [.001, .001, .001], offset: [0, 0, 120], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-10, -10, 110], max: [10, 10, 130] }, { name: 'rgb', type: 'uint16', size: 6 },
      { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(84);
  [0, 1, 8].forEach((x, row) => {
    payload.writeInt32LE(x * 1000, row * 28); payload.writeUInt16LE(1, row * 28 + 18);
    payload.writeUInt32LE(row, row * 28 + 20); payload.writeFloatLE(row ? 6 : 1, row * 28 + 24);
  });
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(3, 2); hierarchy.writeBigUInt64LE(84n, 14);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0],
    potree_scale_m: [.001, .001, .001], semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS,
    sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? 3 : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata));
  await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const artifact = await SemanticArtifact.open(root), artifactRevision = artifact.dataset.revision; await artifact.close();
  return { root, artifactRevision };
}

test('server binds an AOI-only turn to current artifact and exposes all-elevation query without mutation authority', async t => {
  const f = await artifactFixture(t), input = scene({ ...area(), artifactRevision: f.artifactRevision });
  const bound = await bindModelScene(input, f.root, signal());
  try {
    const context = bound.context as { areaOfInterest: ModelAreaOfInterest & Record<string, unknown>; capabilities: Record<string, boolean>; toronto: unknown[] };
    assert.deepEqual(context.areaOfInterest.corners, input.areaOfInterest!.corners);
    assert.equal(context.areaOfInterest.elevationScope, 'all-elevations');
    assert.equal(context.areaOfInterest.referencePlane, 'orbit-target-z-not-terrain');
    assert.equal(context.areaOfInterest.purpose, 'spatial-query-footprint-not-geometry-authority');
    assert.equal(context.capabilities.queryAoiPoints, true);
    assert.equal(typeof bound.queryAoiPoints, 'function');
    assert.equal(context.areaOfInterest.source, 'user-selected-xy-rectangle');
    assert.deepEqual(context.toronto, []); assert.equal(context.capabilities.inspectScene, true);
    assert.equal(context.capabilities.nearestLabel, false); assert.equal(context.capabilities.geometryMutation, false);
    assert.equal(bound.nearestLabel, undefined); assert.equal(bound.proposeCad, undefined);
    await bound.check();
    await writeFile(join(f.root, 'manifest.json'), '{}');
    await assert.rejects(bound.check(), 'AOI-only binding must retain and check the artifact');
  } finally { await bound.close(); }
});

test('server rejects stale AOI-only revisions and cannot silently bind when artifact is missing', async t => {
  const f = await artifactFixture(t);
  await assert.rejects(bindModelScene(scene({ ...area(), artifactRevision: 'f'.repeat(64) }), f.root, signal()),
    error => error instanceof ModelError && error.code === 'stale-scene');
  await assert.rejects(bindModelScene(scene({ ...area(), artifactRevision: f.artifactRevision }), join(f.root, 'missing'), signal()));
});
