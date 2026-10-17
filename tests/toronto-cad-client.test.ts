import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ModelChatController } from '../apps/web/src/model-chat-client';
import { TorontoCadController, validateTorontoCadSnapshot, type TorontoCadView } from '../apps/web/src/toronto-cad-client';
import { createTorontoCadRender } from '../apps/web/src/toronto-cad-render';
import { PointOverrideController, validatePendingMoves, type PointEditView } from '../apps/web/src/point-override-client';
const revision = 'a'.repeat(64);
const binding = { sessionId: 'session-1', revision: 0, artifactRevision: revision, datasetId: 'toronto3d', frameId: 'toronto3d-local-v1', units: 'm' };
const operation = { kind: 'box' as const, center: [1, 1, 1] as const, dimensions: [2, 2, 2] as const };
const body = { bodyId: 'body-1', operation, validation: { body: { bodyId: 'body-1', bodyRevision: 1 }, source: { sessionId: binding.sessionId, projectRevision: 0, frameId: binding.frameId }, units: 'm', complexity: 1, valid: true, volume: 8, bounds: { min: [0,0,0], max: [2,2,2] }, topology: { solids: 1, faces: 6, edges: 12, vertices: 8 }, kernel: { name: 'OpenCascade', package: 'replicad-opencascadejs', version: '1.1.0', validation: 'BRepCheck_Analyzer' } }, mesh: { body: { bodyId: 'body-1', bodyRevision: 1 }, units: 'm', vertices: [0,0,0,2,0,0,0,2,0], normals: [0,0,1,0,0,1,0,0,1], triangles: [0,1,2] } };
const proposal = { ...body, ...binding, proposalId: 'proposal-1' };
const snapshot = () => ({ ...binding, bodies: [], proposals: [], nextUndoTransactionId: null });

test('Toronto CAD snapshots reject wrong artifact, frame, body and nonfinite/index-invalid mesh', () => {
  const s = { ...snapshot(), proposals: [proposal] }; assert.equal(validateTorontoCadSnapshot(s, revision).proposals.length, 1);
  for (const change of [ (x: any) => x.artifactRevision = 'b'.repeat(64), (x: any) => x.frameId = 'demo', (x: any) => x.proposals[0].mesh.body.bodyId = 'other', (x: any) => x.proposals[0].mesh.vertices[0] = NaN, (x: any) => x.proposals[0].mesh.triangles[0] = 99, (x: any) => x.proposals[0].revision = 1 ]) { const bad = structuredClone(s); change(bad); assert.throws(() => validateTorontoCadSnapshot(bad, revision)); }
});
test('Toronto native candidate publication is exact; decline and latest-first Undo do not regenerate solids', async () => {
  let server: any = snapshot(); const states: TorontoCadView[] = [], calls: string[] = [];
  const c = new TorontoCadController(v => states.push(v), async (action, raw) => {
    calls.push(action); const req = raw as any;
    if (action === 'refresh') return server;
    assert.equal(req.artifactRevision, revision); assert.equal(req.sessionId, binding.sessionId);
    if (action === 'propose') { server = { ...server, proposals: [proposal] }; return proposal; }
    if (action === 'decline') { server = { ...server, proposals: [] }; return server; }
    if (action === 'approve') server = { ...server, revision: 1, proposals: [], bodies: [body], nextUndoTransactionId: 'undo-1' };
    if (action === 'undo') server = { ...server, revision: 2, bodies: [], nextUndoTransactionId: null };
    return server;
  }); c.bind(revision); await c.refresh(); await c.propose(operation); assert.equal(states.at(-1)?.snapshot?.bodies.length, 0); await c.decline(proposal.proposalId); assert.equal(states.at(-1)?.snapshot?.proposals.length, 0); await c.propose(operation); await c.approve(proposal.proposalId); assert.equal(states.at(-1)?.snapshot?.bodies.length, 1); assert.equal(states.at(-1)?.needsRefresh, false); await c.undo(); assert.equal(states.at(-1)?.snapshot?.bodies.length, 0); assert.deepEqual(calls, ['refresh','propose','decline','propose','approve','undo']); c.dispose();
});
test('Toronto ambiguous writes require explicit Refresh and malformed publication cannot become scene state', async () => {
  let calls = 0, fail = true; const states: TorontoCadView[] = [];
  const c = new TorontoCadController(v => states.push(v), async action => { calls++; if (action === 'refresh') return { ...snapshot(), proposals: [proposal] }; if (fail) throw new Error('connection lost after write'); return { ...snapshot(), revision: 1, bodies: [{ ...body, operation: { ...operation, dimensions: [9,9,9] } }] }; });
  c.bind(revision); await c.refresh(); await c.approve(proposal.proposalId); assert.equal(states.at(-1)?.needsRefresh, true); assert.equal(states.at(-1)?.snapshot, undefined); const n = calls; await c.propose(operation); assert.equal(calls, n); await c.refresh(); fail = false; await c.approve(proposal.proposalId); assert.equal(states.at(-1)?.needsRefresh, true); c.dispose();
});
test('Toronto source switching/disposal aborts and suppresses late responses', async () => {
  let resolve!: (v: unknown) => void, signal!: AbortSignal; const states: TorontoCadView[] = [];
  const c = new TorontoCadController(v => states.push(v), async (_a, _b, s) => { signal = s; return new Promise(r => resolve = r); }); c.bind(revision); const pending = c.refresh(); c.bind('b'.repeat(64)); assert.equal(signal.aborted, true); resolve(snapshot()); await pending; assert.equal(states.at(-1)?.snapshot, undefined); c.dispose();
});
test('CAD renderer uses supplied native triangles and distinguishes ghosts/commits; disposal frees caches', () => {
  const scene = new THREE.Scene(), render = createTorontoCadRender(scene); render.set(validateTorontoCadSnapshot({ ...snapshot(), proposals: [proposal] }, revision));
  const ghost = render.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; assert.deepEqual(Array.from(ghost.geometry.getAttribute('position').array), body.mesh.vertices); assert.deepEqual(Array.from(ghost.geometry.getIndex()!.array), body.mesh.triangles); assert.equal(ghost.material.transparent, true); assert.equal(ghost.material.depthWrite, false); assert.equal(render.captureBlocked, true);
  let freed = false; ghost.geometry.addEventListener('dispose', () => freed = true); render.set(validateTorontoCadSnapshot({ ...snapshot(), bodies: [body] }, revision)); assert.equal(freed, true); assert.equal((render.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.transparent, false); render.dispose(); assert.equal(scene.children.length, 0);
});
test('model CAD event refreshes retained authority after terminal success or later model error, never admits tool meshes', async () => {
  for (const success of [true, false]) {
    const refreshed: string[] = [];
    const client = new ModelChatController(() => {}, async (path, init) => {
      if (path === '/chat/models') return Response.json({ mode: 'api-key', ready: true, generation: 'account-1', code: 'ready', models: [{ id: 'fixture-model', label: 'Fixture model' }] });
      const r = JSON.parse(String(init?.body));
      const events = [{ kind:'start', requestId:r.requestId, conversationId:'conversation-1', model:r.model }, { kind:'tool', requestId:r.requestId, name:'propose_cad_box', context:{kind:'toronto-cad-proposal',status:'pending',proposal:{proposalId:'metadata-only'}} }, success ? {kind:'done',requestId:r.requestId,conversationId:'conversation-1'} : {kind:'error',requestId:r.requestId,code:'provider-failed'}];
      return new Response(events.map(e=>JSON.stringify(e)+'\n').join(''), { headers:{'content-type':'application/x-ndjson'} });
    }, 1000, 1000, { onauthorityproposal: kind => refreshed.push(kind) });
    client.bind({mode:'toronto',project:null,toronto:[]}); await client.refreshModels(); await client.send('propose box'); assert.deepEqual(refreshed, ['cad']); client.dispose();
  }
});
const pointSnapshot = () => ({ ...binding, entries: [], nextUndoTransactionId: null });
const move = { ...binding, proposalId: 'point-proposal', moves: [{ key: { sourceFileId: 1, sourceRow: 0 }, originalPosition: [1,0,0], before: [1,0,0], after: [1,0,1] }] };
test('retained source moves preserve exact binary64 after values instead of reconstructing a translation operand', () => {
  const p = { ...move, moves: [ { key:{sourceFileId:1,sourceRow:0}, originalPosition:[1000,0,0], before:[1000,0,0], after:[1000.1,0,0] }, { key:{sourceFileId:1,sourceRow:1}, originalPosition:[.1,0,0], before:[.1,0,0], after:[.2,0,0] } ] };
  assert.deepEqual(validatePendingMoves([p], pointSnapshot() as any, [])[0]?.moves, p.moves);
});
test('point authority discovers retained AI proposals, validates binding and explicitly declines without mutation', async () => {
  const states: PointEditView[] = [], calls: string[] = [];
  const c = new PointOverrideController(v => states.push(v), async action => { calls.push(action); return action === 'pending' ? [move] : pointSnapshot(); }, true); c.bind([], revision); await c.refresh(); assert.equal(states.at(-1)?.proposal?.proposalId, move.proposalId); await c.decline(); assert.equal(states.at(-1)?.proposal, undefined); assert.equal(states.at(-1)?.snapshot?.revision, 0); assert.deepEqual(calls, ['refresh','pending','decline']); assert.throws(() => validatePendingMoves([{ ...move, revision: 1 }], pointSnapshot() as any, [])); c.dispose();
});
