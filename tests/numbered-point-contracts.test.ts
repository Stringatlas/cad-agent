import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SCENE_POINT_LIMIT, canonicalScenePointName, canonicalSceneContextRequest, canonicalModelScene,
  type ModelTorontoPoint } from '@spatial/contracts';
import { ProjectSession } from '../apps/server/src/project-session';

const binding = { sessionId: 'scene-session', projectRevision: 0, frameId: 'demo-local-v1', units: 'm' };
const synthetic = (number: number) => ({ name: canonicalScenePointName(`Point ${number}`), entityId: 'cloud', pointIndex: number - 1, position: [1, 2, 3] });
const toronto = (number: number): ModelTorontoPoint => ({ name: canonicalScenePointName(`Point ${number}`), datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64),
  key: { sourceFileId: 1, sourceRow: number - 1 }, position: [1, 2, 120], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] });
const project = (points: unknown[] = []) => ({ ...binding, entityIds: [], points });
const scene = (points: unknown[] = []) => ({ mode: 'toronto', project: null, toronto: points });

test('canonical numbered point names use positive safe integers and exact decimal spelling', () => {
  for (const value of ['Point 1', 'Point 32', 'Point 100', `Point ${Number.MAX_SAFE_INTEGER}`]) assert.equal(canonicalScenePointName(value), value);
  for (const value of [null, 1, '', 'A', 'B', 'Point 0', 'Point -1', 'Point +1', 'Point 01', 'Point 1.0', 'Point 1e3',
    'point 1', 'Point  1', ' Point 1', 'Point 1 ', 'Point 1\n', 'Point ١', 'Point 9007199254740992', 'Point 99999999999999999']) {
    assert.throws(() => canonicalScenePointName(value), TypeError, String(value));
    assert.throws(() => canonicalSceneContextRequest(project([{ ...synthetic(1), name: value }])));
    assert.throws(() => canonicalModelScene(scene([{ ...toronto(1), name: value }])));
  }
});

test('both active scene contracts accept 32 retained points, reject 33, and preserve sparse high numbers', () => {
  assert.equal(SCENE_POINT_LIMIT, 32);
  const points = Array.from({ length: SCENE_POINT_LIMIT }, (_, i) => synthetic(i + 1));
  const imports = Array.from({ length: SCENE_POINT_LIMIT }, (_, i) => toronto(i + 1));
  assert.equal(canonicalSceneContextRequest(project(points)).points.length, 32);
  assert.equal(canonicalModelScene({ mode: 'demo', project: project(points), toronto: [] }).project?.points.length, 32);
  assert.equal(canonicalModelScene(scene(imports)).toronto.length, 32);
  assert.throws(() => canonicalSceneContextRequest(project([...points, synthetic(33)])));
  assert.throws(() => canonicalModelScene(scene([...imports, toronto(33)])));
  const sparse = [synthetic(3), synthetic(Number.MAX_SAFE_INTEGER)];
  // Point numbers are labels, not point provenance indices.
  sparse[1] = { ...sparse[1]!, pointIndex: 0 };
  assert.deepEqual(canonicalSceneContextRequest(project(sparse)).points.map(p => p.name), ['Point 3', `Point ${Number.MAX_SAFE_INTEGER}`]);
  assert.deepEqual(canonicalModelScene(scene([toronto(7), { ...toronto(1), name: canonicalScenePointName(`Point ${Number.MAX_SAFE_INTEGER}`) }])).toronto.map(p => p.name), ['Point 7', `Point ${Number.MAX_SAFE_INTEGER}`]);
  assert.throws(() => canonicalSceneContextRequest(project([synthetic(1), synthetic(1)])));
  assert.throws(() => canonicalModelScene(scene([toronto(1), toronto(1)])));
});

test('numbered references retain strict provenance metadata and separate scene frames', () => {
  const point = toronto(1);
  for (const patch of [{ datasetId: 'other' }, { frameId: 'demo-local-v1' }, { units: 'mm' }, { handedness: 'left' }, { upAxis: 'Y' },
    { localOrigin: [0, 0, 0] }, { artifactRevision: 'bad' }, { key: { sourceFileId: 0, sourceRow: 0 } },
    { key: { sourceFileId: 1, sourceRow: -1 } }, { position: [NaN, 0, 0] }, { extra: true }]) {
    assert.throws(() => canonicalModelScene(scene([{ ...point, ...patch }])));
  }
  assert.throws(() => canonicalModelScene(scene([point, { ...toronto(2), artifactRevision: 'b'.repeat(64) }])));
  assert.throws(() => canonicalModelScene({ mode: 'demo', project: project(), toronto: [point] }));
  assert.throws(() => canonicalModelScene({ mode: 'pole', project: project(), toronto: [point] }));
  assert.throws(() => canonicalModelScene({ mode: 'toronto', project: project([synthetic(1)]), toronto: [point] }));
  assert.throws(() => canonicalModelScene({ mode: 'toronto', project: { ...project(), entityIds: ['cloud'] }, toronto: [] }));
  assert.throws(() => canonicalSceneContextRequest({ ...project([synthetic(1)]), frameId: 'toronto3d-local-v1' }));
  assert.throws(() => canonicalSceneContextRequest(project([{ ...synthetic(1), key: point.key }])));
  const result = canonicalModelScene(scene([point]));
  assert.deepEqual(result.toronto[0], point); assert.notEqual(result.toronto[0]?.position, point.position);
});

test('authoritative project context validates all 32 numbered original records without mutating geometry', () => {
  const root = mkdtempSync(join(tmpdir(), 'spatial-numbered-points-'));
  try {
    const authority = new ProjectSession(join(root, 'project.json')), before = authority.snapshot();
    const cloud = before.project.entities.find(e => e.kind === 'point-cloud');
    assert.ok(cloud?.kind === 'point-cloud');
    const points = Array.from({ length: SCENE_POINT_LIMIT }, (_, i) => ({ name: canonicalScenePointName(`Point ${i + 1}`), entityId: cloud.id, pointIndex: i, position: cloud.points[i]! }));
    const request = { ...authority.binding(), entityIds: [], points };
    const context = authority.context(request);
    assert.equal(context.points.length, 32); assert.deepEqual(context.points, points); assert.deepEqual(authority.snapshot(), before);
    assert.throws(() => authority.context({ ...request, points: [...points, { ...points[0], name: 'Point 33' }] }));
    assert.throws(() => authority.context({ ...request, points: [{ ...points[31], position: [99, 99, 99] }] }));
    assert.deepEqual(authority.snapshot(), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
