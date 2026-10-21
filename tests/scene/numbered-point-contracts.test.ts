import assert from 'node:assert/strict';
import test from 'node:test';
import { SCENE_POINT_LIMIT, canonicalScenePointName, canonicalModelScene, type ModelTorontoPoint } from '@spatial/contracts';

const toronto = (number: number): ModelTorontoPoint => ({ name: canonicalScenePointName(`Point ${number}`), datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64),
  key: { sourceFileId: 1, sourceRow: number - 1 }, position: [1, 2, 120], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] });
const scene = (points: unknown[] = []) => ({ mode: 'toronto', toronto: points });

test('canonical numbered point names use positive safe integers and exact decimal spelling', () => {
  for (const value of ['Point 1', 'Point 32', 'Point 100', `Point ${Number.MAX_SAFE_INTEGER}`]) assert.equal(canonicalScenePointName(value), value);
  for (const value of [null, 1, '', 'A', 'B', 'Point 0', 'Point -1', 'Point +1', 'Point 01', 'Point 1.0', 'Point 1e3',
    'point 1', 'Point  1', ' Point 1', 'Point 1 ', 'Point 1\n', 'Point ١', 'Point 9007199254740992', 'Point 99999999999999999']) {
    assert.throws(() => canonicalScenePointName(value), TypeError, String(value));
    assert.throws(() => canonicalModelScene(scene([{ ...toronto(1), name: value }])));
  }
});

test('Toronto scene accepts 32 retained points, rejects 33, and preserves sparse high numbers', () => {
  assert.equal(SCENE_POINT_LIMIT, 32);
  const imports = Array.from({ length: SCENE_POINT_LIMIT }, (_, i) => toronto(i + 1));
  assert.equal(canonicalModelScene(scene(imports)).toronto.length, 32);
  assert.throws(() => canonicalModelScene(scene([...imports, toronto(33)])));
  assert.deepEqual(canonicalModelScene(scene([toronto(7), { ...toronto(1), name: canonicalScenePointName(`Point ${Number.MAX_SAFE_INTEGER}`) }])).toronto.map(p => p.name), ['Point 7', `Point ${Number.MAX_SAFE_INTEGER}`]);
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
  assert.throws(() => canonicalModelScene({ mode: 'demo', toronto: [point] }));
  assert.throws(() => canonicalModelScene({ mode: 'pole', toronto: [point] }));
  const result = canonicalModelScene(scene([point]));
  assert.deepEqual(result.toronto[0], point); assert.notEqual(result.toronto[0]?.position, point.position);
});
