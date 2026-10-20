import assert from 'node:assert/strict';
import test from 'node:test';
import { searchAreaCandidates, validateAreaCandidateSettings } from '../apps/server/src/area-candidate-search';
import { validateAreaCandidateResult } from '../apps/web/src/area-candidate-client';
import { candidateSource, denseGround } from './fixtures/area-candidate-source';
const settings = { spacingMeters: 1, clearanceRadiusMeters: .2, maxGroundReliefMeters: .1, minPoleDistanceMeters: 0, ranking: 'flat-ground' as const };
const authorities = { pointAuthority: { sessionId: 'count-points', revision: 0 }, cadAuthority: { sessionId: 'count-cad', revision: 0 } };

test('model-selected counts produce C1–Cn beyond five through engine and UI validation', async t => {
  const f = await candidateSource(denseGround(10)); t.after(() => f.close());
  for (const maxCandidates of [1, 3, 7, 20]) {
    const result = await searchAreaCandidates(f.snapshot, f.area(10), { ...settings, maxCandidates }, authorities, new AbortController().signal);
    assert.equal(result.status, 'complete'); assert.equal(result.candidates.length, maxCandidates);
    assert.deepEqual(result.candidates.map(c => c.rank), Array.from({ length: maxCandidates }, (_, i) => i + 1));
    const validated = validateAreaCandidateResult(result); assert.equal(validated.candidates.length, maxCandidates);
    assert.throws(() => validateAreaCandidateResult({ ...result, settings: { ...result.settings, maxCandidates: 0 } }));
    if (maxCandidates > 1) assert.throws(() => validateAreaCandidateResult({ ...result, settings: { ...result.settings, maxCandidates: maxCandidates - 1 } }));
  }
});

test('counts are bounded integers; legacy omission retains default rather than an unbounded search', () => {
  assert.equal(validateAreaCandidateSettings(settings).maxCandidates, 5);
  for (const maxCandidates of [0, -1, 21, 1.5, NaN, Infinity, '7', null]) {
    assert.throws(() => validateAreaCandidateSettings({ ...settings, maxCandidates }));
  }
});

test('requested count is an upper bound, not invented locations when evidence is sparse', async t => {
  const f = await candidateSource(denseGround(.5)); t.after(() => f.close());
  const result = await searchAreaCandidates(f.snapshot, f.area(.5), { ...settings, maxCandidates: 20 }, authorities, new AbortController().signal);
  assert.equal(result.status, 'complete'); assert.equal(result.candidates.length, 1);
  assert.equal(validateAreaCandidateResult(result).candidates[0].rank, 1);
});
