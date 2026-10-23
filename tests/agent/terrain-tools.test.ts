import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalModelChatEvent, type ModelChatEvent, type ModelTurnRequest, type ModelScene } from '@spatial/contracts';
import { terrainFixture } from '../helpers/terrain-fixture';
import { elevationFixture } from '../helpers/elevation-fixture';
import { bindCloudModelScene } from '../../apps/server/src/agent/cloud-model-scene';
import { registeredSceneTools, ProviderModel, type ModelAuth } from '../../apps/server/src/agent/provider-model';
import { validateModelEvent } from '../../apps/web/src/chat/model-chat-client';

const signal = () => new AbortController().signal;
const polygon = [[0, 0], [3, 0], [3, 2], [0, 2]];
const tool = (name: string, args: unknown, call_id = name) => ({ type: 'function_call', namespace: 'scene', name, call_id, arguments: JSON.stringify(args) });
test('terrain tools are conditional; actual provider dispatch enforces skill readiness and delivers mapped PNG image input', async t => {
  const f = await terrainFixture(t), scene: ModelScene = { mode: 'cloud', toronto: [], cloud: { id: f.id, revision: f.info.revision, frameId: f.info.descriptor.frameId, localOrigin: [0, 0, 0], points: [] } };
  const bound = await bindCloudModelScene(scene, { [f.id]: f.root }, signal()); t.after(() => bound.close());
  assert(bound.analyzeTerrain);
  const missing = await elevationFixture(t), missingScene: ModelScene = { ...scene, cloud: { ...scene.cloud!, revision: missing.info.revision } };
  const without = await bindCloudModelScene(missingScene, { [missing.id]: missing.root }, signal()); t.after(() => without.close());
  assert(!registeredSceneTools(missingScene, without, false, false).some(t => t.name === 'terrain_image'));
  assert(registeredSceneTools(missingScene, without, false, false).some(t => t.name === 'query_elevation'));
  const auth: ModelAuth = { status: () => ({ mode: 'api-key', authenticated: true, ready: true, planUsageEnabled: false, selectedAccount: null, accounts: [] }), credentialGeneration: () => 'terrain-generation', onCredentialChange: () => () => {}, credential: async () => ({ mode: 'api-key', bearer: 'fixture-only', baseUrl: 'https://unused.invalid', constraints: { billing: 'api-key', responsesOnly: false } }) };
  let round = 0; const requests: Record<string, any>[] = [];
  const provider = new ProviderModel(auth, async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'terrain-fixture' }] });
    const body = JSON.parse(String(init?.body)); requests.push(body);
    const output = round++ === 0 ? [tool('load_skill', { skillId: 'elevation-models' }), tool('terrain_image', { polygon, layer: 'dtm', maxSize: 128 }, 'early')]
      : round === 2 ? [tool('query_terrain_region', { polygon }), tool('terrain_profile', { start: [.1, .1], end: [2.1, .1], samples: 3 }), tool('filter_terrain_regions', { polygon, maxSlopeDegrees: 5, minArea: 1, maxHeightAboveGround: null, maxRegions: 4 }), tool('terrain_image', { polygon, layer: 'dtm', maxSize: 128 })]
      : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Ground has partial support; no slope regions are supported.' }] }];
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  t.after(() => provider.close()); await provider.models(signal());
  const request: ModelTurnRequest = { requestId: 'terrain-request', conversationId: null, generation: 'terrain-generation', model: 'terrain-fixture', text: 'Inspect regional terrain.', scene };
  const events: ModelChatEvent[] = [];
  await provider.turn(request, bound, async event => { canonicalModelChatEvent(event); validateModelEvent(event, request); events.push(event); }, signal());
  const results = events.filter((e): e is Extract<ModelChatEvent, { kind: 'tool' }> => e.kind === 'tool');
  assert.equal((results.find(e => e.name === 'terrain_image')?.context as { kind: string }).kind, 'runtime-skill-required');
  assert(results.some(e => e.name === 'query_terrain_region' && (e.context as { kind: string }).kind === 'terrain-analysis'));
  const imageContext = results.filter(e => e.name === 'terrain_image').at(-1)!.context as { image: { sha256: string; dataUrl?: string }; result: { mapping: unknown } };
  assert(imageContext.result.mapping); assert.match(imageContext.image.sha256, /^[a-f0-9]{64}$/); assert.equal(imageContext.image.dataUrl, undefined);
  assert(requests[2].input.some((item: any) => item.role === 'user' && Array.isArray(item.content) && item.content.some((c: any) => c.type === 'input_image' && c.image_url.startsWith('data:image/png;base64,'))));
  assert(!requests[2].tools[0].tools.some((t: any) => t.name === 'resolve_visual_pixel'), 'Terrain images grant no browser pixel provenance');
  assert(events.some(e => e.kind === 'done'));
});
