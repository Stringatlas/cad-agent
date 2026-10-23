import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { ProviderModel, ModelError, type BoundModelScene } from '../../apps/server/src/agent/provider-model';
import { ProviderAuth } from '../../apps/server/src/auth/provider-auth';
import { ModelBrowserBroker } from '../../apps/server/src/agent/model-browser-broker';
import { createModelAgentRuntime } from '../../apps/server/src/agent/model-agent-runtime';
import { constructAgentCamera } from '../../apps/web/src/viewer/agent-camera';
import { withProductSkills } from '../helpers/product-skill-transport';
import { canonicalSceneEvidenceLookup, type ModelChatEvent, type ModelScene, type ModelTurnRequest, type ModelVisualObservation } from '@spatial/contracts';
const revision = 'a'.repeat(64), point = [1e-12, 0, 0] as const;
const tool = (name: string, args: unknown, id: string) => ({ type: 'function_call', namespace: 'scene', name, call_id: id, arguments: JSON.stringify(args) });
const nearest = { operation: 'nearest', position: [0, 0, 0], maxResults: 1 };
const output = (body: any, id: string) => JSON.parse(body.input.findLast((item: any) => item.type === 'function_call_output' && item.call_id === id).output);
function png() {
  const chunk = (name: string, bytes: Buffer) => { const payload = Buffer.concat([Buffer.from(name), bytes]); let crc = 0xffffffff; for (const b of payload) { crc ^= b; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; } const out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); payload.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(5))), chunk('IEND', Buffer.alloc(0))]);
}
async function fixture(t: { after(fn: () => unknown): void }, cloudId = 'fixture') {
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'fixture-no-live-inference' });
  const replies: (unknown[] | ((body: any) => unknown[] | Promise<unknown[]>))[] = [], bodies: any[] = [], events: ModelChatEvent[] = [];
  let serial = 0, captures = 0, afterDone = false, unavailableQuery = false, unsupportedQuery = false, now = 0;
  const model = new ProviderModel(auth, withProductSkills(async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture-model' }] });
    const body = JSON.parse(String(init?.body)); bodies.push(body); const next = replies.shift(); assert(next, 'Unexpected provider round');
    const result = typeof next === 'function' ? await next(body) : next;
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: result } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }, ['scene-inspection', 'visual-inspection']), () => now);
  t.after(() => { model.close(); auth.close(); }); const controller = new AbortController(), catalog = await model.models(controller.signal);
  const scene: ModelScene = { mode: 'cloud', toronto: [], cloud: { id: cloudId, revision, frameId: 'local', localOrigin: [0, 0, 0], points: [] } };
  const run = async (conversationId: string | null = null, options: { failDone?: 'emit' | 'postcheck'; scene?: ModelScene } = {}) => {
    events.length = 0; afterDone = false; const current = options.scene ?? scene;
    const call: ModelTurnRequest = { requestId: `turn-${++serial}`, conversationId, generation: catalog.generation, model: 'fixture-model', text: 'Investigate', scene: current };
    const binding = { sourceId: current.cloud!.id, sourceRevision: current.cloud!.revision, frameId: current.cloud!.frameId, units: 'm' as const, origin: current.cloud!.localOrigin };
    const bound: BoundModelScene = { context: { dataset: { bounds: { min: [-10, -10, -10], max: [10, 10, 10] } } }, sceneMarkBinding: { mode: 'cloud', cloudId: binding.sourceId, artifactRevision: binding.sourceRevision, frameId: binding.frameId, units: 'm', localOrigin: binding.origin }, async check() { if (afterDone) throw new ModelError('stale-scene'); }, async close() {}, async resolveReference() { return point; },
      async queryPoints() { return unsupportedQuery ? { complete: false, points: [], limitation: 'Partial adapter result' } : unavailableQuery ? { status: 'unavailable', complete: false, reason: 'spatial-query-busy' } : { kind: 'source-point-query', datasetId: binding.sourceId, artifactRevision: binding.sourceRevision, frameId: binding.frameId, units: 'm', complete: true, count: 1, checkedPoints: 1, points: [{ key: { sourceFileId: 1, sourceRow: 7 }, position: point }] }; } };
    const broker = new ModelBrowserBroker(call.requestId, controller.signal, async event => {
      assert(event.kind === 'browser-request' && event.action.kind === 'capture'); captures++;
      const request = event.action.request; assert(request.kind === 'framed' || request.kind === 'adjust');
      const view = constructAgentCamera(request, 1, '雪'.repeat(128), 'rgb'), c = view.camera, bytes = png();
      const image: ModelVisualObservation = { schemaVersion: 1, observationId: `observation-${serial}-${captures}`, viewGeneration: 1, image: { mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length }, viewport: { width: 1, height: 1, pixelRatio: 1, pixelOrigin: 'top-left' }, binding,
        camera: { position: c.position.toArray(), quaternion: c.quaternion.toArray(), up: c.up.toArray(), near: c.near, far: c.far, fov: c.fov, aspect: 1, zoom: 1, matrixWorld: c.matrixWorld.toArray(), matrixWorldInverse: c.matrixWorldInverse.toArray(), projectionMatrix: c.projectionMatrix.toArray() }, coverage: { kind: 'fixture-points', complete: false, displayedPointCount: 1, agentView: JSON.parse(JSON.stringify(view.receipt)), grounding: { status: 'ready', method: 'point-center-within-3px', bytes: 1234, expiresInMs: 300000 } } };
      broker.accept({ requestId: call.requestId, toolCallId: event.toolCallId, nonce: event.nonce, result: { status: 'captured', observation: image } });
    });
    const runtime = createModelAgentRuntime(call, bound, '/unused', controller.signal, broker, undefined, undefined, async args => ({ status: 'resolved', ...args, provenance: { datasetId: binding.sourceId, artifactRevision: binding.sourceRevision, key: { sourceFileId: 1, sourceRow: 7 }, position: point, frameId: binding.frameId, units: 'm', origin: binding.origin, layer: 'original-source' } }));
    try { await model.turn(call, runtime, async event => { events.push(event); if (event.kind === 'done') { if (options.failDone === 'emit') throw Error('Downstream failed'); if (options.failDone === 'postcheck') afterDone = true; } }, controller.signal); }
    finally { await runtime.close(); }
    const done = [...events].reverse().find(event => event.kind === 'done'); assert(done?.kind === 'done'); return done.conversationId;
  };
  return { replies, bodies, events, scene, run, model, captures: () => captures, unavailable: () => { unavailableQuery = true; }, partial: () => { unsupportedQuery = true; }, advance: () => { now += 30 * 60 * 1000; } };
}
test('actual provider/runtime issues query receipt, looks up same turn and follow-up, rejects cross-conversation and stale/expired handles', async t => {
  const f = await fixture(t, 'toronto3d'); let id = '';
  f.replies.push([tool('query_points', nearest, 'query-one')], body => { const q = output(body, 'query-one'); assert.equal(q.count, 1); id = q.explorationEvidence.evidenceId; assert(id); return [tool('get_scene_evidence', { evidenceId: id }, 'lookup-one')]; }, body => { const value = canonicalSceneEvidenceLookup(output(body, 'lookup-one')); assert(value.status === 'available'); assert.equal(value.receipt.adapter, 'prepared'); assert.equal(value.receipt.sourceBinding.sourceId, 'toronto3d'); assert(value.receipt.projection.tool === 'query_points'); assert.deepEqual(value.receipt.projection.result.witnesses[0]!.position, point); return []; });
  const cid = await f.run();
  f.replies.push(body => { assert(body.input.some((item: any) => item.role === 'developer' && String(item.content).startsWith('Retained historical evidence catalogue') && String(item.content).includes(id))); return [tool('get_scene_evidence', { evidenceId: id }, 'lookup-two')]; }, body => { assert.equal(output(body, 'lookup-two').status, 'available'); return []; });
  assert.equal(await f.run(cid), cid);
  f.replies.push([tool('get_scene_evidence', { evidenceId: id }, 'foreign-lookup')], body => { assert.deepEqual(output(body, 'foreign-lookup'), { status: 'unavailable', reason: 'not-retained' }); return []; });
  await f.run();
  await assert.rejects(f.run(cid, { scene: { ...f.scene, cloud: { ...f.scene.cloud!, revision: 'b'.repeat(64) } } }), { code: 'stale-conversation' });
  f.advance(); await assert.rejects(f.run(cid), { code: 'stale-conversation' });
});
for (const failDone of ['emit', 'postcheck'] as const) test(`failed final ${failDone} rolls back draft UUIDs/history and keeps committed checkpoint`, async t => {
  const f = await fixture(t); let oldId = '';
  f.replies.push([tool('query_points', nearest, 'committed-query')], body => { oldId = output(body, 'committed-query').explorationEvidence.evidenceId; return []; });
  const cid = await f.run();
  f.replies.push([tool('query_points', nearest, 'draft-query')], []);
  await assert.rejects(f.run(cid, { failDone }));
  const draft = f.events.find(event => event.kind === 'tool' && event.name === 'query_points'); assert(draft?.kind === 'tool'); const draftId = (draft.context as any).explorationEvidence.evidenceId; assert(draftId && draftId !== oldId);
  f.replies.push(body => { assert(!body.input.some((item: any) => item.type === 'function_call' && item.call_id === 'draft-query')); return [tool('get_scene_evidence', { evidenceId: draftId }, 'draft-lookup'), tool('get_scene_evidence', { evidenceId: oldId }, 'old-lookup')]; }, body => { assert.equal(output(body, 'draft-lookup').status, 'unavailable'); assert.equal(output(body, 'old-lookup').status, 'available'); return []; });
  await f.run(cid);
});
test('invalid capture admission creates no fictional receipt; actual normalized capture and independently verified pixel create metadata-only receipts', async t => {
  const f = await fixture(t); let observationId = '', captureId = '', pixelId = '';
  const frame = { kind: 'frame', target: { kind: 'reference', reference: { kind: 'cloud-point', cloudId: 'fixture', revision, key: { sourceFileId: 1, sourceRow: 7 } }, spanMeters: 2 }, orientation: 'top' };
  f.replies.push([tool('capture_scene', { ...frame, target: { ...frame.target, spanMeters: 0 } }, 'invalid-frame')], body => {
    assert.deepEqual(output(body, 'invalid-frame'), { status: 'unavailable', reason: 'invalid-region' });
    return [tool('capture_scene', { kind: 'relative', observationId: 'unknown', azimuthDeltaDegrees: 0, elevationDeltaDegrees: 0, distanceScale: 1 }, 'invalid-base')];
  }, body => { const r = output(body, 'invalid-base'); assert.equal(r.reason, 'view-unavailable'); assert(!r.explorationEvidence?.evidenceId); return [tool('capture_scene', frame, 'capture')]; }, body => {
    const r = output(body, 'capture'); assert.equal(r.status, 'captured'); captureId = r.explorationEvidence.evidenceId; observationId = r.observation.observationId;
    return [tool('resolve_visual_pixel', { observationId, x: 0, y: 0 }, 'pixel')];
  }, body => { const r = output(body, 'pixel'); assert.equal(r.recordValidation, 'server-verified-original-record'); pixelId = r.explorationEvidence.evidenceId; return [tool('get_scene_evidence', { evidenceId: captureId }, 'capture-lookup'), tool('get_scene_evidence', { evidenceId: pixelId }, 'pixel-lookup')]; }, body => {
    const cp = output(body, 'capture-lookup').receipt.projection, pp = output(body, 'pixel-lookup').receipt.projection;
    assert.equal(cp.tool, 'capture_scene'); assert.equal(cp.effective.kind, 'framed'); assert.equal(cp.request.kind, 'frame'); assert.deepEqual(cp.authority, { status: 'unknown', reason: 'not-available' });
    assert(cp.requestedScopeHash && cp.effectiveScopeHash); assert(!JSON.stringify(cp).includes('data:image')); assert.equal(cp.result.observation.agentView.layer, '雪'.repeat(128));
    assert.equal(pp.result.recordValidation, 'server-verified-original-record'); assert.equal(pp.result.visibility, 'browser-observed-capture-time'); assert.deepEqual(pp.result.position, point);
    assert.equal(body.input.flatMap((item: any) => Array.isArray(item.content) ? item.content.filter((c: any) => c.type === 'input_image') : []).length, 1, 'Lookup adds no image');
    return [];
  });
  await f.run(); assert.equal(f.captures(), 1);
});
test('admitted unavailable query is retained as unknown coverage without invented zero count', async t => {
  const f = await fixture(t); f.unavailable();
  f.replies.push([tool('query_points', nearest, 'unavailable-query')], body => { const r = output(body, 'unavailable-query'); assert.equal(r.status, 'unavailable'); assert.equal(r.count, undefined); return [tool('get_scene_evidence', { evidenceId: r.explorationEvidence.evidenceId }, 'unavailable-lookup')]; }, body => { const p = output(body, 'unavailable-lookup').receipt.projection; assert.equal(p.result.complete, false); assert.equal(p.result.count, undefined); assert.equal(p.result.status, 'unavailable'); return []; });
  await f.run();
});

test('provider approval rebuild resets authority-bound marks but retains immutable same-source historical capture receipt', async t => {
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'fixture-no-live-inference' }), signal = new AbortController().signal;
  const source = { sourceId: 'toronto3d', sourceRevision: revision, frameId: 'toronto3d-local-v1', units: 'm' as const, origin: [627285, 4841948, 0] as const };
  let cadRevision = 0, evidenceId = '', round = 0;
  const part = (name: string) => ({ sessionId: name, revision: 0, artifactRevision: revision, pendingProposalIds: [] });
  const authority = { status: 'known' as const, points: part('points'), cad: part('cad'), objects: part('objects') };
  const c = new THREE.PerspectiveCamera(50, 1, .1, 100); c.position.set(0, 0, 10); c.lookAt(0, 0, 0); c.updateMatrixWorld(); const bytes = png();
  const image: ModelVisualObservation = { schemaVersion: 1, observationId: 'historical-capture', viewGeneration: 1, image: { mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length }, viewport: { width: 1, height: 1, pixelRatio: 1, pixelOrigin: 'top-left' }, binding: source, coverage: { kind: 'fixture', complete: false, displayedPointCount: 1 }, camera: { position: c.position.toArray(), quaternion: c.quaternion.toArray(), up: c.up.toArray(), near: c.near, far: c.far, fov: c.fov, aspect: 1, zoom: 1, matrixWorld: c.matrixWorld.toArray(), matrixWorldInverse: c.matrixWorldInverse.toArray(), projectionMatrix: c.projectionMatrix.toArray() } };
  const scene: ModelScene = { mode: 'toronto', toronto: [] };
  const bound: BoundModelScene = { context: {}, captureCapabilities: { binding: source, referenceKind: 'toronto-point', bounds: { min: [-1, -1, -1], max: [1, 1, 1] }, colorModes: ['rgb'], targetKinds: ['original-source-point', 'box', 'polygon-prism'], relativeViews: true, layer: 'current-browser-layer' },
    get sceneMarkBinding() { return { artifactRevision: revision, frameId: 'toronto3d-local-v1' as const, units: 'm' as const, localOrigin: source.origin, cad: { sessionId: 'cad', revision: cadRevision } }; },
    captureEvidenceAdmission: { request: { kind: 'current' }, effective: { kind: 'current' }, authority }, async captureScene() { return image; }, async check() {}, async close() {}, async proposeCad() { return { proposalId: 'proposal' }; }, async waitForApproval() { cadRevision++; return { outcome: 'accepted', scene, context: {} }; } };
  const model = new ProviderModel(auth, withProductSkills(async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture-model' }] });
    const body = JSON.parse(String(init?.body)); let commands: unknown[];
    if (round++ === 0) commands = [tool('capture_scene', { kind: 'current' }, 'before-capture')];
    else if (round === 2) { evidenceId = output(body, 'before-capture').explorationEvidence.evidenceId; assert(evidenceId); commands = [tool('set_scene_marks', { expectedRevision: 0, marks: [{ position: [0, 0, 0], rationale: 'Before authority edit', uncertainty: 'Unknown' }] }, 'before-marks')]; }
    else if (round === 3) commands = [tool('propose_cad_box', { center: [0, 0, 0], dimensions: [1, 1, 1] }, 'proposal')];
    else if (round === 4) commands = [tool('get_scene_marks', {}, 'after-marks'), tool('get_scene_evidence', { evidenceId }, 'after-evidence')];
    else { assert.deepEqual(output(body, 'after-marks').marks, []); const receipt = output(body, 'after-evidence').receipt; assert.equal(receipt.projection.authority.cad.revision, 0); assert.equal(cadRevision, 1); assert.equal(receipt.projection.result.observation.observationId, image.observationId); commands = []; }
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: commands } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }, ['candidate-assessment', 'toronto-geometry']));
  t.after(() => { model.close(); auth.close(); }); const catalog = await model.models(signal);
  await model.turn({ requestId: 'authority', conversationId: null, generation: catalog.generation, model: 'fixture-model', text: 'Test authority scope', scene }, bound, async () => {}, signal);
});


test('unsupported retained projection leaves the successful partial operation result intact and issues no ID', async t => {
  const f = await fixture(t); f.partial();
  f.replies.push([tool('query_points', nearest, 'partial-query')], body => {
    const result = output(body, 'partial-query'); assert.equal(result.complete, false); assert.deepEqual(result.points, []); assert.equal(result.limitation, 'Partial adapter result');
    assert.deepEqual(result.explorationEvidence, { status: 'unavailable', reason: 'unsupported-result' }); return [];
  });
  await f.run();
});
