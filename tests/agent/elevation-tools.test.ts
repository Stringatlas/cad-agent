import { validateModelEvent } from '../../apps/web/src/chat/model-chat-client';
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalModelChatEvent, type ModelChatEvent, type ModelScene, type ModelTurnRequest } from '@spatial/contracts';
import { elevationFixture } from '../helpers/elevation-fixture';
import { bindCloudModelScene } from '../../apps/server/src/agent/cloud-model-scene';
import { listProductSkills } from '../../apps/server/src/agent/product-agent-skills';
import { registeredSceneTools, ProviderModel, type ModelAuth } from '../../apps/server/src/agent/provider-model';

const signal = () => new AbortController().signal;
const call = (name: string, args: unknown, id: string) => ({ type: 'function_call', namespace: 'scene', name, call_id: id, arguments: JSON.stringify(args) });

test('elevation capability/skill appear only with valid scene-bound raster artifacts', async t => {
  const f = await elevationFixture(t), scene: ModelScene = { mode: 'cloud', toronto: [], cloud: { id: f.id, revision: f.info.revision, frameId: f.info.descriptor.frameId, localOrigin: [0, 0, 0], points: [] } };
  const bound = await bindCloudModelScene(scene, { [f.id]: f.root }, signal()); t.after(() => bound.close());
  const names = registeredSceneTools(scene, bound, false, false).map(tool => tool.name);
  assert(names.includes('query_elevation')); assert(!names.includes('propose_cad_box'));
  assert(listProductSkills({ mode: 'cloud', toolNames: names }).some(skill => skill.id === 'elevation-models'));
  const missing = await elevationFixture(t, false), missingScene: ModelScene = { ...scene, cloud: { ...scene.cloud!, revision: missing.info.revision } };
  const without = await bindCloudModelScene(missingScene, { [f.id]: missing.root }, signal()); t.after(() => without.close());
  const unavailable = registeredSceneTools(missingScene, without, false, false).map(tool => tool.name);
  assert(!unavailable.includes('query_elevation')); assert(unavailable.includes('query_points'));
  assert(!listProductSkills({ mode: 'cloud', toolNames: unavailable }).some(skill => skill.id === 'elevation-models'));
  await assert.rejects(bound.queryElevation!({ x: NaN, y: 0 }, signal()), /coordinates/);
});

test('actual provider dispatch waits for elevation skill instructions, then returns checked GeoTIFF measurements', async t => {
  const f = await elevationFixture(t), scene: ModelScene = { mode: 'cloud', toronto: [], cloud: { id: f.id, revision: f.info.revision, frameId: f.info.descriptor.frameId, localOrigin: [0, 0, 0], points: [] } };
  const bound = await bindCloudModelScene(scene, { [f.id]: f.root }, signal()); t.after(() => bound.close());
  const auth: ModelAuth = {
    status: () => ({ mode: 'api-key', authenticated: true, ready: true, planUsageEnabled: false, selectedAccount: null, accounts: [] }),
    credentialGeneration: () => 'elevation-generation', onCredentialChange: () => () => {},
    credential: async () => ({ mode: 'api-key', bearer: 'fixture-not-live', baseUrl: 'https://unused.invalid', constraints: { billing: 'api-key', responsesOnly: false } }),
  };
  const requests: Record<string, unknown>[] = [];
  let round = 0;
  const provider = new ProviderModel(auth, async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'elevation-fixture-model' }] });
    const body = JSON.parse(String(init?.body)); requests.push(body);
    const output = round++ === 0 ? [call('load_skill', { skillId: 'elevation-models' }, 'load_elevation'), call('query_elevation', { x: .1, y: .1 }, 'too_early')]
      : round === 2 ? [call('query_elevation', { x: .1, y: .1 }, 'measure_elevation')]
      : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Ground 11 m, surface 20 m; observed cell difference 9 m.' }] }];
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  t.after(() => provider.close()); await provider.models(signal());
  const events: ModelChatEvent[] = [];
  const request: ModelTurnRequest = { requestId: 'elevation-request', conversationId: null, generation: 'elevation-generation', model: 'elevation-fixture-model', text: 'Query terrain and surface at XY 0.1, 0.1.', scene };
  await provider.turn(request, bound, async event => { canonicalModelChatEvent(event); validateModelEvent(event, request); events.push(event); }, signal());
  assert(requests.every(body => (body.tools as { tools: { name: string }[] }[])[0].tools.some(tool => tool.name === 'query_elevation')));
  assert(String(requests[1].instructions).includes('Runtime skill elevation-models:'));
  assert(String(requests[1].instructions).includes('not an individual object height'));
  const measured = events.filter((event): event is Extract<ModelChatEvent, { kind: 'tool' }> => event.kind === 'tool' && event.name === 'query_elevation');
  assert.equal(measured.length, 2);
  assert.equal((measured[0].context as { kind: string }).kind, 'runtime-skill-required');
  const result = measured[1].context as { dtm: number; dsm: number; heightAboveGround: number; sourceRevision: string };
  assert.equal(result.dtm, 11); assert.equal(result.dsm, 20); assert.equal(result.heightAboveGround, 9); assert.equal(result.sourceRevision, f.info.revision);
  assert(events.some(event => event.kind === 'done'));
});
