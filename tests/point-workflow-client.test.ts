import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { PointMoveProposal, PointOverrideSnapshot } from '@spatial/contracts';
import { PointOverrideController, type PointEditView } from '../apps/web/src/point-override-client';
import { createPointOverrideRender } from '../apps/web/src/point-override-render';
import { ModelChatController } from '../apps/web/src/model-chat-client';

const artifactRevision = 'a'.repeat(64);
const empty: PointOverrideSnapshot = { sessionId: 'session-1', revision: 0, artifactRevision, datasetId: 'toronto3d', frameId: 'toronto3d-local-v1', units: 'm', entries: [], nextUndoTransactionId: null };
const { entries: _entries, nextUndoTransactionId: _undo, ...binding } = empty;
const first: PointMoveProposal = { ...binding, proposalId: 'first', moves: [{ key: { sourceFileId: 1, sourceRow: 1 }, originalPosition: [1, 2, 3], before: [1, 2, 3], after: [4, 5, 6] }] };
const second: PointMoveProposal = { ...binding, proposalId: 'second', moves: [{ key: { sourceFileId: 2, sourceRow: 2 }, originalPosition: [7, 8, 9], before: [7, 8, 9], after: [10, 11, 12] }] };
const entry = (p: PointMoveProposal) => ({ key: p.moves[0].key, originalPosition: p.moves[0].originalPosition, position: p.moves[0].after });

function authority(stalePending = false) {
  let snapshot = empty, proposals = [first, second];
  const states: PointEditView[] = [], calls: { action: string; body: unknown }[] = [];
  const controller = new PointOverrideController(v => states.push(v), async (action, body) => {
    calls.push({ action, body });
    if (action === 'refresh') return snapshot;
    if (action === 'pending') return stalePending ? proposals.map(p => ({ ...p, revision: 0 })) : proposals;
    if (action === 'approve' || action === 'decline') {
      const request = body as { proposalId: string; revision: number };
      assert.equal(request.revision, snapshot.revision);
      const proposal = proposals.find(p => p.proposalId === request.proposalId)!;
      assert.ok(proposal);
      if (action === 'approve') snapshot = { ...snapshot, revision: snapshot.revision + 1, entries: [...snapshot.entries, entry(proposal)], nextUndoTransactionId: `undo-${snapshot.revision + 1}` };
      proposals = proposals.filter(p => p.proposalId !== request.proposalId).map(p => ({ ...p, revision: snapshot.revision }));
      return snapshot;
    }
    throw new Error('Unexpected write');
  }, true);
  controller.bind([], artifactRevision);
  return { controller, states, calls };
}

test('separate confirmations reload exact surviving proposals at the returned authority revision', async () => {
  const { controller, states, calls } = authority();
  await controller.refresh();
  assert.equal(states.at(-1)?.proposals?.length, 2);
  controller.selectProposal(first.proposalId); await controller.approve();
  const state = states.at(-1)!;
  assert.equal(state.snapshot?.revision, 1); assert.equal(state.needsRefresh, false);
  assert.deepEqual(state.proposals, [{ ...second, revision: 1 }]);
  assert.deepEqual(state.proposals?.[0].moves, second.moves);
  assert.deepEqual(calls.map(c => c.action), ['refresh', 'pending', 'approve', 'pending']);
  await controller.approve();
  assert.equal(states.at(-1)?.snapshot?.revision, 2);
  assert.equal(states.at(-1)?.snapshot?.entries.length, 2);
  assert.deepEqual(states.at(-1)?.proposals, []);
  assert.deepEqual(calls.at(-2)?.body, { sessionId: empty.sessionId, revision: 1, proposalId: second.proposalId });
  controller.dispose();
});

test('rejecting one change leaves the other exact retained proposal available', async () => {
  const { controller, states } = authority(); await controller.refresh();
  controller.selectProposal(second.proposalId); await controller.decline();
  assert.deepEqual(states.at(-1)?.proposals, [first]);
  assert.deepEqual(states.at(-1)?.snapshot, empty);
  await controller.approve();
  assert.deepEqual(states.at(-1)?.snapshot?.entries, [entry(first)]);
  controller.dispose();
});

test('old-revision pending replies after publication fail closed instead of rebasing locally', async () => {
  const { controller, states, calls } = authority(true); await controller.refresh(); await controller.approve();
  assert.equal(states.at(-1)?.needsRefresh, true); assert.deepEqual(states.at(-1)?.proposals, []);
  const count = calls.length; await controller.approve(); assert.equal(calls.length, count);
  controller.dispose();
});

test('selection generation gates a delayed post-approval pending reload', async () => {
  let resolve!: (value: unknown) => void;
  const states: PointEditView[] = []; let reload = false;
  const controller = new PointOverrideController(v => states.push(v), async action => {
    if (action === 'refresh') return empty;
    if (action === 'approve') { reload = true; return { ...empty, revision: 1, entries: [entry(first)], nextUndoTransactionId: 'undo-1' }; }
    if (action === 'pending') return reload ? new Promise(r => { resolve = r; }) : [first, second];
    throw new Error('Unexpected write');
  }, true);
  controller.bind([], artifactRevision); await controller.refresh();
  const work = controller.approve(); await new Promise(r => setTimeout(r, 0));
  controller.bind([], 'b'.repeat(64)); resolve([{ ...second, revision: 1 }]); await work;
  assert.equal(states.at(-1)?.needsRefresh, true); assert.equal(states.at(-1)?.snapshot, undefined);
  assert.deepEqual(states.at(-1)?.proposals, []); controller.dispose();
});

test('all retained proposal copies render together without changing original positions or colors', () => {
  const scene = new THREE.Scene(), render = createPointOverrideRender(scene);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([1, 2, 3, 7, 8, 9], 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute([.1, .2, .3, .4, .5, .6], 3));
  const cloud = new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors: true }));
  const colors = Array.from(geometry.getAttribute('color').array);
  render.setArtifactRevision(artifactRevision); render.register(cloud, [1, 1, 2, 2]); render.setPointOverrides(empty);
  render.setPointMovePreview([first, second]);
  const ghost = scene.children.find(o => o instanceof THREE.Points && o !== render.fallback) as THREE.Points;
  const lines = scene.children.find(o => o instanceof THREE.LineSegments) as THREE.LineSegments;
  assert.deepEqual(Array.from(ghost.geometry.getAttribute('position').array), [4, 5, 6, 10, 11, 12]);
  assert.equal(lines.geometry.getAttribute('position').count, 4);
  assert.deepEqual(Array.from(geometry.getAttribute('position').array), [1, 2, 3, 7, 8, 9]);
  assert.deepEqual(Array.from(geometry.getAttribute('color').array), colors);
  assert.equal((ghost.material as THREE.PointsMaterial).color.getHex(), 0xffb84d);
  render.setPointOverrides({ ...empty, revision: 1, entries: [entry(first)] });
  render.setPointMovePreview([{ ...second, revision: 1 }]);
  assert.deepEqual(Array.from(ghost.geometry.getAttribute('position').array), [10, 11, 12]);
  assert.deepEqual(Array.from(geometry.getAttribute('position').array), [4, 5, 6, 7, 8, 9]);
  render.dispose(); geometry.dispose(); cloud.material.dispose();
});

test('nearest-move model events request authority reload on success and later provider error', async () => {
  for (const success of [true, false]) for (const status of ['pending', 'no-change']) {
    const refreshed: string[] = [];
    const client = new ModelChatController(() => {}, async (path, init) => {
      if (path === '/chat/models') return Response.json({ mode: 'api-key', ready: true, generation: 'account-1', code: 'ready', models: [{ id: 'fixture-model', label: 'Fixture model' }] });
      const r = JSON.parse(String(init?.body));
      const events = [{ kind: 'start', requestId: r.requestId, conversationId: 'conversation-1', model: r.model }, { kind: 'tool', requestId: r.requestId, name: 'propose_point_move_to_nearest_label', context: { kind: 'toronto-point-move-proposal', status, ...(status === 'pending' ? { proposal: first } : {}) } }, success ? { kind: 'done', requestId: r.requestId, conversationId: 'conversation-1' } : { kind: 'error', requestId: r.requestId, code: 'provider-failed' }];
      return new Response(events.map(e => JSON.stringify(e) + '\n').join(''), { headers: { 'content-type': 'application/x-ndjson' } });
    }, 1000, 1000, { onauthorityproposal: kind => refreshed.push(kind) });
    client.bind({ mode: 'toronto', project: null, toronto: [{ name: 'Point 1', datasetId: 'toronto3d', artifactRevision, key: first.moves[0].key, position: first.moves[0].originalPosition, frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }] });
    await client.refreshModels(); await client.send('move point 1 to closest pole');
    assert.deepEqual(refreshed, status === 'pending' ? ['points'] : []); client.dispose();
  }
});
