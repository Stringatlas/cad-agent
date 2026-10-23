import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSceneEvidenceReceipt, canonicalSceneEvidenceProjection, canonicalSceneEvidenceLookup, canonicalModelChatEvent, evidenceUtf8Bytes, type SceneEvidenceProjection, type SceneSourceBinding, type ModelScene } from '@spatial/contracts';
import { SceneExploration } from '../../apps/server/src/agent/scene-exploration';
import { projectSceneEvidence, evidenceHash, captureAuthorityScope } from '../../apps/server/src/agent/exploration-evidence';
import { sceneCaptureCapabilities } from '../../apps/server/src/agent/agent-view-source';
import { bindCloudModelScene } from '../../apps/server/src/agent/cloud-model-scene';
import { bindModelScene } from '../../apps/server/src/agent/model-scene';
import { elevationFixture } from '../helpers/elevation-fixture';
import { candidateSource } from '../fixtures/area-candidate-source';
import type { ModelEditingAuthorities } from '../../apps/server/src/agent/model-scene';
export const binding: SceneSourceBinding = { sourceId: 'fixture', sourceRevision: 'a'.repeat(64), frameId: 'local', units: 'm', origin: [0, 0, 0] };
const marksBinding = { mode: 'cloud' as const, cloudId: binding.sourceId, artifactRevision: binding.sourceRevision, frameId: binding.frameId, units: 'm' as const, localOrigin: binding.origin };
const source = { binding, adapter: 'prepared' as const };
export function queryProjection(): SceneEvidenceProjection { return { tool: 'query_points', request: { operation: 'nearest', position: [0, 0, 0], maxResults: 1 }, result: { status: 'observed', complete: true, count: 1, checkedPoints: 1, witnesses: [{ key: { sourceFileId: 1, sourceRow: 0 }, position: [1e-12, 0, 0], reference: { kind: 'cloud-point', cloudId: binding.sourceId, revision: binding.sourceRevision, key: { sourceFileId: 1, sourceRow: 0 } } }], returnedWitnessCount: 1, retainedWitnessCount: 1, projectionTruncated: false } }; }
const retained = (store: SceneExploration, p = queryProjection()) => { const result = store.admit(p, 1); assert.equal(result.status, 'retained'); if (result.status !== 'retained') assert.fail(); return result.evidenceId; };
test('one frozen checkpoint preserves legacy marks and exact Float64 receipts, catalogue/lookup and projection digest', () => {
  const store = new SceneExploration(marksBinding, undefined, source), p = queryProjection(), id = retained(store, p);
  const result = store.evidence(id); assert.equal(result.status, 'available'); if (result.status !== 'available') assert.fail();
  assert.deepEqual(result.receipt.projection, p); assert.equal(result.receipt.projectionHash, evidenceHash(p));
  assert.deepEqual(canonicalSceneEvidenceLookup(result), result); assert(Object.isFrozen(result.receipt.projection));
  store.replace({ expectedRevision: 0, marks: [{ position: [0, 0, 0], rationale: 'A hypothesis', uncertainty: 'Occlusion unknown' }] }, 'legacy-image');
  assert.equal(store.snapshot().marks[0]!.observationId, 'legacy-image');
  assert.equal(store.catalogue().latest[0]!.evidenceId, id); assert(evidenceUtf8Bytes(store.catalogue()) <= 4096);
  const restored = new SceneExploration(marksBinding, store.checkpoint(), source); assert.deepEqual(restored.evidence(id), result); assert.deepEqual(restored.snapshot(), store.snapshot());
  assert.deepEqual(restored.evidence('not-issued'), { status: 'unavailable', reason: 'not-retained' });
  assert.throws(() => canonicalSceneEvidenceReceipt({ ...result.receipt, payload: { arbitrary: 'JSON' } }));
  assert.throws(() => canonicalSceneEvidenceProjection({ ...p, result: { ...p.result, independentVerification: true } }, binding, 'prepared'));
  assert.throws(() => new SceneExploration(marksBinding, { ...store.checkpoint(), receipts: [{ ...result.receipt, projectionHash: 'b'.repeat(64) }] }, source));
});
test('count eviction and future pins are atomic; pin exhaustion issues no ID and never replaces a linked record', () => {
  const store = new SceneExploration(marksBinding, undefined, source, { records: 1 }), first = retained(store);
  assert(store.setEvidencePins([first])); const checkpoint = store.checkpoint();
  assert.deepEqual(store.admit(queryProjection(), 2), { status: 'unavailable', reason: 'retention-limit' }); assert.equal(store.checkpoint(), checkpoint);
  assert.equal(store.setEvidencePins(['unknown']), false); assert.equal(store.checkpoint(), checkpoint);
  assert(store.setEvidencePins([])); const next = retained(store); assert.notEqual(first, next);
  assert.equal(store.evidence(first).status, 'unavailable'); assert.equal(store.evidence(next).status, 'available');
  assert.deepEqual(store.admit(undefined, 2), { status: 'unavailable', reason: 'unsupported-result' });
});
test('production count cap, aggregate UTF8 envelope and record bounds are enforced independently', () => {
  const count = new SceneExploration(marksBinding, undefined, source); const ids = Array.from({ length: 130 }, () => retained(count));
  assert.equal(count.checkpoint().receipts.length, 128); assert.equal(count.evidence(ids[0]!).status, 'unavailable');
  const probe = new SceneExploration(marksBinding, undefined, source); retained(probe);
  const bytes = evidenceUtf8Bytes(probe.checkpoint()), receiptBytes = evidenceUtf8Bytes(probe.checkpoint().receipts[0]);
  const limited = new SceneExploration(marksBinding, undefined, source, { checkpointBytes: bytes - 1 });
  assert.deepEqual(limited.admit(queryProjection(), 1), { status: 'unavailable', reason: 'retention-limit' }); assert.equal(limited.checkpoint().receipts.length, 0);
  const record = new SceneExploration(marksBinding, undefined, source, { recordBytes: receiptBytes - 1 });
  assert.deepEqual(record.admit(queryProjection(), 1), { status: 'unavailable', reason: 'record-too-large' });
  const unicode = '雪'.repeat(400); assert(evidenceUtf8Bytes(unicode) > JSON.stringify(unicode).length);
  const baseline = new SceneExploration(marksBinding, undefined, source); baseline.replace({ expectedRevision: 0, marks: [{ position: [0, 0, 0], rationale: unicode, uncertainty: unicode }] });
  assert(evidenceUtf8Bytes(baseline.checkpoint()) > canonicalLength(baseline.checkpoint()));
  const utf8Limited = new SceneExploration(marksBinding, undefined, source, { checkpointBytes: canonicalLength(baseline.checkpoint()) + 1 });
  assert.throws(() => utf8Limited.replace({ expectedRevision: 0, marks: [{ position: [0, 0, 0], rationale: unicode, uncertainty: unicode }] }), RangeError);
  assert.equal(utf8Limited.snapshot().annotationRevision, 0); assert.equal(utf8Limited.snapshot().marks.length, 0);
  function canonicalLength(value: unknown) { return JSON.stringify(value).length; }
});
test('authority-bound mark reset keeps same-original-source receipts and immutable historical scope, source change resets evidence', () => {
  const oldBinding = { artifactRevision: binding.sourceRevision, frameId: 'toronto3d-local-v1' as const, units: 'm' as const, localOrigin: [627285, 4841948, 0] as const, points: { sessionId: 'point-session', revision: 0 } };
  const s = { binding: { ...binding, sourceId: 'toronto3d', frameId: oldBinding.frameId, origin: oldBinding.localOrigin }, adapter: 'toronto' as const };
  const store = new SceneExploration(oldBinding, undefined, s);
  const p = { ...queryProjection(), result: { ...queryProjection().result, count: undefined, checkedPoints: undefined, totalCount: 1, independentVerification: false, witnesses: [] , returnedWitnessCount: 0, retainedWitnessCount: 0 } };
  // Optional fields are omitted, never undefined in JSON contracts.
  delete (p.result as any).count; delete (p.result as any).checkedPoints;
  const id = retained(store, p as SceneEvidenceProjection); store.replace({ expectedRevision: 0, marks: [{ position: [0, 0, 0], rationale: 'Before edit', uncertainty: 'Unknown' }] });
  const rebound = new SceneExploration({ ...oldBinding, points: { ...oldBinding.points, revision: 1 } }, store.checkpoint(), s);
  assert.equal(rebound.snapshot().marks.length, 0); assert.equal(rebound.evidence(id).status, 'available');
  const replaced = new SceneExploration(oldBinding, store.checkpoint(), { ...s, binding: { ...s.binding, sourceRevision: 'b'.repeat(64) } });
  assert.equal(replaced.evidence(id).status, 'unavailable'); assert.equal(replaced.catalogue().resetReason, 'source-changed');
});
test('actual prepared and Toronto adapter query projections preserve their different counts/verification and capped witnesses', async t => {
  const { root: dir, info } = await elevationFixture(t, false);
  const scene: ModelScene = { mode: 'cloud', toronto: [], cloud: { id: info.descriptor.id, revision: info.revision, frameId: info.descriptor.frameId, localOrigin: info.descriptor.coordinates.localOrigin, points: [] } };
  const signal = new AbortController().signal, bound = await bindCloudModelScene(scene, { [info.descriptor.id]: dir }, signal); t.after(() => bound.close());
  const cap = sceneCaptureCapabilities(scene, bound)!; const b = { ...bound, captureCapabilities: cap };
  const request = { operation: 'box' as const, bounds: info.bounds, maxResults: 64 };
  const raw = await bound.queryPoints!(request, signal), p = projectSceneEvidence('query_points', request, raw, scene, b);
  assert(p?.tool === 'query_points'); assert.equal(p.result.count, (raw as any).count); assert.equal(p.result.independentVerification, undefined);
  const toronto = await candidateSource(Array.from({ length: 20 }, (_, i) => ({ xyz: [i / 10, 0, 0], label: 6 }))); t.after(() => toronto.close());
  const ts: ModelScene = { mode: 'toronto', toronto: [] }, tb = await bindModelScene(ts, toronto.root, signal); t.after(() => tb.close());
  const q = { operation: 'box' as const, bounds: { min: [-1, -1, -1] as const, max: [3, 1, 1] as const }, maxResults: 64 };
  const rawToronto = await tb.queryPoints!(q, signal), tp = projectSceneEvidence('query_points', q, rawToronto, ts, { ...tb, captureCapabilities: sceneCaptureCapabilities(ts, tb) });
  assert(tp?.tool === 'query_points'); assert.equal(tp.result.totalCount, 20); assert.equal(tp.result.independentVerification, false); assert.equal(tp.result.count, undefined);
  assert.equal(tp.result.witnesses.length, 16); assert.equal(tp.result.returnedWitnessCount, 20); assert.equal(tp.result.projectionTruncated, true); assert.equal(tp.result.complete, true);
  assert.equal(tp.result.witnesses[0]!.reference.kind, 'toronto-point');
});
test('authority scope includes all bound accepted revisions and pending proposals or explicitly unknown', async () => {
  assert.deepEqual(await captureAuthorityScope(undefined, new AbortController().signal), { status: 'unknown', reason: 'not-available' });
  const make = (name: string) => ({ async execute(op: string) { return op === 'pending' ? [{ proposalId: 'pending-point' }] : { sessionId: name, revision: 4, artifactRevision: binding.sourceRevision, proposals: [{ proposalId: `pending-${name}` }] }; } });
  const scope = await captureAuthorityScope({ points: make('points'), cad: make('cad'), objects: make('objects') } as unknown as ModelEditingAuthorities, new AbortController().signal);
  assert.equal(scope.status, 'known'); if (scope.status === 'known') { assert.deepEqual(scope.points.pendingProposalIds, ['pending-point']); assert.deepEqual(scope.cad.pendingProposalIds, ['pending-cad']); assert.equal(scope.objects.revision, 4); }
});
test('new lookup event uses closed receipt validator and cannot accept arbitrary raw JSON', () => {
  const store = new SceneExploration(marksBinding, undefined, source), id = retained(store), context = store.evidence(id);
  assert.doesNotThrow(() => canonicalModelChatEvent({ kind: 'tool', requestId: 'request', name: 'get_scene_evidence', context }));
  assert.throws(() => canonicalModelChatEvent({ kind: 'tool', requestId: 'request', name: 'get_scene_evidence', context: { status: 'available', receipt: { arbitrary: 'raw JSON' } } }));
});


test('scene-inspection runtime instructions exactly match the static prompt reference evidence paragraph', async () => {
  const { readFile } = await import('node:fs/promises');
  const { loadProductSkill } = await import('../../apps/server/src/agent/product-agent-skills');
  const doc = await readFile('docs/model-candidate-prompt.md', 'utf8');
  const section = (name: string) => doc.split(`## ${name}\n`)[1]!.split('```text\n')[1]!.split('```')[0]!.trim();
  const body = loadProductSkill('scene-inspection', { mode: 'cloud', toolNames: ['query_points', 'get_scene_evidence'] }).instructions;
  assert.equal(body.trim(), `${section('SCENE_QUERY_INSTRUCTIONS')} ${section('AOI_POINTS_INSTRUCTIONS')}`);
});


test('fractional instance IDs and unavailable historical-image source mismatch cannot issue evidence', () => {
  const p = queryProjection(); assert(p.tool === 'query_points');
  assert.throws(() => canonicalSceneEvidenceProjection({ ...p, result: { ...p.result, witnesses: [{ ...p.result.witnesses[0], instanceId: .5 }] } }, binding, 'prepared'));
  const scene: ModelScene = { mode: 'cloud', toronto: [], cloud: { id: binding.sourceId, revision: binding.sourceRevision, frameId: binding.frameId, localOrigin: binding.origin, points: [] } };
  const raw = { imageSha256: 'a'.repeat(64), binding: { ...binding, sourceRevision: 'b'.repeat(64) }, result: { status: 'unavailable', observationId: 'old-image', x: 0, y: 0 } };
  const bound = { context: {}, async check() {}, async close() {}, captureCapabilities: { binding, bounds: { min: [-1,-1,-1] as const, max: [1,1,1] as const }, colorModes: ['rgb'] as const, targetKinds: ['original-source-point','box','polygon-prism'] as const, referenceKind: 'cloud-point' as const, relativeViews: true as const, layer: 'current-browser-layer' as const } };
  assert.equal(projectSceneEvidence('resolve_visual_pixel', { observationId: 'old-image', x: 0, y: 0 }, raw, scene, bound), undefined);
});
