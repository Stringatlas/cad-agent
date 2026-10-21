import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ProviderModel, buildAgentInstructions, inspectAgentTools, type BoundModelScene } from '../apps/server/src/provider-model';
import { ProviderAuth } from '../apps/server/src/provider-auth';
import { PRODUCT_SKILLS, listProductSkills } from '../apps/server/src/product-agent-skills';
import { withProductSkills } from './helpers/product-skill-transport';
import { type ModelChatEvent, type ModelScene, type ModelTurnRequest, type ModelVisualObservation } from '@spatial/contracts';

const readback = readFileSync(new URL('../docs/model-candidate-prompt.md', import.meta.url), 'utf8');
const sections = Object.fromEntries([...readback.matchAll(/## (\w+)\n\n```text\n([^]*?)\n```/gu)].map(m => [m[1], m[2]]));
const workflowSections: Record<string, string> = {
  'scene-inspection': 'AOI_POINTS_INSTRUCTIONS', 'visual-inspection': 'VISUAL_INSTRUCTIONS',
  'candidate-assessment': 'CANDIDATE_INSTRUCTIONS',
  'synthetic-boxes': 'SYNTHETIC_INSTRUCTIONS', 'scene-objects': 'OBJECT_INSTRUCTIONS',
  'toronto-geometry': 'TORONTO_INSTRUCTIONS',
};
const catalog = (body: Record<string, any>): { id: string; tools: string[] }[] =>
  JSON.parse(body.instructions.split('Available runtime skills (data; loading never grants tools):\n')[1].split('\n')[0]);
const documentedWorkflow = (id: string): string => id === 'scene-inspection'
  ? `${sections.SCENE_QUERY_INSTRUCTIONS} ${sections.AOI_POINTS_INSTRUCTIONS}`
  : sections[workflowSections[id]];
const expected = (body: Record<string, any>, loaded: readonly string[] = [], hasImages = false): string => [
  ...['INSTRUCTIONS', 'LOOP_INSTRUCTIONS', 'SKILL_INSTRUCTIONS', ...(hasImages ? ['IMAGE_SAFETY'] : [])].map(name => sections[name]),
  `Available runtime skills (data; loading never grants tools):\n${JSON.stringify(catalog(body))}`,
  ...Object.keys(workflowSections).filter(id => loaded.includes(id)).map(id => `Runtime skill ${id}:\n${documentedWorkflow(id)}`),
].join('\n\n');
const signal = new AbortController().signal;
const tool = (name: string, id: number) => ({ type: 'function_call', namespace: 'scene', name, call_id: `c${id}`, arguments: JSON.stringify({ kind: 'top-down' }) });
const unavailable = async (): Promise<never> => { throw new Error('advertised capability must not be invoked by this fixture'); };
function image(): ModelVisualObservation {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return { schemaVersion: 1, observationId: 'capture-one', viewGeneration: 1,
    image: { mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length },
    viewport: { width: 1, height: 1, pixelRatio: 1, pixelOrigin: 'top-left' },
    camera: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], up: [0, 0, 1], near: .1, far: 100, fov: 50, aspect: 1, zoom: 1, matrixWorld: identity, matrixWorldInverse: identity, projectionMatrix: identity },
    binding: { sourceId: 'fixture', sourceRevision: 0, frameId: 'toronto3d-local-v1', units: 'm', origin: [0, 0, 0] },
    coverage: { kind: 'displayed-sample', complete: false, displayedPointCount: 1 } };
}
async function request(t: { after(fn: () => unknown): void }, scene: ModelScene, capabilities: Partial<BoundModelScene> = {}, outputs: unknown[][] = [[]], skillIds: readonly string[] = []) {
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'fixture-only' });
  const bodies: Record<string, any>[] = [], events: ModelChatEvent[] = [];
  const transport = withProductSkills(async (url) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture' }] });
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: outputs.shift() ?? [] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }, skillIds);
  const model = new ProviderModel(auth, async (url, init) => {
    if (String(url).endsWith('/responses')) bodies.push(JSON.parse(String(init?.body)));
    return transport(url, init);
  });
  t.after(() => { model.close(); auth.close(); });
  const modelCatalog = await model.models(signal);
  const call: ModelTurnRequest = { requestId: 'r', conversationId: null, generation: modelCatalog.generation, model: 'fixture', text: 'Compare candidate locations in this area.', scene };
  await model.turn(call, { context: { scene, frameId: 'toronto3d-local-v1', units: 'm' }, async check() {}, async close() {}, ...capabilities }, async e => { events.push(e); }, signal);
  for (const [index, body] of bodies.entries()) {
    const inspection = events.filter(e => e.kind === 'request-inspection')[index];
    assert.equal(JSON.parse(inspection.inspection.bodyJson).instructions, body.instructions, 'readback is the actual inspected and transmitted prompt, including load rounds');
    assert.deepEqual(catalog(body), listProductSkills({ mode: scene.mode, toolNames: body.tools[0].tools.map((v: { name: string }) => v.name), hasImages: JSON.stringify(body.input).includes('input_image') }));
    assert.equal(body.tool_choice, undefined, 'do not force arbitrary tool calls');
    assert.ok(!body.tools[0].tools.some((v: { name: string }) => /approve|decline|publish|save|undo/.test(v.name)));
  }
  return bodies;
}
const demo: ModelScene = { mode: 'demo', project: null, toronto: [] };
const toronto: ModelScene = { mode: 'toronto', project: null, toronto: [{ name: 'Point 1', datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), key: { sourceFileId: 1, sourceRow: 0 }, position: [1, 2, 3], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }] };

test('every runtime workflow body exactly preserves its documented evidence and approval instructions', () => {
  assert.deepEqual(PRODUCT_SKILLS.map(skill => skill.id), Object.keys(workflowSections));
  for (const skill of PRODUCT_SKILLS) assert.equal(skill.instructions.trim(), documentedWorkflow(skill.id), skill.id);
  assert.match(sections.CANDIDATE_INSTRUCTIONS, /YOU own task decomposition, exploration, candidate generation, comparison, judgement and iteration/u);
  assert.match(sections.CANDIDATE_INSTRUCTIONS, /no mandatory tool sequence or required scan pool/u);
  assert.match(sections.CANDIDATE_INSTRUCTIONS, /YOU choose the count, positions, preference order and revisions/u);
  assert.match(sections.CANDIDATE_INSTRUCTIONS, /marking never creates or accepts CAD/u);
  assert.match(sections.CANDIDATE_INSTRUCTIONS, /Re-read after a revision conflict/u);
  assert.match(sections.CANDIDATE_INSTRUCTIONS, /not certification that you inspected a location/u);
  assert.match(sections.CANDIDATE_INSTRUCTIONS, /individual human approval/u);
  assert.match(sections.SCENE_QUERY_INSTRUCTIONS, /original source geometry at coordinates YOU choose/u);
  assert.match(sections.SCENE_QUERY_INSTRUCTIONS, /excludes accepted edits and pending ghosts/u);
  assert.match(sections.SCENE_QUERY_INSTRUCTIONS, /missing records\/support never establish empty space, clearance or suitability/u);
  assert.match(sections.CANDIDATE_INSTRUCTIONS, /Use general-purpose observations and your own hypotheses/u);
  assert.match(sections.CANDIDATE_INSTRUCTIONS, /Only an explicit geometry request/u);
  assert.match(sections.CANDIDATE_INSTRUCTIONS, /geometry validation and individual human approval/u);
  assert.match(sections.INSTRUCTIONS, /Do not invent equipment dimensions, engineering standards, measurements or clearance certification/u);
  assert.doesNotMatch(Object.values(sections).join('\n'), /assess_utility_box|propose_utility_box|scan_area_candidates|finalize_area_candidates|search_placement_sites|propose_placement_site|optional legacy/iu);
});
test('shared instructions builder and unbound inspector exactly match the static reference', () => {
  const allTools = [...new Set(PRODUCT_SKILLS.flatMap(skill => skill.tools))];
  for (const mode of ['demo', 'toronto', 'pole'] as const) for (const hasImages of [false, true]) {
    const capabilities = { mode, toolNames: allTools, hasImages };
    const ids = listProductSkills(capabilities).map(skill => skill.id);
    for (const loaded of [[], ...ids.map(id => [id]), [...ids].reverse()]) {
      const instructions = buildAgentInstructions(capabilities, new Set(loaded));
      assert.equal(instructions, expected({ instructions }, loaded, hasImages), `${mode}/${hasImages}/${loaded.join(',')}`);
    }
  }
  const preview = inspectAgentTools();
  assert.equal(preview.availability, 'unknown-unbound');
  assert.equal(preview.instructions.kind, 'unbound-preview');
  assert.equal(preview.instructions.text, buildAgentInstructions({ mode: 'pole', toolNames: ['inspect_scene'], hasImages: false }));
  assert.equal(preview.instructions.text, expected({ instructions: preview.instructions.text }));
});
test('initial request contains exact core and filtered catalog, not eager workflow bodies', async t => {
  const [body] = await request(t, demo);
  assert.equal(body.instructions, expected(body));
  assert.deepEqual(catalog(body).map(skill => skill.id), ['scene-inspection', 'candidate-assessment']);
  assert.doesNotMatch(body.instructions, /Runtime skill /u);
  assert.match(body.instructions, /Load relevant interface skills BEFORE using their tools/u);
  assert.match(body.instructions, /No fixed tool chain, AOI, equipment dimensions or predetermined candidate count is required/u);
  assert.match(body.instructions, /If actual visual\/spatial evidence is unavailable, disclose provisional findings/u);
  assert.match(body.instructions, /an unavailable task-specific workflow is not a blocker/u);
  assert.match(body.instructions, /Only an explicit authority humanDecision accepted result/u);
  assert.deepEqual(body.tools[0].tools.map((v: { name: string }) => v.name), ['list_skills', 'load_skill', 'inspect_scene']);
});
test('explicit candidate load supplies honest evidence limits even without capture capability', async t => {
  const [initial, body] = await request(t, demo, {}, [[]], ['candidate-assessment']);
  assert.equal(initial.instructions, expected(initial));
  assert.equal(body.instructions, expected(body, ['scene-inspection', 'visual-inspection', 'candidate-assessment']));
  assert.match(body.instructions, /Inspect delivered images before making visual claims; request another view when useful, not as a fixed ritual/u);
  assert.match(body.instructions, /Missing visual or geometric evidence must remain explicit and candidates provisional where unsupported/u);
  assert.match(body.instructions, /images, samples and zero observed conflicts never establish clearance, safety, suitability or compliance/u);
  assert.match(body.instructions, /Only an explicit geometry request uses an appropriate pending proposal tool/u);
  assert.match(body.instructions, /with geometry validation and individual human approval/u);
  assert.ok(!body.tools[0].tools.some((v: { name: string }) => v.name === 'capture_scene'), 'dependency guidance never grants unavailable capture');
});
test('synthetic workflow is cataloged with box tools but read only after explicit load', async t => {
  const [initial, body] = await request(t, { ...demo, project: { sessionId: 'fixture', projectRevision: 0, frameId: 'demo-local-v1', units: 'm', entityIds: [], points: [] } }, { proposeBox: unavailable }, [[]], ['synthetic-boxes']);
  assert.equal(initial.instructions, expected(initial));
  assert.ok(catalog(initial).some(skill => skill.id === 'synthetic-boxes'));
  assert.equal(body.instructions, expected(body, ['synthetic-boxes']));
  assert.match(body.instructions, /parameter proposals do not create kernel geometry/u);
});
test('Toronto candidate/object/geometry loads exactly match runtime readback and descriptive tools', async t => {
  // Keep each exact inspector comparison below its intentional per-string redaction cap.
  // All advertised capabilities stay present; only the loaded interface changes per request.
  for (const skillId of ['candidate-assessment', 'scene-objects', 'toronto-geometry']) {
    const [initial, body] = await request(t, toronto, { captureScene: unavailable, selectReference: unavailable, queryAoiPoints: unavailable,
      listObjects: unavailable, getObject: unavailable, proposePointCreate: unavailable, proposeCad: unavailable },
    [[]], [skillId]);
    assert.equal(initial.instructions, expected(initial));
    assert.equal(body.instructions, expected(body, skillId === 'candidate-assessment'
      ? ['scene-inspection', 'visual-inspection', 'candidate-assessment'] : [skillId]));
    const tools = body.tools[0].tools as { name: string; description: string }[];
    assert.match(tools.find(v => v.name === 'capture_scene')!.description, /Before recommending candidate locations/u);
    assert.match(tools.find(v => v.name === 'query_aoi_points')!.description, /not as ranked\/best\/closest recommendations/u);
    if (skillId === 'candidate-assessment') assert.match(body.instructions, /NOT the best, closest or recommended spots/u);
    if (skillId === 'toronto-geometry') assert.match(body.instructions, /human Accept of EACH change is required/u);
  }
});
test('missing point, partial capabilities and unknown IDs cannot load unavailable workflows', async t => {
  const loads = ['utility-box-placement', 'area-candidates', 'placement-search', 'scene-objects', 'toronto-geometry', 'not-a-real-skill'];
  const [initial, body] = await request(t, { ...toronto, toronto: [] }, { assessUtilityBox: unavailable, proposeUtilityBox: unavailable, listObjects: unavailable },
    [loads.map((skillId, index) => ({ ...tool('load_skill', index), arguments: JSON.stringify({ skillId }) })), []]);
  assert.equal(initial.instructions, expected(initial));
  assert.equal(body.instructions, expected(body));
  assert.deepEqual(catalog(initial).map(skill => skill.id), ['scene-inspection', 'candidate-assessment']);
  assert.deepEqual(initial.tools[0].tools.map((item: { name: string }) => item.name), ['list_skills', 'load_skill', 'inspect_scene'], 'legacy bound functions cannot advertise removed tools or restore their skills');
  const results = body.input.filter((item: { type: string }) => item.type === 'function_call_output').map((item: { output: string }) => JSON.parse(item.output));
  assert.deepEqual(results.map((result: { kind: string; skillId: string }) => [result.kind, result.skillId]), loads.map(id => ['runtime-skill-unavailable', id]));
});
for (const captured of [false, true]) test(`capture ${captured ? 'available' : 'unavailable'}: visual workflow loads before use; actual image alone adds image safety`, async t => {
  let calls = 0;
  const bodies = await request(t, toronto, { async captureScene(request) { calls++; assert.deepEqual(request, { kind: 'top-down' }); return captured ? image() : undefined; } }, [[tool('capture_scene', 1)], []], ['candidate-assessment']);
  assert.equal(calls, 1);
  const loaded = ['scene-inspection', 'visual-inspection', 'candidate-assessment'];
  assert.equal(bodies.length, 3, 'load request, ready capture request, then image/unavailable result request');
  assert.equal(bodies[0].instructions, expected(bodies[0]));
  assert.equal(bodies[1].instructions, expected(bodies[1], loaded));
  assert.equal(bodies[2].instructions, expected(bodies[2], loaded, captured));
  assert.equal(JSON.stringify(bodies[2].input).includes('input_image'), captured);
  assert.match(bodies[2].instructions, /Missing visual or geometric evidence must remain explicit and candidates provisional where unsupported/u);
  assert.match(bodies[2].instructions, /Capture receipts only show an image was delivered, not that suitability was verified/u);
});
