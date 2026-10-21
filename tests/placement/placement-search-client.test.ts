import assert from 'node:assert/strict';
import test from 'node:test';
import { illustrationSettings, placementAccessBounds, type PlacementCandidate } from '../../apps/web/src/scenes/toronto/placement/placement-search-client';

const candidate = (yawDegrees: number, dimensions: readonly [number, number, number]): PlacementCandidate => ({
  id: 'candidate', rank: 1, yawDegrees, operation: { kind: 'box', center: [10, 20, 3], dimensions },
  groundSlopeDegrees: 0, groundRelief: 0, poleSeparationMeters: null,
  body: { bounds: { min: [0, 0, 0], max: [1, 1, 1] }, totalCount: 0, countsByLabel: [], supportingGroundCount: 0, obstructionCount: 0, points: [], truncated: false }, access: null,
});

test('illustrative settings are editable independent values, not hidden standards', () => {
  const first = illustrationSettings(), second = illustrationSettings();
  assert.deepEqual(first, { dimensions: [1, 1, 1.2], frontAccessDepth: 1, poleSeparation: 2,
    maxGroundSlopeDegrees: 5, maxGroundRelief: .1, spacingMeters: 2, allowedYawDegrees: [0, 90, 180, 270] });
  first.allowedYawDegrees.pop();
  assert.equal(second.allowedYawDegrees.length, 4);
});

test('access previews use cardinal engine dimensions without double rotation', () => {
  assert.deepEqual(placementAccessBounds(candidate(0, [2, 4, 2]), 1), { min: [9, 22, 2], max: [11, 23, 4] });
  assert.deepEqual(placementAccessBounds(candidate(90, [4, 2, 2]), 1), { min: [7, 19, 2], max: [8, 21, 4] });
  assert.deepEqual(placementAccessBounds(candidate(180, [2, 4, 2]), 1), { min: [9, 17, 2], max: [11, 18, 4] });
  assert.deepEqual(placementAccessBounds(candidate(270, [4, 2, 2]), 1), { min: [12, 19, 2], max: [13, 21, 4] });
  assert.equal(placementAccessBounds(candidate(0, [2, 4, 2]), 0), undefined);
  assert.throws(() => placementAccessBounds(candidate(45, [2, 4, 2]), 1));
});
