import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectSession } from '../apps/server/src/project-session';
import { ProjectController, projectBinding, type ProjectTransport, type ProjectView } from '../apps/web/src/project-client';
import { resolveAgentTorontoPoint } from '../apps/web/src/agent-reference';
import { modelScene } from '../apps/web/src/model-chat-client';

const edit = { kind: 'update-box' as const, entityId: 'proposal-box', center: [1, 2, 3] as const, dimensions: [4, 5, 6] as const };
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'agent-ui-')); const authority = new ProjectSession(join(root, 'project.json'));
  const calls: string[] = [], states: ProjectView[] = [];
  let fail = false;
  const transport: ProjectTransport = async (path, body) => {
    calls.push(path); if (fail) throw new Error('Unavailable');
    if (path === '/project/session') return structuredClone(authority.info());
    if (path === '/project/approve') return authority.approve(body);
    if (path === '/project/decline') return authority.decline(body);
    throw new Error('Unexpected write');
  };
  const client = new ProjectController(value => states.push(value), transport);
  return { client, authority, calls, states, fail() { fail = true; }, dispose() { client.dispose(); rmSync(root, { recursive: true, force: true }); } };
}

test('streaming synthetic acceptance and rebind preserve exact references/entity IDs', async () => {
  const f = setup(); try {
    await f.client.refresh(); f.client.setModelProposalScope(true);
    const snapshot = f.client.view.snapshot!; const cloud = snapshot.project.entities.find(e => e.kind === 'point-cloud')!;
    if (cloud.kind !== 'point-cloud') throw new Error('Missing fixture');
    f.client.select('proposal-box');
    assert.equal(f.client.pin({ name: 'Point 1', entityId: cloud.id, pointIndex: 17, position: cloud.points[17]! }), true);
    const previous = modelScene('demo', snapshot, f.client.view, []);
    const proposal = f.authority.propose({ ...projectBinding(snapshot), edit });
    assert.equal(await f.client.admitModelProposal(proposal), true);
    f.client.setModelStreaming(true);
    await f.client.approve(proposal.proposalId);
    const checkpoint = f.states.length;
    await f.client.refreshAgentAuthority();
    const actual = modelScene('demo', f.client.view.snapshot, f.client.view, []);
    assert.deepEqual(actual, { ...previous, project: { ...previous.project!, projectRevision: previous.project!.projectRevision + 1 } });
    assert.ok(f.states.slice(checkpoint).every(state => state.snapshot && state.selectedId === 'proposal-box' && state.points.length === 1));
    assert.equal(f.authority.proposalDecision(proposal.proposalId), 'accepted');
  } finally { f.dispose(); }
});

test('streaming permits decline but blocks unrelated project writes', async () => {
  const f = setup(); try {
    await f.client.refresh(); f.client.setModelProposalScope(true);
    const proposal = f.authority.propose({ ...projectBinding(f.client.view.snapshot!), edit });
    await f.client.admitModelProposal(proposal); f.client.setModelStreaming(true);
    await f.client.decline(proposal.proposalId);
    assert.equal(f.authority.proposalDecision(proposal.proposalId), 'declined');
    const count = f.calls.length;
    await f.client.save(); await f.client.load(); await f.client.undo(); await f.client.propose(edit);
    assert.equal(f.calls.length, count); assert.equal(f.authority.snapshot().project.revision, 0);
  } finally { f.dispose(); }
});

test('agent refresh rejects unavailable authority instead of returning unchanged stale scene', async () => {
  const f = setup(); try { await f.client.refresh(); f.fail(); await assert.rejects(f.client.refreshAgentAuthority()); }
  finally { f.dispose(); }
});

const revision = 'a'.repeat(64);
const source = { datasetId: 'toronto3d', artifactRevision: revision, frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0], key: { sourceFileId: 1, sourceRow: 20 }, position: [1.0000000001, 2, 3], semanticLabel: 6 };
const reference = { kind: 'toronto-point' as const, key: source.key };
const reply = (value: unknown): typeof fetch => (async () => new Response(JSON.stringify(value))) as typeof fetch;
test('agent reference resolves canonical original binary64 record and semantic label', async () => {
  const point = await resolveAgentTorontoPoint(reference, revision, new AbortController().signal, reply(source));
  assert.equal(point.position[0], source.position[0]); assert.equal(point.semanticLabel, 6); assert.ok(!('name' in point));
});
test('agent reference rejects mismatched key/revision/frame and oversized source replies', async () => {
  for (const value of [{ ...source, key: { ...source.key, sourceRow: 21 } }, { ...source, artifactRevision: 'b'.repeat(64) }, { ...source, frameId: 'other' }, { ...source, position: [null, 2, 3] }, 'x'.repeat(5000)]) {
    await assert.rejects(resolveAgentTorontoPoint(reference, revision, new AbortController().signal, reply(value)));
  }
});
