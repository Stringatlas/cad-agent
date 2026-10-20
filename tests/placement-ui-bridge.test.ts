import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalResolvedPlacementSpecification, type ModelAreaOfInterest } from '@spatial/contracts';
import { placementMatchesScene, validatePlacementShortlist } from '../apps/web/src/placement-search-client';

function fixture() {
  const area: ModelAreaOfInterest = { datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0], corners: [[0, 0, 10], [10, 0, 10], [10, 20, 10], [0, 20, 10]] };
  const points = { sessionId: 'points', revision: 0 }, cad = { sessionId: 'cad', revision: 2 };
  const specification = canonicalResolvedPlacementSpecification({ schemaVersion: 1, parameters: {
    binding: { datasetId: area.datasetId, artifactRevision: area.artifactRevision, frameId: area.frameId, units: area.units, localOrigin: area.localOrigin, terrainRevision: 'b'.repeat(64), pointAuthority: points, cadAuthority: cad },
    area: { corners: area.corners }, dimensions: [1, 1, 1.2], frontAccessDepth: 1, frontAccessHeight: 1.2,
    poleSeparation: 2, poleDistance: { from: 'box-boundary', metric: 'horizontal', to: 'observed-pole-points' },
    maxGroundSlopeDegrees: 2, maxGroundRelief: .1, groundMeasurement: 'sampled-plane-slope-and-height-range',
    allowedYawDegrees: [0, 90, 180, 270], containment: 'footprint-and-access', maxBodyConflicts: 0, maxAccessConflicts: 0,
    ranking: [{ metric: 'ground-slope', direction: 'minimize' }],
  }, assumptions: [] });
  const volume = { bounds: { min: [0, 0, 0], max: [1, 1, 1] }, totalCount: 1, supportingGroundCount: 1, obstructionCount: 0, countsByLabel: [0, 1, 0, 0, 0, 0, 0, 0, 0], points: [], truncated: false };
  const result = { searchId: 'search', specification, status: 'complete', evaluated: 1, generated: 1,
    limitations: ['Illustrative only'], binding: { preprocessingHash: 'b'.repeat(64), indexHash: 'c'.repeat(64), sourceHash: 'd'.repeat(64) },
    candidates: [{ id: 'site-1', rank: 1, operation: { kind: 'box', center: [5, 5, 10.6], dimensions: [1, 1, 1.2] }, yawDegrees: 90, groundSlopeDegrees: 0, groundRelief: 0, poleSeparationMeters: null, body: volume, access: structuredClone(volume) }] };
  return { area, points, cad, result };
}

test('tool shortlist is detached and matches only the active AOI and exact authority snapshots', () => {
  const { area, points, cad, result } = fixture();
  const checked = validatePlacementShortlist(result);
  assert.equal(placementMatchesScene(checked, area, points, cad), true);
  assert.equal(placementMatchesScene(checked, area, undefined, cad), false);
  assert.equal(placementMatchesScene(checked, area, { ...points, sessionId: 'replacement' }, cad), false);
  assert.equal(placementMatchesScene(checked, area, points, { ...cad, revision: 3 }), false);
  assert.equal(placementMatchesScene(checked, { ...area, artifactRevision: 'e'.repeat(64) }, points, cad), false);
  const moved: ModelAreaOfInterest = { ...area, corners: [[1, 0, 10], area.corners[1], area.corners[2], area.corners[3]] };
  assert.equal(placementMatchesScene(checked, moved, points, cad), false);
  result.candidates[0].operation.center[0] = 99;
  assert.equal(checked.candidates[0].operation.center[0], 5);
});

test('rejects malformed specifications, bounded lists, evidence counts, witnesses and display numbers', () => {
  const mutations: ((r: any) => void)[] = [
    r => delete r.specification.parameters.frontAccessDepth,
    r => r.candidates = Array(6).fill(r.candidates[0]),
    r => r.candidates[0].rank = 2,
    r => r.candidates[0].yawDegrees = 45,
    r => r.candidates[0].operation.center = [0, null, 1],
    r => r.candidates[0].poleSeparationMeters = 'none',
    r => r.candidates[0].body.countsByLabel = [0],
    r => r.candidates[0].body.obstructionCount = -1,
    r => r.candidates[0].access = null,
    r => r.candidates[0].body.points = Array(13).fill({}),
    r => r.candidates[0].body.points = [{ position: [0, 0, 0], label: 9, source: {} }],
    r => r.generated = 100_001,
    r => r.status = 'incomplete',
    r => r.limitations = ['x'.repeat(2001)],
    r => r.binding.indexHash = 'invalid',
  ];
  for (const mutate of mutations) {
    const { result } = fixture(); mutate(result);
    assert.throws(() => validatePlacementShortlist(result));
  }
});
