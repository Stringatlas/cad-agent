import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalSceneMarkSnapshot, type ModelCaptureRequest, type ModelChatEvent, type ModelTurnRequest, type ModelVisualObservation, type SceneMarkSnapshot } from '@spatial/contracts';
import { ProviderModel, type BoundModelScene, type ModelAuth } from '../apps/server/src/provider-model';

type Body = { input: { type?: string; call_id?: string; output?: string; role?: string; content?: unknown }[]; tools: { tools: { name: string }[] }[] };
const binding: SceneMarkSnapshot['binding'] = { artifactRevision: 'a'.repeat(64), frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0], points: { sessionId: 'points', revision: 0 }, cad: { sessionId: 'cad', revision: 0 } };
const tool = (name: string, args: unknown = {}, callId = name) => ({ type: 'function_call', namespace: 'scene', name, call_id: callId, arguments: JSON.stringify(args) });
const load = (id = 'load') => tool('load_skill', { skillId: 'candidate-assessment' }, id);
const mark = (position: readonly number[], id?: string) => ({ ...(id ? { id } : {}), position, rationale: 'Model hypothesis from the observed approach.', uncertainty: 'Occluded surfaces and utilities remain unknown.' });
const output = (body: Body, id: string): unknown => {
  const item = body.input.find(item => item.type === 'function_call_output' && item.call_id === id);
  assert.ok(item?.output, `Missing tool result ${id}`); return JSON.parse(item.output);
};
const snapshot = (body: Body, id: string) => canonicalSceneMarkSnapshot(output(body, id));
const images = (body: Body) => body.input.flatMap(item => Array.isArray(item.content)
  ? item.content.filter((c: { type?: string }) => c.type === 'input_image') as { image_url: string }[] : []);
const toolEvents = (events: ModelChatEvent[]) => events.filter(event => event.kind === 'tool');
function observation(id = 'exploration-image'): ModelVisualObservation {
  // A real tiny PNG payload is delivered as input_image; no network/provider inference.
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return { schemaVersion: 1, observationId: id, viewGeneration: 1,
    image: { mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
    viewport: { width: 1, height: 1, pixelRatio: 1, pixelOrigin: 'top-left' },
    binding: { sourceId: 'toronto3d', sourceRevision: binding.artifactRevision, frameId: binding.frameId, units: 'm', origin: binding.localOrigin, upAxis: 'z', handedness: 'right' },
    camera: { position: [10, 20, 30], quaternion: [0, 0, 0, 1], up: [0, 0, 1], near: .1, far: 1000, fov: 60, aspect: 1, zoom: 1, matrixWorld: identity, matrixWorldInverse: identity, projectionMatrix: identity },
    coverage: { kind: 'displayed-sample', complete: false, displayedPointCount: 12 } };
}
async function fixture(t: { after(fn: () => unknown): void }, respond: (body: Body, round: number) => unknown[] | Promise<unknown[]>) {
  const requests: Body[] = [], events: ModelChatEvent[] = [], measurements: unknown[] = [], captures: ModelCaptureRequest[] = [];
  let mutations = 0;
  const auth: ModelAuth = {
    status: () => ({ mode: 'api-key', authenticated: true, ready: true, planUsageEnabled: false, selectedAccount: null, accounts: [] }),
    credentialGeneration: () => 'exploration-generation', onCredentialChange: () => () => {},
    credential: async () => ({ mode: 'api-key', bearer: 'synthetic-not-live', baseUrl: 'https://unused.invalid', constraints: { billing: 'api-key', responsesOnly: false } }),
  };
  const model = new ProviderModel(auth, async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'exploration-model' }] });
    const body = JSON.parse(String(init?.body)) as Body; requests.push(body);
    const result = await respond(body, requests.length - 1);
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: result } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  const context = { sceneBounds: { min: [-100, -100, -10], max: [100, 100, 40] }, spatialFrame: { frameId: binding.frameId, units: 'm', localOrigin: binding.localOrigin }, capabilities: { queryPoints: true, groundElevation: true }, sourceLimitations: 'Original source only, not clearance verification.' };
  const forbidden = async (): Promise<never> => { mutations++; throw Error('Geometry mutation forbidden during exploration'); };
  const bound: BoundModelScene = { context, sceneMarkBinding: binding, check: async () => {}, close: async () => {},
    captureScene: async request => { captures.push(request); return observation(); },
    queryPoints: async args => { measurements.push(args); return { complete: true, domain: 'original-source-points', totalCount: 2, points: [], truncated: false, independentVerification: false }; },
    groundElevation: async args => { measurements.push(args); return { status: 'unavailable', reason: 'no-supported-ground-cell' }; },
    proposeCad: forbidden, proposePointMove: forbidden, proposePointCreate: forbidden,
    scanAreaCandidates: forbidden, searchPlacementSites: forbidden, proposePlacementSite: forbidden };
  const controller = new AbortController();
  const run = (conversationId: string | null = null, requestId = 'exploration-turn') => {
    const call: ModelTurnRequest = { requestId, conversationId, generation: 'exploration-generation', model: 'exploration-model', text: 'Explore useful locations and compare alternatives.', scene: { mode: 'toronto', toronto: [] } };
    return model.turn(call, bound, async event => { events.push(event); }, controller.signal);
  };
  t.after(() => { model.close(); assert.equal(mutations, 0, 'No scan, fit solver or geometry authority may execute'); });
  assert.equal((await model.models(controller.signal)).ready, true);
  return { model, bound, context, events, requests, captures, measurements, controller, run };
}

test('model explores images, invents coordinates, measures, revises/removes/reorders stable hypotheses and resumes next turn', async t => {
  let initial!: SceneMarkSnapshot, revised!: SceneMarkSnapshot;
  const f = await fixture(t, (body, round) => {
    switch (round) {
      case 0: {
        assert.ok(body.input.some(item => item.role === 'developer' && String(item.content).includes('sceneBounds') && String(item.content).includes('toronto3d-local-v1')));
        assert.ok(body.input.some(item => String(item.content).includes('"annotationRevision":0')));
        const names = body.tools[0]!.tools.map(tool => tool.name);
        for (const name of ['query_points', 'ground_elevation', 'set_scene_marks', 'get_scene_marks', 'capture_scene']) assert.ok(names.includes(name));
        assert.equal(names.includes('scan_area_candidates'), false, 'No AOI or numerical pool prerequisite');
        assert.equal(names.includes('search_placement_sites'), false);
        return [tool('inspect_scene'), load()];
      }
      case 1: assert.deepEqual(output(body, 'inspect_scene'), f.context); return [tool('capture_scene', { kind: 'current', colorMode: 'rgb' }, 'observe')];
      case 2:
        assert.equal(images(body).at(-1)?.image_url, observation().image.dataUrl);
        return [tool('set_scene_marks', { expectedRevision: 0, marks: [mark([12.375, -4.25, 1.1]), mark([-8.2, 17.7, .4]), mark([31.1, 8.6, 2])] }, 'invent')];
      case 3:
        initial = snapshot(body, 'invent'); assert.equal(initial.marks.length, 3);
        assert.ok(initial.marks.every(m => m.observationId === 'exploration-image'));
        assert.deepEqual(initial.marks.map(m => m.position), [[12.375, -4.25, 1.1], [-8.2, 17.7, .4], [31.1, 8.6, 2]]);
        return [tool('query_points', { operation: 'radius', position: initial.marks[2]!.position, radiusMeters: 2.75, maxResults: 4 }, 'measure'), tool('ground_elevation', { x: 31.1, y: 8.6 }, 'ground')];
      case 4:
        assert.equal((output(body, 'measure') as { totalCount: number }).totalCount, 2);
        assert.equal((output(body, 'ground') as { status: string }).status, 'unavailable');
        return [tool('set_scene_marks', { expectedRevision: 1, marks: [mark([31.4, 8.1, 2], initial.marks[2]!.id), mark(initial.marks[0]!.position, initial.marks[0]!.id)] }, 'revise')];
      case 5:
        revised = snapshot(body, 'revise'); assert.equal(revised.annotationRevision, 2);
        assert.deepEqual(revised.marks.map(m => [m.id, m.rank]), [[initial.marks[2]!.id, 1], [initial.marks[0]!.id, 2]]);
        return [tool('set_scene_marks', { expectedRevision: 1, marks: [] }, 'conflict')];
      case 6: assert.deepEqual(output(body, 'conflict'), { kind: 'scene-marks-conflict', current: revised, recovery: 'Read current marks, preserve known IDs only, and retry with current annotationRevision. Nothing changed.' }); return [tool('get_scene_marks', {}, 'read')];
      case 7: assert.deepEqual(snapshot(body, 'read'), revised); return [];
      case 8:
        assert.ok(body.input.some(item => item.role === 'developer' && String(item.content).includes(JSON.stringify(revised))));
        return [load('reload')];
      case 9: return [tool('get_scene_marks', {}, 'resumed')];
      case 10: assert.deepEqual(snapshot(body, 'resumed'), revised); return [];
      default: assert.fail('Unexpected provider request');
    }
  });
  await f.run();
  const start = f.events.find(event => event.kind === 'start'); assert.ok(start?.kind === 'start');
  await f.run(start.conversationId, 'later-turn');
  assert.equal(f.requests.length, 11); assert.equal(f.captures.length, 1);
  assert.deepEqual(f.measurements, [{ operation: 'radius', position: [31.1, 8.6, 2], radiusMeters: 2.75, maxResults: 4 }, { x: 31.1, y: 8.6 }]);
  assert.equal(f.events.filter(event => event.kind === 'done').length, 2);
});

test('an unavailable latest image leaves new marks provisional without reusing an old observation receipt', async t => {
  const f = await fixture(t, (body, round) => {
    if (round === 0) return [load()];
    if (round === 1) return [tool('capture_scene', { kind: 'current' }, 'old-view')];
    if (round === 2) { assert.equal(images(body).length, 1); return [tool('capture_scene', { kind: 'current' }, 'missing-view')]; }
    if (round === 3) { assert.deepEqual(output(body, 'missing-view'), { status: 'unavailable' }); return [tool('set_scene_marks', { expectedRevision: 0, marks: [mark([3, 4, 5])] }, 'provisional')]; }
    const result = snapshot(body, 'provisional'); assert.equal(result.marks[0]!.observationId, undefined);
    assert.match(result.marks[0]!.uncertainty, /unknown/); return [];
  });
  let captures = 0; f.bound.captureScene = async () => ++captures === 1 ? observation('old-image') : undefined;
  await f.run(); assert.equal(captures, 2);
});

test('successive exploration views deliver the latest real image before model-authored marks receive its receipt', async t => {
  const f = await fixture(t, (body, round) => {
    if (round === 0) return [load()];
    if (round === 1) return [tool('capture_scene', { kind: 'current' }, 'first')];
    if (round === 2) {
      assert.equal(images(body).at(-1)?.image_url, observation('first-view').image.dataUrl);
      return [tool('capture_scene', { kind: 'top-down', colorMode: 'type' }, 'second')];
    }
    if (round === 3) {
      const result = output(body, 'second') as { observation: { observationId: string } };
      assert.equal(result.observation.observationId, 'latest-view');
      assert.equal(images(body).length, 2);
      assert.equal(images(body).at(-1)?.image_url, latest.image.dataUrl);
      assert.notEqual(images(body).at(-1)?.image_url, images(body)[0]?.image_url);
      return [tool('set_scene_marks', { expectedRevision: 0, marks: [mark([-15.1, 22.8, 3.2])] }, 'latest-hypothesis')];
    }
    assert.equal(snapshot(body, 'latest-hypothesis').marks[0]!.observationId, 'latest-view'); return [];
  });
  // Distinct image payloads ensure retained history cannot masquerade as the latest capture.
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1sAAAAASUVORK5CYII=', 'base64');
  const latest: ModelVisualObservation = { ...observation('latest-view'), image: { mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
  let captures = 0; f.bound.captureScene = async () => ++captures === 1 ? observation('first-view') : latest;
  await f.run(); assert.equal(captures, 2);
});

test('changed source binding resets resumed annotations instead of reusing stale coordinates', async t => {
  let initial!: SceneMarkSnapshot;
  const f = await fixture(t, (body, round) => {
    if (round === 0) return [load()];
    if (round === 1) return [tool('set_scene_marks', { expectedRevision: 0, marks: [mark([1, 2, 3])] }, 'before-rebind')];
    if (round === 2) { initial = snapshot(body, 'before-rebind'); return []; }
    if (round === 3) return [load('rebind-load')];
    if (round === 4) return [tool('get_scene_marks', {}, 'after-rebind')];
    const rebound = snapshot(body, 'after-rebind');
    assert.equal(rebound.annotationRevision, 0); assert.deepEqual(rebound.marks, []);
    assert.notEqual(rebound.binding.artifactRevision, initial.binding.artifactRevision); return [];
  });
  await f.run();
  const start = f.events.find(event => event.kind === 'start'); assert.ok(start?.kind === 'start');
  Object.assign(f.bound, { sceneMarkBinding: { ...binding, artifactRevision: 'b'.repeat(64) } });
  await f.run(start.conversationId, 'rebound-turn');
});

test('capture and marks in one provider response cannot imply the model has inspected the new image', async t => {
  const f = await fixture(t, (body, round) => round === 0 ? [load()] : round === 1
    ? [tool('capture_scene', { kind: 'current' }), tool('set_scene_marks', { expectedRevision: 0, marks: [mark([7, 8, 9])] }, 'premature')]
    : (assert.equal(snapshot(body, 'premature').marks[0]!.observationId, undefined), []));
  await f.run();
});

for (const [name, args, code] of [
  ['query_points', { operation: 'nearest', position: [0, 0, 0], maxResults: 1, forged: true }, 'invalid-spatial-query'],
  ['query_points', { operation: 'radius', position: [0, 0, 0], radiusMeters: -1, maxResults: 1 }, 'invalid-spatial-query'],
  ['query_points', { operation: 'box', bounds: { min: [2, 0, 0], max: [1, 1, 1] }, maxResults: 1 }, 'invalid-spatial-query'],
  ['query_points', { operation: 'nearest', position: [0, 0, 0], maxResults: 65 }, 'invalid-spatial-query'],
  ['ground_elevation', { x: 1, y: 2, z: 3 }, 'invalid-ground-query'],
  ['ground_elevation', { x: '1', y: 2 }, 'invalid-ground-query'],
  ['set_scene_marks', { expectedRevision: 0, marks: [mark([0, 0, 0])], approved: true }, 'invalid-scene-marks'],
  ['set_scene_marks', { expectedRevision: 0, marks: [{ ...mark([0, 0, 0]), observationId: 'forged' }] }, 'invalid-scene-marks'],
  ['set_scene_marks', { expectedRevision: 0, marks: [mark([0, 0, 0], 'same'), mark([1, 1, 1], 'same')] }, 'invalid-scene-marks'],
  ['set_scene_marks', { expectedRevision: 0, marks: [{ ...mark([0, 0, 0]), rationale: '' }] }, 'invalid-scene-marks'],
  ['get_scene_marks', { revision: 0 }, 'unsupported-tool'],
] as const) test(`strict ${name} boundary rejects ${JSON.stringify(args)}`, async t => {
  const f = await fixture(t, (_body, round) => round === 0 ? [load()] : [tool(name, args, 'invalid')]);
  await assert.rejects(f.run(), { code }); assert.equal(f.measurements.length, 0);
  assert.equal(toolEvents(f.events).some(event => event.name === name), false);
  assert.equal(f.events.some(event => event.kind === 'done'), false);
});

for (const reason of ['stale-source', 'abort'] as const) test(`${reason} during a factual query cannot publish observations or subsequent marks`, async t => {
  let stale = false;
  const f = await fixture(t, (_body, round) => round === 0 ? [load()] : [
    tool('query_points', { operation: 'nearest', position: [5, 6, 7], maxResults: 1 }),
    tool('set_scene_marks', { expectedRevision: 0, marks: [mark([5, 6, 7])] }),
  ]);
  f.bound.check = async () => { if (stale) throw Object.assign(Error('Source artifact replaced'), { code: 'stale-revision' }); };
  f.bound.queryPoints = async () => { if (reason === 'abort') f.controller.abort(); else stale = true; return { complete: true, point: { position: [5, 6, 7] } }; };
  await assert.rejects(f.run(), { code: reason === 'abort' ? 'cancelled' : 'stale-revision' });
  assert.deepEqual(toolEvents(f.events).map(event => event.name), ['load_skill']);
  assert.equal(f.events.some(event => event.kind === 'done'), false);
});

test('marks are unavailable without an explicit bound source/frame/authority binding', async t => {
  const f = await fixture(t, (body, round) => {
    const names = body.tools[0]!.tools.map(tool => tool.name);
    assert.equal(names.includes('set_scene_marks'), false); assert.equal(names.includes('get_scene_marks'), false);
    return round === 0 ? [tool('get_scene_marks')] : [];
  });
  delete (f.bound as { sceneMarkBinding?: unknown }).sceneMarkBinding;
  await assert.rejects(f.run(), { code: 'unsupported-tool' });
});

for (const change of ['revision', 'session'] as const) test(`changed object ${change} resets resumed annotation state without changing point/CAD authorities`, async t => {
  let initial!: SceneMarkSnapshot;
  const objects = { sessionId: 'objects', revision: 0 };
  const f = await fixture(t, (body, round) => {
    if (round === 0) return [load()];
    if (round === 1) return [tool('set_scene_marks', { expectedRevision: 0, marks: [mark([1, 2, 3])] }, 'initial')];
    if (round === 2) { initial = snapshot(body, 'initial'); return []; }
    if (round === 3) return [load('reload')];
    if (round === 4) return [tool('get_scene_marks', {}, 'rebound')];
    assert.equal(round, 5);
    const current = snapshot(body, 'rebound');
    assert.equal(current.annotationRevision, 0); assert.deepEqual(current.marks, []);
    assert.deepEqual(current.binding.points, initial.binding.points);
    assert.deepEqual(current.binding.cad, initial.binding.cad);
    assert.equal(current.binding.artifactRevision, initial.binding.artifactRevision);
    assert.notDeepEqual(current.binding.objects, initial.binding.objects);
    return [];
  });
  Object.defineProperty(f.bound, 'sceneMarkBinding', { get: () => ({ ...binding, objects: { ...objects } }) });
  await f.run();
  const start = f.events.find(event => event.kind === 'start'); assert.ok(start?.kind === 'start');
  if (change === 'revision') objects.revision++; else objects.sessionId = 'replacement-objects';
  await f.run(start.conversationId, 'object-rebound-turn');
});

test('object-only accepted approval clears annotations and prior visual receipts before further mark edits', async t => {
  let before!: SceneMarkSnapshot;
  let objectRevision = 0, decisions = 0;
  const f = await fixture(t, (body, round) => {
    switch (round) {
      case 0: return [load(), tool('load_skill', { skillId: 'scene-objects' }, 'objects-skill')];
      case 1: return [tool('capture_scene', { kind: 'current' }, 'observe')];
      case 2: return [tool('set_scene_marks', { expectedRevision: 0, marks: [mark([1, 2, 3])] }, 'initial')];
      case 3:
        before = snapshot(body, 'initial');
        assert.equal(before.marks[0]!.observationId, 'exploration-image');
        return [tool('propose_point_create', { name: 'Datum', input: { kind: 'position', position: [2, 3, 4] } }, 'proposal')];
      case 4: {
        assert.equal(decisions, 1);
        assert.equal((output(body, 'proposal') as { humanDecision: { outcome: string } }).humanDecision.outcome, 'accepted');
        assert.ok(body.input.some(item => item.role === 'developer' && String(item.content).includes('Current annotation state after authority decision')));
        return [tool('get_scene_marks', {}, 'after-decision')];
      }
      case 5: {
        const current = snapshot(body, 'after-decision');
        assert.equal(current.annotationRevision, 0); assert.deepEqual(current.marks, []);
        assert.deepEqual(current.binding.points, before.binding.points); assert.deepEqual(current.binding.cad, before.binding.cad);
        assert.deepEqual(current.binding.objects, { sessionId: 'objects', revision: 1 });
        return [tool('set_scene_marks', { expectedRevision: 0, marks: [mark([4, 5, 6], before.marks[0]!.id)] }, 'stale-id')];
      }
      case 6: {
        const conflict = output(body, 'stale-id') as { kind: string; current: SceneMarkSnapshot };
        assert.equal(conflict.kind, 'scene-marks-conflict');
        assert.equal(conflict.current.annotationRevision, 0); assert.deepEqual(conflict.current.marks, []);
        return [tool('set_scene_marks', { expectedRevision: 0, marks: [mark([4, 5, 6])] }, 'fresh')];
      }
      case 7: {
        const fresh = snapshot(body, 'fresh'); assert.equal(fresh.annotationRevision, 1);
        assert.notEqual(fresh.marks[0]!.id, before.marks[0]!.id);
        assert.equal(fresh.marks[0]!.observationId, undefined, 'Old image receipt cannot survive an authority rebind');
        return [];
      }
      default: assert.fail('Unexpected provider request');
    }
  });
  Object.defineProperty(f.bound, 'sceneMarkBinding', { get: () => ({ ...binding, objects: { sessionId: 'objects', revision: objectRevision } }) });
  f.bound.listObjects = async () => ({ objects: [] });
  f.bound.getObject = async () => ({});
  f.bound.proposePointCreate = async () => ({ proposalId: 'object-proposal' }) as Awaited<ReturnType<NonNullable<BoundModelScene['proposePointCreate']>>>;
  f.bound.waitForApproval = async (authority, proposalId) => {
    assert.equal(authority, 'objects'); assert.equal(proposalId, 'object-proposal');
    decisions++; objectRevision++;
    return { outcome: 'accepted', scene: { mode: 'toronto', toronto: [] }, context: { objectRevision } };
  };
  await f.run();
  assert.equal(decisions, 1); assert.equal(f.captures.length, 1);
  assert.ok(f.events.some(event => event.kind === 'approval-result' && event.authority === 'objects' && event.outcome === 'accepted'));
});
