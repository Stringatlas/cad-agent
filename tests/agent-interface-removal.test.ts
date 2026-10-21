import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { ModelScene, ModelTurnRequest } from '@spatial/contracts';
import { ProviderAuth } from '../apps/server/src/provider-auth';
import { ProviderModel, ModelError, type BoundModelScene } from '../apps/server/src/provider-model';
import { bindModelScene } from '../apps/server/src/model-scene';
import { ProjectSession } from '../apps/server/src/project-session';
import { PointOverrideSession } from '../apps/server/src/point-overrides';
import { TorontoCadSession } from '../apps/server/src/toronto-cad-session';
import { PlacementSearchSession } from '../apps/server/src/placement-search-session';
import { candidateSource } from './fixtures/area-candidate-source';

const removed = ['assess_utility_box', 'propose_utility_box', 'search_placement_sites', 'propose_placement_site', 'scan_area_candidates', 'finalize_area_candidates'];
const forbiddenContext = ['utilityBoxPreset', 'utilityBoxAssessment', 'scanAreaCandidates', 'searchPlacementSites', 'proposePlacementSite'];
const forbiddenPrompt = [...removed, ...forbiddenContext, 'utility-box-placement', 'placement-search', 'area-candidates'];
type Body = { instructions: string; input: { type?: string; call_id?: string; output?: string; role?: string; content?: unknown }[]; tools: { tools: { name: string }[] }[] };
const tool = (name: string, args: unknown = {}) => ({ type: 'function_call', namespace: 'scene', name, call_id: `call_${name}`, arguments: JSON.stringify(args) });
const sse = (output: unknown[]) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const signal = new AbortController().signal;

async function provider(t: { after(fn: () => unknown): void }, scene: ModelScene, bound: BoundModelScene, outputs: unknown[][]) {
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'synthetic-not-live' });
  const requests: Body[] = [];
  const model = new ProviderModel(auth, async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'interface-model' }] });
    requests.push(JSON.parse(String(init?.body)) as Body);
    assert.ok(outputs.length, 'Unexpected provider request');
    return sse(outputs.shift()!);
  });
  t.after(() => { model.close(); auth.close(); });
  const catalog = await model.models(signal);
  const call: ModelTurnRequest = { requestId: 'interface-removal', conversationId: null, generation: catalog.generation, model: 'interface-model', text: 'Inspect and reason about useful locations without creating geometry.', scene };
  return { requests, run: () => model.turn(call, bound, async () => {}, signal) };
}

async function fixture(t: { after(fn: () => unknown): void }, selected: boolean) {
  const source = await candidateSource([{ xyz: [0, 0, 0], label: 1 }, { xyz: [1, 1, 2], label: 6 }]);
  const points = new PointOverrideSession(source.root), cad = new TorontoCadSession(source.root);
  const placement = new PlacementSearchSession(source.root, points, cad);
  const scene: ModelScene = { mode: 'toronto', project: null, toronto: selected ? [{ name: 'Point 1', datasetId: 'toronto3d', artifactRevision: source.snapshot.dataset.revision,
    key: { sourceFileId: 1, sourceRow: 0 }, position: [0, 0, 0], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }] : [],
    ...(selected ? { areaOfInterest: source.area(10) } : {}) };
  const bound = await bindModelScene(scene, new ProjectSession(join(source.root, 'project.json')), source.root, signal, undefined, { points, cad, placement });
  t.after(async () => { await bound.close(); await placement.close(); await points.close(); await cad.close(); await source.close(); });
  return { scene, bound };
}

for (const selected of [false, true]) test(`effective agent interface excludes legacy workflows (${selected ? 'selected point and AOI' : 'empty selection'})`, async t => {
  const f = await fixture(t, selected);
  // Internal/manual engine compatibility is deliberately preserved, even though no
  // corresponding model tool may be advertised or dispatched.
  assert.ok(f.bound.assessUtilityBox); assert.ok(f.bound.proposeUtilityBox);
  assert.ok(f.bound.proposePlacementSite);
  if (selected) { assert.ok(f.bound.searchPlacementSites); assert.ok(f.bound.scanAreaCandidates); }
  for (const key of forbiddenContext) assert.equal(JSON.stringify(f.bound.context).includes(key), false, key);
  const p = await provider(t, f.scene, f.bound, [[tool('inspect_scene')], []]);
  await p.run(); assert.equal(p.requests.length, 2);
  for (const body of p.requests) {
    const names = body.tools[0]!.tools.map(tool => tool.name);
    for (const name of removed) assert.equal(names.includes(name), false, name);
    for (const name of ['query_points', 'ground_elevation', 'get_scene_marks', 'set_scene_marks', 'propose_cad_box']) assert.ok(names.includes(name), name);
    for (const text of forbiddenPrompt) assert.equal(JSON.stringify(body).includes(text), false, text);
    assert.match(body.instructions, /own task decomposition, exploration, hypotheses/);
    assert.match(body.instructions, /unavailable task-specific workflow is not a blocker/);
    assert.match(body.instructions, /Do not invent equipment dimensions, engineering standards, measurements or clearance certification/);
    assert.match(body.instructions, /kernel validation/); assert.match(body.instructions, /individual human approval/);
    assert.match(body.instructions, /Every retained geometry proposal pauses/);
    assert.match(body.instructions, /original source records, current accepted edits/);
  }
  const result = p.requests[1]!.input.find(item => item.type === 'function_call_output' && item.call_id === 'call_inspect_scene');
  assert.deepEqual(JSON.parse(result!.output!), f.bound.context);
});

for (const name of removed) test(`removed call ${name} is unsupported even with all legacy bound implementations`, async t => {
  const f = await fixture(t, true);
  let dispatched = 0;
  const forbidden = async (): Promise<never> => { dispatched++; throw Error('Removed engine must never dispatch'); };
  const bound: BoundModelScene = { ...f.bound, assessUtilityBox: forbidden, proposeUtilityBox: forbidden, searchPlacementSites: forbidden, proposePlacementSite: forbidden, scanAreaCandidates: forbidden, checkAreaCandidates: forbidden };
  const p = await provider(t, f.scene, bound, [[tool(name)]]);
  await assert.rejects(p.run(), error => error instanceof ModelError && error.code === 'unsupported-tool');
  assert.equal(dispatched, 0); assert.equal(p.requests.length, 1);
});

test('capture delivery has no legacy candidate-judgement metadata', async t => {
  const f = await fixture(t, false);
  const bound: BoundModelScene = { ...f.bound, captureScene: async () => undefined };
  const p = await provider(t, f.scene, bound, [[tool('load_skill', { skillId: 'visual-inspection' })], [tool('capture_scene', { kind: 'current' })], []]);
  await p.run();
  const last = p.requests.at(-1)!;
  const result = last.input.find(item => item.type === 'function_call_output' && item.call_id === 'call_capture_scene');
  assert.deepEqual(JSON.parse(result!.output!), { status: 'unavailable' });
  for (const body of p.requests) assert.equal(JSON.stringify(body).includes('candidateAssessment'), false);
});
