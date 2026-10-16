import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PROJECT_LIMITS, type BoxEdit } from '@spatial/contracts';
import { ProjectSession } from '../apps/server/src/project-session';
import { ProjectController, ProjectRejection, projectBinding, projectTransport, validateSession, validateProposal,
  validateCommit, validateContext, type ProjectTransport, type ProjectView } from '../apps/web/src/project-client';

const edit: BoxEdit = { kind: 'update-box', entityId: 'proposal-box', center: [1, 2, 3], dimensions: [4, 5, 6] };
function fixture(wrap?: (transport: ProjectTransport) => ProjectTransport) {
  const root = mkdtempSync(join(tmpdir(), 'spatial-project-client-')), authority = new ProjectSession(join(root, 'project.json'));
  const transport: ProjectTransport = async (path, body) => {
    switch (path) {
      case '/project/session': return structuredClone(authority.info());
      case '/project/context': return authority.context(body);
      case '/project/proposals': return authority.propose(body);
      case '/project/approve': return authority.approve(body);
      case '/project/undo': return authority.undo(body);
      case '/project/save': return authority.save(body);
      case '/project/load': return authority.load(body);
      default: throw new Error('Unexpected endpoint');
    }
  };
  const states: ProjectView[] = [], client = new ProjectController(s => states.push(s), wrap ? wrap(transport) : transport);
  return { authority, client, states, transport, dispose() { client.dispose(); rmSync(root, { force: true, recursive: true }); } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; }

test('scene A/B/entity context is original bound provenance and never a geometry mutation', async () => {
  const f = fixture(); try {
    await f.client.refresh(); const original = f.authority.snapshot(), cloud = original.project.entities.find(e => e.kind === 'point-cloud')!;
    assert.equal(cloud.kind, 'point-cloud'); if (cloud.kind !== 'point-cloud') throw new Error('fixture');
    f.client.select('proposal-box');
    f.client.pin({ name: 'A', entityId: cloud.id, pointIndex: 17, position: cloud.points[17]! });
    f.client.pin({ name: 'B', entityId: cloud.id, pointIndex: 42, position: cloud.points[42]! });
    f.client.pin({ name: 'A', entityId: cloud.id, pointIndex: 0, position: [99, 99, 99] });
    await f.client.context(); assert.equal(f.client.view.context!.points[0]!.pointIndex, 17);
    assert.deepEqual(f.client.view.context!.entityIds, ['proposal-box']); assert.deepEqual(f.authority.snapshot(), original);
    f.client.select(null); assert.equal(f.client.view.context, undefined);
  } finally { f.dispose(); }
});

test('preview is immutable exact digest; deliberate approve/undo advance revision, save/load rotate session', async () => {
  const f = fixture(); try {
    await f.client.refresh(); const start = f.authority.snapshot();
    await f.client.propose(edit); const preview = f.client.view.proposal!;
    assert.deepEqual(f.authority.snapshot(), start); assert.equal(preview.edit.center[0], 1); assert.ok(Object.isFrozen(preview));
    await f.client.approve(); assert.equal(f.client.view.snapshot!.project.revision, 1); assert.equal(f.client.view.session!.dirty, true);
    assert.equal(f.client.view.proposal, undefined); assert.equal(f.client.view.points.length, 0); assert.equal(f.client.view.undoAvailable, true);
    await f.client.refresh(); assert.equal(f.client.view.undoAvailable, true, 'refresh retains exact inverse receipt within same session');
    await f.client.undo(); assert.equal(f.client.view.snapshot!.project.revision, 2);
    assert.deepEqual(f.client.view.snapshot!.project.entities, start.project.entities); assert.equal(f.client.view.undoAvailable, false);
    await f.client.save(); assert.equal(f.client.view.session!.dirty, false);
    const saved = f.client.view.snapshot!; await f.client.propose(edit); await f.client.approve();
    const stale = f.client.view.snapshot!; await f.client.load();
    assert.notEqual(f.client.view.snapshot!.sessionId, stale.sessionId); assert.equal(f.client.view.snapshot!.project.revision, saved.project.revision);
    assert.equal(f.client.view.session!.nextUndoTransactionId, null); assert.equal(f.client.view.undoAvailable, false);
  } finally { f.dispose(); }
});

test('overlapping same-session Refresh retains the exact inverse and suppresses the superseded read', async () => {
  const gate = deferred<unknown>(), received = deferred<void>(); let hold = false;
  const f = fixture(transport => async (path, body, signal) => {
    const result = await transport(path, body, signal);
    if (path === '/project/session' && hold) { hold = false; received.resolve(); return gate.promise; }
    return result;
  });
  try {
    await f.client.refresh(); const original = f.authority.snapshot();
    await f.client.propose(edit); await f.client.approve();
    const committed = f.authority.info(); assert.equal(f.client.view.undoAvailable, true);
    hold = true; const first = f.client.refresh(); await received.promise;
    assert.equal(f.client.view.snapshot, undefined);
    await f.client.refresh(); assert.equal(f.client.view.undoAvailable, true);
    assert.equal(f.client.view.session!.nextUndoTransactionId, committed.nextUndoTransactionId);
    const count = f.states.length; gate.resolve({ malformed: true }); await first;
    assert.equal(f.states.length, count, 'noncooperative superseded read cannot publish or clear receipts');
    await f.client.undo(); assert.equal(f.client.view.snapshot!.project.revision, 2);
    assert.deepEqual(f.client.view.snapshot!.project.entities, original.project.entities);
  } finally { f.dispose(); }
});

test('failed Refresh followed by same-session recovery retains the exact inverse receipt', async () => {
  for (const failure of ['network', 'invalid-session']) {
    let fail = false;
    const f = fixture(transport => async (path, body, signal) => {
      if (path === '/project/session' && fail) {
        fail = false;
        if (failure === 'network') throw new Error('Connection lost');
        return { malformed: true };
      }
      return transport(path, body, signal);
    });
    try {
      await f.client.refresh(); const original = f.authority.snapshot();
      await f.client.propose(edit); await f.client.approve(); const committed = f.authority.info();
      fail = true; await f.client.refresh(); assert.equal(f.client.view.snapshot, undefined);
      assert.match(f.client.view.status, /Server unavailable/);
      await f.client.refresh(); assert.equal(f.client.view.undoAvailable, true);
      assert.equal(f.client.view.session!.nextUndoTransactionId, committed.nextUndoTransactionId);
      await f.client.undo(); assert.equal(f.client.view.snapshot!.project.revision, 2);
      assert.deepEqual(f.client.view.snapshot!.project.entities, original.project.entities);
    } finally { f.dispose(); }
  }
});

test('only a confirmed different session discards receipts, even if a transaction token is reused', async () => {
  let reusedId: string | null = null;
  const f = fixture(transport => async (path, body, signal) => {
    const result = await transport(path, body, signal);
    return path === '/project/session' && reusedId ? { ...(result as object), nextUndoTransactionId: reusedId } : result;
  });
  try {
    await f.client.refresh(); await f.client.propose(edit); await f.client.approve();
    reusedId = f.client.view.session!.nextUndoTransactionId; assert.ok(reusedId);
    const previousSession = f.client.view.snapshot!.sessionId;
    f.authority.save(f.authority.binding()); f.authority.load(f.authority.binding());
    await f.client.refresh(); assert.notEqual(f.client.view.snapshot!.sessionId, previousSession);
    assert.equal(f.client.view.undoAvailable, false, 'old exact inverse cannot authorize a new session token');
    await f.client.refresh(); assert.equal(f.client.view.undoAvailable, false);
  } finally { f.dispose(); }
});

test('returned proposal binding, parameters, digest, before/after and unrelated mutation are strictly rejected', async () => {
  const f = fixture(); try {
    const snapshot = f.authority.snapshot(), request = { ...projectBinding(snapshot), edit }, proposal = f.authority.propose(request);
    for (const patch of [{ sessionId: 'wrong' }, { projectRevision: 9 }, { after: { ...proposal.after, center: [9, 9, 9] } }, { before: null },
      { digest: '0'.repeat(64) }, { extra: true }, { edit: { ...edit, dimensions: [1, 1, 1] } }])
      await assert.rejects(validateProposal({ ...proposal, ...patch }, request, snapshot));
    const result = f.authority.approve({ ...projectBinding(snapshot), proposalId: proposal.proposalId, digest: proposal.digest, humanApproved: true });
    const expected = result.snapshot.project;
    for (const bad of [{ ...result, operation: 'create-box' }, { ...result, persisted: true }, { ...result, snapshot: { ...result.snapshot, sessionId: 'other' } },
      { ...result, snapshot: { ...result.snapshot, project: { ...expected, entities: expected.entities.filter(e => e.kind !== 'point-cloud') } } }])
      assert.throws(() => validateCommit(bad, snapshot, expected, 'update-box'));
    const contextRequest = { ...projectBinding(result.snapshot), entityIds: ['proposal-box'], points: [] }, context = f.authority.context(contextRequest);
    assert.throws(() => validateContext({ ...context, frameId: 'toronto3d-local-v1' }, contextRequest, result.snapshot));
    assert.throws(() => validateContext({ ...context, entities: [] }, contextRequest, result.snapshot));
    assert.throws(() => validateSession({ ...f.authority.info(), limits: { ...PROJECT_LIMITS, maxPoints: 100000 } }));
  } finally { f.dispose(); }
});

test('cancelled and malformed late read replies never publish; parameter change invalidates pending preview', async () => {
  const gate = deferred<unknown>(); let received = deferred<void>();
  const f = fixture(transport => async (path, body, signal) => {
    if (path === '/project/proposals') { received.resolve(); return gate.promise; }
    return transport(path, body, signal);
  });
  try {
    await f.client.refresh(); const run = f.client.propose(edit); await received.promise;
    f.client.clearProposal(); const count = f.states.length;
    gate.resolve({ malformed: true }); await run;
    assert.equal(f.states.length, count); assert.equal(f.client.view.proposal, undefined); assert.equal(f.client.view.needsRefresh, false);
  } finally { f.dispose(); }
});

test('old proposal after refresh is suppressed and load rotates session even when transport ignores AbortSignal', async () => {
  const gate = deferred<unknown>(), received = deferred<void>(); let delayed: unknown;
  const f = fixture(transport => async (path, body, signal) => {
    const result = await transport(path, body, signal);
    if (path === '/project/proposals') { delayed = result; received.resolve(); return gate.promise; }
    return result;
  });
  try {
    await f.client.refresh(); const run = f.client.propose(edit); await received.promise;
    await f.client.refresh(); const count = f.states.length; gate.resolve(delayed); await run;
    assert.equal(f.states.length, count); assert.equal(f.client.view.proposal, undefined);
    await f.client.save(); const prior = f.client.view.snapshot!.sessionId; await f.client.load();
    assert.notEqual(f.client.view.snapshot!.sessionId, prior); assert.equal(f.client.view.context, undefined);
  } finally { f.dispose(); }
});

test('late context/load replies cannot overwrite a refreshed rotated session', async () => {
  for (const endpoint of ['/project/context', '/project/load']) {
    const gate = deferred<unknown>(), received = deferred<void>(); let delayed: unknown;
    const f = fixture(transport => async (path, body, signal) => {
      const result = await transport(path, body, signal);
      if (path === endpoint) { delayed = result; received.resolve(); return gate.promise; }
      return result;
    });
    try {
      await f.client.refresh(); await f.client.save(); const start = f.client.view.snapshot!;
      const pending = endpoint === '/project/context' ? f.client.context() : f.client.load(); await received.promise;
      f.client.cancel();
      // Authoritative load happens outside the pending client request for the context case.
      if (endpoint === '/project/context') f.authority.load(f.authority.binding());
      await f.client.refresh(); const rotated = f.client.view.snapshot!; assert.notEqual(rotated.sessionId, start.sessionId);
      const count = f.states.length; gate.resolve(delayed); await pending;
      assert.equal(f.states.length, count); assert.equal(f.client.view.snapshot!.sessionId, rotated.sessionId);
      assert.equal(f.client.view.context, undefined); assert.equal(f.client.view.needsRefresh, false);
    } finally { f.dispose(); }
  }
});

test('ambiguous approval cancellation blocks mutation retries until explicit authority refresh', async () => {
  const gate = deferred<unknown>(), received = deferred<void>(); let committed: unknown, calls = 0;
  const f = fixture(transport => async (path, body, signal) => {
    if (path === '/project/approve') { calls++; committed = await transport(path, body, signal); received.resolve(); return gate.promise; }
    return transport(path, body, signal);
  });
  try {
    await f.client.refresh(); await f.client.propose(edit); const pending = f.client.approve(); await received.promise;
    f.client.cancel(); assert.equal(f.client.view.needsRefresh, true); assert.equal(f.client.view.snapshot!.project.revision, 0);
    await f.client.propose(edit); await f.client.save(); assert.equal(calls, 1); const count = f.states.length;
    gate.resolve(committed); await pending; assert.equal(f.states.length, count);
    await f.client.refresh(); assert.equal(f.client.view.snapshot!.project.revision, 1); assert.equal(f.client.view.needsRefresh, false);
    assert.equal(f.client.view.undoAvailable, false, 'unreceived exact mutation receipt cannot safely validate undo');
  } finally { f.dispose(); }
});

test('malformed mutation response never adopts unrelated forged changes and requires explicit refresh', async () => {
  const f = fixture(transport => async (path, body, signal) => {
    const result = await transport(path, body, signal);
    if (path !== '/project/approve') return result;
    const reply = structuredClone(result) as any; reply.snapshot.project.entities[0].points[0][0] += 17; return reply;
  });
  try {
    await f.client.refresh(); await f.client.propose(edit); await f.client.approve();
    assert.equal(f.client.view.snapshot!.project.revision, 0); assert.equal(f.client.view.needsRefresh, true);
    await f.client.refresh(); assert.equal(f.client.view.snapshot!.project.revision, 1);
  } finally { f.dispose(); }
});

test('known rejection is explicit and does not mark uncertain commit; stale rejection requires refresh', async () => {
  let code = 'unknown-proposal'; const f = fixture(transport => async (path, body, signal) => {
    if (path === '/project/approve') throw new ProjectRejection(code, 'explicit rejection'); return transport(path, body, signal);
  });
  try {
    await f.client.refresh(); await f.client.propose(edit); await f.client.approve(); assert.equal(f.client.view.needsRefresh, false);
    assert.match(f.client.view.status, /unknown-proposal/); code = 'stale-project'; await f.client.propose(edit); await f.client.approve(); assert.equal(f.client.view.needsRefresh, true);
  } finally { f.dispose(); }
});

test('bounded reader rejects oversized/malformed envelopes and respects abort during body read', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(' '.repeat(PROJECT_LIMITS.snapshotBytes + 16385));
    await assert.rejects(projectTransport('/project/session', undefined, new AbortController().signal));
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: {}, extra: 1 }));
    await assert.rejects(projectTransport('/project/session', undefined, new AbortController().signal));
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: { code: 'stale-project', message: 'stale' } }), { status: 409 });
    await assert.rejects(projectTransport('/project/approve', {}, new AbortController().signal), e => e instanceof ProjectRejection);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(projectTransport('/project/session', undefined, controller.signal));
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    const streaming = new AbortController(), reading = projectTransport('/project/session', undefined, streaming.signal);
    await new Promise(resolve => setTimeout(resolve, 0)); streaming.abort();
    await assert.rejects(reading); assert.equal(cancelled, true, 'abort interrupts a pending reader.read, not only future iterations');
  } finally { globalThis.fetch = original; }
});
