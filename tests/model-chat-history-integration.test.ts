import assert from 'node:assert/strict';
import { withProductSkills } from './helpers/product-skill-transport';
import test, { type TestContext } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TORONTO_SEMANTIC_LABELS, type BoxProposal, type ModelScene, type ModelTurnRequest } from '@spatial/contracts';
import { ProjectSession } from '../apps/server/src/project-session';
import { ProviderAuth } from '../apps/server/src/provider-auth';
import { createModelChatRoutes } from '../apps/server/src/model-chat-routes';
import { SemanticArtifact } from '../apps/server/src/semantic-artifact';
import { getSemanticDiskIndex, dropSemanticDiskIndexMemoryCache } from '../apps/server/src/semantic-disk-index';
import { ModelChatController } from '../apps/web/src/model-chat-client';

// Only the upstream network is replaced. Browser fetch/NDJSON, route admission,
// ProviderModel/SSE parsing, authority checks and tool execution are all real.
type Item = Record<string, any>;
type ProviderBody = { input: Item[]; tools: { name: string; tools: { name: string }[] }[] };
const answer = (text: string): Item => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const tool = (name: string, id: string, args: object = {}): Item => ({ type: 'function_call', namespace: 'scene', name, call_id: id, arguments: JSON.stringify(args) });
const results = (body: ProviderBody) => body.input.filter(item => item.type === 'function_call_output');
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
async function fixture(t: TestContext, rounds: (body: ProviderBody, round: number) => Item[], skillIds: readonly string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'spatial-chat-history-'));
  const authority = new ProjectSession(join(root, 'project.json'));
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'synthetic-never-live' });
  // Keep original workflow numbering distinct from the explicit skill-load network rounds.
  const requests: ProviderBody[] = [], skillRequests: Record<string, unknown>[] = [], turns: ModelTurnRequest[] = [];
  const routes = createModelChatRoutes(auth, authority, root, withProductSkills(async (url, init) => {
    assert.match(String(url), /^https:\/\/api\.openai\.com\/v1\/(models|responses)$/u);
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture-model' }] });
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init?.body)) as ProviderBody;
    requests.push(body);
    const text = `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: rounds(body, requests.length) } })}\n\n`;
    const bytes = new TextEncoder().encode(text);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 11) controller.enqueue(bytes.slice(offset, offset + 11));
      controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } });
  }, skillIds, skillRequests));
  const server = createServer((req, res) => { void routes.handle(req, res).then(handled => {
    if (!handled) { res.statusCode = 404; res.end(); }
  }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const fetcher: typeof fetch = (path, init) => {
    if (String(path) === '/chat/turn') turns.push(JSON.parse(String(init?.body)) as ModelTurnRequest);
    return fetch(base + String(path), { ...init, headers: { ...init?.headers, Origin: base } });
  };
  const scene: ModelScene = { mode: 'demo', project: { ...authority.binding(), entityIds: [], points: [] }, toronto: [] };
  t.after(async () => {
    routes.close(); auth.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  return { root, authority, fetcher, requests, skillRequests, turns, scene };
}
function completed(controller: ModelChatController) {
  assert.equal(controller.view.phase, 'completed', controller.view.code);
  assert.equal(controller.view.messages.at(-1)?.state, 'complete');
  assert.equal(controller.view.continuationActive, true);
}

test('controller preserves three user turns, assistant replies and every tool call/result in actual provider POSTs', { timeout: 10000 }, async t => {
  const firstCall = tool('inspect_scene', 'history-inspect-one');
  const secondCall = tool('inspect_scene', 'history-inspect-two');
  const replies = ['Scene inspected twice. 🌍', 'I remember the scene.', 'All earlier context is retained.'];
  const f = await fixture(t, (_body, round) => {
    if (round === 1) return [answer('Inspecting the scene.'), firstCall];
    if (round === 2) return [answer('Checking it again.'), secondCall];
    return [answer(replies[round - 3])];
  });
  const controller = new ModelChatController(() => {}, f.fetcher, 5000, 1000);
  t.after(() => controller.dispose()); controller.bind(f.scene); await controller.refreshModels();
  const sends = ['Inspect this scene twice.', 'What did you observe?', 'Recall our full conversation.'];
  for (const text of sends) { assert.equal(await controller.send(text), true); completed(controller); }
  assert.equal(f.requests.length, 5); assert.equal(f.turns.length, 3);
  assert.equal(f.turns[0].conversationId, null);
  assert.ok(f.turns[1].conversationId); assert.equal(f.turns[2].conversationId, f.turns[1].conversationId);
  assert.equal(new Set(f.turns.map(turn => turn.requestId)).size, 3);
  for (const turn of f.turns) { assert.equal('messages' in turn, false); assert.equal('tools' in turn, false); }
  // Every dispatch extends the exact previous provider input, including opaque
  // function-call IDs/results, rather than reconstructing history from UI text.
  for (let i = 1; i < f.requests.length; i++) {
    const previous = f.requests[i - 1].input;
    assert.deepEqual(f.requests[i].input.slice(0, previous.length), previous);
  }
  assert.deepEqual(f.requests[1].input.slice(2, 4), [answer('Inspecting the scene.'), firstCall]);
  assert.deepEqual(f.requests[2].input.slice(5, 7), [answer('Checking it again.'), secondCall]);
  for (const body of f.requests.slice(2)) {
    assert.deepEqual(body.input.filter(item => item.type === 'function_call'), [firstCall, secondCall]);
    assert.deepEqual(results(body).map(item => item.call_id), [firstCall.call_id, secondCall.call_id]);
    for (const result of results(body)) {
      const context = JSON.parse(result.output);
      assert.equal(context.mode, 'demo'); assert.equal(context.project.sessionId, f.authority.binding().sessionId);
    }
  }
  assert.deepEqual(f.requests[4].input.filter(item => item.role === 'user').map(item => item.content), sends);
  assert.deepEqual(f.requests[4].input.filter(item => item.role === 'assistant'), [
    answer('Inspecting the scene.'), answer('Checking it again.'), answer(replies[0]), answer(replies[1]),
  ]);
  assert.deepEqual(controller.view.messages.map(message => message.text), [
    sends[0], `Inspecting the scene.Checking it again.${replies[0]}`, sends[1], replies[1], sends[2], replies[2],
  ]);
});

test('completed provider history survives catalog discovery failure and a confirmed failed followup without replaying it', { timeout: 10000 }, async t => {
  const f = await fixture(t, (_body, round) => round === 2 ?
    [answer('Uncommitted partial answer.'), tool('inspect_scene', 'failed-inspection', { invalid: true })] : [answer('Completed answer.')]);
  let unavailable = false;
  const fetcher: typeof fetch = (path, init) => {
    if (path === '/chat/models' && unavailable) return Promise.reject(new Error('Synthetic discovery failure'));
    return f.fetcher(path, init);
  };
  const controller = new ModelChatController(() => {}, fetcher, 5000, 1000);
  t.after(() => controller.dispose()); controller.bind(f.scene); await controller.refreshModels();
  await controller.send('Remember my original request.'); completed(controller);
  unavailable = true; await controller.refreshModels();
  assert.equal(controller.view.catalogPhase, 'error'); assert.equal(controller.view.continuationActive, true);
  assert.equal(await controller.send('Must not dispatch while discovery is unavailable.'), false);
  assert.equal(f.requests.length, 1);
  unavailable = false; await controller.refreshModels();
  await controller.send('This turn fails.');
  assert.equal(controller.view.phase, 'error'); assert.equal(controller.view.code, 'unsupported-tool');
  assert.equal(controller.view.continuationActive, true);
  await controller.send('Recall the original completed conversation.'); completed(controller);
  assert.equal(f.requests.length, 3);
  assert.deepEqual(f.requests[2].input.filter(item => item.role === 'user').map(item => item.content),
    ['Remember my original request.', 'Recall the original completed conversation.']);
  assert.deepEqual(f.requests[2].input.filter(item => item.role === 'assistant'), [answer('Completed answer.')]);
  assert.equal(JSON.stringify(f.requests[2]).includes('failed-inspection'), false);
  assert.equal(controller.view.messages[3].state, 'incomplete');
  assert.equal(f.turns[2].conversationId, f.turns[1].conversationId);
});

test('human approval pauses the controller loop until external authority acceptance, then replays the actual receipt', { timeout: 10000 }, async t => {
  const proposed = deferred<BoxProposal>(), waiting = deferred<void>();
  const call = tool('propose_box_create', 'history-proposal', { entityId: 'history-created-box', center: [1, 2, 3], dimensions: [1, 1, 1] });
  const f = await fixture(t, (_body, round) => round === 1 ? [call] : [answer('The human accepted the proposal.')], ['synthetic-boxes']);
  const before = f.authority.binding().projectRevision;
  const controller = new ModelChatController(() => {}, f.fetcher, 5000, 1000, {
    onproposal: proposal => proposed.resolve(proposal as BoxProposal),
    onapprovalwait: active => { if (active) waiting.resolve(); },
    onauthorityrefresh: async () => ({ ...f.scene, project: { ...f.scene.project!, ...f.authority.binding() } }),
  });
  t.after(() => controller.dispose()); controller.bind(f.scene); await controller.refreshModels();
  const pending = controller.send('Propose a box and wait for my decision.');
  const proposal = await proposed.promise; await waiting.promise;
  assert.equal(controller.view.phase, 'streaming'); assert.equal(f.requests.length, 1);
  assert.equal(f.authority.proposalDecision(proposal.proposalId), undefined);
  assert.equal(f.authority.snapshot().project.entities.some(entity => entity.id === 'history-created-box'), false);
  await delay(180); // longer than the real receipt polling interval
  assert.equal(f.requests.length, 1, 'no provider continuation while the human has not decided');
  for (const body of f.requests) {
    const names = body.tools.flatMap(namespace => namespace.tools.map(tool => tool.name));
    assert.ok(!names.some(name => /approve|accept|decline|publish/u.test(name)));
  }
  // This action is deliberately outside any model/browser callback.
  f.authority.approve({ ...f.authority.binding(), proposalId: proposal.proposalId, digest: proposal.digest, humanApproved: true });
  await pending; completed(controller); assert.equal(f.requests.length, 2);
  assert.equal(f.skillRequests.length, 1); assert.equal(f.requests.length + f.skillRequests.length, 3);
  const result = JSON.parse(results(f.requests[1]).find(item => item.call_id === call.call_id)!.output);
  assert.equal(result.humanDecision.outcome, 'accepted');
  assert.equal(result.humanDecision.scene.project.projectRevision, before + 1);
  assert.equal(f.authority.proposalDecision(proposal.proposalId), 'accepted');
  assert.equal(f.authority.snapshot().project.entities.some(entity => entity.id === 'history-created-box'), true);
  assert.equal(await controller.send('Remember my acceptance.'), true); completed(controller);
  assert.ok(f.turns[1].conversationId);
  assert.equal(f.turns[1].scene.project?.projectRevision, before + 1);
  assert.deepEqual(results(f.requests[2]).filter(item => item.call_id === call.call_id), results(f.requests[1]).filter(item => item.call_id === call.call_id));
});

test('a provider cannot bypass human approval with an invented approval tool', { timeout: 10000 }, async t => {
  const f = await fixture(t, () => [tool('approve', 'forged-model-approval', { humanApproved: true })]);
  const before = f.authority.snapshot();
  const controller = new ModelChatController(() => {}, f.fetcher, 5000, 1000);
  t.after(() => controller.dispose()); controller.bind(f.scene); await controller.refreshModels();
  assert.equal(await controller.send('Approve the scene yourself.'), true);
  assert.equal(controller.view.phase, 'error'); assert.equal(controller.view.code, 'unsupported-tool');
  assert.equal(f.requests.length, 1); assert.deepEqual(f.authority.snapshot(), before);
});

async function torontoArea(root: string): Promise<ModelScene> {
  await mkdir(join(root, 'octree'));
  // One pole inside the AOI and one outside; all source records and IDs are real fixture data.
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 2, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [0, 0, 0], max: [10, 10, 10] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [0, 0, 0], max: [10, 10, 10] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(56);
  for (let i = 0; i < 2; i++) {
    payload.writeInt32LE(i ? 9000 : 1000, i * 28); payload.writeInt32LE(1000, i * 28 + 4);
    payload.writeInt32LE(5000, i * 28 + 8); payload.writeUInt16LE(1, i * 28 + 18);
    payload.writeUInt32LE(i, i * 28 + 20); payload.writeFloatLE(6, i * 28 + 24);
  }
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(2, 2); hierarchy.writeBigUInt64LE(56n, 14);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0],
    potree_scale_m: metadata.scale, semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS,
    sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? 2 : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata));
  await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const artifact = await SemanticArtifact.open(root);
  try {
    return { mode: 'toronto', project: null, toronto: [], areaOfInterest: {
      datasetId: 'toronto3d', artifactRevision: artifact.dataset.revision, frameId: 'toronto3d-local-v1', units: 'm',
      localOrigin: [627285, 4841948, 0], corners: [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]],
    } };
  } finally { await artifact.close(); }
}

test('Toronto inspect_scene → query_aoi_points → final answer completes through the real client and retains source results', { timeout: 15000 }, async t => {
  const inspect = tool('inspect_scene', 'aoi-inspection'), query = tool('query_aoi_points', 'aoi-query', { label: 6, maxResults: 8 });
  const f = await fixture(t, (_body, round) => round === 1 ? [inspect] : round === 2 ? [query] : [answer('One original Pole is inside this AOI.')], ['scene-inspection']);
  const scene = await torontoArea(f.root);
  const artifact = await SemanticArtifact.open(f.root);
  const { index } = await getSemanticDiskIndex(artifact); await artifact.close();
  t.after(async () => { dropSemanticDiskIndexMemoryCache(); await rm(index.directory, { recursive: true, force: true }); });
  const controller = new ModelChatController(() => {}, f.fetcher, 10000, 1000);
  t.after(() => controller.dispose()); controller.bind(scene); await controller.refreshModels();
  assert.equal(await controller.send('Inspect the scene, then find original Pole points in this AOI.'), true);
  completed(controller); assert.equal(f.requests.length, 3);
  assert.equal(f.skillRequests.length, 1); assert.equal(f.requests.length + f.skillRequests.length, 4);
  assert.deepEqual(results(f.requests[2]).filter(item => !item.call_id.startsWith('fixture_load_')).map(item => item.call_id), [inspect.call_id, query.call_id]);
  const result = JSON.parse(results(f.requests[2]).find(item => item.call_id === query.call_id)!.output);
  assert.equal(result.complete, true); assert.equal(result.totalCount, 1); assert.equal(result.truncated, false);
  assert.equal(result.domain, 'original-source-points'); assert.equal(result.elevationScope, 'all-elevations');
  assert.equal(result.binding.frameId, 'toronto3d-local-v1'); assert.equal(result.binding.units, 'm');
  assert.deepEqual(result.points[0].position, [1, 1, 5]); assert.equal(result.points[0].semanticType, 'Pole');
  assert.deepEqual(result.points[0].selectReference, { kind: 'toronto-point', key: { sourceFileId: 1, sourceRow: 0 } });
  assert.equal(result.cadVerification, false); assert.equal(result.independentVerification, false);
  assert.equal(controller.view.messages.at(-1)?.tools.length, 3);
  assert.equal(await controller.send('Remember the returned original source point.'), true); completed(controller);
  assert.deepEqual(results(f.requests[3]).filter(item => !item.call_id.startsWith('fixture_load_')), results(f.requests[2]).filter(item => !item.call_id.startsWith('fixture_load_')));
});
