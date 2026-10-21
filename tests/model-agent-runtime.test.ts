import test from 'node:test';
import { withProductSkills } from './helpers/product-skill-transport';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalModelCaptureRequest, canonicalModelReferenceSelection, canonicalModelChatEvent, type ModelCaptureRequest, type ModelTurnRequest,
  type ModelScene, type ModelChatEvent, type BoxProposal, type ModelVisualObservation, TORONTO_SEMANTIC_LABELS,
  type TorontoCadSnapshot, type TorontoCadProposal, type PointOverrideSnapshot } from '@spatial/contracts';
import { ProjectSession } from '../apps/server/src/project-session';
import { ProviderAuth } from '../apps/server/src/provider-auth';
import { createModelChatRoutes } from '../apps/server/src/model-chat-routes';
import { ModelBrowserBroker } from '../apps/server/src/model-browser-broker';
import { createModelAgentRuntime, retryModelSceneRead } from '../apps/server/src/model-agent-runtime';
import { bindModelScene } from '../apps/server/src/model-scene';
import { PointOverrideSession } from '../apps/server/src/point-overrides';
import { TorontoCadSession } from '../apps/server/src/toronto-cad-session';
import type { SemanticArtifact } from '../apps/server/src/semantic-artifact';
import { ModelChatController, streamModelTurn, type VisualModelAttachment } from '../apps/web/src/model-chat-client';

// Trusted fixture receipts exercise the runtime protocol independently of authority receipt-storage tests.
class DecisionProject extends ProjectSession {
  private decisions = new Map<string, 'accepted' | 'declined'>();
  proposalDecision(id: string) { return this.decisions.get(id); }
  approve(value: Parameters<ProjectSession['approve']>[0]) {
    const result = super.approve(value); this.decisions.set((value as { proposalId: string }).proposalId, 'accepted'); return result;
  }
  decline(value: Parameters<ProjectSession['decline']>[0]) {
    const result = super.decline(value); this.decisions.set(result.proposalId, 'declined'); return result;
  }
}
function visual(id = 'agent-observation'): ModelVisualObservation {
  const chunk = (name: string, data: Buffer) => {
    const payload = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff;
    for (const b of payload) { crc ^= b; for (let i = 0; i < 8; ++i) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); payload.copy(bytes, 4); bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4); return bytes;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(18))), chunk('IEND', Buffer.alloc(0))]);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return { schemaVersion: 1, observationId: id, viewGeneration: 1,
    image: { mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length },
    viewport: { width: 2, height: 2, pixelRatio: 1, pixelOrigin: 'top-left' },
    camera: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], up: [0, 0, 1], near: .1, far: 100, fov: 50, aspect: 1, zoom: 1,
      matrixWorld: identity, matrixWorldInverse: identity, projectionMatrix: identity },
    binding: { sourceId: 'capture-session', sourceRevision: 0, frameId: 'synthetic-project-local-v1', units: 'm', origin: [0, 0, 0] },
    coverage: { kind: 'displayed-sample', complete: false, displayedPointCount: 4 } };
}
const attachment = (id?: string): VisualModelAttachment => ({ observation: visual(id), isCurrent: () => true,
  resolvePixel: (observationId, x, y) => ({ status: 'no-hit', observationId, x, y, reason: 'Fixture empty' }) });
const output = (items: unknown[]) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: items } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const tool = (name: string, args: unknown, id: number) => ({ type: 'function_call', namespace: 'scene', name, call_id: `agent-call-${id}`, arguments: JSON.stringify(args) });
const message = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Observed actual human outcome.' }] };
async function fixture(t: { after(fn: () => unknown): void }, rounds: (body: Record<string, any>, round: number) => unknown[]) {
  const root = await mkdtemp(join(tmpdir(), 'spatial-agent-runtime-')), authority = new DecisionProject(join(root, 'project.json'));
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'fixture-not-live' }), requests: Record<string, any>[] = [], skillRequests: Record<string, unknown>[] = [];
  // requests counts workflow responses; skillRequests counts the additional real load round per turn.
  const routes = createModelChatRoutes(auth, authority, root, withProductSkills(async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture-model' }] });
    const body = JSON.parse(String(init?.body)); requests.push(body); return output(rounds(body, requests.length));
  }, ['synthetic-boxes', 'visual-inspection', 'scene-inspection'], skillRequests));
  const server = createServer((req, res) => { void routes.handle(req, res).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { routes.close(); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); });
  const fetcher: typeof fetch = (path, init) => fetch(base + String(path), { ...init, headers: { ...init?.headers, Origin: base } });
  const catalog = await (await fetcher('/chat/models')).json();
  const scene: ModelScene = { mode: 'demo', project: { ...authority.binding(), entityIds: [], points: [] }, toronto: [] };
  const call: ModelTurnRequest = { requestId: 'agent-request', conversationId: null, generation: catalog.generation, model: 'fixture-model', text: 'Inspect and propose, then wait for me.', scene };
  return { authority, requests, skillRequests, fetcher, call, scene };
}
function decide(authority: DecisionProject, proposal: BoxProposal, decision: 'accepted' | 'declined') {
  const request = { ...authority.binding(), proposalId: proposal.proposalId, digest: proposal.digest };
  if (decision === 'accepted') authority.approve({ ...request, humanApproved: true }); else authority.decline(request);
}

for (const decision of ['accepted', 'declined'] as const) test(`proposal publishes immediately, pauses for actual ${decision} receipt and resumes on rebound authority`, async t => {
  const f = await fixture(t, (body, round) => {
    if (round === 1) return [tool('propose_box_create', { entityId: 'agent-created', center: [1, 2, 3], dimensions: [1, 1, 1] }, round)];
    const result = JSON.parse(body.input.find((i: any) => i.type === 'function_call_output' && i.call_id === 'agent-call-1').output);
    assert.equal(result.humanDecision.outcome, decision);
    assert.equal(result.humanDecision.scene.project.projectRevision, f.call.scene.project!.projectRevision + (decision === 'accepted' ? 1 : 0));
    return [message];
  });
  const before = f.authority.snapshot().project.revision, seen: ModelChatEvent[] = [];
  let approved = false, resumedScene = f.scene;
  const conversationId = await streamModelTurn(f.call, AbortSignal.timeout(5000), async event => {
    seen.push(event);
    if (event.kind === 'approval-result') resumedScene = event.scene;
    if (event.kind === 'tool' && event.name === 'propose_box_create') {
      assert.equal(f.requests.length, 1); assert.equal(f.authority.snapshot().project.revision, before);
      await delay(30); assert.equal(f.requests.length, 1); // provider must not continue while waiting
      decide(f.authority, (event.context as { proposal: BoxProposal }).proposal, decision); approved = true;
    }
  }, f.fetcher);
  assert.ok(approved); assert.equal(f.requests.length, 2); assert.equal(f.skillRequests.length, 1);
  assert.equal(f.requests.length + f.skillRequests.length, 3, 'load, proposal, then post-decision response');
  assert.deepEqual(seen.filter(e => e.kind.startsWith('approval')).map(e => e.kind), ['approval-wait', 'approval-result']);
  assert.equal(seen.at(-1)?.kind, 'done');
  assert.equal(f.authority.snapshot().project.entities.some(e => e.id === 'agent-created'), decision === 'accepted');
  assert.equal(JSON.stringify(f.requests[0].tools).includes('approve'), false);
  await streamModelTurn({ ...f.call, requestId: 'agent-continuation', conversationId, scene: resumedScene }, AbortSignal.timeout(5000), () => {}, f.fetcher);
  assert.equal(f.requests.length, 3); assert.equal(f.skillRequests.length, 2); // each user turn must reload, even after authority rebind
});

test('current/top-down/arbitrary screenshots, then model-selected reference, flow back into subsequent provider rounds without permission', async t => {
  const captures: ModelCaptureRequest[] = [{ kind: 'current' }, { kind: 'top-down' }, { kind: 'camera', position: [4, 3, 2], target: [0, 0, 0], up: [0, 0, 1] }];
  const f = await fixture(t, (body, round) => {
    if (round > 1 && round <= 4) {
      const imageInputs = body.input.filter((i: any) => Array.isArray(i.content)).flatMap((i: any) => i.content).filter((i: any) => i.type === 'input_image');
      assert.equal(imageInputs.length, round - 1); // Every earlier capture remains historical input.
      for (const image of imageInputs) assert.equal(image.image_url, visual().image.dataUrl);
    }
    if (round <= 3) return [tool('capture_scene', captures[round - 1], round)];
    if (round === 4) return [tool('select_reference', { kind: 'project-point', entityId: f.authority.snapshot().project.entities.find(e => e.kind === 'point-cloud')!.id, pointIndex: 0 }, round)];
    const result = JSON.parse(body.input.filter((i: any) => i.type === 'function_call_output').at(-1).output);
    assert.equal(result.status, 'selected'); assert.equal(result.context.project.points[0].name, 'Point 1');
    return [message];
  });
  let selected = 0;
  const seenCaptures: ModelCaptureRequest[] = [];
  await streamModelTurn(f.call, AbortSignal.timeout(5000), () => {}, f.fetcher, undefined, {
    oncapture: async request => { seenCaptures.push(request); return attachment(`observation-${seenCaptures.length}`); },
    onselectreference: async reference => {
      assert.equal(reference.kind, 'project-point'); if (reference.kind !== 'project-point') throw new Error('Unexpected frame');
      const entity = f.authority.snapshot().project.entities.find(e => e.id === reference.entityId); assert.ok(entity?.kind === 'point-cloud'); ++selected;
      return { ...f.scene, project: { ...f.scene.project!, points: [{ name: 'Point 1', entityId: entity.id, pointIndex: reference.pointIndex, position: entity.points[reference.pointIndex] }] } };
    },
  });
  assert.deepEqual(seenCaptures, captures); assert.equal(selected, 1); assert.equal(f.requests.length, 5);
  assert.equal(f.skillRequests.length, 1); assert.equal(f.requests.length + f.skillRequests.length, 6);
});

test('initial image proposal is visible and human-acceptable before EOF', async t => {
  const f = await fixture(t, (_body, round) => round === 1 ? [tool('propose_box_create', { entityId: 'image-proposal', center: [1, 2, 3], dimensions: [1, 1, 1] }, round)] : [message]);
  const image = attachment(); let proposed = false;
  const controller = new ModelChatController(() => {}, f.fetcher, 5000, 1000, {
    onproposal: value => { proposed = true; assert.equal(f.requests.length, 1); decide(f.authority, value as BoxProposal, 'accepted'); },
    onauthorityrefresh: async () => ({ ...f.scene, project: { ...f.scene.project!, ...f.authority.binding() } }),
  });
  controller.bind(f.scene); await controller.refreshModels(); await controller.send('Inspect this screenshot, propose and wait.', image);
  assert.ok(proposed); assert.equal(controller.view.phase, 'completed'); assert.equal(controller.view.continuationActive, true); controller.dispose();
});

test('agent-selected reference bind does not cancel its own streaming controller', async t => {
  const f = await fixture(t, (_body, round) => round === 1 ? [tool('select_reference', { kind: 'project-point', entityId: f.authority.snapshot().project.entities.find(e => e.kind === 'point-cloud')!.id, pointIndex: 0 }, round)] : [message]);
  let controller!: ModelChatController;
  controller = new ModelChatController(() => {}, f.fetcher, 5000, 1000, {
    onselectreference: async reference => {
      assert.equal(reference.kind, 'project-point'); if (reference.kind !== 'project-point') throw new Error('Unexpected frame');
      const entity = f.authority.snapshot().project.entities.find(e => e.id === reference.entityId); assert.ok(entity?.kind === 'point-cloud');
      const next: ModelScene = { ...f.scene, project: { ...f.scene.project!, points: [{ name: 'Point 1', entityId: entity.id, pointIndex: 0, position: entity.points[0] }] } };
      controller.bind(next); return next;
    },
  });
  controller.bind(f.scene); await controller.refreshModels(); await controller.send('Select an original scene reference.');
  assert.equal(controller.view.phase, 'completed'); assert.equal(f.requests.length, 2); controller.dispose();
});

test('forged selected reference position fails before another provider dispatch', async t => {
  const f = await fixture(t, (_body, round) => round === 1 ? [tool('select_reference', { kind: 'project-point', entityId: f.authority.snapshot().project.entities.find(e => e.kind === 'point-cloud')!.id, pointIndex: 0 }, round)] : [message]);
  await assert.rejects(streamModelTurn(f.call, AbortSignal.timeout(5000), () => {}, f.fetcher, undefined, {
    onselectreference: async reference => ({ ...f.scene, project: { ...f.scene.project!, points: [{ name: 'Point 1', entityId: reference.kind === 'project-point' ? reference.entityId : 'bad', pointIndex: 0, position: [999, 999, 999] }] } }),
  }));
  assert.equal(f.requests.length, 1);
});

test('unrelated mutation while paused is stale, not a fabricated approval or decline', async t => {
  const f = await fixture(t, (_body, round) => round === 1 ? [tool('propose_box_create', { entityId: 'agent-pending', center: [1, 2, 3], dimensions: [1, 1, 1] }, round)] : [message]);
  await assert.rejects(streamModelTurn(f.call, AbortSignal.timeout(5000), event => {
    if (event.kind === 'tool' && event.name === 'propose_box_create') {
      const other = f.authority.propose({ ...f.authority.binding(), edit: { kind: 'create-box', entityId: 'other', center: [9, 2, 3], dimensions: [1, 1, 1] } });
      decide(f.authority, other, 'accepted');
    }
  }, f.fetcher));
  assert.equal(f.requests.length, 1);
});

test('browser RPC capabilities reject wrong/replayed nonces and cannot carry approval decisions', async () => {
  let event!: Extract<ModelChatEvent, { kind: 'browser-request' }>;
  const broker = new ModelBrowserBroker('rpc-request', AbortSignal.timeout(2000), async e => { assert.equal(e.kind, 'browser-request'); event = e as typeof event; });
  const promise = broker.request({ kind: 'capture', request: { kind: 'top-down' } }, 'call-one');
  const result = { requestId: event.requestId, toolCallId: event.toolCallId, nonce: event.nonce, result: { status: 'unavailable' } };
  assert.throws(() => broker.accept({ ...result, nonce: 'forged' }));
  assert.throws(() => broker.accept({ ...result, result: { status: 'accepted' } }));
  broker.accept(result); assert.deepEqual(await promise, { status: 'unavailable' }); assert.throws(() => broker.accept(result));
});

test('capture/reference/event contracts reject extra fields, frame confusion and degenerate camera', () => {
  assert.deepEqual(canonicalModelCaptureRequest({ kind: 'top-down' }), { kind: 'top-down' });
  for (const request of [{ kind: 'approve' }, { kind: 'current', approve: true }, { kind: 'camera', position: [0, 0, 0], target: [0, 0, 0] }, { kind: 'camera', position: [0, 0, 1], target: [0, 0, 0], up: [0, 0, 1] }]) assert.throws(() => canonicalModelCaptureRequest(request));
  for (const request of [{ kind: 'toronto-point', key: { sourceFileId: 0, sourceRow: 0 } }, { kind: 'project-point', entityId: 'x', pointIndex: -1 }, { kind: 'project-point', entityId: 'x', pointIndex: 0, position: [0, 0, 0] }]) assert.throws(() => canonicalModelReferenceSelection(request));
  assert.throws(() => canonicalModelChatEvent({ kind: 'approval-result', requestId: 'r', proposalId: 'p', authority: 'cad', outcome: 'approved-by-model', scene: { mode: 'pole', project: null, toronto: [] } }));
});

async function torontoRuntimeFixture(t: { after(fn: () => unknown): void }) {
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
  const authority = new ProjectSession(join(root, 'project.json')), points = new PointOverrideSession(root), cad = new TorontoCadSession(root);
  const controller = new AbortController(), signal = controller.signal;
  const scene: ModelScene = { mode: 'toronto', project: null, toronto: [] };
  const call: ModelTurnRequest = { requestId: 'toronto-concurrency', conversationId: null, generation: 'fixture-generation', model: 'fixture', text: 'Inspect', scene };
  const initial = await bindModelScene(scene, authority, root, signal, undefined, { points, cad });
  const browser = new ModelBrowserBroker(call.requestId, signal, async () => {});
  const runtime = createModelAgentRuntime(call, initial, authority, root, signal, browser, { points, cad });
  t.after(async () => { controller.abort(); await runtime.close(); await points.close(); await cad.close(); await rm(root, { recursive: true, force: true }); });
  return { cad, points, runtime, signal };
}

for (const decision of ['accepted', 'declined'] as const) for (const unrelatedMutation of [false, true])
test(`actual Toronto ${decision} receipt with concurrent browser snapshot ${unrelatedMutation ? 'rejects unrelated revision' : 'resumes without mutation replay'}`, async t => {
  const f = await torontoRuntimeFixture(t);
  const proposal = await f.runtime.proposeCad!({ kind: 'box', center: [1, 1, 1], dimensions: [1, 1, 1] }, f.signal) as TorontoCadProposal;
  await f.cad.execute(decision === 'accepted' ? 'approve' : 'decline', { sessionId: proposal.sessionId, revision: proposal.revision,
    artifactRevision: proposal.artifactRevision, proposalId: proposal.proposalId });
  assert.equal(f.cad.proposalDecision(proposal.proposalId), decision); // actual authority receipt, not a fixture decision map
  if (unrelatedMutation) {
    const state = await f.cad.execute('snapshot') as TorontoCadSnapshot;
    const other = await f.cad.execute('propose', { sessionId: state.sessionId, revision: state.revision, artifactRevision: state.artifactRevision,
      operation: { kind: 'cylinder', center: [2, 2, 2], radius: .25, height: 1 } }) as TorontoCadProposal;
    await f.cad.execute('approve', { sessionId: other.sessionId, revision: other.revision, artifactRevision: other.artifactRevision, proposalId: other.proposalId });
  }
  // Hold genuine artifact I/O inside the actual authority's read admission, deterministically
  // reproducing an HTTP GET snapshot overlapping receipt refresh. No fake authority behavior.
  const artifact = (f.cad as unknown as { artifact: SemanticArtifact }).artifact;
  const check = artifact.check.bind(artifact);
  let entered!: () => void, release!: () => void, hold = true;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  artifact.check = async signal => { if (hold) { hold = false; entered(); await gate; } await check(signal); };
  const browserRead = f.cad.execute('snapshot'); await started;
  const observed = f.runtime.waitForApproval!('cad', proposal.proposalId);
  // Attach rejection immediately so the old busy failure is a deterministic assertion, not an unhandled rejection.
  const observation = observed.then(value => ({ value }), error => ({ error }));
  await delay(40); release();
  const result = await observation; await browserRead; artifact.check = check;
  if (unrelatedMutation) {
    assert.ok('error' in result); assert.equal((result.error as { code: string }).code, 'stale-scene'); return;
  }
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

test('controller permits expected approved revision during streaming and still cancels unrelated selection', async t => {
  for (const unrelated of [false, true]) {
    const f = await fixture(t, (_body, round) => round === 1 ? [tool('propose_box_create', { entityId: 'from-controller', center: [1, 2, 3], dimensions: [1, 1, 1] }, round)] : [message]);
    let controller!: ModelChatController;
    controller = new ModelChatController(() => {}, f.fetcher, 5000, 1000, {
      onproposal: value => {
        decide(f.authority, value as BoxProposal, 'accepted');
        const next = { ...f.scene, project: { ...f.scene.project!, ...f.authority.binding(), ...(unrelated ? { entityIds: ['from-controller'] } : {}) } };
        controller.bind(next);
      },
      onauthorityrefresh: async () => ({ ...f.scene, project: { ...f.scene.project!, ...f.authority.binding() } }),
    });
    controller.bind(f.scene); await controller.refreshModels(); await controller.send('Create a candidate and wait');
    assert.equal(controller.view.phase, unrelated ? 'idle' : 'completed');
    assert.equal(f.requests.length, unrelated ? 1 : 2); controller.dispose();
  }
});
