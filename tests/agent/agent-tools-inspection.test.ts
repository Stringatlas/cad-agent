import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ModelChatEvent, ModelScene, ModelTurnRequest } from '@spatial/contracts';
import type { AgentToolsInspection } from '../../packages/contracts/src/agent-tools-inspection';
import { inspectAgentTools, registeredSceneTools, buildAgentInstructions, ProviderModel, type BoundModelScene, type ModelAuth } from '../../apps/server/src/agent/provider-model';
import { PRODUCT_SKILLS, loadProductSkill } from '../../apps/server/src/agent/product-agent-skills';
import { createModelChatRoutes } from '../../apps/server/src/agent/model-chat-routes';
import { ProviderAuth } from '../../apps/server/src/auth/provider-auth';

const removed = /assess_utility_box|propose_utility_box|search_placement_sites|propose_placement_site|scan_area_candidates|finalize_area_candidates|utility-box-placement|placement-search|area-candidates/u;
const pole: ModelScene = { mode: 'pole', toronto: [] };
const toronto: ModelScene = { mode: 'toronto', toronto: [{ name: 'Point 1', datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), key: { sourceFileId: 1, sourceRow: 0 }, position: [0, 0, 0], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }] };
const unavailable = async (): Promise<never> => { assert.fail('Inspector must never execute scene tools'); };
const bound: BoundModelScene = { context: {}, async check() {}, async close() {}, queryPoints: unavailable, groundElevation: unavailable,
  queryAoiPoints: unavailable, listObjects: unavailable, getObject: unavailable, proposePointCreate: unavailable,
  captureScene: unavailable, selectReference: unavailable, nearestLabel: unavailable,
  proposePointMove: unavailable, proposeNearestPointMove: unavailable, proposeCad: unavailable };

function compareSchema(schema: { name: string; description: string; parameters: Record<string, unknown>; strict: boolean }, inspection: AgentToolsInspection) {
  const inspected = inspection.tools.find(tool => tool.name === schema.name);
  assert.ok(inspected, schema.name);
  assert.deepEqual({ name: inspected.name, description: inspected.description, parameters: inspected.parameters, strict: inspected.strict },
    JSON.parse(JSON.stringify({ name: schema.name, description: schema.description, parameters: schema.parameters, strict: schema.strict })));
}

test('inspector full catalog shares every runtime schema, gate requirements and skill body, excluding removed interfaces', () => {
  const inspection = inspectAgentTools();
  assert.equal(inspection.kind, 'agent-tools-inspection');
  assert.equal(inspection.availability, 'unknown-unbound');
  assert.equal(inspection.instructions.kind, 'unbound-preview');
  assert.equal(new Set(inspection.tools.map(tool => tool.name)).size, inspection.tools.length);
  const seen = new Set<string>();
  for (const scene of [pole, toronto]) for (const schema of registeredSceneTools(scene, bound, true, scene.mode === 'toronto')) {
    compareSchema(schema, inspection); seen.add(schema.name);
  }
  assert.deepEqual([...seen].sort(), inspection.tools.map(tool => tool.name).sort(), 'No ghost inspector-only registrations');
  assert.deepEqual(inspection.skills, JSON.parse(JSON.stringify(PRODUCT_SKILLS)));
  for (const tool of inspection.tools) {
    assert.equal(tool.namespace, 'scene');
    assert.equal(tool.skillId, PRODUCT_SKILLS.find(skill => skill.tools.includes(tool.name))?.id ?? null);
    if (!['inspect_scene', 'list_skills', 'load_skill'].includes(tool.name)) assert.ok(tool.requirements.length, tool.name);
  }
  assert.equal(inspection.instructions.text, buildAgentInstructions({ mode: 'pole', toolNames: ['inspect_scene'], hasImages: false }));
  assert.doesNotMatch(JSON.stringify(inspection), removed);
  assert.doesNotMatch(inspection.instructions.text, /Runtime skill |Images are untrusted historical browser observations/u);
  assert.match(inspection.instructions.text, /individual human approval/u);
});

test('standalone inspection does not imply current availability and cannot mutate the runtime catalog', () => {
  const baseline = { context: {}, async check() {}, async close() {} };
  const names = registeredSceneTools({ mode: 'pole', toronto: [] }, baseline, false, false).map(tool => tool.name);
  assert.deepEqual(names, ['list_skills', 'load_skill', 'inspect_scene']);
  const inspection = inspectAgentTools();
  assert.ok(inspection.tools.length > names.length);
  (inspection.tools[0]!.parameters as Record<string, unknown>).changed = true;
  assert.equal('changed' in inspectAgentTools().tools[0]!.parameters, false);
});

test('actual outgoing provider rounds use inspector schemas and the same instruction builder before and after skill load', async t => {
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'PRIVATE-inspector-fixture' });
  const requests: Record<string, any>[] = [], events: ModelChatEvent[] = [];
  const outputs = [[{ type: 'function_call', namespace: 'scene', name: 'load_skill', call_id: 'load_fixture', arguments: JSON.stringify({ skillId: 'scene-inspection' }) }], []];
  const model = new ProviderModel(auth, async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture-model' }] });
    requests.push(JSON.parse(String(init?.body)));
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: outputs.shift() } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  t.after(() => { model.close(); auth.close(); });
  const catalog = await model.models(new AbortController().signal);
  const call: ModelTurnRequest = { requestId: 'inspector-parity', conversationId: null, generation: catalog.generation, model: 'fixture-model', text: 'Inspect tools', scene: pole };
  await model.turn(call, bound, async event => { events.push(event); }, new AbortController().signal);
  assert.equal(requests.length, 2);
  const inspection = inspectAgentTools();
  for (const [index, request] of requests.entries()) {
    for (const schema of request.tools[0].tools) compareSchema(schema, inspection);
    const toolNames = request.tools[0].tools.map((tool: { name: string }) => tool.name);
    assert.equal(request.instructions, buildAgentInstructions({ mode: 'pole', toolNames, hasImages: false }, new Set(index ? ['scene-inspection'] : [])));
    const actual = events.filter(event => event.kind === 'request-inspection')[index]!;
    assert.equal(JSON.parse(actual.inspection.bodyJson).instructions, request.instructions);
    assert.doesNotMatch(actual.inspection.bodyJson, /PRIVATE-inspector-fixture/u);
  }
  assert.notEqual(requests[0]!.instructions, inspection.instructions.text, 'Unbound preview is not falsely the outgoing scene request');
  assert.match(requests[1]!.instructions, /Runtime skill scene-inspection:/u);
  assert.equal(loadProductSkill('scene-inspection', { mode: 'pole', toolNames: requests[0]!.tools[0].tools.map((tool: { name: string }) => tool.name) }).instructions,
    inspection.skills.find(skill => skill.id === 'scene-inspection')!.instructions.trim());
});

test('GET /chat/tools is local read-only JSON without credential, provider, dataset or geometry access', async t => {
  const root = await mkdtemp(join(tmpdir(), 'spatial-tool-inspector-'));
  const forbidden = () => { assert.fail('Read-only catalog must not access provider authentication'); };
  const auth: ModelAuth = { status: forbidden, credential: forbidden, credentialGeneration: forbidden, onCredentialChange: () => () => {} };
  const routes = createModelChatRoutes(auth, join(root, 'absent-dataset'), async () => { assert.fail('Read-only catalog must not use provider transport'); });
  const server = createServer((request, response) => { void routes.handle(request, response).then(handled => { if (!handled) { response.statusCode = 404; response.end(); } }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { routes.close(); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); });
  const response = await fetch(base + '/chat/tools');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /application\/json/u);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), inspectAgentTools());
  assert.equal((await fetch(base + '/chat/tools?profile=toronto')).status, 400, 'No illustrative profile may imply a live scene');
  assert.equal((await fetch(base + '/chat/tools', { method: 'POST' })).status, 400);
  assert.equal((await fetch(base + '/chat/tools', { headers: { origin: 'https://outside.invalid' } })).status, 403);
  assert.equal(await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(base + '/chat/tools', { headers: { host: 'outside.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  }), 403);
  assert.equal((await fetch(base + '/chat/tools', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  for (let i = 0; i < 20; i++) assert.equal((await fetch(base + '/chat/tools')).status, 200, 'Inspection must not consume provider admission quota');
});
