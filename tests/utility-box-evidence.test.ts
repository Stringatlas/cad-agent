import assert from 'node:assert/strict';
import test from 'node:test';
import { placementWitnesses, placementWitnessSelection } from '../apps/web/src/utility-box-evidence';
import type { TorontoDraftPoint } from '../apps/web/src/draft-context';
const source: TorontoDraftPoint = { name: 'Point 1', datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), key: { sourceFileId: 1, sourceRow: 0 }, position: [1, 1, 0],
  frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] };
const witness = { position: [1, 1, 1], label: 6, source: { sourceFileId: 2, sourceRow: 3 }, artifactRevision: source.artifactRevision, frameId: source.frameId, units: 'm' };
const assessment = { status: 'assessed', complete: true, pointName: source.name, source,
  binding: { artifactRevision: source.artifactRevision, frameId: source.frameId, units: 'm', domain: 'original-source-points' },
  body: { complete: true, points: [witness] }, access: null };
test('placement evidence is on-demand, bound to current reference and reread before normal scene pin selection', async () => {
  const [selection] = placementWitnesses(assessment, [source]); assert.equal(selection.volume, 'body');
  let calls = 0;
  const result = await placementWitnessSelection(selection, [source], async (url, init) => { calls++; assert.ok(String(url).includes('sourceFileId=2')); assert.ok(init?.signal);
    return Response.json({ ...source, key: { sourceFileId: 2, sourceRow: 3 }, position: witness.position, semanticLabel: 6 }); });
  assert.equal(calls, 1); assert.equal(result.semanticLabel, 6); assert.deepEqual(result.key, { sourceFileId: 2, sourceRow: 3 }); assert.equal(result.evidence, undefined);
  assert.deepEqual(placementWitnesses({ ...assessment, complete: false }, [source]), []);
  assert.deepEqual(placementWitnesses({ ...assessment, access: { complete: false, points: [] } }, [source]), []);
  assert.deepEqual(placementWitnesses(assessment, [{ ...source, artifactRevision: 'b'.repeat(64) }]), []);
  assert.deepEqual(placementWitnesses(assessment, [{ ...source, position: [2, 1, 0] }]), []);
  assert.deepEqual(placementWitnesses(assessment, []), []);
  await assert.rejects(placementWitnessSelection({ ...selection, witness: { ...selection.witness, position: [9, 9, 9] } }, [source]));
  await assert.rejects(placementWitnessSelection(selection, [source], async () => Response.json({ ...source, semanticLabel: 6 })));
  await assert.rejects(placementWitnessSelection(selection, [source], async () => new Response('unavailable', { status: 503 })));
});
