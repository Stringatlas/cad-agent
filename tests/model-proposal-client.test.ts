import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalProtocolJson, type BoxEdit, type ModelCatalog, type ModelTurnRequest, type VisualObservation } from '@spatial/contracts';
import { ProjectSession } from '../apps/server/src/project-session';
import { ProjectController, projectBinding, type ProjectTransport } from '../apps/web/src/project-client';
import { ModelChatController, modelScene, validateModelEvent } from '../apps/web/src/model-chat-client';

const edit: BoxEdit = { kind: 'update-box', entityId: 'proposal-box', center: [1, 2, 3], dimensions: [4, 5, 6] };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'spatial-model-proposals-'));
  const authority = new ProjectSession(join(root, 'project.json')), calls: { path: string; body: unknown }[] = [];
  const transport: ProjectTransport = async (path, body) => {
    calls.push({ path, body });
    if (path === '/project/session') return structuredClone(authority.info());
    if (path === '/project/approve') return authority.approve(body);
    if (path === '/project/undo') return authority.undo(body);
    // The parent implements the route/retention deletion; this test checks the client receipt/request boundary.
    if (path === '/project/decline') return { proposalId: (body as { proposalId: string }).proposalId, declined: true };
    throw new Error('Unexpected route');
  };
  const client = new ProjectController(() => {}, transport);
  return { authority, client, calls,
    proposal(change: BoxEdit = edit) { return authority.propose({ ...projectBinding(authority.snapshot()), edit: change }); },
    dispose() { client.dispose(); rmSync(root, { recursive: true, force: true }); } };
}
async function signed<T extends Record<string, unknown>>(value: T) {
  const { digest: _digest, ...exact } = value;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalProtocolJson(exact)));
  return { ...exact, digest: Buffer.from(digest).toString('hex') };
}
async function ready(f: ReturnType<typeof fixture>) { await f.client.refresh(); f.client.setModelProposalScope(true); }

test('multiple model ghosts retain exact candidates; accept one invalidates all others, then checked Undo works', async () => {
  const f = fixture(); try {
    await ready(f); const before = f.authority.snapshot(), first = f.proposal(), second = f.proposal({ ...edit, center: [7, 8, 9] });
    assert.equal(await f.client.admitModelProposal(first), true);
    assert.equal(await f.client.admitModelProposal(second), true);
    assert.equal(await f.client.admitModelProposal(first), true);
    assert.equal(f.client.view.modelProposals!.length, 2);
    assert.ok(Object.isFrozen(f.client.view.modelProposals![0]!.after.center));
    assert.deepEqual(f.authority.snapshot(), before);
    f.client.setModelStreaming(true); await f.client.decline(first.proposalId);
    assert.equal(f.calls.filter(c => c.path === '/project/decline').length, 1);
    assert.deepEqual(f.authority.snapshot(), before);
    await f.client.approve(second.proposalId);
    f.client.setModelStreaming(false);
    assert.deepEqual(f.authority.snapshot().project.entities.find(e => e.id === edit.entityId), second.after);
    assert.equal(f.client.view.modelProposals!.length, 0); assert.equal(f.client.view.undoAvailable, true);
    await f.client.approve(first.proposalId); assert.equal(f.authority.snapshot().project.revision, before.project.revision + 1);
    await f.client.undo(); assert.deepEqual(f.authority.snapshot().project.entities, before.project.entities);
  } finally { f.dispose(); }
});

test('create-box model candidates preserve unrelated entities and publish only after exact approval', async () => {
  const f = fixture(); try {
    await ready(f); const before = f.authority.snapshot();
    const proposal = f.proposal({ ...edit, kind: 'create-box', entityId: 'model-created-box' });
    assert.equal(await f.client.admitModelProposal(proposal), true);
    assert.deepEqual(f.authority.snapshot(), before); assert.equal(proposal.before, null);
    await f.client.approve(proposal.proposalId);
    assert.deepEqual(f.authority.snapshot().project.entities, [...before.project.entities, proposal.after]);
    await f.client.undo(); assert.deepEqual(f.authority.snapshot().project.entities, before.project.entities);
  } finally { f.dispose(); }
});

test('decline posts exact binding/hash without approval and preserves sibling proposals/revision', async () => {
  const f = fixture(); try {
    await ready(f); const first = f.proposal(), second = f.proposal({ ...edit, center: [7, 8, 9] });
    await f.client.admitModelProposal(first); await f.client.admitModelProposal(second);
    const before = f.authority.snapshot(); await f.client.decline(first.proposalId);
    assert.deepEqual(f.calls.at(-1), { path: '/project/decline', body: { ...projectBinding(before), proposalId: first.proposalId, digest: first.digest } });
    assert.deepEqual(f.client.view.modelProposals, [second]); assert.deepEqual(f.authority.snapshot(), before);
  } finally { f.dispose(); }
});

test('admission rejects forged hashes, candidate/binding/coordinate/expiry mismatches even if rehashed', async () => {
  const f = fixture(); try {
    await ready(f); const proposal = f.proposal(), before = f.authority.snapshot();
    const bad = [ { ...proposal, digest: '0'.repeat(64) }, { ...proposal, extra: true },
      await signed({ ...proposal, projectRevision: proposal.projectRevision + 1 }), await signed({ ...proposal, sessionId: 'wrong-session' }),
      await signed({ ...proposal, frameId: 'wrong-frame' }), await signed({ ...proposal, units: 'mm' }),
      await signed({ ...proposal, after: { ...proposal.after, center: [90, 90, 90] } }),
      await signed({ ...proposal, before: null }), await signed({ ...proposal, expiresAt: Date.now() - 1 }),
      await signed({ ...proposal, coordinates: { ...proposal.coordinates, localOrigin: [0, 0, 0] } }),
      await signed({ ...proposal, verification: 'CAD' }) ];
    for (const value of bad) assert.equal(await f.client.admitModelProposal(value), false);
    assert.equal(f.client.view.modelProposals?.length ?? 0, 0); assert.deepEqual(f.authority.snapshot(), before);
  } finally { f.dispose(); }
});

test('hash-await admission gates suppress late scene/account/refresh/disposal replies and mutation overlap', async () => {
  for (const invalidate of ['source', 'account', 'refresh', 'dispose', 'turn'] as const) {
    const f = fixture(); try {
      await ready(f); const proposal = f.proposal(); let current = true;
      const pending = f.client.admitModelProposal(proposal, () => current);
      if (invalidate === 'source') { f.client.setModelProposalScope(false); f.client.setModelProposalScope(true); }
      if (invalidate === 'account') f.client.clearModelProposals();
      if (invalidate === 'refresh') await f.client.refresh();
      if (invalidate === 'dispose') f.client.dispose();
      if (invalidate === 'turn') current = false;
      assert.equal(await pending, false); assert.equal(f.client.view.modelProposals?.length ?? 0, 0);
    } finally { f.dispose(); }
  }
  const f = fixture(); try {
    await ready(f); const proposal = f.proposal(); await f.client.admitModelProposal(proposal);
    const mutation = f.client.approve(proposal.proposalId);
    assert.equal(await f.client.admitModelProposal(f.proposal()), false); await mutation;
    assert.equal(f.client.view.modelProposals!.length, 0);
  } finally { f.dispose(); }
});

test('model proposals are disabled outside synthetic scope; expiry removes ghosts without mutation', async () => {
  const f = fixture(); try {
    await f.client.refresh(); const proposal = f.proposal();
    assert.equal(await f.client.admitModelProposal(proposal), false);
    f.client.setModelProposalScope(true);
    const short = await signed({ ...proposal, expiresAt: Date.now() + 5000 });
    assert.equal(await f.client.admitModelProposal(short), true);
    const now = Date.now; Date.now = () => (short.expiresAt as number) + 1;
    try { f.client.expireModelProposals(); } finally { Date.now = now; }
    assert.equal(f.client.view.modelProposals!.length, 0); assert.equal(f.authority.snapshot().project.revision, proposal.projectRevision);
  } finally { f.dispose(); }
});

test('model tool callback admits ghosts during streaming, retains contexts, and account invalidation clears them', async () => {
  const f = fixture(); let chat: ModelChatController | undefined;
  try {
    await ready(f); const proposal = f.proposal();
    const catalog: ModelCatalog = { mode: 'api-key', ready: true, generation: 'account-one', code: 'ready', models: [{ id: 'model-one', label: 'Model one' }] };
    let stream!: ReadableStreamDefaultController<Uint8Array>, turn!: ModelTurnRequest;
    const fetcher: typeof fetch = async (path, init) => {
      if (path === '/chat/models') return new Response(JSON.stringify(catalog));
      turn = JSON.parse(init!.body as string);
      return new Response(new ReadableStream({ start(c) { stream = c; } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
    const admissions: Promise<boolean>[] = [], guards: (() => boolean)[] = [];
    chat = new ModelChatController(view => f.client.setModelStreaming(view.phase === 'streaming'), fetcher, 5000, 5000, {
      onproposal: (value, current) => { guards.push(current); admissions.push(f.client.admitModelProposal(value, current)); },
      oninvalidate: () => f.client.clearModelProposals(),
    });
    chat.bind(modelScene('demo', f.client.view.snapshot, f.client.view, [])); await chat.refreshModels();
    const sending = chat.send('Modify the box');
    while (!stream) await new Promise(resolve => setTimeout(resolve, 0));
    const push = (event: unknown) => stream.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
    push({ kind: 'start', requestId: turn.requestId, conversationId: 'conversation-one', model: turn.model });
    const context = { kind: 'project-box-proposal', proposal };
    push({ kind: 'tool', requestId: turn.requestId, name: 'propose_box_update', context });
    while (!admissions.length) await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(await admissions[0], true); assert.equal(chat.view.phase, 'streaming');
    assert.deepEqual(chat.view.messages.at(-1)!.tools, [context]);
    await f.client.approve(proposal.proposalId); assert.equal(f.authority.snapshot().project.revision, proposal.projectRevision + 1);
    push({ kind: 'done', requestId: turn.requestId, conversationId: 'conversation-one' }); stream.close(); await sending;
    assert.equal(f.client.view.modelStreaming, false); assert.equal(f.client.view.modelProposals!.length, 0);
    chat.accountChanged(); assert.equal(guards[0]!(), false); assert.equal(f.client.view.modelProposals!.length, 0);
    const request = { ...turn, scene: { mode: 'toronto', project: null, toronto: [] } };
    assert.throws(() => validateModelEvent({ kind: 'tool', requestId: turn.requestId, name: 'propose_box_update', context }, request as ModelTurnRequest));
  } finally { chat?.dispose(); f.dispose(); }
});

test('image-turn proposals admit immediately; historical pixels do not gate human review', async () => {
  const f = fixture(); let chat: ModelChatController | undefined;
  try {
    await ready(f); const proposal = f.proposal(), snapshot = f.authority.snapshot();
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const observation: VisualObservation = { schemaVersion: 1, observationId: 'image-one', viewGeneration: 1,
      image: { mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA==', sha256: 'a'.repeat(64), byteLength: 1 },
      viewport: { width: 8, height: 6, pixelRatio: 1, pixelOrigin: 'top-left' },
      camera: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], up: [0, 0, 1], near: .1, far: 100, fov: 50, aspect: 1, zoom: 1,
        matrixWorld: identity, matrixWorldInverse: identity, projectionMatrix: identity },
      binding: { sourceId: snapshot.sessionId, sourceRevision: snapshot.project.revision, frameId: snapshot.frameId, units: 'm', origin: snapshot.project.coordinates.localOrigin },
      coverage: { kind: 'synthetic-project-display', complete: true, displayedPointCount: 441 } };
    let imageCurrent = true, count = 0;
    const fetcher: typeof fetch = async (path, init) => {
      if (path === '/chat/models') return new Response(JSON.stringify({ mode: 'api-key', ready: true, generation: 'account-one', code: 'ready', models: [{ id: 'model-one', label: 'Model one' }] }));
      const turn = JSON.parse(init!.body as string) as ModelTurnRequest;
      const events = [ { kind: 'start', requestId: turn.requestId, conversationId: 'conversation-one', model: turn.model },
        { kind: 'tool', requestId: turn.requestId, name: 'propose_box_update', context: { kind: 'project-box-proposal', proposal } },
        { kind: 'delta', requestId: turn.requestId, text: 'Review the proposed change.' },
        { kind: 'done', requestId: turn.requestId, conversationId: 'conversation-one' } ];
      return new Response(events.map(e => JSON.stringify(e) + '\n').join(''), { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
    chat = new ModelChatController(() => {}, fetcher, 5000, 5000, { onproposal: () => { count++; imageCurrent = false; } });
    chat.bind(modelScene('demo', snapshot, f.client.view, [])); await chat.refreshModels();
    await chat.send('Modify this box', { observation, isCurrent: () => imageCurrent, resolvePixel: () => { throw new Error('Not called'); } });
    assert.equal(chat.view.phase, 'completed'); assert.equal(count, 1); assert.equal(imageCurrent, false);
    assert.equal(chat.view.messages.at(-1)!.tools.length, 1);
  } finally { chat?.dispose(); f.dispose(); }
});
