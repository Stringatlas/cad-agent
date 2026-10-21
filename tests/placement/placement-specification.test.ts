import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalPlacementIntent, canonicalResolvedPlacementSpecification, unresolvedPlacementFields, type PlacementValues } from '@spatial/contracts';

function resolved() {
  return { schemaVersion: 1, parameters: {
    binding: { datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), terrainRevision: 'b'.repeat(64), frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0], pointAuthority: { sessionId: 'points', revision: 0 }, cadAuthority: { sessionId: 'cad', revision: 2 } },
    area: { corners: [[0, 0, 10], [10, 0, 10], [10, 20, 10], [0, 20, 10]] },
    dimensions: [1, 1, 1.2], frontAccessDepth: 1, frontAccessHeight: 1.2,
    poleSeparation: 2, poleDistance: { from: 'box-boundary', metric: 'horizontal', to: 'observed-pole-points' },
    maxGroundSlopeDegrees: 2, maxGroundRelief: .1, groundMeasurement: 'sampled-plane-slope-and-height-range',
    allowedYawDegrees: [0, 90, 180, 270], containment: 'footprint-and-access', maxBodyConflicts: 0, maxAccessConflicts: 0,
    ranking: [{ metric: 'ground-slope', direction: 'minimize' }, { metric: 'pole-separation', direction: 'maximize' }],
  }, assumptions: [] };
}

test('example values survive without guessing missing intent/measurement semantics', () => {
  const intent = canonicalPlacementIntent({ schemaVersion: 1, parameters: { dimensions: [1, 1, 1.2], frontAccessDepth: 1, poleSeparation: 2 } });
  assert.deepEqual(intent.parameters.dimensions, [1, 1, 1.2]);
  assert.equal(intent.parameters.frontAccessDepth, 1);
  assert.equal(intent.parameters.poleSeparation, 2);
  assert.equal(intent.parameters.maxGroundSlopeDegrees, null);
  assert.equal(intent.parameters.poleDistance, null);
  assert.equal(intent.parameters.ranking, null);
  assert.equal(unresolvedPlacementFields(intent).length, 12);
  assert.throws(() => canonicalResolvedPlacementSpecification(intent), /Unresolved/);
  assert.deepEqual(canonicalPlacementIntent(intent), intent);
});

test('explicitly resolved request round trips and detaches all nested data', () => {
  const input = resolved(), before = structuredClone(input);
  const result = canonicalResolvedPlacementSpecification(input);
  const typed: PlacementValues = result.parameters;
  assert.equal(typed.frontAccessDepth, 1);
  assert.deepEqual(result, before);
  assert.deepEqual(unresolvedPlacementFields(result), []);
  input.parameters.dimensions[0] = 99;
  input.parameters.binding.pointAuthority.revision = 99;
  input.parameters.area.corners[0][0] = 99;
  input.parameters.ranking[0].direction = 'maximize';
  assert.deepEqual(result, before);
});

test('yaw normalization preserves positive decimal values and canonicalizes equivalent turns', () => {
  const input = resolved(); input.parameters.allowedYawDegrees = [360, -90, 90, 0, -360, .1];
  const intent = canonicalPlacementIntent(input);
  assert.deepEqual(intent.parameters.allowedYawDegrees, [0, .1, 90, 270]);
  assert.deepEqual(canonicalPlacementIntent(intent), intent);
});

test('tiny negative yaws stay canonical at the floating-point turn boundary', () => {
  const input = resolved(); input.parameters.allowedYawDegrees = [-Number.MIN_VALUE, -1e-20, 0, 360];
  const intent = canonicalPlacementIntent(input);
  assert.deepEqual(intent.parameters.allowedYawDegrees, [0]);
  assert.deepEqual(canonicalPlacementIntent(intent), intent);
});

test('disclosed assumptions are retained, not silently inserted or treated as missing', () => {
  const input = { ...resolved(), assumptions: [{ field: 'frontAccessHeight', reason: 'Illustrative access height equals box height; not a standard.' }] };
  assert.deepEqual(canonicalResolvedPlacementSpecification(input).assumptions, input.assumptions);
  for (const assumptions of [
    [{ field: 'frontAccessHeight', reason: '' }], [{ field: 'frontAccessHeight', reason: ' '.repeat(5) }],
    [{ field: 'unknown', reason: 'test' }], [{ field: 'frontAccessHeight', reason: 'a' }, { field: 'frontAccessHeight', reason: 'b' }],
  ]) assert.throws(() => canonicalPlacementIntent({ ...input, assumptions }));
  assert.throws(() => canonicalPlacementIntent({ schemaVersion: 1, parameters: {}, assumptions: input.assumptions }));
});

test('every missing requirement prevents resolution, while explicit zero and empty preferences survive', () => {
  const input = resolved();
  for (const key of Object.keys(input.parameters)) {
    const parameters: Record<string, unknown> = { ...input.parameters }; delete parameters[key];
    assert.deepEqual(unresolvedPlacementFields(canonicalPlacementIntent({ ...input, parameters })), [key]);
    assert.throws(() => canonicalResolvedPlacementSpecification({ ...input, parameters }));
  }
  input.parameters.frontAccessDepth = 0; input.parameters.poleSeparation = 0;
  input.parameters.maxGroundSlopeDegrees = 0; input.parameters.maxGroundRelief = 0; input.parameters.ranking = [];
  assert.deepEqual(canonicalResolvedPlacementSpecification(input).parameters.ranking, []);
});

test('rejects malformed, ambiguous and unsupported parameter semantics', () => {
  const invalid: Record<string, unknown[]> = {
    dimensions: [[0, 1, 1], [-1, 1, 1], [1, 1], [1, Infinity, 1]],
    frontAccessDepth: [-1, NaN, '1'], frontAccessHeight: [0, -1], poleSeparation: [-1, Infinity],
    poleDistance: [{ from: 'center', metric: 'horizontal', to: 'observed-pole-points' }, { from: 'box-boundary', metric: '3d' }],
    maxGroundSlopeDegrees: [-1, 90, NaN], maxGroundRelief: [-1, Infinity], groundMeasurement: ['level', 'certified-terrain'],
    allowedYawDegrees: [[], [361], [Infinity], new Array(1), new Array(361).fill(0)],
    containment: ['center', '3d'], maxBodyConflicts: [-1, .5], maxAccessConflicts: [Infinity, '0'],
    ranking: [[{ metric: 'ground-slope', direction: 'minimize' }, { metric: 'ground-slope', direction: 'maximize' }], [{ metric: 'safety', direction: 'maximize' }], [{ metric: 'pole-separation', direction: 'best' }]],
  };
  for (const [key, values] of Object.entries(invalid)) for (const value of values) {
    const input = resolved(); assert.throws(() => canonicalPlacementIntent({ ...input, parameters: { ...input.parameters, [key]: value } }), key);
  }
  assert.throws(() => canonicalPlacementIntent({ schemaVersion: 2, parameters: {} }));
  assert.throws(() => canonicalPlacementIntent({ schemaVersion: 1, parameters: { level: true } }));
  assert.throws(() => canonicalPlacementIntent({ schemaVersion: 1, parameters: { poleSeparation: undefined } }));
  assert.throws(() => canonicalPlacementIntent({ schemaVersion: 1, parameters: {}, approved: true }));
});

test('frame, origin, units, source/terrain and authority bindings are explicit and strict', () => {
  const input = resolved();
  for (const patch of [{ units: 'mm' }, { frameId: 'demo' }, { datasetId: 'other' }, { artifactRevision: 'stale' }, { terrainRevision: '' }, { localOrigin: [0, 0, 0] }, { pointAuthority: { sessionId: '', revision: 0 } }, { cadAuthority: { sessionId: 'cad', revision: -1 } }]) {
    assert.throws(() => canonicalPlacementIntent({ ...input, parameters: { ...input.parameters, binding: { ...input.parameters.binding, ...patch } } }));
  }
});

test('AOI accepts rotated rectangles in either winding but rejects degenerate/nonrectangular/nonplanar input', () => {
  const input = resolved();
  const corners = [[0, 0, 5], [2, 2, 5], [0, 4, 5], [-2, 2, 5]];
  for (const ring of [corners, [...corners].reverse()]) {
    assert.deepEqual(canonicalResolvedPlacementSpecification({ ...input, parameters: { ...input.parameters, area: { corners: ring } } }).parameters.area.corners, ring);
  }
  for (const ring of [[], [[0, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 0, 0], [1, 0, 0], [2, 1, 0], [0, 1, 0]], [[0, 0, 0], [1, 0, 1], [1, 1, 0], [0, 1, 0]]]) {
    assert.throws(() => canonicalPlacementIntent({ ...input, parameters: { ...input.parameters, area: { corners: ring } } }));
  }
});
