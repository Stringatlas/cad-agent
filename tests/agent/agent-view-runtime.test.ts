import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createModelAgentRuntime } from '../../apps/server/src/agent/model-agent-runtime';
import { ModelBrowserBroker } from '../../apps/server/src/agent/model-browser-broker';
import { ProviderModel, type BoundModelScene } from '../../apps/server/src/agent/provider-model';
import { ProviderAuth } from '../../apps/server/src/auth/provider-auth';
import { withProductSkills } from '../helpers/product-skill-transport';
import { constructAgentCamera } from '../../apps/web/src/viewer/agent-camera';
import { canonicalAgentViewReceipt, canonicalModelBrowserAction, type ModelBrowserAction, type ModelChatEvent, type ModelScene, type ModelVisualObservation, type BrowserCaptureRequest, type ModelTurnRequest } from '@spatial/contracts';
const binding = { sourceId: 'stpls3d-1', sourceRevision: 'a'.repeat(64), frameId: 'local', units: 'm' as const, origin: [0, 0, 0] as const };
function png() {
  const chunk = (name: string, bytes: Buffer) => { const payload = Buffer.concat([Buffer.from(name), bytes]); let crc = 0xffffffff; for (const b of payload) { crc ^= b; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; } const out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); payload.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(5))), chunk('IEND', Buffer.alloc(0))]);
}
function observation(request: BrowserCaptureRequest, id: string): ModelVisualObservation {
  assert(request.kind === 'framed' || request.kind === 'adjust');
  const v = constructAgentCamera(request, 1, 'points', 'rgb'), c = v.camera, bytes = png();
  return { schemaVersion: 1, observationId: id, viewGeneration: 1, image: { mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length },
    viewport: { width: 1, height: 1, pixelRatio: 1, pixelOrigin: 'top-left' }, camera: { position: c.position.toArray(), quaternion: c.quaternion.toArray(), up: c.up.toArray(), near: c.near, far: c.far, fov: c.fov, aspect: c.aspect, zoom: c.zoom, matrixWorld: c.matrixWorld.toArray(), matrixWorldInverse: c.matrixWorldInverse.toArray(), projectionMatrix: c.projectionMatrix.toArray() },
    binding, coverage: { kind: 'fixture-points', complete: false, displayedPointCount: 1, grounding: { status: 'unavailable' }, agentView: JSON.parse(JSON.stringify(v.receipt)) } };
}
function fixture() {
  const scene: ModelScene = { mode: 'cloud', toronto: [], cloud: { id: binding.sourceId, revision: binding.sourceRevision, frameId: binding.frameId, localOrigin: binding.origin, points: [] } };
  const controller = new AbortController(), requests: ModelBrowserAction[] = []; let serial = 0, fail = false, stale = false, lookups = 0, forged = false;
  const bound: BoundModelScene = { context: { dataset: { bounds: { min: [-10, -10, -10], max: [10, 10, 10] } } }, async check() { if (stale) throw Object.assign(new Error('stale'), { code: 'stale-scene' }); }, async close() {}, async resolveReference(ref) { assert.equal(ref.kind, 'cloud-point'); lookups++; return [.000000000001, 0, 0]; } };
  const call: ModelTurnRequest = { requestId: 'view', conversationId: null, generation: 'test', model: 'test', text: 'Explore', scene };
  const broker = new ModelBrowserBroker(call.requestId, controller.signal, async event => {
    assert.equal(event.kind, 'browser-request'); if (event.kind !== 'browser-request') return;
    const action = canonicalModelBrowserAction(event.action); requests.push(action); assert.equal(action.kind, 'capture'); if (action.kind !== 'capture') return;
    const image = fail ? undefined : observation(action.request, `image-${++serial}`);
    if (forged && image) (image.coverage.agentView as Record<string, unknown>).pivot = [999, 0, 0];
    broker.accept({ requestId: call.requestId, toolCallId: event.toolCallId, nonce: event.nonce, result: image ? { status: 'captured', observation: image } : { status: 'unavailable', reason: 'detail-unavailable' } });
  });
  const runtime = createModelAgentRuntime(call, bound, '/unused', controller.signal, broker, undefined, undefined, async args => ({ status: 'no-hit', ...args, reason: 'Fixture has no matching point' }));
  const frame = { kind: 'frame' as const, target: { kind: 'reference' as const, reference: { kind: 'cloud-point' as const, cloudId: binding.sourceId, revision: binding.sourceRevision, key: { sourceFileId: 1, sourceRow: 7 } }, spanMeters: 2 }, orientation: 'top' as const };
  const relative = (id: string) => ({ kind: 'relative' as const, observationId: id, azimuthDeltaDegrees: 90, elevationDeltaDegrees: -45, distanceScale: .5 });
  return { runtime, requests, controller, frame, relative, scene, lookups: () => lookups, fail: () => fail = true, stale: () => stale = true, forge: () => forged = true };
}
test('unattached original frame is resolved independently, normalized without selection, then relative from issued image despite unavailable grounding', async () => {
  const f = fixture(), first = await f.runtime.captureScene!(f.frame, 'frame'); assert(first && !('status' in first));
  assert.equal(f.lookups(), 1); assert.equal(f.scene.cloud!.points.length, 0);
  const request = (f.requests[0] as Extract<ModelBrowserAction, { kind: 'capture' }>).request; assert.equal(request.kind, 'framed');
  if (request.kind === 'framed') assert.deepEqual(request.bounds, { min: [-.999999999999, -1, -1], max: [1.000000000001, 1, 1] });
  const second = await f.runtime.captureScene!(f.relative(first.observationId), 'relative'); assert(second && !('status' in second));
  assert.equal(f.requests.length, 2); assert.equal((second.coverage.agentView as Record<string, unknown>).azimuthDegrees, 135);
  await f.runtime.close();
});
test('unknown/old IDs and failed replacement are recoverable without current-camera fallback', async () => {
  const f = fixture(); assert.deepEqual(await f.runtime.captureScene!(f.relative('historical'), 'wrong'), { status: 'unavailable', reason: 'view-unavailable' }); assert.equal(f.requests.length, 0);
  const first = await f.runtime.captureScene!(f.frame, 'first'); assert(first && !('status' in first)); f.fail();
  assert.deepEqual(await f.runtime.captureScene!(f.relative(first.observationId), 'failed'), { status: 'unavailable', reason: 'detail-unavailable' });
  assert.deepEqual(await f.runtime.captureScene!(f.relative(first.observationId), 'old'), { status: 'unavailable', reason: 'view-unavailable' }); assert.equal(f.requests.length, 2); await f.runtime.close();
});
test('bound declared box outside source is recoverable, wrong identity is hard and forged receipts fail closed', async () => {
  const f = fixture(), region = { binding, shape: { kind: 'box' as const, bounds: { min: [100, 100, 100] as const, max: [101, 101, 101] as const } } };
  assert.deepEqual(await f.runtime.captureScene!({ kind: 'frame', target: { kind: 'region', region }, orientation: 'oblique' }, 'outside'), { status: 'unavailable', reason: 'outside-source-bounds' }); assert.equal(f.requests.length, 0);
  await assert.rejects(f.runtime.captureScene!({ kind: 'frame', target: { kind: 'region', region: { ...region, binding: { ...binding, frameId: 'foreign' } } }, orientation: 'top' }, 'foreign'), { code: 'stale-scene' });
  f.forge(); await assert.rejects(f.runtime.captureScene!(f.frame, 'forged'), { code: 'invalid-tool-result' }); await f.runtime.close();
});
test('stale lookup/cancellation cannot dispatch a browser view or recreate a base', async () => {
  const f = fixture(); f.stale(); await assert.rejects(f.runtime.captureScene!(f.frame, 'stale'), { code: 'stale-scene' }); assert.equal(f.requests.length, 0); await f.runtime.close();
  const cancelled = fixture(); cancelled.controller.abort(); await assert.rejects(cancelled.runtime.captureScene!(cancelled.frame, 'cancelled')); assert.equal(cancelled.requests.length, 0); await cancelled.runtime.close();
});

test('issued bases expire after five minutes and unsupported adapter colors do not dispatch', async t => {
  let now = 0; t.mock.method(performance, 'now', () => now);
  const f = fixture(), first = await f.runtime.captureScene!(f.frame, 'first'); assert(first && !('status' in first));
  now = 300000;
  assert.deepEqual(await f.runtime.captureScene!(f.relative(first.observationId), 'expired'), { status: 'unavailable', reason: 'view-unavailable' }); assert.equal(f.requests.length, 1);
  assert.deepEqual(await f.runtime.captureScene!({ ...f.frame, colorMode: 'instance' }, 'unsupported'), { status: 'unavailable', reason: 'unsupported' }); assert.equal(f.requests.length, 1); await f.runtime.close();
});

test('Toronto reference frame targets original record even after an individually accepted override', async t => {
  const { candidateSource } = await import('../fixtures/area-candidate-source');
  const { PointOverrideSession } = await import('../../apps/server/src/scene/point-overrides');
  const { TorontoCadSession } = await import('../../apps/server/src/cad/toronto-cad-session');
  const { bindModelScene } = await import('../../apps/server/src/agent/model-scene');
  const source = await candidateSource([{ xyz: [1, 0, 0], label: 6 }]), points = new PointOverrideSession(source.root), cad = new TorontoCadSession(source.root);
  const signal = new AbortController().signal;
  t.after(async () => { await points.close(); await cad.close(); await source.close(); });
  const state = await points.execute('snapshot') as import('@spatial/contracts').PointOverrideSnapshot;
  const proposal = await points.execute('propose', { sessionId: state.sessionId, revision: state.revision, artifactRevision: state.artifactRevision, points: [{ key: { sourceFileId: 1, sourceRow: 0 }, position: [1, 0, 0] }], translation: [0, 0, 2] }) as import('@spatial/contracts').PointMoveProposal;
  const accepted = await points.execute('approve', { sessionId: state.sessionId, revision: state.revision, proposalId: proposal.proposalId }) as import('@spatial/contracts').PointOverrideSnapshot;
  assert.deepEqual(accepted.entries[0]!.position, [1, 0, 2]);
  const scene: ModelScene = { mode: 'toronto', toronto: [] }, initial = await bindModelScene(scene, source.root, signal, undefined, { points, cad });
  const call: ModelTurnRequest = { requestId: 'toronto-view', conversationId: null, generation: 'fixture', model: 'fixture', text: 'Frame original point', scene };
  let actual: BrowserCaptureRequest | undefined;
  const broker = new ModelBrowserBroker(call.requestId, signal, async event => {
    if (event.kind !== 'browser-request' || event.action.kind !== 'capture') throw new Error('Unexpected selection/mutation');
    actual = event.action.request; broker.accept({ requestId: call.requestId, toolCallId: event.toolCallId, nonce: event.nonce, result: { status: 'unavailable', reason: 'detail-unavailable' } });
  });
  const runtime = createModelAgentRuntime(call, initial, source.root, signal, broker, { points, cad }); t.after(() => runtime.close());
  assert.deepEqual(await runtime.captureScene!({ kind: 'frame', target: { kind: 'reference', reference: { kind: 'toronto-point', key: { sourceFileId: 1, sourceRow: 0 } }, spanMeters: 2 }, orientation: 'top' }, 'original'), { status: 'unavailable', reason: 'detail-unavailable' });
  assert(actual?.kind === 'framed'); assert.deepEqual(actual.pivot, [1, 0, 0]); assert.equal(actual.targetKind, 'original-source-reference');
  assert.equal((await points.execute('snapshot') as import('@spatial/contracts').PointOverrideSnapshot).revision, accepted.revision);
});

test('provider safe invalid replacement revokes prior relative base and pixel ownership', async t => {
 const f = fixture(), auth = new ProviderAuth({ mode: 'api-key', apiKey: 'fixture-only' });
 let firstId = '', invalidResult: unknown, reusedResult: unknown;
 const tool = (args: unknown,id: string) => ({ type:'function_call',namespace:'scene',name:'capture_scene',arguments:JSON.stringify(args),call_id:id });
 const model = new ProviderModel(auth, withProductSkills(async (url,init) => {
  if(String(url).endsWith('/models')) return Response.json({data:[{id:'fixture'}]});
  const body=JSON.parse(String(init?.body)), last=body.input.findLast((x: any)=>x.type==='function_call_output');
  let output: unknown[];
  if(!last || JSON.parse(last.output).kind==='runtime-skill') output=[tool(f.frame,'frame')];
  else if(last.call_id==='frame') {firstId=JSON.parse(last.output).observation.observationId; output=[tool({...f.relative(firstId),distanceScale:0},'invalid')];}
  else if(last.call_id==='invalid') {invalidResult=JSON.parse(last.output); assert.deepEqual(await f.runtime.resolveVisualPixel!({ observationId: firstId, x: 0, y: 0 }, 'old-pixel', f.controller.signal), { status: 'unavailable', observationId: firstId, x: 0, y: 0, reason: 'Observation replaced by a later capture request' }); output=[tool(f.relative(firstId),'reuse')];}
  else {reusedResult=JSON.parse(last.output); output=[];}
  return new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output}})}\n\n`,{headers:{'content-type':'text/event-stream'}});
 },['visual-inspection']));
 t.after(async()=>{model.close();auth.close();await f.runtime.close();});
 const catalog=await model.models(f.controller.signal);
 await model.turn({requestId:'review',conversationId:null,generation:catalog.generation,model:'fixture',text:'Review replacement',scene:f.scene},f.runtime,async()=>{},f.controller.signal);
 assert.deepEqual(invalidResult, { status: 'unavailable', reason: 'invalid-view-adjustment' });
 assert.equal(f.requests.length, 1);
 assert.deepEqual(reusedResult,{status:'unavailable',reason:'view-unavailable'});
});

test('polygon prisms normalize to an enclosing box, retain topology across relative views and fail closed on binding/receipt drift', async () => {
  const f = fixture(), region = { binding, shape: { kind: 'polygon-prism' as const, polygon: [[-2, -2], [2, -2], [2, 2], [0, 1], [-2, 2]] as const, z: { min: -1, max: 1 } } };
  const request = { kind: 'frame' as const, target: { kind: 'region' as const, region }, orientation: 'top' as const };
  const first = await f.runtime.captureScene!(request, 'polygon'); assert(first && !('status' in first));
  const actual = (f.requests[0] as Extract<ModelBrowserAction, { kind: 'capture' }>).request;
  assert(actual.kind === 'framed'); assert.deepEqual(actual.region, region); assert.deepEqual(actual.bounds, { min: [-2, -2, -1], max: [2, 2, 1] });
  assert.equal(canonicalAgentViewReceipt(first.coverage.agentView).fitMethod, 'enclosing-box');
  const next = await f.runtime.captureScene!(f.relative(first.observationId), 'polygon-relative'); assert(next && !('status' in next));
  assert.deepEqual(canonicalAgentViewReceipt(next.coverage.agentView).region, region); assert.equal(canonicalAgentViewReceipt(next.coverage.agentView).fitMethod, 'enclosing-box');
  await assert.rejects(f.runtime.captureScene!({ ...request, target: { kind: 'region', region: { ...region, binding: { ...binding, frameId: 'foreign' } } } }, 'foreign-polygon'), { code: 'stale-scene' });
  const fresh = await f.runtime.captureScene!(request, 'fresh-polygon'); assert(fresh && !('status' in fresh));
  const invalid = { ...request, target: { kind: 'region' as const, region: { ...region, shape: { ...region.shape, polygon: [[0, 0], [1, 1], [0, 1], [1, 0]] as const } } } };
  assert.deepEqual(await f.runtime.captureScene!(invalid, 'invalid-polygon'), { status: 'unavailable', reason: 'invalid-region' });
  assert.deepEqual(await f.runtime.captureScene!(f.relative(fresh.observationId), 'invalidated-polygon'), { status: 'unavailable', reason: 'view-unavailable' });
  f.forge(); await assert.rejects(f.runtime.captureScene!(request, 'forged-polygon'), { code: 'invalid-tool-result' });
  await f.runtime.close();
});

const foreignCaptureCases = [
  ...Object.entries({ sourceId: 'foreign', sourceRevision: 'b'.repeat(64), frameId: 'foreign', origin: [1, 0, 0] }).map(([field, value]) => ({
    name: `region ${field} with invalid topology`,
    request: { kind: 'frame', target: { kind: 'region', region: { binding: { ...binding, [field]: value }, shape: { kind: 'polygon-prism', polygon: [[0, 0], [1, 1], [0, 1], [1, 0]], z: { min: 0, max: 1 } } } }, orientation: 'top' },
  })),
  ...(['cloudId', 'revision'] as const).flatMap(field => ['span', 'color'].map(invalid => ({
    name: `reference ${field} with invalid ${invalid}`,
    request: { kind: 'frame', target: { kind: 'reference', reference: { kind: 'cloud-point', cloudId: binding.sourceId, revision: binding.sourceRevision, key: { sourceFileId: 1, sourceRow: 7 }, [field]: field === 'revision' ? 'b'.repeat(64) : 'foreign' }, spanMeters: invalid === 'span' ? 0 : 2 }, orientation: 'top', ...(invalid === 'color' ? { colorMode: 'instance' } : {}) },
  }))),
];
for (const scenario of foreignCaptureCases) test(`capture identity first: ${scenario.name} at provider and runtime`, async t => {
  for (const admission of ['runtime', 'provider']) {
    const f = fixture(); t.after(() => f.runtime.close());
    let firstId: string;
    if (admission === 'runtime') {
      const first = await f.runtime.captureScene!(f.frame, 'first'); assert(first && !('status' in first)); firstId = first.observationId;
      await assert.rejects(f.runtime.captureScene!(scenario.request as unknown as Parameters<NonNullable<BoundModelScene['captureScene']>>[0], 'foreign'), { code: 'stale-scene' });
    } else {
      const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'fixture-only' });
      const model = new ProviderModel(auth, withProductSkills(async (url, init) => {
        if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture' }] });
        const body = JSON.parse(String(init?.body)), last = body.input.findLast((entry: { type: string }) => entry.type === 'function_call_output');
        const first = !last || JSON.parse(last.output).kind === 'runtime-skill';
        if (!first) firstId = JSON.parse(last.output).observation.observationId;
        const output = [{ type: 'function_call', namespace: 'scene', name: 'capture_scene', call_id: first ? 'frame' : 'foreign', arguments: JSON.stringify(first ? f.frame : scenario.request) }];
        return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      }, ['visual-inspection']));
      t.after(() => { model.close(); auth.close(); });
      const catalog = await model.models(f.controller.signal);
      await assert.rejects(model.turn({ requestId: 'identity', conversationId: null, generation: catalog.generation, model: 'fixture', text: 'Frame source', scene: f.scene }, f.runtime, async () => {}, f.controller.signal), { code: 'stale-scene' });
    }
    assert.equal(f.requests.length, 1, `${admission}: foreign identity never reaches browser`);
    assert.deepEqual(await f.runtime.resolveVisualPixel!({ observationId: firstId!, x: 0, y: 0 }, 'prior-pixel', f.controller.signal), { status: 'unavailable', observationId: firstId!, x: 0, y: 0, reason: 'Observation replaced by a later capture request' });
    assert.deepEqual(await f.runtime.captureScene!(f.relative(firstId!), 'prior-base'), { status: 'unavailable', reason: 'view-unavailable' });
    assert.equal(f.requests.length, 1);
  }
});

test('prepared cloud named toronto3d advertises and resolves cloud references through explicit adapter capability', async t => {
  const { captureRequestSchema } = await import('../../apps/server/src/agent/agent-view-schema');
  const scene: ModelScene = { mode: 'cloud', toronto: [], cloud: { id: 'toronto3d', revision: binding.sourceRevision, frameId: binding.frameId, localOrigin: binding.origin, points: [] } };
  let lookedUp = false, dispatched = false;
  const bound: BoundModelScene = { context: { dataset: { bounds: { min: [-10, -10, -10], max: [10, 10, 10] } } }, async check() {}, async close() {}, async resolveReference(reference) { assert.equal(reference.kind, 'cloud-point'); lookedUp = true; return [0, 0, 0]; } };
  const controller = new AbortController(), call: ModelTurnRequest = { requestId: 'named-cloud', conversationId: null, generation: 'fixture', model: 'fixture', text: 'Frame cloud', scene };
  const broker = new ModelBrowserBroker(call.requestId, controller.signal, async event => {
    assert(event.kind === 'browser-request'); dispatched = true;
    broker.accept({ requestId: call.requestId, toolCallId: event.toolCallId, nonce: event.nonce, result: { status: 'unavailable', reason: 'detail-unavailable' } });
  });
  const runtime = createModelAgentRuntime(call, bound, '/unused', controller.signal, broker); t.after(() => runtime.close());
  assert.equal(runtime.captureCapabilities?.referenceKind, 'cloud-point');
  const schema = captureRequestSchema(runtime.captureCapabilities) as any;
  const reference = schema.anyOf.find((branch: any) => branch.properties.kind.enum.includes('frame')).properties.target.anyOf[0].properties.reference;
  assert.deepEqual(reference.properties.kind.enum, ['cloud-point']);
  assert.equal(reference.properties.key.properties.sourceFileId.maximum, 65535);
  const target = { kind: 'reference' as const, reference: { kind: 'cloud-point' as const, cloudId: 'toronto3d', revision: binding.sourceRevision, key: { sourceFileId: 9, sourceRow: 0 } }, spanMeters: 2 };
  assert.deepEqual(await runtime.captureScene!({ kind: 'frame', target, orientation: 'top' }, 'named-cloud'), { status: 'unavailable', reason: 'detail-unavailable' });
  assert(lookedUp && dispatched);
  await assert.rejects(runtime.captureScene!({ kind: 'frame', target: { ...target, reference: { kind: 'toronto-point', key: { sourceFileId: 1, sourceRow: 0 } } }, orientation: 'top' }, 'wrong-adapter'), { code: 'stale-scene' });
});
