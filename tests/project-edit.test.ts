import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { PROJECT_LIMITS, canonicalBoxProposalRequest, canonicalBoxApprovalRequest, canonicalProjectUndoRequest, type BoxProposal } from '@spatial/contracts';
import { ProjectSession, ProjectError } from '../apps/server/src/project-session';
import { createDemoServer } from '../apps/server/src/index';

const edit = { kind: 'update-box', entityId: 'proposal-box', center: [1, 2, 3], dimensions: [4, 5, 6] };
const approve = (s: ProjectSession, p: BoxProposal) => s.approve({ ...s.binding(), proposalId: p.proposalId, digest: p.digest, humanApproved: true });
const errorCode = (code: string) => (error: unknown) => error instanceof ProjectError && error.code === code;
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'spatial-project-edit-')); return { root, service: new ProjectSession(join(root, 'project.json')) }; };

test('strict parameter/approval schemas reject malformed, unsupported, unknown and implicit-unit edits', () => {
  const { root, service: s } = fixture();
  try {
    const request = { ...s.binding(), edit };
    for (const bad of [
      { ...request, units: 'mm' }, { ...request, frameId: 'toronto3d-local-v1' }, { ...request, expectedRevision: 0 },
      { ...request, edit: { ...edit, dimensions: [1, 0, 1] } }, { ...request, edit: { ...edit, center: [NaN, 0, 0] } },
      { ...request, edit: { ...edit, dimensions: [1, -1, 1] } }, { ...request, edit: { ...edit, center: [1000001, 0, 0] } },
      { ...request, edit: { ...edit, kind: 'channel' } }, { ...request, edit: { ...edit, extra: true } },
    ]) assert.throws(() => canonicalBoxProposalRequest(bad));
    const before = s.snapshot();
    assert.throws(() => s.propose({ ...request, edit: { ...edit, entityId: 'missing' } }), errorCode('unknown-entity'));
    assert.throws(() => s.propose({ ...request, edit: { ...edit, entityId: 'synthetic-cloud' } }), errorCode('unknown-entity'));
    assert.throws(() => s.propose({ ...request, edit: { ...edit, kind: 'create-box' } }), errorCode('unknown-entity'));
    assert.deepEqual(s.snapshot(), before);
    const p = s.propose(request), call = { ...s.binding(), proposalId: p.proposalId, digest: p.digest, humanApproved: true };
    assert.throws(() => canonicalBoxApprovalRequest({ ...call, humanApproved: false }));
    assert.throws(() => canonicalBoxApprovalRequest({ ...call, edit }));
    assert.throws(() => canonicalBoxApprovalRequest({ ...call, digest: 'forged' }));
    assert.throws(() => canonicalProjectUndoRequest({ ...s.binding(), transactionId: 'id', humanApproved: false }));
    assert.throws(() => s.approve({ ...call, digest: 'a'.repeat(64) }), errorCode('approval-mismatch'));
    assert.throws(() => s.approve({ ...call, proposalId: 'unknown' }), errorCode('unknown-proposal'));
    assert.deepEqual(s.snapshot(), before, 'all failures preserve geometry/revision/session');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('exact preview remains detached; approval publishes checked parameters once and preserves unrelated entities', () => {
  const { root, service: s } = fixture();
  try {
    const before = s.snapshot(), request = { ...s.binding(), edit: structuredClone(edit) };
    const p = s.propose(request); request.edit.center[0] = 999;
    assert.deepEqual(s.snapshot(), before); assert.equal(p.before?.id, 'proposal-box'); assert.deepEqual(p.after.center, [1, 2, 3]);
    assert.match(p.digest, /^[a-f0-9]{64}$/); assert.notEqual(p.proposalId, p.digest);
    assert.throws(() => { (p.after.center as unknown as number[])[0] = 100; });
    const alternative = s.propose({ ...s.binding(), edit: { ...edit, center: [0, 0, 0] } });
    assert.notEqual(p.digest, alternative.digest);
    const committed = approve(s, p); assert.equal(committed.snapshot.project.revision, before.project.revision + 1);
    assert.equal(committed.verification, 'parameter-postconditions-not-cad'); assert.equal(committed.persisted, false);
    assert.deepEqual(committed.snapshot.project.entities.find(e => e.id === edit.entityId), p.after);
    assert.deepEqual(committed.snapshot.project.entities.filter(e => e.id !== edit.entityId), before.project.entities.filter(e => e.id !== edit.entityId));
    assert.deepEqual(committed.snapshot.project.coordinates, before.project.coordinates); assert.equal(committed.snapshot.project.selectedEntityId, null);
    assert.throws(() => approve(s, alternative), errorCode('unknown-proposal'));
    assert.throws(() => s.approve({ ...p, humanApproved: true }), 'approval never accepts full edited preview');
    assert.throws(() => s.approve({ sessionId: p.sessionId, projectRevision: p.projectRevision, frameId: p.frameId, units: p.units, proposalId: p.proposalId, digest: p.digest, humanApproved: true }), errorCode('stale-project'));
    assert.deepEqual(s.snapshot(), committed.snapshot);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('create/update/undo form revision-checked transactions, not revision rollback; load invalidates same-revision proposals', () => {
  const { root, service: s } = fixture();
  try {
    const initial = s.snapshot(); s.save(s.binding());
    const stalePreview = s.propose({ ...s.binding(), edit }); s.load(s.binding());
    assert.equal(s.snapshot().project.revision, initial.project.revision);
    assert.throws(() => s.approve({ sessionId: stalePreview.sessionId, projectRevision: stalePreview.projectRevision, frameId: stalePreview.frameId, units: stalePreview.units, proposalId: stalePreview.proposalId, digest: stalePreview.digest, humanApproved: true }), errorCode('stale-project'));
    const created = approve(s, s.propose({ ...s.binding(), edit: { ...edit, kind: 'create-box', entityId: 'second-box' } }));
    assert.equal(created.snapshot.project.revision, 1); assert.ok(created.snapshot.project.entities.some(e => e.id === 'second-box'));
    const updated = approve(s, s.propose({ ...s.binding(), edit })); assert.equal(updated.snapshot.project.revision, 2);
    const undoCall = { ...s.binding(), transactionId: updated.transactionId, humanApproved: true };
    assert.throws(() => s.undo({ ...undoCall, transactionId: created.transactionId }), errorCode('nothing-to-undo'));
    assert.throws(() => s.undo({ ...undoCall, projectRevision: 1 }), errorCode('stale-project'));
    const undoneUpdate = s.undo(undoCall); assert.equal(undoneUpdate.snapshot.project.revision, 3);
    assert.deepEqual(undoneUpdate.snapshot.project.entities, created.snapshot.project.entities); assert.equal(undoneUpdate.nextUndoTransactionId, created.transactionId);
    assert.throws(() => s.undo(undoCall), errorCode('stale-project'));
    const undoneCreate = s.undo({ ...s.binding(), transactionId: created.transactionId, humanApproved: true });
    assert.equal(undoneCreate.snapshot.project.revision, 4); assert.deepEqual(undoneCreate.snapshot.project.entities, initial.project.entities); assert.equal(undoneCreate.nextUndoTransactionId, null);
    assert.throws(() => s.undo({ ...s.binding(), transactionId: undoneCreate.transactionId, humanApproved: true }), errorCode('nothing-to-undo'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('proposal/history storage and expiry are bounded without mutation on failure', () => {
  const { root, service: s } = fixture(), originalNow = Date.now;
  try {
    for (let i = 0; i < PROJECT_LIMITS.maxProposals; i++) s.propose({ ...s.binding(), edit });
    const before = s.snapshot(); assert.throws(() => s.propose({ ...s.binding(), edit }), errorCode('resource-limit')); assert.deepEqual(s.snapshot(), before);
    const time = originalNow(); Date.now = () => time + PROJECT_LIMITS.proposalLifetimeMs + 1;
    const p = s.propose({ ...s.binding(), edit }); Date.now = () => p.expiresAt + 1;
    assert.throws(() => approve(s, p), errorCode('expired-proposal')); assert.deepEqual(s.snapshot(), before);
    Date.now = originalNow;
    for (let i = 0; i < PROJECT_LIMITS.maxHistory; i++) approve(s, s.propose({ ...s.binding(), edit: { ...edit, center: [i, 0, 0] } }));
    const full = s.snapshot(); assert.throws(() => s.propose({ ...s.binding(), edit }), errorCode('resource-limit')); assert.deepEqual(s.snapshot(), full);
  } finally { Date.now = originalNow; rmSync(root, { recursive: true, force: true }); }
});

test('actual HTTP preview→human approval→live project→new-revision undo and persistence; old CAD binding rejected', async () => {
  const { root } = fixture(), server = createDemoServer({ projectPath: join(root, 'project.json') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const a = server.address(); assert.ok(a && typeof a !== 'string'); const base = `http://127.0.0.1:${a.port}`;
  const post = async (route: string, body: unknown) => { const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  try {
    const initial = (await (await fetch(base + '/project/session')).json()).result.snapshot;
    const b = { sessionId: initial.sessionId, projectRevision: initial.project.revision, frameId: initial.frameId, units: 'm' };
    const p = await post('/project/proposals', { ...b, edit }); assert.equal(p.status, 200); assert.equal(p.body.ok, true);
    assert.deepEqual(await (await fetch(base + '/project')).json(), initial.project);
    assert.equal((await post('/project/approve', { ...b, proposalId: p.body.result.proposalId, digest: 'a'.repeat(64), humanApproved: true })).status, 409);
    const committed = await post('/project/approve', { ...b, proposalId: p.body.result.proposalId, digest: p.body.result.digest, humanApproved: true }); assert.equal(committed.status, 200);
    assert.deepEqual(await (await fetch(base + '/project')).json(), committed.body.result.snapshot.project);
    assert.equal((await post('/project/approve', { ...b, proposalId: p.body.result.proposalId, digest: p.body.result.digest, humanApproved: true })).status, 409);
    assert.equal((await fetch(base + '/cad/capabilities')).status, 409);
    const source = { sessionId: b.sessionId, projectRevision: b.projectRevision, frameId: b.frameId };
    const cad = await post('/cad/execute', { ...source, operation: { kind: 'box', center: [0, 0, 0], dimensions: [1, 1, 1] } }); assert.equal(cad.status, 409); assert.equal(cad.body.error.code, 'stale-source');
    const current = { ...b, projectRevision: 1 };
    assert.equal((await post('/project/save', current)).status, 200);
    const undone = await post('/project/undo', { ...current, transactionId: committed.body.result.transactionId, humanApproved: true }); assert.equal(undone.status, 200); assert.equal(undone.body.result.snapshot.project.revision, 2);
    assert.deepEqual(undone.body.result.snapshot.project.entities, initial.project.entities);
    const loaded = await post('/project/load', { ...b, projectRevision: 2 }); assert.equal(loaded.status, 200); assert.equal(loaded.body.result.snapshot.project.revision, 1); assert.notEqual(loaded.body.result.snapshot.sessionId, b.sessionId);
    assert.equal((await post('/project/proposals', { ...current, edit })).status, 409);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});
