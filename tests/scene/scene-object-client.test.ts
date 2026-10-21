import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { canonicalSceneObjectSnapshot, type DatumPoint, type SceneObjectSnapshot, type SceneObjectProposal } from '../../packages/contracts/src/scene-objects';
import { SceneObjectController, authoredReference, type SceneObjectTransport, type SceneObjectView } from '../../apps/web/src/scenes/toronto/objects/scene-object-client';
import { createSceneObjectRender } from '../../apps/web/src/scenes/toronto/objects/scene-object-render';
import { modelScene, validateModelEvent } from '../../apps/web/src/chat/model-chat-client';

const artifact = 'a'.repeat(64);
const binding = { sessionId: 'object-session', revision: 0, artifactRevision: artifact, datasetId: 'toronto3d', frameId: 'toronto3d-local-v1', units: 'm' } as const;
const datum = (id = 'datum-1'): DatumPoint => ({ id, name: 'Point A', kind: 'datum-point', parentId: null, frameId: 'toronto3d-local-v1', units: 'm', objectRevision: 1, position: [1, 2, 3] });
const initial = (): SceneObjectSnapshot => ({ ...binding, schemaVersion: 1, objects: [], proposals: [], nextUndoTransactionId: null });
function fixture(transform?: (action: string, result: unknown) => unknown) {
  let state = initial(), count = 0;
  const requests: { action: string; body: any }[] = [];
  const transport: SceneObjectTransport = async (action, body) => {
    requests.push({ action, body });
    const request = body as any;
    let result: SceneObjectSnapshot | SceneObjectProposal;
    if (action === 'refresh') result = state;
    else if (action === 'propose') {
      assert.equal(request.sessionId, state.sessionId); assert.equal(request.revision, state.revision);
      const object = { ...datum(`datum-${++count}`), name: request.name, position: request.input.kind === 'position' ? request.input.position : [4, 5, 6] };
      result = { ...binding, revision: state.revision, schemaVersion: 1, proposalId: `proposal-${count}`, object };
      state = { ...state, proposals: [...state.proposals, result] };
    } else if (action === 'approve') {
      const proposal = state.proposals.find(p => p.proposalId === request.proposalId)!;
      state = { ...state, revision: state.revision + 1, objects: [...state.objects, proposal.object], proposals: [], nextUndoTransactionId: `transaction-${count}` }; result = state;
    } else if (action === 'decline') { state = { ...state, proposals: state.proposals.filter(p => p.proposalId !== request.proposalId) }; result = state; }
    else { state = { ...state, revision: state.revision + 1, objects: state.objects.slice(0, -1), proposals: [], nextUndoTransactionId: null }; result = state; }
    return structuredClone(transform ? transform(action, result) : result);
  };
  let view: SceneObjectView = { busy: false, needsRefresh: true };
  const controller = new SceneObjectController(value => { view = value; }, transport);
  controller.bind(artifact);
  return { controller, requests, get view() { return view; } };
}

test('manual datum preview, decline, exact acceptance and checked Undo share one authority', async () => {
  const f = fixture(); await f.controller.refresh();
  await f.controller.propose('Point A', { kind: 'position', position: [1, 2, 3] });
  assert.equal(f.view.snapshot?.objects.length, 0); assert.equal(f.view.snapshot?.proposals.length, 1);
  await f.controller.decline('proposal-1');
  assert.equal(f.view.snapshot?.revision, 0); assert.equal(f.view.snapshot?.objects.length, 0);
  await f.controller.propose('Point A', { kind: 'position', position: [1, 2, 3] });
  const candidate = f.view.snapshot!.proposals[0]!.object;
  await f.controller.approve('proposal-2');
  assert.equal(f.view.snapshot?.revision, 1); assert.deepEqual(f.view.snapshot?.objects, [candidate]);
  const calls = f.requests.length; await f.controller.approve('proposal-2'); assert.equal(f.requests.length, calls);
  assert.deepEqual(authoredReference(f.view.snapshot!, candidate), { kind: 'authored-object', sessionId: binding.sessionId, revision: 1, objectId: candidate.id, objectRevision: 1, frameId: binding.frameId, units: 'm' });
  await f.controller.undo(); assert.equal(f.view.snapshot?.revision, 2); assert.deepEqual(f.view.snapshot?.objects, []);
  assert.equal(f.requests.at(-1)?.body.transactionId, 'transaction-2'); f.controller.dispose();
});

test('reference creation transmits checked identity and offset, never client-resolved coordinates', async () => {
  const f = fixture(); await f.controller.refresh();
  const reference = { kind: 'source-record', datasetId: 'toronto3d', artifactRevision: artifact, key: { sourceFileId: 1, sourceRow: 2 }, domain: 'effective', overrideSessionId: 'points', overrideRevision: 3, frameId: binding.frameId, units: 'm' } as const;
  await f.controller.propose('Point A', { kind: 'reference', reference, offset: [1, 0, -1] });
  assert.deepEqual(f.requests.at(-1)?.body.input, { kind: 'reference', reference, offset: [1, 0, -1] });
  assert.deepEqual(f.view.snapshot?.proposals[0]?.object.position, [4, 5, 6]);
  const calls = f.requests.length;
  await f.controller.propose('Invalid source', { kind: 'reference', reference: { ...reference, key: { sourceFileId: 0, sourceRow: 2 } }, offset: [0, 0, 0] });
  assert.equal(f.requests.length, calls, 'invalid source identity must fail before a write');
  assert.equal(f.view.needsRefresh, true); assert.match(f.view.error!, /Invalid scene object contract/);
  f.controller.dispose();
});

test('pending reserved IDs cannot become authored references', async () => {
  const f = fixture(); await f.controller.refresh(); await f.controller.propose('Point A', { kind: 'position', position: [1, 2, 3] });
  assert.throws(() => authoredReference(f.view.snapshot!, f.view.snapshot!.proposals[0]!.object), /not committed/); f.controller.dispose();
});

for (const fault of ['moved-publication', 'decline-mutation', 'undo-mutation', 'wrong-artifact', 'wrong-proposal-position', 'unknown-fields']) {
  test(`object client fails closed on ${fault}; no automatic write retry`, async () => {
    const f = fixture((action, result) => {
      const value = result as any;
      if (fault === 'moved-publication' && action === 'approve') return { ...value, objects: [{ ...value.objects[0], position: [9, 9, 9] }] };
      if (fault === 'decline-mutation' && action === 'decline') return { ...value, objects: [datum()] };
      if (fault === 'undo-mutation' && action === 'undo') return { ...value, objects: [datum()] };
      if (fault === 'wrong-artifact' && action === 'refresh') return { ...value, artifactRevision: 'b'.repeat(64) };
      if (fault === 'wrong-proposal-position' && action === 'propose') return { ...value, object: { ...value.object, position: [9, 9, 9] } };
      if (fault === 'unknown-fields' && action === 'refresh') return { ...value, unknown: true };
      return result;
    });
    await f.controller.refresh();
    if (!['wrong-artifact', 'unknown-fields'].includes(fault)) {
      await f.controller.propose('Point A', { kind: 'position', position: [1, 2, 3] });
      if (fault === 'decline-mutation') await f.controller.decline('proposal-1');
      if (fault === 'moved-publication' || fault === 'undo-mutation') await f.controller.approve('proposal-1');
      if (fault === 'undo-mutation') await f.controller.undo();
    }
    assert.equal(f.view.needsRefresh, true); assert.equal(f.view.snapshot, undefined); assert.match(f.view.error!, /Refresh/);
    const calls = f.requests.length; await f.controller.propose('Again', { kind: 'position', position: [1, 2, 3] }); assert.equal(f.requests.length, calls); f.controller.dispose();
  });
}

test('artifact replacement and disposal suppress late authority replies', async () => {
  let resolve!: (value: unknown) => void;
  let view: SceneObjectView | undefined;
  const controller = new SceneObjectController(value => { view = value; }, () => new Promise(done => { resolve = done; }));
  controller.bind(artifact); const pending = controller.refresh();
  controller.bind('b'.repeat(64)); resolve(initial()); await pending;
  assert.equal(view?.snapshot, undefined); assert.equal(view?.needsRefresh, true);
  const second = controller.refresh(); const retained = view; controller.dispose(); resolve({ ...initial(), artifactRevision: 'b'.repeat(64) }); await second;
  assert.equal(view, retained);
});

test('datum render cache shows distinct ghosts, picks only committed IDs and releases resources', () => {
  const scene = new THREE.Scene(), render = createSceneObjectRender(scene);
  const snapshot = canonicalSceneObjectSnapshot({ ...initial(), objects: [datum()], proposals: [{ ...binding, schemaVersion: 1, proposalId: 'pending', object: { ...datum('pending-datum'), position: [10, 0, 0] } }] });
  render.set(snapshot, 'datum-1'); scene.updateMatrixWorld(true);
  assert.equal(render.count, 2);
  const group = scene.children[0]!;
  const marker = group.children[0] as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  assert.deepEqual(Array.from(marker.geometry.getAttribute('position').array), [1, 2, 3]);
  assert.equal(marker.material.color.getHex(), 0xffffff);
  const raycaster = new THREE.Raycaster(new THREE.Vector3(1, 2, 20), new THREE.Vector3(0, 0, -1)); raycaster.params.Points.threshold = .1;
  assert.equal(render.pick(raycaster), 'datum-1');
  raycaster.set(new THREE.Vector3(10, 0, 20), new THREE.Vector3(0, 0, -1)); assert.equal(render.pick(raycaster), undefined);
  let disposed = 0; marker.geometry.addEventListener('dispose', () => { disposed++; }); marker.material.addEventListener('dispose', () => { disposed++; });
  assert.equal(render.set(snapshot, 'datum-1'), false);
  const authorityBefore = JSON.stringify(snapshot);
  assert.equal(render.set(snapshot, 'datum-1', ['datum-1', 'pending-datum']), true);
  assert.equal(disposed, 2); assert.equal(render.count, 1); // Pending ghosts cannot be hidden.
  scene.updateMatrixWorld(true);
  raycaster.set(new THREE.Vector3(1, 2, 20), new THREE.Vector3(0, 0, -1));
  assert.equal(render.pick(raycaster), undefined);
  assert.equal(render.set(snapshot, 'datum-1', ['pending-datum', 'datum-1']), false);
  assert.equal(render.set(snapshot, 'datum-1'), true); scene.updateMatrixWorld(true);
  assert.equal(render.count, 2); assert.equal(render.pick(raycaster), 'datum-1');
  assert.equal(JSON.stringify(snapshot), authorityBefore);
  render.set(); assert.equal(render.count, 0); render.dispose(); assert.equal(scene.children.length, 0);
});

test('authored model references remain typed and only enter Toronto turns', () => {
  const snapshot = canonicalSceneObjectSnapshot({ ...initial(), objects: [datum()] }); const reference = authoredReference(snapshot, snapshot.objects[0]!);
  const toronto = modelScene('toronto', [], undefined, [reference]);
  assert.deepEqual(toronto.objects, [reference]); assert.deepEqual(toronto.toronto, []);
  assert.equal(modelScene('pole', [], undefined, [reference]).objects, undefined);
  const request = { requestId: 'request', conversationId: null, generation: 'catalog', model: 'fixture', text: 'Create a point', scene: toronto };
  assert.equal(validateModelEvent({ kind: 'tool', requestId: 'request', name: 'propose_point_create', context: { kind: 'scene-object-proposal' } }, request).kind, 'tool');
  assert.throws(() => validateModelEvent({ kind: 'tool', requestId: 'request', name: 'propose_point_create', context: {} }, { ...request, scene: { mode: 'pole', toronto: [] } }));
});
