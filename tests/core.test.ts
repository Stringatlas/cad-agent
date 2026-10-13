import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertBoxEntity,
  assertCoordinateMetadata,
  assertEntity,
  assertProjectState,
  assertVec3,
  type BoxEntity,
  type Vec3,
} from '@spatial/contracts';
import { createDemoProject, localToWorld, resolveEntity, selectEntity, worldToLocal } from '@spatial/project-state';
import { boxBounds } from '@spatial/geometry';

function assertNear(actual: Vec3, expected: Vec3): void {
  for (const axis of [0, 1, 2] as const) {
    assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-10, `Axis ${axis}: ${actual[axis]} != ${expected[axis]}`);
  }
}

function demoBox(): BoxEntity {
  const box = resolveEntity(createDemoProject(), 'proposal-box');
  assert.ok(box?.kind === 'box');
  return box;
}

test('local/world conversion uses the explicit origin and round trips with tolerance', () => {
  const { coordinates } = createDemoProject();
  assert.deepEqual(localToWorld([1, 2, 3], coordinates), [1001, 2002, 13]);
  assert.deepEqual(worldToLocal([1001, 2002, 13], coordinates), [1, 2, 3]);
  for (const point of [[0, 0, 0], [-2.7, 1.2, 0.017], [3, -3, 1.5]] as const) {
    assertNear(worldToLocal(localToWorld(point, coordinates), coordinates), point);
  }
});

test('demo points, IDs, coordinate metadata and proposal are deterministic', () => {
  const first = createDemoProject();
  const second = createDemoProject();
  assert.deepEqual(first, second);
  assert.notEqual(first.entities, second.entities);
  assert.deepEqual(first.coordinates, { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [1000, 2000, 10] });
  assert.deepEqual(first.entities.map((entity) => entity.id), ['synthetic-cloud', 'proposal-box']);
  const cloud = resolveEntity(first, 'synthetic-cloud');
  assert.ok(cloud?.kind === 'point-cloud');
  assert.equal(cloud.points.length, 441);
  assert.deepEqual(cloud.points[0]?.slice(0, 2), [-3, -3]);
  assert.deepEqual(cloud.points.at(-1)?.slice(0, 2), [3, 3]);
  assert.ok(cloud.points.every(([x, y, z]) => x >= -3 && x <= 3 && y >= -3 && y <= 3 && Math.abs(z) <= 0.02));
  assert.ok(cloud.points.some((point) => point[2] !== 0));
  assert.deepEqual(demoBox(), { id: 'proposal-box', kind: 'box', center: [0, 0, 0.75], dimensions: [1.8, 1.2, 1.5] });
  assertProjectState(first);
});

test('box bounds preserve dimensions and place the proposal on the local floor', () => {
  const box = demoBox();
  const bounds = boxBounds(box);
  assert.deepEqual(bounds.min, [-0.9, -0.6, 0]);
  assert.deepEqual(bounds.max, [0.9, 0.6, 1.5]);
  assertNear([
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ], box.dimensions);
  assert.deepEqual(boxBounds({ ...box, center: [5, -2, 3] }), { min: [4.1, -2.6, 2.25], max: [5.9, -1.4, 3.75] });
});

test('box validation rejects invalid dimensions and placement', () => {
  const box = demoBox();
  for (const dimensions of [[0, 1, 1], [1, -1, 1], [1, 1, NaN], [Infinity, 1, 1], [1, 1], ['1', 1, 1]]) {
    assert.throws(() => assertBoxEntity({ ...box, dimensions }));
    assert.throws(() => boxBounds({ ...box, dimensions } as unknown as BoxEntity));
  }
  assert.throws(() => assertBoxEntity({ ...box, center: [0, Infinity, 0] }));
  assert.throws(() => assertBoxEntity({ ...box, id: '' }));
});

test('selection resolves IDs, rejects unknown IDs and preserves geometry revision', () => {
  const initial = { ...createDemoProject(), revision: 7 };
  const selected = selectEntity(initial, 'proposal-box');
  assert.equal(selected.selectedEntityId, 'proposal-box');
  assert.equal(selected.revision, 7);
  assert.equal(selected.entities, initial.entities);
  assert.equal(initial.selectedEntityId, null);
  assert.equal(selectEntity(selected, 'synthetic-cloud').revision, 7);
  assert.equal(selectEntity(selected, null).selectedEntityId, null);
  assert.equal(selectEntity(selected, null).revision, 7);
  assert.equal(resolveEntity(initial, 'missing'), undefined);
  assert.throws(() => selectEntity(initial, 'missing'), /Unknown entity ID/);
  assert.throws(() => selectEntity(initial, ''), /Unknown entity ID/);
  assertProjectState(selected);
});

test('runtime contracts reject malformed frames, entities and project references', () => {
  const state = createDemoProject();
  assert.throws(() => assertVec3([1, 2, Infinity]));
  assert.throws(() => assertCoordinateMetadata({ ...state.coordinates, units: 'mm' }));
  assert.throws(() => assertCoordinateMetadata({ ...state.coordinates, handedness: 'left' }));
  assert.throws(() => assertCoordinateMetadata({ ...state.coordinates, upAxis: 'Y' }));
  assert.throws(() => assertEntity({ id: 'cloud', kind: 'point-cloud', points: [[0, NaN, 0]] }));
  assert.throws(() => assertEntity({ id: 'other', kind: 'solid' }));
  assert.throws(() => assertProjectState({ ...state, revision: -1 }));
  assert.throws(() => assertProjectState({ ...state, revision: 0.5 }));
  assert.throws(() => assertProjectState({ ...state, selectedEntityId: 'missing' }));
  assert.throws(() => assertProjectState({ ...state, entities: [demoBox(), demoBox()] }));
});
