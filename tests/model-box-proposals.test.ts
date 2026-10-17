import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalModelChatEvent, type BoxProposal, type ModelChatEvent, type ModelScene, type ModelTurnRequest } from '@spatial/contracts';
import { ProjectSession } from '../apps/server/src/project-session';
import { bindModelScene } from '../apps/server/src/model-scene';
import { ProviderModel, type ModelAuth, type BoundModelScene } from '../apps/server/src/provider-model';

const freshSignal = () => new AbortController().signal;
const tool = (name: string, args: unknown, namespace = 'scene') => ({ type: 'function_call', namespace, name, call_id: `call_${name}`, arguments: JSON.stringify(args) });
const sse = (output: unknown[]) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const parameters = { entityId: 'model-box', center: [2, 3, 4] as const, dimensions: [1, 2, 3] as const };
async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), 'spatial-box-tools-'));
  const authority = new ProjectSession(join(root, 'project.json'));
  const auth: ModelAuth = { status: () => ({ mode: 'api-key', authenticated: true, ready: true, planUsageEnabled: false, selectedAccount: null, accounts: [] }),
    credentialGeneration: () => 'generation', onCredentialChange: () => () => {},
    credential: async () => ({ mode: 'api-key', bearer: 'synthetic-fixture', baseUrl: 'https://unused.invalid', constraints: { billing: 'api-key', responsesOnly: false } }) };
  const requests: Record<string, unknown>[] = []; const outputs: unknown[][] = [];
  let beforeResponse: (() => void) | undefined;
  const model = new ProviderModel(auth, async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'model-one' }] });
    requests.push(JSON.parse(String(init?.body))); beforeResponse?.();
    return sse(outputs.shift() ?? []);
  });
  t.after(async () => { model.close(); await rm(root, { recursive: true, force: true }); });
  await model.models(freshSignal());
  const scene: ModelScene = { mode: 'demo', project: { ...authority.binding(), entityIds: [], points: [] }, toronto: [] };
  const bound = await bindModelScene(scene, authority, root, freshSignal());
  t.after(() => bound.close());
  const call = (s = scene): ModelTurnRequest => ({ requestId: 'request', conversationId: null, generation: 'generation', model: 'model-one', text: 'Propose a box', scene: s });
  const run = async (s = scene, b = bound, signal = freshSignal()) => {
    const events: ModelChatEvent[] = [];
    await model.turn(call(s), b, async event => { events.push(canonicalModelChatEvent(event)); }, signal);
    return events;
  };
  return { root, authority, model, scene, bound, requests, outputs, run, call, setBeforeResponse(fn: () => void) { beforeResponse = fn; } };
}
const advertised = (body: Record<string, unknown>) => (body.tools as { tools: { name: string }[] }[])[0].tools.map(t => t.name);
const proposalEvents = (events: ModelChatEvent[]) => events.filter((e): e is Extract<ModelChatEvent, { kind: 'tool' }> => e.kind === 'tool');

test('model create/update dispatch returns exact retained proposals without mutation; human approval remains possible after turn close', async t => {
  const f = await fixture(t); const before = f.authority.snapshot();
  const box = before.project.entities.find(e => e.kind === 'box')!;
  f.outputs.push([tool('propose_box_create', parameters), tool('propose_box_update', { ...parameters, entityId: box.id })], []);
  const events = await f.run();
  const tools = proposalEvents(events); assert.equal(tools.length, 2);
  assert.deepEqual(tools.map(e => e.name), ['propose_box_create', 'propose_box_update']);
  assert.deepEqual(f.authority.snapshot(), before);
  assert.deepEqual(advertised(f.requests[0]), ['inspect_scene', 'propose_box_create', 'propose_box_update']);
  assert.match(String(f.requests[0].instructions), /Never claim a proposal is committed/u);
  const context = f.bound.context as { availableProjectBoxes: unknown[] };
  assert.deepEqual(context.availableProjectBoxes, before.project.entities.filter(e => e.kind === 'box'));
  const proposals = tools.map(e => {
    assert.deepEqual(Object.keys(e.context as object).sort(), ['kind', 'proposal']);
    const wrapper = e.context as { kind: string; proposal: BoxProposal };
    assert.equal(wrapper.kind, 'project-box-proposal');
    assert.equal(wrapper.proposal.verification, 'parameter-postconditions-not-cad');
    assert.equal(wrapper.proposal.projectRevision, before.project.revision);
    return wrapper.proposal;
  });
  const input = f.requests[1].input as { type?: string; output?: string }[];
  assert.deepEqual(input.filter(i => i.type === 'function_call_output').map(i => JSON.parse(i.output!)), tools.map(e => e.context));
  await f.bound.close();
  const proposal = proposals[0];
  const result = f.authority.approve({ ...f.authority.binding(), proposalId: proposal.proposalId, digest: proposal.digest, humanApproved: true });
  assert.deepEqual(result.snapshot.project.entities.find(e => e.id === parameters.entityId), proposal.after);
  assert.throws(() => f.authority.approve({ ...f.authority.binding(), proposalId: proposals[1].proposalId, digest: proposals[1].digest, humanApproved: true }));
});

test('proposal tools are not advertised or callable outside a bound synthetic demo, even with an injected method', async t => {
  const f = await fixture(t); let attempts = 0;
  const forged: BoundModelScene = { ...f.bound, async proposeBox() { attempts++; throw new Error('must not dispatch'); } };
  for (const scene of [{ ...f.scene, project: null }, { ...f.scene, mode: 'pole' as const }, { ...f.scene, mode: 'toronto' as const }]) {
    for (const name of ['propose_box_create', 'propose_box_update']) {
      f.outputs.push([tool(name, parameters)]);
      await assert.rejects(f.run(scene, forged), { code: 'unsupported-tool' });
      assert.deepEqual(advertised(f.requests.at(-1)!), ['inspect_scene']);
    }
    const bound = await bindModelScene(scene, f.authority, f.root, freshSignal());
    assert.equal(bound.proposeBox, undefined); await bound.close();
  }
  assert.equal(attempts, 0);
});

test('strict model box arguments reject extras, wrong vectors, invalid IDs, nonpositive/oversized values and forged binding', async t => {
  const f = await fixture(t); const before = f.authority.snapshot();
  const invalid = [null, [], {}, { ...parameters, extra: true }, { ...parameters, sessionId: 'forged' },
    { ...parameters, entityId: '' }, { ...parameters, entityId: 'invalid id' }, { ...parameters, center: [1, 2] },
    { ...parameters, center: ['1', 2, 3] }, { ...parameters, center: [1e7, 2, 3] },
    { ...parameters, dimensions: [1, 0, 3] }, { ...parameters, dimensions: [1, -1, 3] },
    { ...parameters, dimensions: [1, null, 3] }, { ...parameters, dimensions: [1, 2, 3, 4] }];
  let attempts = 0; const guarded: BoundModelScene = { ...f.bound, async proposeBox() { attempts++; throw new Error('must not dispatch'); } };
  for (const args of invalid) {
    f.outputs.push([tool('propose_box_create', args)]); await assert.rejects(f.run(f.scene, guarded));
    assert.deepEqual(f.authority.snapshot(), before);
  }
  assert.equal(attempts, 0);
  for (const name of ['approve', 'decline', 'undo', 'save', 'load', 'propose_box_create']) {
    f.outputs.push([tool(name, parameters, name === 'propose_box_create' ? 'other' : 'scene')]);
    await assert.rejects(f.run(), { code: 'unsupported-tool' });
  }
});

test('unknown update IDs and duplicate create IDs fail without authority mutation', async t => {
  const f = await fixture(t); const before = f.authority.snapshot();
  const existing = before.project.entities.find(e => e.kind === 'box')!;
  for (const [name, entityId] of [['propose_box_update', 'missing-box'], ['propose_box_create', existing.id]]) {
    f.outputs.push([tool(name, { ...parameters, entityId })]);
    await assert.rejects(f.run(), { code: 'unknown-entity' });
    assert.deepEqual(f.authority.snapshot(), before);
  }
});

test('stale provider completion cannot dispatch a proposal or publish a tool result', async t => {
  const f = await fixture(t);
  const pending = f.authority.propose({ ...f.authority.binding(), edit: { ...parameters, kind: 'create-box' } });
  let attempts = 0;
  const guarded: BoundModelScene = { ...f.bound, async proposeBox(edit, signal) { attempts++; return f.bound.proposeBox!(edit, signal); } };
  f.setBeforeResponse(() => { f.authority.approve({ ...f.authority.binding(), proposalId: pending.proposalId, digest: pending.digest, humanApproved: true }); });
  f.outputs.push([tool('propose_box_create', { ...parameters, entityId: 'late-box' })]);
  const events: ModelChatEvent[] = [];
  await assert.rejects(f.model.turn(f.call(), guarded, async e => { events.push(e); }, freshSignal()), { code: 'stale-project' });
  assert.equal(attempts, 0); assert.equal(proposalEvents(events).length, 0);
  assert.equal(f.authority.snapshot().project.entities.some(e => e.id === 'late-box'), false);
  await assert.rejects(f.bound.proposeBox!({ ...parameters, kind: 'create-box' }, freshSignal()), { code: 'stale-project' });
});

test('aborted and closed binding cannot retain proposals; cancellation after provider completion cannot dispatch', async t => {
  const f = await fixture(t); const before = f.authority.snapshot();
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(f.bound.proposeBox!({ ...parameters, kind: 'create-box' }, aborted.signal));
  const controller = new AbortController();
  f.setBeforeResponse(() => controller.abort());
  f.outputs.push([tool('propose_box_create', parameters)]);
  let attempts = 0;
  const guarded: BoundModelScene = { ...f.bound, async proposeBox() { attempts++; throw new Error('must not dispatch'); } };
  await assert.rejects(f.run(f.scene, guarded, controller.signal));
  assert.equal(attempts, 0); assert.deepEqual(f.authority.snapshot(), before);
  await f.bound.close();
  await assert.rejects(f.bound.proposeBox!({ ...parameters, kind: 'create-box' }, freshSignal()), { code: 'stale-scene' });
});
