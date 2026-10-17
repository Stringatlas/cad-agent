import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { ProjectSession, ProjectError } from '../apps/server/src/project-session';
import { createDemoServer } from '../apps/server/src/index';

const code = (expected: string) => (error: unknown) => error instanceof ProjectError && error.code === expected;
const create = (session: ProjectSession, entityId: string) => session.propose({ ...session.binding(), edit: { kind: 'create-box', entityId, center: [2, 3, 4], dimensions: [1, 2, 3] } });

test('decline binds exact digest and live session; removes only the selected proposal without geometry/history changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spatial-decline-'));
  try {
    const session = new ProjectSession(join(root, 'project.json'));
    const first = create(session, 'first-box'), second = create(session, 'second-box');
    const before = session.info(), binding = session.binding();
    const call = { ...binding, proposalId: first.proposalId, digest: first.digest };
    assert.throws(() => session.decline({ ...call, digest: first.digest === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64) }), code('approval-mismatch'));
    for (const stale of [{ sessionId: 'stale-session' }, { projectRevision: 1 }]) {
      assert.throws(() => session.decline({ ...call, ...stale }), code('stale-project'));
    }
    assert.throws(() => session.decline({ ...call, proposalId: 'unknown-proposal' }), code('unknown-proposal'));
    assert.deepEqual(session.info(), before, 'failed declines preserve geometry, binding and history');
    assert.deepEqual(session.decline(call), { proposalId: first.proposalId, declined: true });
    assert.deepEqual(session.info(), before, 'successful decline does not publish a revision or undo transaction');
    assert.throws(() => session.decline(call), code('unknown-proposal'));
    assert.throws(() => session.approve({ ...call, humanApproved: true }), code('unknown-proposal'));
    const committed = session.approve({ ...binding, proposalId: second.proposalId, digest: second.digest, humanApproved: true });
    assert.equal(committed.snapshot.project.revision, binding.projectRevision + 1);
    assert.deepEqual(committed.snapshot.project.entities.find(e => e.id === 'second-box'), second.after);
    assert.equal(committed.snapshot.project.entities.some(e => e.id === 'first-box'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('HTTP decline enforces strict binding/digest, preserves peers, and makes later approval impossible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spatial-decline-http-'));
  const server = createDemoServer({ projectPath: join(root, 'project.json') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const info = async () => (await (await fetch(base + '/project/session')).json()).result;
  const failure = async (body: unknown, expected: string) => { const response = await post('/project/decline', body); assert.equal(response.ok, false); assert.equal((await response.json()).error.code, expected); };
  try {
    const before = await info(), snapshot = before.snapshot;
    const binding = { sessionId: snapshot.sessionId, projectRevision: snapshot.project.revision, frameId: snapshot.frameId, units: 'm' };
    const propose = async (entityId: string) => { const response = await post('/project/proposals', { ...binding, edit: { kind: 'create-box', entityId, center: [2, 3, 4], dimensions: [1, 2, 3] } }); assert.equal(response.status, 200); return (await response.json()).result; };
    const first = await propose('first-box'), second = await propose('second-box');
    const call = { ...binding, proposalId: first.proposalId, digest: first.digest };
    await failure({ ...call, digest: '0'.repeat(64) }, 'approval-mismatch');
    await failure({ ...call, projectRevision: 1 }, 'stale-project');
    await failure({ ...call, proposalId: 'unknown' }, 'unknown-proposal');
    await failure({ ...call, humanApproved: true }, 'invalid-request');
    assert.deepEqual(await info(), before);
    const declined = await post('/project/decline', call); assert.equal(declined.status, 200);
    assert.deepEqual((await declined.json()).result, { proposalId: first.proposalId, declined: true });
    assert.deepEqual(await info(), before);
    const rejected = await post('/project/approve', { ...call, humanApproved: true });
    assert.equal(rejected.ok, false); assert.equal((await rejected.json()).error.code, 'unknown-proposal');
    const approved = await post('/project/approve', { ...binding, proposalId: second.proposalId, digest: second.digest, humanApproved: true });
    assert.equal(approved.status, 200);
    const after = (await approved.json()).result.snapshot.project;
    assert.equal(after.revision, 1); assert.deepEqual(after.entities.find((e: { id: string }) => e.id === 'second-box'), second.after);
    assert.equal(after.entities.some((e: { id: string }) => e.id === 'first-box'), false);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
