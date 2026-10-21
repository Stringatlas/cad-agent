import test from 'node:test';
import { withProductSkills, isWorkflowTool } from './helpers/product-skill-transport';
import assert from 'node:assert/strict';
import { canonicalModelChatEvent, type AreaCandidateResult, type AreaCandidateSettings, type ModelCatalog, type ModelChatEvent, type ModelScene, type ModelTurnRequest, type PointMoveProposal, type PointOverrideSnapshot, type TorontoCadProposal, type TorontoCadSnapshot } from '@spatial/contracts';
import { createDemoServer } from '../apps/server/src/index';
import { bindModelScene } from '../apps/server/src/model-scene';
import { PointOverrideSession } from '../apps/server/src/point-overrides';
import { TorontoCadSession } from '../apps/server/src/toronto-cad-session';
import { SemanticDiskIndex } from '../apps/server/src/semantic-disk-index';
import { ModelChatController, validateModelEvent } from '../apps/web/src/model-chat-client';
import { areaCandidatesMatchScene, validateAreaCandidateResult } from '../apps/web/src/area-candidate-client';
import { candidateSource, denseGround } from './fixtures/area-candidate-source';

const settings: AreaCandidateSettings = { maxCandidates: 7, spacingMeters: 2, clearanceRadiusMeters: .5, maxGroundReliefMeters: .25, minPoleDistanceMeters: 0, ranking: 'flat-ground' };
const tool = (args: unknown) => ({ type: 'function_call', namespace: 'scene', name: 'scan_area_candidates', call_id: 'scan_call', arguments: JSON.stringify(args) });
const sse = (output: unknown[]) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const decision = (p: PointMoveProposal | TorontoCadProposal) => ({ sessionId: p.sessionId, revision: p.revision, artifactRevision: p.artifactRevision, proposalId: p.proposalId });

async function httpFixture(t: { after(fn: () => unknown): void }, size = 4) {
  const source = await candidateSource(denseGround(size));
  const scene: ModelScene = { mode: 'toronto', toronto: [], areaOfInterest: source.area(100) };
  const outputs: unknown[][] = [], requests: Record<string, any>[] = [];
  const server = createDemoServer({ datasetRoot: source.root, provider: { mode: 'api-key', apiKey: 'synthetic-not-a-credential' },
    modelTransport: withProductSkills(async (url, init) => {
      if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture-model' }] });
      requests.push(JSON.parse(String(init?.body))); return sse(outputs.shift() ?? []);
    }, ['area-candidates']) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const fetcher: typeof fetch = (input, init) => fetch(`http://127.0.0.1:${address.port}${String(input)}`, init);
  const catalog = await (await fetcher('/chat/models')).json() as ModelCatalog;
  const call = (s = scene): ModelTurnRequest => ({ requestId: 'area-tool-request', conversationId: null, generation: catalog.generation, model: 'fixture-model', text: 'Scan the large area and suggest candidate locations; create nothing.', scene: s });
  const run = async (request = call()) => {
    const response = await fetcher('/chat/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    assert.equal(response.status, 200);
    return (await response.text()).trim().split('\n').map(line => canonicalModelChatEvent(JSON.parse(line)));
  };
  const snapshots = async () => ({
    points: (await (await fetcher('/datasets/toronto3d/overrides')).json() as { result: PointOverrideSnapshot }).result,
    cad: (await (await fetcher('/datasets/toronto3d/cad')).json() as { result: TorontoCadSnapshot }).result,
  });
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await source.close(); });
  return { source, scene, outputs, requests, fetcher, call, run, snapshots };
}
function resultOf(events: ModelChatEvent[]): AreaCandidateResult {
  const e = events.find(e => e.kind === 'tool' && e.name === 'scan_area_candidates');
  assert.ok(e?.kind === 'tool'); return (e.context as { result: AreaCandidateResult }).result;
}

// Integration boundary: mocked provider only; artifact, reduction, HTTP protocol,
// client dispatch and current-area/authority display checks are real.
test('100x100m provider scan reaches client candidate callback without selected points or CAD premises', async t => {
  const f = await httpFixture(t, 100); let received: AreaCandidateResult | undefined;
  let proposalCallbacks = 0;
  const client = new ModelChatController(() => {}, f.fetcher, undefined, undefined, {
    onareacandidates: async (value, current) => {
      assert.equal(current(), true);
      const r = validateAreaCandidateResult(value), { points, cad } = await f.snapshots();
      assert.equal(areaCandidatesMatchScene(r, f.scene.areaOfInterest, points, cad), true);
      received = r;
    },
    onauthorityproposal: () => { proposalCallbacks++; },
  });
  t.after(() => client.dispose()); client.bind(f.scene); await client.refreshModels(); client.selectModel('fixture-model');
  f.outputs.push([tool({ settings })], []);
  assert.equal(await client.send('Find candidate locations across this large area.'), true);
  assert.equal(client.view.phase, 'completed'); assert.ok(received);
  assert.equal(received.status, 'complete'); assert.equal(received.candidates.length, 7);
  assert.deepEqual(received.area.corners, f.source.area(100).corners);
  assert.equal(received.evidence.sourcePointsExamined, 120_000);
  assert.deepEqual(received.candidates.map(c => c.rank), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(received.candidates.every(c => c.position[2] === 0));
  const schema = f.requests[0].tools[0].tools.find((item: { name: string }) => item.name === 'scan_area_candidates');
  assert.ok(schema); assert.ok(schema.parameters.properties.settings.required.includes('maxCandidates'));
  assert.equal(schema.parameters.properties.settings.properties.maxCandidates.maximum, 20);
  assert.match(String(f.requests[0].instructions), /LARGE area/);
  assert.deepEqual(f.scene.toronto, []);
  const { points, cad } = await f.snapshots();
  assert.equal(points.entries.length, 0); assert.equal(cad.bodies.length, 0); assert.equal(cad.proposals.length, 0); assert.equal(proposalCallbacks, 0);
  assert.deepEqual((await (await f.fetcher('/datasets/toronto3d/overrides/pending')).json() as { result: unknown[] }).result, []);
  assert.equal(areaCandidatesMatchScene(received, f.source.area(99), points, cad), false);
  assert.equal(areaCandidatesMatchScene(received, f.scene.areaOfInterest, { ...points, revision: points.revision + 1 }, cad), false);
});

test('provider rejects extra settings, model corners, invalid filters and missing active AOI', async t => {
  const invalid = [
    (scene: ModelScene) => ({ settings, corners: scene.areaOfInterest!.corners }),
    (scene: ModelScene) => ({ settings, area: scene.areaOfInterest }),
    () => ({ settings: { ...settings, corners: [] } }), () => ({ settings: { ...settings, dimensions: [1, 1, 1] } }),
    () => ({ settings: { ...settings, spacingMeters: 0 } }), () => ({ settings: { ...settings, clearanceRadiusMeters: -1 } }),
    () => ({ settings: { ...settings, ranking: 'made-up' } }), () => ({ settings: {} }),
  ];
  // Response EOF can precede admission cleanup; independent inputs need independent servers.
  for (const [index, args] of invalid.entries()) await t.test(`malformed input ${index + 1}`, async t => {
    const f = await httpFixture(t);
    f.outputs.push([tool(args(f.scene))]); const events = await f.run();
    assert.equal(events.at(-1)?.kind, 'error'); assert.equal(events.some(e => isWorkflowTool(e)), false);
    const { points, cad } = await f.snapshots(); assert.equal(points.entries.length, 0); assert.equal(cad.proposals.length, 0);
  });
  await t.test('missing active AOI', async t => {
    const f = await httpFixture(t), { areaOfInterest: _, ...noArea } = f.scene;
    f.outputs.push([tool({ settings })]); assert.equal((await f.run(f.call(noArea))).at(-1)?.kind, 'error');
    assert.equal(f.requests.at(-1)!.tools[0].tools.some((item: { name: string }) => item.name === 'scan_area_candidates'), false);
    const { points, cad } = await f.snapshots(); assert.equal(points.entries.length, 0); assert.equal(cad.proposals.length, 0);
  });
});

test('real engine cell-budget failure with unavailable index hashes remains valid through HTTP and UI validator', async t => {
  const f = await httpFixture(t), scene = { ...f.scene, areaOfInterest: f.source.area(1000) };
  f.outputs.push([tool({ settings: { ...settings, spacingMeters: .5 } })], []);
  const events = await f.run(f.call(scene)), result = validateAreaCandidateResult(resultOf(events));
  assert.equal(events.at(-1)?.kind, 'done'); assert.equal(result.status, 'incomplete'); assert.deepEqual(result.candidates, []);
  assert.equal(result.binding.indexHash, ''); assert.equal(result.binding.sourceHash, ''); assert.match(result.reason!, /budget/);
  assert.doesNotThrow(() => validateModelEvent(events.find(e => e.kind === 'tool')!, f.call(scene)));
  const { points, cad } = await f.snapshots(); assert.equal(areaCandidatesMatchScene(result, scene.areaOfInterest, points, cad), true);
  assert.throws(() => validateAreaCandidateResult({ ...result, status: 'complete' }));
});

async function boundFixture(t: { after(fn: () => unknown): void }) {
  const source = await candidateSource(denseGround(4));
  const points = new PointOverrideSession(source.root), cad = new TorontoCadSession(source.root);
  const controller = new AbortController();
  const scene: ModelScene = { mode: 'toronto', toronto: [], areaOfInterest: source.area(100) };
  const bound = await bindModelScene(scene, source.root, controller.signal, undefined, { points, cad });
  t.after(async () => { await bound.close(); await points.close(); await cad.close(); await source.close(); });
  const propose = async (kind: 'point' | 'cad') => {
    if (kind === 'point') {
      const s = await points.execute('snapshot') as PointOverrideSnapshot;
      return await points.execute('propose', { sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision,
        points: [{ key: { sourceFileId: 1, sourceRow: 0 }, position: [.25, .25, 0] }], translation: [0, 0, 1] }) as PointMoveProposal;
    }
    const s = await cad.execute('snapshot') as TorontoCadSnapshot;
    return await cad.execute('propose', { sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision,
      operation: { kind: 'box', center: [30, 30, 1], dimensions: [1, 1, 1] } }) as TorontoCadProposal;
  };
  const scan = () => bound.scanAreaCandidates!(settings, controller.signal);
  return { source, points, cad, bound, controller, propose, scan };
}

for (const kind of ['point', 'cad'] as const) {
  test(`existing pending ${kind} proposal blocks source-only scan without revision advance`, async t => {
    const f = await boundFixture(t); await f.propose(kind);
    await assert.rejects(f.scan());
    assert.equal((await f.points.execute('snapshot') as PointOverrideSnapshot).revision, 0);
    assert.equal((await f.cad.execute('snapshot') as TorontoCadSnapshot).revision, 0);
  });
  test(`accepted ${kind} edit after binding invalidates scan`, async t => {
    const f = await boundFixture(t), proposal = await f.propose(kind);
    if (kind === 'point') await f.points.execute('approve', { sessionId: proposal.sessionId, revision: proposal.revision, proposalId: proposal.proposalId }); else await f.cad.execute('approve', decision(proposal));
    await assert.rejects(f.scan());
  });
  test(`pending ${kind} proposal arriving MID-SCAN prevents publishing original-source candidates`, async t => {
    const f = await boundFixture(t);
    const original = SemanticDiskIndex.prototype.readPage;
    let entered!: () => void, release!: () => void;
    const paused = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let intercepted = false;
    t.mock.method(SemanticDiskIndex.prototype, 'readPage', async function (this: SemanticDiskIndex, ...args: Parameters<typeof original>) {
      if (!intercepted) { intercepted = true; entered(); await gate; }
      return original.apply(this, args);
    });
    const pending = f.scan();
    // Attach rejection observer immediately, before asynchronously mutating authorities.
    const rejected = assert.rejects(pending);
    try { await paused; await f.propose(kind); } finally { release(); }
    await rejected;
    assert.equal((await f.points.execute('snapshot') as PointOverrideSnapshot).revision, 0);
    assert.equal((await f.cad.execute('snapshot') as TorontoCadSnapshot).revision, 0);
  });
}

test('mid-scan cancellation fails closed and overlapping scans cannot bypass per-authority admission', async t => {
  const f = await boundFixture(t), original = SemanticDiskIndex.prototype.readPage;
  let entered!: () => void, release!: () => void;
  const paused = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let intercepted = false;
  t.mock.method(SemanticDiskIndex.prototype, 'readPage', async function (this: SemanticDiskIndex, ...args: Parameters<typeof original>) {
    if (!intercepted) { intercepted = true; entered(); await gate; }
    return original.apply(this, args);
  });
  const cancellation = new AbortController();
  const pending = f.bound.scanAreaCandidates!(settings, cancellation.signal), rejected = assert.rejects(pending);
  try {
    await paused;
    await assert.rejects(f.scan(), { code: 'area-scan-busy' });
    cancellation.abort();
  } finally { release(); }
  await rejected;
  assert.equal((await f.scan()).status, 'complete');
});

for (const kind of ['point', 'cad'] as const) test(`pending ${kind} created after scan invalidates capture/final judgement even without revision advance`, async t => {
  const f = await boundFixture(t);
  assert.equal((await f.scan()).status, 'complete');
  await f.bound.checkAreaCandidates!(f.controller.signal);
  await f.propose(kind);
  await assert.rejects(f.bound.checkAreaCandidates!(f.controller.signal));
});

test('aborted scan and disposed binding cannot return candidates; aborted scan releases admission', async t => {
  const f = await boundFixture(t), aborted = new AbortController(); aborted.abort();
  await assert.rejects(f.bound.scanAreaCandidates!(settings, aborted.signal));
  assert.equal((await f.scan()).status, 'complete');
  await f.bound.close(); await assert.rejects(f.scan());
});
