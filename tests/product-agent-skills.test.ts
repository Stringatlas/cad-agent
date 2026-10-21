import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODEL_CHAT_LIMITS, MODEL_INSPECTION_LIMITS, type ModelChatEvent, type ModelScene, type ModelTurnRequest } from '@spatial/contracts';
import { PRODUCT_SKILLS, listProductSkills, loadProductSkill } from '../apps/server/src/product-agent-skills';
import { ProviderModel, type ModelAuth, type BoundModelScene } from '../apps/server/src/provider-model';
import { bindModelScene } from '../apps/server/src/model-scene';

const signal = () => new AbortController().signal;
const ids = (capabilities: Parameters<typeof listProductSkills>[0]) => listProductSkills(capabilities).map(skill => skill.id);
const tool = (name: string, args: unknown = {}, callId = `call_${name}`) => ({
  type: 'function_call', namespace: 'scene', name, call_id: callId, arguments: JSON.stringify(args),
});
const load = (skillId: string, callId = `load_${skillId}`) => tool('load_skill', { skillId }, callId);
const sse = (output: unknown[]) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`,
  { headers: { 'content-type': 'text/event-stream' } });
const advertised = (body: Record<string, unknown>) => (body.tools as { tools: { name: string }[] }[])[0]!.tools.map(tool => tool.name);
const toolEvents = (events: ModelChatEvent[]) => events.filter((event): event is Extract<ModelChatEvent, { kind: 'tool' }> => event.kind === 'tool');
const contexts = (events: ModelChatEvent[], name: string) => toolEvents(events).filter(event => event.name === name).map(event => event.context);
const outputFor = (body: Record<string, unknown>, callId: string): unknown => {
  const output = (body.input as { type?: string; call_id?: string; output?: string }[]).find(item => item.type === 'function_call_output' && item.call_id === callId);
  assert.ok(output?.output, `Missing output for ${callId}`);
  return JSON.parse(output.output);
};

async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), 'spatial-product-skills-'));
  const auth: ModelAuth = {
    status: () => ({ mode: 'api-key', authenticated: true, ready: true, planUsageEnabled: false, selectedAccount: null, accounts: [] }),
    credentialGeneration: () => 'skill-generation', onCredentialChange: () => () => {},
    credential: async () => ({ mode: 'api-key', bearer: 'synthetic-skills-not-live', baseUrl: 'https://unused.invalid', constraints: { billing: 'api-key', responsesOnly: false } }),
  };
  const requests: Record<string, unknown>[] = [];
  const outputs: unknown[][] = [];
  let beforeResponse: (() => void) | undefined;
  // Exercise the actual ProviderModel loop directly: no auto-loading test transport.
  const model = new ProviderModel(auth, async (url, init) => {
    assert.match(String(url), /^https:\/\/api\.openai\.com\/v1\/(models|responses)$/u);
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'skill-model' }] });
    requests.push(JSON.parse(String(init?.body)));
    beforeResponse?.();
    const output = outputs.shift(); assert.ok(output, 'Unexpected provider round');
    return sse(output);
  });
  const scene: ModelScene = { mode: 'pole', toronto: [] };
  const bound = await bindModelScene(scene, root, signal());
  t.after(async () => { model.close(); await bound.close(); await rm(root, { recursive: true, force: true }); });
  assert.equal((await model.models(signal())).ready, true);
  const call = (extra: Partial<ModelTurnRequest> = {}): ModelTurnRequest => ({ requestId: 'skill-request', conversationId: null,
    generation: 'skill-generation', model: 'skill-model', text: 'Propose one box', scene, ...extra });
  const run = async (extra: Partial<ModelTurnRequest> = {}, binding: BoundModelScene = bound, events: ModelChatEvent[] = []) => {
    await model.turn(call(extra), binding, async event => { events.push(event); }, signal());
    return events;
  };
  return { model, scene, bound, requests, outputs, call, run, beforeResponse(fn: () => void) { beforeResponse = fn; } };
}

test('one skill-loading round preserves the complete workflow budget and completion round', async t => {
  const f = await fixture(t);
  assert.equal(MODEL_CHAT_LIMITS.toolCalls, 64);
  assert.equal(MODEL_CHAT_LIMITS.skillCalls, 16);
  assert.equal(MODEL_INSPECTION_LIMITS.rounds, MODEL_CHAT_LIMITS.toolCalls + MODEL_CHAT_LIMITS.skillCalls + 1);
  f.outputs.push([load('scene-inspection')],
    ...Array.from({ length: MODEL_CHAT_LIMITS.toolCalls }, (_, index) => [tool('inspect_scene', {}, `inspect_${index}`)]), []);
  const events = await f.run();
  assert.equal(contexts(events, 'load_skill').length, 1);
  assert.equal(contexts(events, 'inspect_scene').length, MODEL_CHAT_LIMITS.toolCalls);
  assert.equal(f.requests.length, MODEL_CHAT_LIMITS.toolCalls + 2, 'One skill request plus the full workflow budget and completion');
  assert.equal(events.at(-1)?.kind, 'done');
  assert.equal(f.outputs.length, 0);
});

test('complete independent skill and workflow budgets fit across every inspection round', async t => {
  const f = await fixture(t);
  f.outputs.push(...Array.from({ length: MODEL_CHAT_LIMITS.skillCalls }, (_, index) => [index % 2 === 0
    ? tool('list_skills', {}, `list_${index}`) : load('scene-inspection', `load_${index}`)]),
    ...Array.from({ length: MODEL_CHAT_LIMITS.toolCalls }, (_, index) => [tool('inspect_scene', {}, `inspect_${index}`)]), []);
  const events = await f.run();
  assert.equal(contexts(events, 'list_skills').length, Math.ceil(MODEL_CHAT_LIMITS.skillCalls / 2));
  assert.equal(contexts(events, 'load_skill').length, Math.floor(MODEL_CHAT_LIMITS.skillCalls / 2));
  assert.equal(contexts(events, 'inspect_scene').length, MODEL_CHAT_LIMITS.toolCalls);
  assert.equal(f.requests.length, MODEL_INSPECTION_LIMITS.rounds);
  const inspections = events.filter(event => event.kind === 'request-inspection');
  assert.deepEqual(inspections.map(event => event.inspection.round), Array.from({ length: MODEL_INSPECTION_LIMITS.rounds }, (_, index) => index + 1));
  assert.equal(events.at(-1)?.kind, 'done');
  assert.equal(f.outputs.length, 0);
});

test('the first workflow call beyond the complete budget is rejected with spare skill budget', async t => {
  const f = await fixture(t);
  f.outputs.push([load('scene-inspection')],
    ...Array.from({ length: MODEL_CHAT_LIMITS.toolCalls + 1 }, (_, index) => [tool('inspect_scene', {}, `inspect_${index}`)]), []);
  const events: ModelChatEvent[] = [];
  await assert.rejects(f.run({}, f.bound, events), { code: 'tool-limit' });
  assert.equal(contexts(events, 'load_skill').length, 1);
  assert.equal(contexts(events, 'inspect_scene').length, MODEL_CHAT_LIMITS.toolCalls);
  assert.equal(f.requests.length, MODEL_CHAT_LIMITS.toolCalls + 2);
  assert.equal(events.some(event => event.kind === 'done'), false);
  assert.equal(f.outputs.length, 1, 'Rejected workflow call must not reach completion request');
});

test('the first skill call beyond the complete budget is rejected with untouched workflow budget', async t => {
  const f = await fixture(t);
  f.outputs.push(...Array.from({ length: MODEL_CHAT_LIMITS.skillCalls + 1 }, (_, index) => [index % 2 === 0
    ? tool('list_skills', {}, `list_${index}`) : load('scene-inspection', `load_${index}`)]), []);
  const events: ModelChatEvent[] = [];
  await assert.rejects(f.run({}, f.bound, events), { code: 'tool-limit' });
  assert.equal(contexts(events, 'list_skills').length, Math.ceil(MODEL_CHAT_LIMITS.skillCalls / 2));
  assert.equal(contexts(events, 'load_skill').length, Math.floor(MODEL_CHAT_LIMITS.skillCalls / 2));
  assert.equal(contexts(events, 'inspect_scene').length, 0);
  assert.equal(f.requests.length, MODEL_CHAT_LIMITS.skillCalls + 1);
  assert.equal(events.some(event => event.kind === 'done'), false);
  assert.equal(f.outputs.length, 1, 'Rejected lifecycle call must not reach completion request');
});

test('removed decision workflows stay absent before and after Toronto geometry loading', async t => {
  const f = await fixture(t);
  const scene: ModelScene = { mode: 'toronto', toronto: [{ name: 'Point 1', datasetId: 'toronto3d',
    artifactRevision: 'a'.repeat(64), key: { sourceFileId: 1, sourceRow: 0 }, position: [1, 1, 0],
    frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }] };
  const binding: BoundModelScene = { context: {}, async check() {}, async close() {},
    async proposeCad() { assert.fail('Prompt-invariant test must not dispatch geometry'); },
    async assessUtilityBox() { assert.fail('Prompt-invariant test must not dispatch assessment'); },
    async proposeUtilityBox() { assert.fail('Prompt-invariant test must not dispatch utility proposals'); },
    async proposePlacementSite() { assert.fail('Prompt-invariant test must not dispatch shortlisted proposals'); } };
  f.outputs.push([load('toronto-geometry')], []);
  const events = await f.run({ scene, text: 'Place a utility box at Point 1' }, binding);
  assert.equal(f.requests.length, 2);
  const geometryInstructions = PRODUCT_SKILLS.find(skill => skill.id === 'toronto-geometry')!.instructions.trim();
  assert.equal(String(f.requests[0]!.instructions).includes(geometryInstructions), false);
  assert.ok(String(f.requests[1]!.instructions).includes(`Runtime skill toronto-geometry:\n${geometryInstructions}`));
  assert.equal((contexts(events, 'load_skill')[0] as { kind: string }).kind, 'runtime-skill');
  for (const request of f.requests) {
    const names = advertised(request);
    for (const name of ['propose_cad_box', 'propose_cad_cylinder']) assert.ok(names.includes(name));
    for (const name of ['assess_utility_box', 'propose_utility_box', 'propose_placement_site', 'search_placement_sites', 'scan_area_candidates', 'finalize_area_candidates']) {
      assert.equal(names.includes(name), false);
      assert.equal(String(request.instructions).includes(name), false);
    }
    assert.match(String(request.instructions), /Geometry proposals must retain kernel validation where available and individual human approval/u);
  }
});

test('catalog has unique stable IDs and immutable workflow metadata, not development skills', () => {
  assert.equal(PRODUCT_SKILLS.length, 5);
  assert.equal(new Set(PRODUCT_SKILLS.map(skill => skill.id)).size, PRODUCT_SKILLS.length);
  assert.ok(Object.isFrozen(PRODUCT_SKILLS));
  for (const skill of PRODUCT_SKILLS) {
    assert.ok(skill.name && skill.description && skill.instructions.trim());
    assert.ok(Object.isFrozen(skill) && Object.isFrozen(skill.tools) && Object.isFrozen(skill.dependencies) && Object.isFrozen(skill.modes));
    for (const dependency of skill.dependencies) assert.ok(PRODUCT_SKILLS.some(other => other.id === dependency));
  }
});

test('discovery filters by mode and exact advertised tools, and never exposes workflow bodies', () => {
  assert.deepEqual(ids({ mode: 'pole', toolNames: ['inspect_scene'] }), ['scene-inspection', 'candidate-assessment']);
  const capabilities = { mode: 'pole' as const, toolNames: ['inspect_scene', 'scan_area_candidates', 'propose_cad_box'] };
  assert.deepEqual(ids(capabilities), ['scene-inspection', 'candidate-assessment']);
  const catalog = listProductSkills(capabilities);
  for (const summary of catalog) {
    assert.deepEqual(Object.keys(summary).sort(), ['dependencies', 'description', 'id', 'name', 'tools']);
    assert.equal('instructions' in summary, false);
    assert.ok(summary.tools.every(name => capabilities.toolNames.includes(name)));
  }
  assert.equal(ids({ mode: 'toronto', toolNames: ['scan_area_candidates'] }).includes('area-candidates' as never), false);
});

test('unknown and unavailable IDs fail closed; historical images permit visual guidance, not tools', () => {
  const capabilities = { mode: 'pole' as const, toolNames: ['inspect_scene'] };
  for (const id of ['', 'SKILL.md', '__proto__', 'not-a-skill']) assert.throws(() => loadProductSkill(id, capabilities), /Unknown product skill/u);
  for (const id of ['visual-inspection']) assert.throws(() => loadProductSkill(id, capabilities), /Unavailable product skill/u);
  for (const id of ['area-candidates', 'utility-box-placement', 'placement-search']) assert.throws(() => loadProductSkill(id, capabilities), /Unknown product skill/u);
  const historical = { ...capabilities, hasImages: true };
  assert.ok(ids(historical).includes('visual-inspection'));
  assert.deepEqual(loadProductSkill('visual-inspection', historical).tools, []);
  assert.throws(() => loadProductSkill('area-candidates', { mode: 'pole', toolNames: ['scan_area_candidates'] }), /Unknown/u);
});

test('dependency loading is dependency-first and deduplicated, with exact instructions and no capability expansion', () => {
  const capabilities = { mode: 'toronto' as const, toolNames: ['set_scene_marks', 'inspect_scene'] };
  const loaded = loadProductSkill('candidate-assessment', capabilities);
  assert.deepEqual(loaded.loadedSkillIds, ['scene-inspection', 'visual-inspection', 'candidate-assessment']);
  assert.deepEqual(loaded.tools, ['inspect_scene', 'set_scene_marks']);
  assert.equal(loaded.instructions, loaded.loadedSkillIds.map(id => PRODUCT_SKILLS.find(skill => skill.id === id)!.instructions.trim()).join('\n\n'));
  // Unavailable dependencies still teach safe fallback, but do not advertise capture/finalize.
  assert.throws(() => loadProductSkill('visual-inspection', capabilities), /Unavailable/u);
  assert.match(loaded.instructions, /Missing visual or geometric evidence must remain explicit/u);
  assert.equal(loaded.tools.includes('capture_scene'), false);
  assert.equal(loaded.tools.includes('finalize_area_candidates'), false);
});

test('general scene skills own composable measurements and arbitrary hypotheses without loading legacy scans', () => {
  const capabilities = { mode: 'toronto' as const, toolNames: ['inspect_scene', 'query_points', 'ground_elevation',
    'capture_scene', 'get_scene_marks', 'set_scene_marks', 'scan_area_candidates', 'finalize_area_candidates', 'search_placement_sites'] };
  const loaded = loadProductSkill('candidate-assessment', capabilities);
  assert.deepEqual(loaded.loadedSkillIds, ['scene-inspection', 'visual-inspection', 'candidate-assessment']);
  assert.deepEqual(loaded.tools, ['inspect_scene', 'query_points', 'ground_elevation', 'capture_scene', 'set_scene_marks', 'get_scene_marks']);
  assert.equal(loaded.tools.includes('scan_area_candidates'), false);
  assert.equal(loaded.tools.includes('search_placement_sites'), false);
  const inspection = PRODUCT_SKILLS.find(skill => skill.id === 'scene-inspection')!;
  assert.ok(inspection.tools.includes('query_points') && inspection.tools.includes('ground_elevation'));
  assert.match(inspection.instructions, /nearest, radius or box queries/u);
  assert.match(inspection.instructions, /original source geometry/u);
  assert.match(inspection.instructions, /missing records\/support never establish empty space/u);
  assert.match(loaded.instructions, /YOU own task decomposition, exploration, candidate generation, comparison, judgement and iteration/u);
  assert.match(loaded.instructions, /no mandatory tool sequence or required scan pool/u);
  assert.match(loaded.instructions, /scene\.set_scene_marks\(\{expectedRevision,marks:/u);
  assert.match(loaded.instructions, /Omit id for a new mark/u);
  assert.match(loaded.instructions, /server-returned IDs/u);
  assert.match(loaded.instructions, /C1–Cn by submitted order/u);
  assert.match(loaded.instructions, /empty marks list clears hypotheses/u);
  assert.match(loaded.instructions, /Re-read after a revision conflict/u);
  assert.match(loaded.instructions, /capture-time observations only/u);
  assert.match(loaded.instructions, /not source records, authored datums, geometry proposals or approval/u);
  assert.match(loaded.instructions, /individual human approval/u);
  assert.doesNotMatch(loaded.instructions, /assess_utility_box|propose_utility_box|scan_area_candidates|finalize_area_candidates|search_placement_sites|propose_placement_site/u);
  assert.doesNotMatch(loaded.instructions, /follow inspect → capture → assess → propose|prefer scene\.scan_area_candidates|Before recommending or ranking locations, call/u);
});

test('removed legacy decision skills cannot be discovered or loaded even if old capability names are supplied', () => {
  const capabilities = { mode: 'toronto' as const, toolNames: ['scan_area_candidates', 'finalize_area_candidates', 'search_placement_sites', 'propose_placement_site', 'assess_utility_box', 'propose_utility_box'] };
  for (const id of ['area-candidates', 'placement-search', 'utility-box-placement']) {
    assert.equal(PRODUCT_SKILLS.some(entry => String(entry.id) === id), false);
    assert.throws(() => loadProductSkill(id, capabilities), /Unknown product skill/u);
  }
  assert.doesNotMatch(JSON.stringify(listProductSkills(capabilities)), /scan_area_candidates|assess_utility_box|search_placement_sites/u);
});

test('initial provider instructions stay lean; list/load instructions and inspection match the effective request exactly', async t => {
  const f = await fixture(t);
  f.outputs.push([tool('list_skills')], [load('scene-inspection')], []);
  const events = await f.run();
  assert.equal(f.requests.length, 3);
  const initial = f.requests[0]!;
  assert.match(String(initial.instructions), /Available runtime skills/u);
  assert.match(String(initial.instructions), /Loaded skills reset each user turn/u);
  for (const skill of PRODUCT_SKILLS) assert.equal(String(initial.instructions).includes(skill.instructions.trim()), false, skill.id);
  assert.ok(String(initial.instructions).length < 8000);
  assert.deepEqual(contexts(events, 'list_skills'), [{ kind: 'runtime-skill-catalog', skills: listProductSkills({ mode: 'pole', toolNames: advertised(initial) }) }]);
  const expected = { kind: 'runtime-skill', ...loadProductSkill('scene-inspection', { mode: 'pole', toolNames: advertised(initial) }) };
  assert.deepEqual(contexts(events, 'load_skill'), [expected]);
  assert.deepEqual(outputFor(f.requests[2]!, 'load_scene-inspection'), expected);
  const instructions = PRODUCT_SKILLS.find(skill => skill.id === 'scene-inspection')!.instructions.trim();
  assert.equal(String(f.requests[1]!.instructions).includes(instructions), false);
  assert.ok(String(f.requests[2]!.instructions).includes(`Runtime skill scene-inspection:\n${instructions}`));
  assert.equal(f.requests[2]!.instructions, `${f.requests[1]!.instructions}\n\nRuntime skill scene-inspection:\n${instructions}`);
  const inspections = events.filter((event): event is Extract<ModelChatEvent, { kind: 'request-inspection' }> => event.kind === 'request-inspection');
  assert.equal(inspections.length, f.requests.length);
  for (const [index, event] of inspections.entries()) {
    const inspected = JSON.parse(event.inspection.bodyJson);
    assert.equal(inspected.instructions, f.requests[index]!.instructions);
    assert.equal(event.inspection.round, index + 1);
    assert.equal(event.inspection.bodyJson.includes('synthetic-skills-not-live'), false);
  }
  const inspected = JSON.parse(inspections[2]!.inspection.bodyJson);
  assert.deepEqual(outputFor(inspected, 'load_scene-inspection'), expected);
});

test('unknown/unavailable load calls return filtered recovery rather than expanding capabilities', async t => {
  const f = await fixture(t); let cadAttempts = 0;
  f.outputs.push([load('unknown-id'), load('toronto-geometry')], []);
  const binding: BoundModelScene = { ...f.bound, async proposeCad() { cadAttempts++; assert.fail('Pole cannot gain Toronto CAD'); } };
  const events = await f.run({}, binding);
  for (const context of contexts(events, 'load_skill') as { kind: string; availableSkillIds: string[] }[]) {
    assert.equal(context.kind, 'runtime-skill-unavailable');
    assert.deepEqual(context.availableSkillIds, ['scene-inspection', 'candidate-assessment']);
  }
  assert.deepEqual(advertised(f.requests[0]!), advertised(f.requests[1]!));
  f.outputs.push([load('candidate-assessment')], [tool('propose_cad_box', { center: [0, 0, 0], dimensions: [1, 1, 1] })]);
  await assert.rejects(f.run({}, binding), { code: 'unsupported-tool' });
  assert.equal(cadAttempts, 0);
  assert.equal(advertised(f.requests.at(-1)!).includes('propose_cad_box'), false);
});

test('loading candidate dependencies cannot grant absent visual capture capability', async t => {
  const f = await fixture(t);
  f.outputs.push([load('candidate-assessment')], [tool('capture_scene', { kind: 'current' })]);
  const events: ModelChatEvent[] = [];
  await assert.rejects(f.run({}, f.bound, events), { code: 'unsupported-tool' });
  const loaded = contexts(events, 'load_skill')[0] as { loadedSkillIds: string[]; tools: string[] };
  assert.deepEqual(loaded.loadedSkillIds, ['scene-inspection', 'visual-inspection', 'candidate-assessment']);
  assert.deepEqual(loaded.tools, ['inspect_scene']);
  assert.equal(advertised(f.requests[1]!).includes('capture_scene'), false);
});
