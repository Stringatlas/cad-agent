import assert from 'node:assert/strict';
import test from 'node:test';

import type { AreaCandidateResult, PointOverrideSnapshot, TorontoCadSnapshot } from '@spatial/contracts';
import { areaCandidatesMatchScene, validateAreaCandidateResult } from '../../apps/web/src/scenes/toronto/placement/area-candidate-client';
const hash = 'a'.repeat(64);
const area = { datasetId: 'toronto3d' as const, artifactRevision: hash, frameId: 'toronto3d-local-v1' as const, units: 'm' as const, localOrigin: [627285, 4841948, 0] as const, corners: [[0,0,0], [100,0,0], [100,100,0], [0,100,0]] as const };
function fixture(): AreaCandidateResult {
  return { status: 'complete', candidates: [{ id: 'candidate-one', rank: 1, position: [5,5,0], groundPoints: 10, groundReliefMeters: .02, observedObstacleCells: 0, poleDistanceMeters: null }], area,
    settings: { spacingMeters: 2, clearanceRadiusMeters: 1, maxGroundReliefMeters: .1, minPoleDistanceMeters: 2, ranking: 'flat-ground' },
    binding: { artifactRevision: hash, indexHash: hash, sourceHash: hash, pointAuthority: { sessionId: 'points-one', revision: 0 }, cadAuthority: { sessionId: 'cad-one', revision: 0 } },
    evidence: { pagesRead: 1, sourcePointsExamined: 100, areaPoints: 50, cellsEvaluated: 25, elapsedMilliseconds: 100, cellMeters: 1 }, limitations: ['Observed evidence only'] };
}
const points: PointOverrideSnapshot = { datasetId: 'toronto3d', artifactRevision: hash, frameId: 'toronto3d-local-v1', units: 'm', sessionId: 'points-one', revision: 0, entries: [], nextUndoTransactionId: null };
const cad: TorontoCadSnapshot = { datasetId: 'toronto3d', frameId: 'toronto3d-local-v1', units: 'm', artifactRevision: hash, sessionId: 'cad-one', revision: 0, bodies: [], proposals: [], nextUndoTransactionId: null };
test('candidate evidence is bounded, strict and detached', () => {
  const input = fixture(), result = validateAreaCandidateResult(input);
  assert.notEqual(result, input); assert.ok(Object.isFrozen(result)); assert.equal(result.candidates[0].rank, 1);
  for (const mutate of [
    (r: any) => r.extra = true, (r: any) => r.candidates[0].position = [101,5,0],
    (r: any) => r.candidates[0].rank = 2, (r: any) => r.candidates[0].extra = true,
    (r: any) => r.binding.cadAuthority.revision = -1, (r: any) => r.settings.spacingMeters = 0,
    (r: any) => r.status = 'incomplete', (r: any) => r.evidence.areaPoints = 101,
    (r: any) => r.binding.artifactRevision = 'b'.repeat(64), (r: any) => r.limitations = ['x'.repeat(2001)],
  ]) { const value = structuredClone(input); mutate(value); assert.throws(() => validateAreaCandidateResult(value)); }
});
test('exact active area, source-only state and current authorities are mandatory', () => {
  const r = validateAreaCandidateResult(fixture()); assert.equal(areaCandidatesMatchScene(r, area, points, cad), true);
  assert.equal(areaCandidatesMatchScene(r, undefined, points, cad), false);
  assert.equal(areaCandidatesMatchScene(r, area, undefined, cad), false);
  assert.equal(areaCandidatesMatchScene(r, { ...area, corners: [[1,0,0],[101,0,0],[101,100,0],[1,100,0]] }, points, cad), false);
  assert.equal(areaCandidatesMatchScene(r, area, { ...points, revision: 1 }, cad), false);
  assert.equal(areaCandidatesMatchScene(r, area, points, { ...cad, sessionId: 'replacement' }), false);
  assert.equal(areaCandidatesMatchScene(r, area, { ...points, entries: [{} as any] }, cad), false);
  assert.equal(areaCandidatesMatchScene(r, area, points, { ...cad, bodies: [{} as any] }), false);
  assert.equal(areaCandidatesMatchScene(r, area, points, { ...cad, proposals: [{} as any] }), false);
});
