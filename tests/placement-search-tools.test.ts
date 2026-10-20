import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TORONTO_SEMANTIC_LABELS, canonicalModelChatEvent, type ModelCatalog, type ModelScene, type ModelTurnRequest, type ModelChatEvent, type TorontoCadSnapshot, type TorontoCadProposal } from '@spatial/contracts';
import { createDemoServer } from '../apps/server/src/index';
import { SemanticArtifact } from '../apps/server/src/semantic-artifact';
import { getSemanticDiskIndex, dropSemanticDiskIndexMemoryCache } from '../apps/server/src/semantic-disk-index';
import type { PlacementSearchResponse } from '../apps/server/src/placement-search-session';
import { validateModelEvent, ModelChatController } from '../apps/web/src/model-chat-client';

const settings = { dimensions: [1, 1, 1.2], frontAccessDepth: .5, poleSeparation: 0, maxGroundSlopeDegrees: 1, maxGroundRelief: .1, spacingMeters: 1, allowedYawDegrees: [0] };
const tool = (name: string, args: unknown) => ({ type: 'function_call', namespace: 'scene', name, call_id: `call_${name}`, arguments: JSON.stringify(args) });
const sse = (output: unknown[]) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const CAD = '/datasets/toronto3d/cad', PLACEMENT = '/datasets/toronto3d/placement';
const tools = (body: Record<string, unknown>) => (body.tools as { tools: { name: string }[] }[])[0].tools;
const proposalRequest = (p: TorontoCadProposal) => ({ sessionId: p.sessionId, revision: p.revision, artifactRevision: p.artifactRevision, proposalId: p.proposalId });
async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), 'placement-model-')); await mkdir(join(root, 'octree'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 1, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-100, -100, -100], max: [100, 100, 200] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-100, -100, -100], max: [100, 100, 200] }, { name: 'rgb', type: 'uint16', size: 6 },
      { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(28); payload.writeInt32LE(-10000, 0); payload.writeInt32LE(-10000, 4); payload.writeUInt16LE(1, 18); payload.writeFloatLE(1, 24);
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(1, 2); hierarchy.writeBigUInt64LE(28n, 14);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale,
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? 1 : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const artifact = await SemanticArtifact.open(root), { index } = await getSemanticDiskIndex(artifact);
  const previous = process.env.SPATIAL_PREPROCESSING_PATH; process.env.SPATIAL_PREPROCESSING_PATH = join(root, 'terrain.json');
  const cells = Array.from({ length: 100 }, (_, i) => ({ x: i % 10 - 2, y: Math.floor(i / 10) - 2, points: 3, elevation: 0, maxElevation: 0 }));
  await writeFile(process.env.SPATIAL_PREPROCESSING_PATH, JSON.stringify({ version: 'scene-preprocessing-v1', complete: true, binding: { datasetId: 'toronto3d', artifactRevision: artifact.dataset.revision,
    frameId: 'toronto3d-local-v1', units: 'm', coordinates: artifact.dataset.coordinates, indexHash: index.hash, sourceHash: index.sourceHash, instanceManifestHash: 'a'.repeat(64), membershipHash: 'b'.repeat(64) },
    instances: [], ground: { cellMeters: 1, origin: [0, 0], labels: [1, 2], method: 'observed-cell-minimum-v1', minimumSupport: 3, points: cells.length * 3, cells } }));
  const scene: ModelScene = { mode: 'toronto', project: null, toronto: [], areaOfInterest: { datasetId: 'toronto3d', artifactRevision: artifact.dataset.revision,
    frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0], corners: [[0, 0, 100], [4, 0, 100], [4, 4, 100], [0, 4, 100]] } };
  const outputs: unknown[][] = [], requests: Record<string, unknown>[] = [];
  const server = createDemoServer({ datasetRoot: root, projectPath: join(root, 'project.json'), provider: { mode: 'api-key', apiKey: 'synthetic-not-a-credential' },
    modelTransport: async (url, init) => {
      if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture-model' }] });
      requests.push(JSON.parse(String(init?.body))); return sse(outputs.shift() ?? []);
    } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  const fetcher: typeof fetch = (input, init) => fetch(base + String(input), init);
  const post = async (path: string, value: unknown) => {
    const r = await fetcher(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    return { status: r.status, body: await r.json() as { result: any } };
  };
  const catalog = await (await fetcher('/chat/models')).json() as ModelCatalog;
  const call = (s = scene, conversationId: string | null = null): ModelTurnRequest => ({ requestId: 'fixture-request', conversationId,
    generation: catalog.generation, model: 'fixture-model', text: 'Search with the stated settings; do not choose or propose a site.', scene: s });
  const run = async (request = call(), onEvent?: (e: ModelChatEvent) => Promise<void>) => {
    const r = await fetcher('/chat/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }); assert.equal(r.status, 200);
    const events: ModelChatEvent[] = []; let pending = '';
    const reader = r.body!.getReader(), decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      pending += decoder.decode(value, { stream: true });
      for (;;) {
        const end = pending.indexOf('\n'); if (end < 0) break;
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        const event = canonicalModelChatEvent(JSON.parse(line)); events.push(event); await onEvent?.(event);
      }
    }
    assert.equal(pending, ''); return events;
  };
  const snapshot = async () => (await (await fetcher(CAD)).json() as { result: TorontoCadSnapshot }).result;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.SPATIAL_PREPROCESSING_PATH; else process.env.SPATIAL_PREPROCESSING_PATH = previous;
    dropSemanticDiskIndexMemoryCache(); await artifact.close(); await rm(index.directory, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); });
  return { scene, outputs, requests, fetcher, post, call, run, snapshot };
}
function shortlist(events: ModelChatEvent[]): PlacementSearchResponse {
  const event = events.find(e => e.kind === 'tool' && e.name === 'search_placement_sites'); assert.ok(event && event.kind === 'tool');
  return (event.context as { result: PlacementSearchResponse }).result;
}

test('fake provider AOI search connects shared viewer/session shortlist, later exact proposal, and authority-owned human approval pause', async t => {
  const f = await fixture(t); f.outputs.push([tool('search_placement_sites', { settings })], []);
  const first = await f.run(), result = shortlist(first); assert.equal(result.status, 'complete'); assert.ok(result.candidates.length);
  assert.equal(first.at(-1)?.kind, 'done'); assert.equal(first.some(e => e.kind === 'approval-wait'), false);
  assert.deepEqual(result.specification.parameters.area.corners, f.scene.areaOfInterest!.corners);
  assert.deepEqual(result.specification.parameters.dimensions, settings.dimensions);
  assert.deepEqual(result.candidates.map(c => c.rank), result.candidates.map((_, i) => i + 1));
  assert.equal((await f.snapshot()).proposals.length, 0); assert.equal((await f.snapshot()).bodies.length, 0);
  assert.ok(tools(f.requests[0]).some(t => t.name === 'search_placement_sites'));
  const instructions = String(f.requests[0].instructions);
  for (const text of ['material missing requirements', 'illustrative values', 'Do not automatically pick', 'explicit human request for an exact candidate', 'normal/current view', 'not automated top-down', 'numerical rank/metrics separate', 'never recreate its operation through a generic CAD tool']) assert.ok(instructions.includes(text), text);
  const args = { searchId: result.searchId, candidateId: result.candidates[0].id };
  // UI can consume an AI search without running another search or copying an operation.
  const uiProposal = await f.post(PLACEMENT + '/propose', args); assert.equal(uiProposal.status, 200);
  assert.deepEqual(uiProposal.body.result.operation, result.candidates[0].operation);
  assert.equal((await f.post(CAD + '/decline', proposalRequest(uiProposal.body.result))).status, 200);
  const done = first.at(-1); assert.ok(done?.kind === 'done');
  f.outputs.push([tool('propose_placement_site', args)], []);
  const request = { ...f.call(f.scene, done.conversationId), text: 'Propose the exact first shortlisted site; I will review the ghost.' };
  let pendingSeen = false;
  const second = await f.run(request, async event => {
    if (event.kind !== 'tool' || event.name !== 'propose_placement_site') return;
    const c = event.context as { kind: string; status: string; proposal: TorontoCadProposal };
    assert.equal(c.kind, 'toronto-cad-proposal'); assert.equal(c.status, 'pending'); assert.equal(c.proposal.mesh, undefined);
    assert.deepEqual(c.proposal.operation, result.candidates[0].operation);
    const before = await f.snapshot(); assert.equal(before.bodies.length, 0); assert.equal(before.revision, 0); pendingSeen = true;
    assert.equal((await f.post(CAD + '/approve', proposalRequest(c.proposal))).status, 200);
  });
  assert.equal(pendingSeen, true);
  assert.ok(second.some(e => e.kind === 'approval-wait' && e.authority === 'cad'));
  assert.ok(second.some(e => e.kind === 'approval-result' && e.authority === 'cad' && e.outcome === 'accepted'));
  assert.equal(second.at(-1)?.kind, 'done'); assert.equal((await f.snapshot()).bodies.length, 1);
});

test('strict settings/candidate allowlists reject model corners, operations, foreign candidates, and model approval without a CAD mutation', async t => {
  const f = await fixture(t);
  const invalid = [
    ['search_placement_sites', { settings, area: f.scene.areaOfInterest }], ['search_placement_sites', { settings: { ...settings, corners: [] } }],
    ['search_placement_sites', { settings: { ...settings, dimensions: [1, -1, 1] } }], ['search_placement_sites', { settings: { ...settings, frontAccessDepth: -1 } }],
    ['search_placement_sites', { settings: { ...settings, maxGroundSlopeDegrees: 90 } }], ['search_placement_sites', { settings: { ...settings, spacingMeters: 0 } }],
    ['search_placement_sites', { settings: { ...settings, allowedYawDegrees: [45] } }], ['search_placement_sites', { settings: { dimensions: [1, 1, 1] } }],
    ['propose_placement_site', { searchId: 'foreign', candidateId: 'foreign', operation: { kind: 'box' } }],
    ['propose_placement_site', { searchId: '', candidateId: 'site' }], ['approve', {}], ['approve_placement_site', {}], ['undo', {}],
  ] as const;
  for (const [name, args] of invalid) {
    f.outputs.push([tool(name, args)]); const events = await f.run(); assert.equal(events.at(-1)?.kind, 'error', name);
  }
  f.outputs.push([tool('search_placement_sites', { settings })], []); const r = shortlist(await f.run());
  for (const args of [{ searchId: r.searchId, candidateId: 'foreign' }, { searchId: 'foreign', candidateId: r.candidates[0].id }]) {
    f.outputs.push([tool('propose_placement_site', args)]); assert.equal((await f.run()).at(-1)?.kind, 'error');
  }
  assert.equal((await f.snapshot()).proposals.length, 0); assert.equal((await f.snapshot()).bodies.length, 0);
  const { areaOfInterest: _, ...noArea } = f.scene;
  f.outputs.push([tool('search_placement_sites', { settings })]); assert.equal((await f.run(f.call(noArea))).at(-1)?.kind, 'error');
  assert.ok(!tools(f.requests.at(-1)!).some(t => t.name === 'search_placement_sites'));
  f.outputs.push([tool('propose_placement_site', { searchId: r.searchId, candidateId: r.candidates[0].id })]);
  assert.equal((await f.run(f.call({ mode: 'demo', project: null, toronto: [] }))).at(-1)?.kind, 'error');
});

test('viewer HTTP search is usable by model; latest-search invalidation cannot be bypassed', async t => {
  const f = await fixture(t), a = await f.post(PLACEMENT + '/search', { area: f.scene.areaOfInterest, settings }), b = await f.post(PLACEMENT + '/search', { area: f.scene.areaOfInterest, settings });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  f.outputs.push([tool('propose_placement_site', { searchId: a.body.result.searchId, candidateId: a.body.result.candidates[0].id })]);
  assert.equal((await f.run()).at(-1)?.kind, 'error'); assert.equal((await f.snapshot()).proposals.length, 0);
  f.outputs.push([tool('propose_placement_site', { searchId: b.body.result.searchId, candidateId: b.body.result.candidates[0].id })], []);
  const { areaOfInterest: _, ...noArea } = f.scene;
  const events = await f.run({ ...f.call(noArea), text: 'Propose this exact retained site.' }, async event => {
    if (event.kind === 'tool' && event.name === 'propose_placement_site') {
      const p = (event.context as { proposal: TorontoCadProposal }).proposal;
      assert.equal((await f.post(CAD + '/decline', proposalRequest(p))).status, 200);
    }
  });
  assert.ok(events.some(e => e.kind === 'approval-result' && e.outcome === 'declined')); assert.equal((await f.snapshot()).bodies.length, 0);
});

test('client accepts bounded additive placement tool events, delivers shortlist callback, and refreshes CAD on site proposal', async t => {
  const f = await fixture(t), seen: unknown[] = [], waits: boolean[] = []; let refreshes = 0, decisionTask: Promise<void> | undefined;
  const client = new ModelChatController(() => {}, f.fetcher, undefined, undefined, {
    onplacementsearch: (r, current) => { assert.equal(current(), true); seen.push(r); },
    onapprovalwait: waiting => waits.push(waiting),
    onauthorityproposal: kind => {
      assert.equal(kind, 'cad'); refreshes++;
      decisionTask = (async () => { const snapshot = await f.snapshot(); assert.equal(snapshot.bodies.length, 0);
        assert.equal((await f.post(CAD + '/decline', proposalRequest(snapshot.proposals[0]))).status, 200); })();
    },
  });
  t.after(() => client.dispose()); client.bind(f.scene); await client.refreshModels(); client.selectModel('fixture-model');
  f.outputs.push([tool('search_placement_sites', { settings })], []); assert.equal(await client.send('Find sites using these explicit settings.'), true);
  assert.equal(client.view.phase, 'completed'); assert.equal(seen.length, 1); assert.ok((seen[0] as PlacementSearchResponse).candidates.length);
  const searchEvent = { kind: 'tool', requestId: 'fixture-request', name: 'search_placement_sites', context: { kind: 'placement-search-result', result: seen[0] } };
  assert.doesNotThrow(() => validateModelEvent(searchEvent, f.call()));
  assert.throws(() => validateModelEvent(searchEvent, f.call({ mode: 'demo', project: null, toronto: [] })));
  assert.doesNotThrow(() => validateModelEvent({ ...searchEvent, name: 'propose_placement_site', context: { kind: 'toronto-cad-proposal', status: 'pending', proposal: {} } }, f.call()));
  const result = seen[0] as PlacementSearchResponse;
  f.outputs.push([tool('propose_placement_site', { searchId: result.searchId, candidateId: result.candidates[0].id })], []);
  assert.equal(await client.send('Propose the exact first shortlisted site, pending my review.'), true); await decisionTask;
  assert.equal(refreshes, 1); assert.equal(waits.filter(Boolean).length, 1); assert.equal(waits[waits.indexOf(true) + 1], false); assert.equal(client.view.phase, 'completed'); assert.equal((await f.snapshot()).bodies.length, 0);
});
