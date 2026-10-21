import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroundSurface, type GroundSurfaceResult } from '../../apps/server/src/spatial/ground-surface';
import type { GroundCell, GroundModel } from '../../apps/server/src/preprocessing/scene-preprocessing';

function model(cells: GroundCell[], cellMeters = 2): GroundModel {
  return { cellMeters, origin: [0, 0], labels: [1, 2], method: 'observed-cell-minimum-v1', minimumSupport: 3,
    points: cells.reduce((n, c) => n + c.points, 0), cells,
    limitation: 'Lower envelope of Ground/Road_markings only; sensitive to low outliers; no interpolation or extrapolation' };
}
function cell(x: number, y: number, elevation = 0, points = 3): GroundCell {
  return { x, y, elevation, points, maxElevation: elevation + .2 };
}
function elevation(result: GroundSurfaceResult) {
  assert.equal(result.status, 'available');
  if (result.status !== 'available') throw new Error('Unavailable');
  return result.elevation;
}
function quad(z: number[] = [0, 0, 0, 0]) { return [cell(0, 0, z[0]), cell(1, 0, z[1]), cell(0, 1, z[2]), cell(1, 1, z[3])]; }

test('triangulated cell-center plane is deterministic in negative original-source meter coordinates', () => {
  const cells: GroundCell[] = [];
  const plane = (x: number, y: number) => 10 + .2 * x - .3 * y;
  for (let x = -3; x <= 1; x++) for (let y = -3; y <= 1; y++) cells.push(cell(x, y, plane((x + .5) * 2, (y + .5) * 2)));
  const a = createGroundSurface(model(cells)), b = createGroundSurface(model([...cells].reverse()));
  for (const [x, y] of [[-4.5, -4.8], [-4.8, -4.5], [-2, -2], [-3, -.2], [0, 0], [3, 3]]) {
    const result = a.elevationAt(x, y);
    assert.ok(Math.abs(elevation(result) - plane(x, y)) < 1e-12);
    assert.deepEqual(result, b.elevationAt(x, y));
    if (result.status === 'available') { assert.equal(result.units, 'm'); assert.equal(result.coordinates, 'original-source-local'); }
  }
});

test('fixed SW→NE diagonal is piecewise linear, not bilinear; reports required corners and observed spread', () => {
  const s = createGroundSurface(model(quad([0, 0, 0, 1])));
  assert.equal(elevation(s.elevationAt(2.5, 1.5)), .25);
  assert.equal(elevation(s.elevationAt(1.5, 2.5)), .25);
  assert.equal(elevation(s.elevationAt(2, 2)), .5);
  const result = s.elevationAt(2, 2);
  if (result.status === 'available') {
    assert.equal(result.method, 'cell-center-triangulation-v1'); assert.equal(result.supportingCells.length, 4);
    assert.equal(result.spreadMeters, 1.2);
  }
});

test('holes and insufficient fourth corners forbid even three-corner interpolation; exact centers still work', () => {
  for (const cells of [quad().slice(0, 3), [...quad().slice(0, 3), cell(1, 1, 0, 2)]]) {
    const s = createGroundSurface(model(cells));
    assert.equal(s.elevationAt(1.5, 1.2).status, 'unavailable');
    assert.equal(elevation(s.elevationAt(1, 1)), 0);
  }
  assert.deepEqual(createGroundSurface(model([cell(0, 0, 0, 1)])).elevationAt(1, 1), { status: 'unavailable', reason: 'insufficient-support' });
  assert.deepEqual(createGroundSurface(model([])).elevationAt(1, 1), { status: 'unavailable', reason: 'outside-support' });
  // A cell observation does NOT support the entire occupied tile.
  assert.equal(createGroundSurface(model([cell(0, 0, 5)])).elevationAt(.9, 1).status, 'unavailable');
});

test('supported outer boundaries work on all sides, with no extrapolation beyond centers', () => {
  const s = createGroundSurface(model(quad([0, .2, .4, .6])));
  for (const [x, y] of [[1, 2], [3, 2], [2, 1], [2, 3]]) assert.equal(s.elevationAt(x, y).status, 'available');
  for (const [x, y] of [[.999999, 2], [3.000001, 2], [2, .999999], [2, 3.000001]]) assert.equal(s.elevationAt(x, y).status, 'unavailable');
});

test('slope cutoff checks both triangles; exact observations retain low outlier sensitivity', () => {
  const g = model(quad([0, 0, 0, -20]));
  const s = createGroundSurface(g);
  assert.deepEqual(s.elevationAt(1.5, 1.2), { status: 'unavailable', reason: 'slope-limit' });
  assert.equal(elevation(s.elevationAt(3, 3)), -20);
  assert.equal(elevation(createGroundSurface(g, { maxSlope: 20 }).elevationAt(2, 2)), -10);
  assert.equal(createGroundSurface(model(quad([0, 2, 0, 2]))).elevationAt(2, 2).status, 'available');
  assert.equal(createGroundSurface(model(quad([0, 2.01, 0, 2.01]))).elevationAt(2, 2).status, 'unavailable');
  const low = createGroundSurface(model(quad([-20, -20, -20, -20])));
  assert.equal(elevation(low.elevationAt(2, 2)), -20); // smooth low outliers are NOT corrected
});

test('lookup snapshots inputs and returned evidence cannot mutate future answers', () => {
  const g = model(quad()), s = createGroundSurface(g);
  g.cells[0].elevation = -100; g.cells.length = 0; g.minimumSupport = 100;
  assert.equal(elevation(s.elevationAt(2, 2)), 0);
  const result = s.elevationAt(2, 2);
  if (result.status === 'available') {
    assert.throws(() => { (result.supportingCells[0] as GroundCell).elevation = 50; }, TypeError);
    assert.ok(Object.isFrozen(result.supportingCells));
  }
});

test('malformed metadata, cells, duplicate indices, overflow and unsupported options fail closed', () => {
  const bad: GroundModel[] = [];
  for (const h of [0, -1, Infinity, NaN, Number.MIN_VALUE, Number.MAX_VALUE]) bad.push(model(quad(), h));
  for (const patch of [{ x: .5 }, { y: Infinity }, { x: Number.MAX_SAFE_INTEGER }, { points: 0 }, { points: 1.5 },
    { elevation: NaN }, { maxElevation: Infinity }, { elevation: 10, maxElevation: 0 },
    { elevation: -Number.MAX_VALUE, maxElevation: Number.MAX_VALUE }]) bad.push(model([{ ...cell(0, 0), ...patch }]));
  bad.push(model([cell(0, 0), cell(0, 0)]));
  bad.push({ ...model(quad()), minimumSupport: 0 }, { ...model(quad()), minimumSupport: .5 },
    { ...model(quad()), points: 13 }, { ...model(quad()), origin: [1, 0] as unknown as [0, 0] },
    { ...model(quad()), labels: [2, 1] as unknown as [1, 2] },
    model([cell(0, 0, 0, Number.MAX_SAFE_INTEGER), cell(1, 0)]));
  for (const g of bad) assert.throws(() => createGroundSurface(g), RangeError);
  for (const maxSlope of [0, -1, Infinity, NaN]) assert.throws(() => createGroundSurface(model(quad()), { maxSlope }), RangeError);
});

test('nonfinite and out-of-range queries return structured failures without nonfinite elevations', () => {
  const s = createGroundSurface(model(quad()));
  for (const n of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(s.elevationAt(n, 2), { status: 'unavailable', reason: 'invalid-query' });
    assert.deepEqual(s.elevationAt(2, n), { status: 'unavailable', reason: 'invalid-query' });
  }
  assert.deepEqual(s.elevationAt(Number.MAX_VALUE, 0), { status: 'unavailable', reason: 'numeric-range' });
  const huge = createGroundSurface(model(quad([-Number.MAX_VALUE / 2, Number.MAX_VALUE / 2, -Number.MAX_VALUE / 2, Number.MAX_VALUE / 2])), { maxSlope: Number.MAX_VALUE });
  assert.equal(huge.elevationAt(2, 2).status, 'available');
  const overflow = createGroundSurface(model(quad([-Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE])), { maxSlope: Number.MAX_VALUE });
  assert.deepEqual(overflow.elevationAt(2, 2), { status: 'unavailable', reason: 'numeric-range' });
});
