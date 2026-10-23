import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { canonicalSceneRegion, sceneRegionBounds, canonicalModelCaptureRequest, canonicalAgentViewReceipt, canonicalBrowserCaptureRequest } from '@spatial/contracts';
import { constructAgentCamera, agentBoxCorners } from '../../apps/web/src/viewer/agent-camera';
const binding = { sourceId: 'fixture', sourceRevision: 'a'.repeat(64), frameId: 'local', units: 'm' as const, origin: [0, 0, 0] as const };
const region = (polygon: readonly (readonly number[])[], z = { min: -2, max: 3 }) => ({ binding, shape: { kind: 'polygon-prism', polygon, z } });
const valid = [[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]];
test('polygon prisms preserve either winding and detached concavity, explicit flat Z and closed keys', () => {
  for (const polygon of [valid, [...valid].reverse()]) {
    const input = region(polygon, { min: 1, max: 1 }), value = canonicalSceneRegion(input);
    assert.deepEqual(value, input); assert.notEqual(value.shape, input.shape);
    assert.deepEqual(sceneRegionBounds(value), { min: [0, 0, 1], max: [4, 4, 1] });
  }
  for (const shape of [{ ...region(valid).shape, holes: [] }, { kind: 'polygon-prism', polygon: valid }, region(valid, { min: 2, max: 1 }).shape, region([[0, 0], [Infinity, 1], [0, 1]]).shape, region([[0, 0], [1e7 + 1, 1], [0, 1]]).shape]) assert.throws(() => canonicalSceneRegion({ binding, shape }));
  assert.throws(() => canonicalModelCaptureRequest({ kind: 'frame', target: { kind: 'region', region: region([[0, 0], [1, 1], [0, 1], [1, 0]]) }, orientation: 'top' }), { code: 'invalid-region' });
});
test('exact binary64 topology agrees with independent rational line-parameter oracle on adversarial and seeded rings', () => {
  const tiny = Number.MIN_VALUE, large = 1e7, step = 2 ** -29;
  const cases: number[][][] = [valid, [...valid].reverse(), [[0, 0], [1, 1], [0, 1], [1, 0]], [[0, 0], [2, 0], [1, 0], [1, 1]], [[0, 0], [1, 0], [2, 0], [2, 1], [0, 1]], [[0, 0], [1, 0], [1, 1], [0, 0]], [[0, 0], [2, 0], [2, 2], [1, 0], [0, 2]], [[0, 0], [tiny, 0], [0, tiny]], [[large, large], [large - step, large], [large, large - step]], [[0, 0], [1, 1], [2, 2 + Number.EPSILON * 2]], [[0, 0], [4, 0], [4, 4], [2, tiny], [0, 4]], [[0, 0], [1e7, tiny], [tiny, 1e7]]];
  let seed = 123456789; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 400; i++) {
    const scale = [tiny, 2 ** -500, 1, 1e6][i % 4]!, n = 3 + i % 6;
    cases.push(Array.from({ length: n }, () => [Math.floor(random() * 17 - 8) * scale, Math.floor(random() * 17 - 8) * scale]));
  }
  const oracle = spawnSync('python3', ['tests/fixtures/polygon-oracle.py'], { input: JSON.stringify(cases), encoding: 'utf8' });
  assert.equal(oracle.status, 0, oracle.stderr); const answers = JSON.parse(oracle.stdout) as boolean[];
  cases.forEach((polygon, i) => { let accepted = true; try { canonicalSceneRegion(region(polygon)); } catch { accepted = false; } assert.equal(accepted, answers[i], `case ${i}: ${JSON.stringify(polygon)}`); });
  assert(answers[7], 'subnormal triangle has exact nonzero area'); assert(answers[8], 'large offset cancellation triangle has exact nonzero area');
});
test('64 vertices are bounded and exact topology worst-case timing is measured; 65 rejects', t => {
  const polygon = Array.from({ length: 64 }, (_, i) => [1e7 * Math.cos(i / 64 * Math.PI * 2), 1e7 * Math.sin(i / 64 * Math.PI * 2)]);
  const started = performance.now(); for (let i = 0; i < 20; i++) canonicalSceneRegion(region(polygon));
  t.diagnostic(`64-vertex exact validation20 iterations: ${(performance.now() - started).toFixed(1)}ms`);
  assert.throws(() => canonicalSceneRegion(region([...polygon, [0, 0]])));
});
test('polygon frame fits enclosing box and receipt preserves topology/method across relative views and portrait', () => {
  const declared = canonicalSceneRegion(region(valid)), bounds = sceneRegionBounds(declared);
  const request = { kind: 'framed' as const, binding, bounds, pivot: [2, 2, .5] as const, orientation: 'oblique' as const, targetKind: 'declared-polygon-prism' as const, region: declared };
  assert.deepEqual(canonicalBrowserCaptureRequest(request), request);
  for (const aspect of [.3, 1, 3]) {
    const { camera, receipt } = constructAgentCamera(request, aspect, 'points', 'rgb');
    assert.deepEqual(receipt.region, declared); assert.equal(receipt.fitMethod, 'enclosing-box');
    for (const corner of agentBoxCorners(bounds)) { const p = corner.project(camera); assert(Math.abs(p.x) <= 1 / 1.1 + 1e-12); assert(Math.abs(p.y) <= 1 / 1.1 + 1e-12); }
    const next = constructAgentCamera({ kind: 'adjust', binding, observationId: 'first', base: receipt, adjustment: { azimuthDeltaDegrees: 10, elevationDeltaDegrees: 0, distanceScale: .5 } }, aspect, 'points', 'rgb').receipt;
    assert.deepEqual(next.region, declared); assert.equal(next.fitMethod, 'enclosing-box'); assert.equal(next.fitGuaranteed, false);
    assert.throws(() => canonicalAgentViewReceipt({ ...receipt, fitMethod: undefined }));
    assert.throws(() => canonicalAgentViewReceipt({ ...receipt, targetKind: 'declared-box' }));
    assert.throws(() => canonicalAgentViewReceipt({ ...receipt, bounds: { ...bounds, max: [5, 5, 5] } }));
  }
  assert.throws(() => canonicalBrowserCaptureRequest({ ...request, binding: { ...binding, frameId: 'wrong' } }));
});


test('capture region canonical syntax stays hard while closed topology errors are recoverable', () => {
  const frame = (value: unknown) => ({ kind: 'frame', target: { kind: 'region', region: value }, orientation: 'top' });
  for (const value of [{ ...region(valid), extra: true }, { binding, shape: { ...region(valid).shape, holes: [] } }, { binding, shape: { ...region(valid).shape, kind: 'unknown' } }, { ...region(valid), binding: { ...binding, sourceRevision: 'not-a-hash' } }]) {
    assert.throws(() => canonicalModelCaptureRequest(frame(value)), error => error instanceof TypeError && !('code' in error));
  }
  assert.throws(() => canonicalModelCaptureRequest(frame(region([[0, 0], [1, 0], [2, 0]]))), { code: 'invalid-region' });
});
