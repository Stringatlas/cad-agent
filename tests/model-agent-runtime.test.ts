import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalModelCaptureRequest, canonicalModelReferenceSelection, canonicalModelChatEvent,
  type ModelTurnRequest, type ModelScene, type ModelChatEvent, TORONTO_SEMANTIC_LABELS,
  type TorontoCadSnapshot, type TorontoCadProposal, type PointOverrideSnapshot } from '@spatial/contracts';
import { ModelBrowserBroker } from '../apps/server/src/model-browser-broker';
import { createModelAgentRuntime, retryModelSceneRead } from '../apps/server/src/model-agent-runtime';
import { bindModelScene } from '../apps/server/src/model-scene';
import { PointOverrideSession } from '../apps/server/src/point-overrides';
import { TorontoCadSession } from '../apps/server/src/toronto-cad-session';
import { SemanticArtifact } from '../apps/server/src/semantic-artifact';
import { getSemanticDiskIndex } from '../apps/server/src/semantic-disk-index';

test('browser RPC rejects wrong/replayed nonces and cannot carry approval decisions', async () => {
  let event!: Extract<ModelChatEvent, { kind: 'browser-request' }>;
  const broker = new ModelBrowserBroker('rpc-request', AbortSignal.timeout(2000), async e => { assert.equal(e.kind, 'browser-request'); event = e as typeof event; });
  const promise = broker.request({ kind: 'capture', request: { kind: 'top-down' } }, 'call-one');
  const result = { requestId: event.requestId, toolCallId: event.toolCallId, nonce: event.nonce, result: { status: 'unavailable' } };
  assert.throws(() => broker.accept({ ...result, nonce: 'forged' }));
  assert.throws(() => broker.accept({ ...result, result: { status: 'accepted' } }));
  broker.accept(result); assert.deepEqual(await promise, { status: 'unavailable' }); assert.throws(() => broker.accept(result));
});

test('capture/reference/event contracts reject extra fields and degenerate camera', () => {
  assert.deepEqual(canonicalModelCaptureRequest({ kind: 'top-down' }), { kind: 'top-down' });
  for (const request of [{ kind: 'approve' }, { kind: 'current', approve: true }, { kind: 'camera', position: [0, 0, 0], target: [0, 0, 0] }, { kind: 'camera', position: [0, 0, 1], target: [0, 0, 0], up: [0, 0, 1] }]) assert.throws(() => canonicalModelCaptureRequest(request));
  for (const request of [{ kind: 'toronto-point', key: { sourceFileId: 0, sourceRow: 0 } }, { kind: 'toronto-point', key: { sourceFileId: 1, sourceRow: -1 } }, { kind: 'toronto-point', key: { sourceFileId: 1, sourceRow: 0 }, position: [0, 0, 0] }]) assert.throws(() => canonicalModelReferenceSelection(request));
  assert.throws(() => canonicalModelChatEvent({ kind: 'approval-result', requestId: 'r', proposalId: 'p', authority: 'cad', outcome: 'approved-by-model', scene: { mode: 'pole', toronto: [] } }));
});

async function torontoRuntimeFixture(t: { after(fn: () => unknown): void }, onBrowser?: (event: ModelChatEvent) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'spatial-runtime-toronto-'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 1, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [0, 0, 0], max: [3, 3, 3] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [0, 0, 0], max: [3, 3, 3] }, { name: 'rgb', type: 'uint16', size: 6 },
      { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(28); payload.writeInt32LE(1000); payload.writeUInt16LE(1, 18);
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(1, 2); hierarchy.writeBigUInt64LE(28n, 14);
  await mkdir(join(root, 'octree'));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0],
    potree_scale_m: metadata.scale, semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS,
    sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? 1 : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata));
  await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const artifact = await SemanticArtifact.open(root);
  const prepared = await getSemanticDiskIndex(artifact); await artifact.close();
  t.after(() => rm(prepared.index.directory, { recursive: true, force: true }));
  const points = new PointOverrideSession(root), cad = new TorontoCadSession(root);
  const controller = new AbortController(), signal = controller.signal;
  const scene: ModelScene = { mode: 'toronto', toronto: [] };
  const call: ModelTurnRequest = { requestId: 'toronto-concurrency', conversationId: null, generation: 'fixture-generation', model: 'fixture', text: 'Inspect', scene };
  const initial = await bindModelScene(scene, root, signal, undefined, { points, cad });
  const browser = new ModelBrowserBroker(call.requestId, signal, onBrowser ?? (async () => {}));
  const runtime = createModelAgentRuntime(call, initial, root, signal, browser, { points, cad });
  t.after(async () => { controller.abort(); await runtime.close(); await points.close(); await cad.close(); await rm(root, { recursive: true, force: true }); });
  return { cad, points, runtime, signal, browser, scene };
}

for (const forged of [false, true]) test(`Toronto reference selection independently checks original source position: forged=${forged}`, async t => {
  const f = await torontoRuntimeFixture(t, async event => {
    assert.equal(event.kind, 'browser-request'); if (event.kind !== 'browser-request') return;
    const state = await f.points.execute('snapshot') as PointOverrideSnapshot;
    f.browser.accept({ requestId: event.requestId, toolCallId: event.toolCallId, nonce: event.nonce, result: { status: 'selected', scene: {
      ...f.scene, toronto: [{ name: 'Point 1', datasetId: 'toronto3d', artifactRevision: state.artifactRevision,
        key: { sourceFileId: 1, sourceRow: 0 }, position: forged ? [999, 0, 0] : [1, 0, 0],
        frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }],
    } } });
  });
  const selected = f.runtime.selectReference!({ kind: 'toronto-point', key: { sourceFileId: 1, sourceRow: 0 } }, 'reference-call');
  if (forged) await assert.rejects(selected, { code: 'invalid-tool-result' });
  else { const result = await selected; assert.equal(result.status, 'selected'); }
});

for (const decision of ['accepted', 'declined'] as const) for (const unrelatedMutation of [false, true])
test(`actual Toronto ${decision} receipt with concurrent snapshot ${unrelatedMutation ? 'rejects unrelated revision' : 'resumes without mutation replay'}`, async t => {
  const f = await torontoRuntimeFixture(t);
  const proposal = await f.runtime.proposeCad!({ kind: 'box', center: [1, 1, 1], dimensions: [1, 1, 1] }, f.signal) as TorontoCadProposal;
  await f.cad.execute(decision === 'accepted' ? 'approve' : 'decline', { sessionId: proposal.sessionId, revision: proposal.revision,
    artifactRevision: proposal.artifactRevision, proposalId: proposal.proposalId });
  assert.equal(f.cad.proposalDecision(proposal.proposalId), decision);
  if (unrelatedMutation) {
    const state = await f.cad.execute('snapshot') as TorontoCadSnapshot;
    const other = await f.cad.execute('propose', { sessionId: state.sessionId, revision: state.revision, artifactRevision: state.artifactRevision,
      operation: { kind: 'cylinder', center: [2, 2, 2], radius: .25, height: 1 } }) as TorontoCadProposal;
    await f.cad.execute('approve', { sessionId: other.sessionId, revision: other.revision, artifactRevision: other.artifactRevision, proposalId: other.proposalId });
  }
  const artifact = (f.cad as unknown as { artifact: SemanticArtifact }).artifact;
  const check = artifact.check.bind(artifact);
  let entered!: () => void, release!: () => void, hold = true;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  artifact.check = async signal => { if (hold) { hold = false; entered(); await gate; } await check(signal); };
  const browserRead = f.cad.execute('snapshot'); await started;
  const observation = f.runtime.waitForApproval!('cad', proposal.proposalId).then(value => ({ value }), error => ({ error }));
  await delay(40); release();
  const result = await observation; await browserRead; artifact.check = check;
  if (unrelatedMutation) { assert.ok('error' in result); assert.equal((result.error as { code: string }).code, 'stale-scene'); return; }
  if ('error' in result) throw result.error;
  assert.equal(result.value.outcome, decision);
  const state = await f.cad.execute('snapshot') as TorontoCadSnapshot;
  assert.equal(state.revision, decision === 'accepted' ? 1 : 0);
  assert.equal(state.bodies.length, decision === 'accepted' ? 1 : 0); assert.equal(state.proposals.length, 0);
  const context = result.value.context as { torontoEditing: { cad: { revision: number } } };
  assert.equal(context.torontoEditing.cad.revision, state.revision);
  assert.equal((await f.points.execute('snapshot') as PointOverrideSnapshot).revision, 0);
});

test('scene read contention retries remain cancellable and never retry non-busy failures', async () => {
  const controller = new AbortController(); let reads = 0;
  const waiting = retryModelSceneRead(async () => { ++reads; throw { code: 'busy' }; }, controller.signal);
  await delay(40); controller.abort(); await assert.rejects(waiting, { name: 'AbortError' }); assert.ok(reads >= 1);
  let staleReads = 0;
  await assert.rejects(retryModelSceneRead(async () => { ++staleReads; throw { code: 'stale-scene' }; }, new AbortController().signal), { code: 'stale-scene' });
  assert.equal(staleReads, 1);
});
