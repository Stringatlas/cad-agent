import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createDemoServer } from '../../apps/server/src/index';
import { preparedCloudRegistrations } from '../../apps/server/src/datasets/scene-registry';
import { createPreparedCloudRegistry } from '../../apps/server/src/datasets/prepared-cloud';
import { preparedPoint, loadPreparedSample, type PreparedSample } from '../../apps/web/src/scenes/point-cloud/prepared-cloud-client';
import { canonicalModelScene, canonicalModelReferenceSelection, canonicalModelCaptureRequest, type ModelChatEvent } from '@spatial/contracts';
import { bindModelScene } from '../../apps/server/src/agent/model-scene';
import { registeredSceneTools, ProviderModel } from '../../apps/server/src/agent/provider-model';
import { ProviderAuth } from '../../apps/server/src/auth/provider-auth';
import { withProductSkills } from '../helpers/product-skill-transport';

async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'octree'));
  const id = 'stpls3d-25', count = 5000;
  const descriptor = { version: 1, format: 'potree2-uncompressed', id, frameId: `${id}-local`,
    coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [0, 0, 0] },
    sources: [{ id: 25, name: '25_points_GTv3.txt', points: count }],
    semantics: { attribute: 'semantic_id', type: 'uint8', classes: { '14': 'Fence' } },
    instances: { attribute: 'instance_id', type: 'int32', unassigned: -100 } };
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: count, scale: [0.01, 0.01, 0.01], offset: [0, 0, 0], hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [0, 0, 0], max: [500, 500, 100] }, attributes: [
      { name: 'position', type: 'int32', size: 12, min: [0, 0, 0], max: [500, 500, 100] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'semantic_id', type: 'uint8', size: 1 }, { name: 'instance_id', type: 'int32', size: 4 },
    ] };
  const payload = Buffer.alloc(count * 29), hierarchy = Buffer.alloc(22);
  for (let i = 0; i < count; i++) {
    const at = i * 29; payload.writeInt32LE(i, at); payload.writeUInt16LE(65535, at + 12);
    payload.writeUInt16LE(25, at + 18); payload.writeUInt32LE(i, at + 20); payload[at + 24] = 14; payload.writeInt32LE(i % 2 ? 123 : -100, at + 25);
  }
  hierarchy[0] = 1; hierarchy.writeUInt32LE(count, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  await Promise.all([writeFile(join(root, 'cloud.json'), JSON.stringify(descriptor)), writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)),
    writeFile(join(root, 'octree/hierarchy.bin'), hierarchy), writeFile(join(root, 'octree/octree.bin'), payload)]);
  const server = createDemoServer({ datasetRoot: join(root, 'no-toronto'), preparedClouds: { [id]: root } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { root, id, base, path: `${base}/datasets/prepared/${id}` };
}

test('operator inventory registers synthetic and real-world STPLS3D scenes', () => {
  const registrations = preparedCloudRegistrations('/operator/stpls3d');
  assert.equal(Object.keys(registrations).length, 29);
  assert.equal(registrations['stpls3d-25'], '/operator/stpls3d/25');
  assert.equal(registrations['stpls3d-realworld-usc'], '/operator/stpls3d_realworld/usc');
  assert.ok(Object.keys(registrations).every(id => /^stpls3d-(\d+|realworld-(occc|ra|usc|wmsc))$/.test(id)));
});

test('Prepared routes load independently of missing Toronto and expose native labels plus bound picks', async t => {
  const f = await fixture(t);
  const inventory = await (await fetch(`${f.base}/datasets/prepared`)).json();
  assert.deepEqual(inventory.scenes, [{ id: f.id, name: 'STPLS3D · Scene 25' }]);
  assert.ok(!JSON.stringify(inventory).includes(f.root));
  const info = await (await fetch(f.path)).json();
  assert.equal(info.descriptor.frameId, `${f.id}-local`); assert.equal(info.capabilities.editing, false);
  const response = await fetch(`${f.path}/sample?revision=${info.revision}&budget=5000&depth=0`);
  assert.equal(response.status, 200);
  const sample = await response.json() as PreparedSample;
  assert.equal(sample.count, 5000); assert.equal(sample.labels?.[0], 14);
  const pick = preparedPoint(sample, 4999);
  assert.equal(pick.type, 'Fence'); assert.equal(pick.cloudId, f.id); assert.equal(pick.sourceRow, 4999);
  assert.deepEqual(pick.position, [49.99, 0, 0]); assert.equal(pick.frameId, `${f.id}-local`);
  assert.deepEqual(sample.instances?.slice(0, 2), [-100, 123]);
  assert.equal(pick.instanceId, 123);
  assert.equal(pick.sourceId, 25);
  assert.equal(pick.revision, info.revision); assert.equal('artifactRevision' in pick, false);
  assert.throws(() => preparedPoint(sample, 5000), /Invalid sample/);
  const reader = createPreparedCloudRegistry({ [f.id]: f.root }).open(f.id);
  // Widening the display sample does not widen the harness default.
  await assert.rejects(reader.sample(info.revision, { budget: 5000, depth: 0 }), { name: 'RangeError' });
});

test('prepared routes fail closed on unsafe requests, stale revisions, missing assets and mutation', async t => {
  const f = await fixture(t), info = await (await fetch(f.path)).json();
  for (const query of ['budget=100001&depth=0', 'budget=4096&depth=3', 'budget=4096&depth=0&path=/tmp/cloud', 'budget=4&budget=5&depth=0']) {
    assert.equal((await fetch(`${f.path}/sample?revision=${info.revision}&${query}`)).status, 400);
  }
  assert.equal((await fetch(`${f.path}/sample?revision=${'a'.repeat(64)}&budget=4&depth=0`)).status, 503);
  assert.equal((await fetch(`${f.path}/octree/octree.bin`)).status, 404);
  assert.equal((await fetch(`${f.path}?path=/tmp/cloud`)).status, 400);
  assert.equal((await fetch(`${f.path}`, { method: 'POST', body: '{}' })).status, 405);
  assert.equal((await fetch(f.path, { headers: { Origin: 'https://evil.example' } })).status, 403);
  const foreignHost = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(f.path, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.once('error', reject); request.end();
  });
  assert.equal(foreignHost, 403);
  assert.equal((await fetch(f.path, { headers: { Range: 'bytes=0-10' } })).status, 416);
  assert.equal((await fetch(`${f.base}/datasets/prepared/toronto3d`)).status, 404);
  await rm(join(f.root, 'octree/octree.bin'));
  const unavailable = await fetch(f.path); assert.equal(unavailable.status, 503);
  assert.ok(!(await unavailable.text()).includes(f.root));
});

test('browser sample loader refuses mismatched scene/frame/revision before publication', async t => {
  const f = await fixture(t), info = await (await fetch(f.path)).json();
  const sample = await (await fetch(`${f.path}/sample?revision=${info.revision}&budget=4&depth=0`)).json();
  const originalFetch = globalThis.fetch;
  const mock = t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    if (String(input).includes('/sample?')) return new Response(JSON.stringify({ ...sample, cloud: { ...sample.cloud, revision: 'f'.repeat(64) } }));
    return new Response(JSON.stringify(info));
  });
  try { await assert.rejects(loadPreparedSample(f.id, 4, 0, new AbortController().signal), /stale/); }
  finally { mock.mock.restore(); assert.equal(globalThis.fetch, originalFetch); }
});

test('STPLS3D replaces DALES and uses shared viewer tools', async () => {
  const app = await readFile(new URL('../../apps/web/src/App.svelte', import.meta.url), 'utf8');
  assert.match(app, /value="cloud">STPLS3D/);
  assert.doesNotMatch(app, /DALES|Dales|dales/);
  const component = await readFile(new URL('../../apps/web/src/scenes/point-cloud/PointCloud.svelte', import.meta.url), 'utf8');
  assert.match(component, /RGB/); assert.match(component, /Instance/); assert.match(component, /Semantic/);
  assert.match(component, /selected.type/);
  const viewer = await readFile(new URL('../../apps/web/src/scenes/point-cloud/prepared-cloud-viewer.ts', import.meta.url), 'utf8');
  assert.match(viewer, /createPointCloudViewport/); assert.match(viewer, /cloudColors/);
});

test('original-source queries preserve native instance IDs, exact counts, bounded witnesses and revision isolation', async t => {
  const f = await fixture(t), reader = createPreparedCloudRegistry({ [f.id]: f.root }).open(f.id);
  const info = await reader.info(), signal = new AbortController().signal;
  const radius = await reader.queryOriginal(info.revision, { operation: 'radius', position: [0, 0, 0], radiusMeters: 1, maxResults: 3, label: 14 }, signal);
  assert.equal(radius.complete, true); assert.equal(radius.count, 101); assert.equal(radius.checkedPoints, 5000);
  assert.equal(radius.points.length, 3); assert.equal(radius.points[0].instanceId, -100);
  const nearest = await reader.queryOriginal(info.revision, { operation: 'nearest', position: [0.501, 0, 0], maxResults: 1, label: 14 }, signal);
  assert.equal(nearest.points[0].key.sourceRow, 50); assert.deepEqual(nearest.points[0].position, [0.5, 0, 0]);
  const box = await reader.queryOriginal(info.revision, { operation: 'box', bounds: { min: [0, 0, 0], max: [0.1, 0, 0] }, maxResults: 2 }, signal);
  assert.equal(box.count, 11); assert.equal(box.points.length, 2);
  await assert.rejects(reader.queryOriginal(info.revision, { operation: 'nearest', position: [0, 0, 0], label: 6, maxResults: 1 }), /semantic/);
  await assert.rejects(reader.queryOriginal('a'.repeat(64), { operation: 'nearest', position: [0, 0, 0], maxResults: 1 }), /Stale/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(reader.queryOriginal(info.revision, { operation: 'nearest', position: [0, 0, 0], maxResults: 1 }, aborted.signal));
  const point = await (await fetch(`${f.path}/point?revision=${info.revision}&sourceFileId=25&sourceRow=1`)).json();
  assert.equal(point.point.instanceId, 123); assert.equal(point.point.label, 14);
  assert.equal(point.cloud.revision, info.revision);
  assert.equal((await fetch(`${f.path}/point?revision=${info.revision}&sourceFileId=1&sourceRow=1`)).status, 503);
});

test('cloud agent binds only registered scene/frame/revision and independently resolves attached source positions', async t => {
  const f = await fixture(t), reader = createPreparedCloudRegistry({ [f.id]: f.root }).open(f.id), info = await reader.info();
  const scene = canonicalModelScene({ mode: 'cloud', toronto: [], cloud: { id: f.id, revision: info.revision,
    frameId: info.descriptor.frameId, localOrigin: [0, 0, 0], points: [{ name: 'Point 1', key: { sourceFileId: 25, sourceRow: 10 }, position: [0.1, 0, 0] }] } });
  const signal = new AbortController().signal;
  const bind = (value = scene) => bindModelScene(value, '/unused/toronto', signal, undefined, undefined, { [f.id]: f.root });
  const bound = await bind(); t.after(() => bound.close());
  const advertised = registeredSceneTools(scene, bound, false, false);
  assert.deepEqual(advertised.map(t => t.name), ['list_skills', 'load_skill', 'query_points', 'inspect_scene']);
  const query = advertised.find(t => t.name === 'query_points')!;
  assert.deepEqual((query.parameters.properties as any).label.enum, [null, 14]);
  const result = await bound.queryPoints!({ operation: 'radius', position: [0, 0, 0], radiusMeters: 1, maxResults: 2, label: 14 }, signal) as any;
  assert.equal(result.count, 101); assert.equal(result.points[0].semanticType, 'Fence');
  const ref = canonicalModelReferenceSelection(result.points[0].selectReference);
  assert.equal(ref.kind, 'cloud-point'); assert.deepEqual(await bound.resolveReference!(ref, signal), [0, 0, 0]);
  await assert.rejects(bound.resolveReference!({ ...ref, cloudId: 'stpls3d-1' } as typeof ref, signal));
  await assert.rejects(bind({ ...scene, cloud: { ...scene.cloud!, frameId: 'foreign-frame' } }), { code: 'stale-scene' });
  await assert.rejects(bind({ ...scene, cloud: { ...scene.cloud!, id: 'unregistered' } }), { code: 'invalid-scene' });
  await assert.rejects(bind({ ...scene, cloud: { ...scene.cloud!, points: [{ ...scene.cloud!.points[0], position: [2, 0, 0] }] } }), { code: 'invalid-scene' });
  const payload = join(f.root, 'octree/octree.bin');
  await writeFile(payload, await readFile(payload));
  await assert.rejects(bound.check(), { code: 'stale-scene' });
});

test('actual provider loop dispatches a native semantic query and rejects cross-cloud continuation', async t => {
  const f = await fixture(t), info = await createPreparedCloudRegistry({ [f.id]: f.root }).open(f.id).info();
  const scene = canonicalModelScene({ mode: 'cloud', toronto: [], cloud: { id: f.id, revision: info.revision,
    frameId: info.descriptor.frameId, localOrigin: [0, 0, 0], points: [] } });
  const signal = new AbortController().signal;
  const bound = await bindModelScene(scene, '/unused', signal, undefined, undefined, { [f.id]: f.root });
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'cloud-fixture-only' });
  let queried = false;
  const model = new ProviderModel(auth, withProductSkills(async url => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'cloud-test' }] });
    const output = queried ? [] : [{ type: 'function_call', namespace: 'scene', name: 'query_points', call_id: 'native-query', arguments: JSON.stringify({ operation: 'nearest', position: [0, 0, 0], label: 14, maxResults: 1 }) }];
    queried = true;
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }, ['scene-inspection']));
  t.after(async () => { model.close(); auth.close(); await bound.close(); });
  await model.models(signal);
  const events: ModelChatEvent[] = [];
  const call = { requestId: 'native-turn', conversationId: null, generation: auth.credentialGeneration(), model: 'cloud-test', text: 'Inspect fence points', scene };
  await model.turn(call, bound, async event => { events.push(event); }, signal);
  assert(events.some(e => e.kind === 'tool' && e.name === 'query_points'));
  const start = events.find((e): e is Extract<ModelChatEvent, { kind: 'start' }> => e.kind === 'start')!;
  await assert.rejects(model.turn({ ...call, requestId: 'wrong-cloud', conversationId: start.conversationId,
    scene: { ...scene, cloud: { ...scene.cloud!, id: 'stpls3d-1' } } }, bound, async () => {}, signal), { code: 'stale-conversation' });
});

test('native capture modes round trip and cloud contracts reject mixed coordinate domains', () => {
  for (const colorMode of ['semantic', 'instance'] as const) assert.deepEqual(canonicalModelCaptureRequest({ kind: 'current', colorMode }), { kind: 'current', colorMode });
  assert.throws(() => canonicalModelScene({ mode: 'cloud', toronto: [], cloud: { id: 'x', revision: 'a'.repeat(64), frameId: 'x-local', localOrigin: [0, 0, 0], points: [] }, objects: [] }));
});

test('prepared hypotheses use checked cloud binding, survive continuation and exclude failed-turn revisions', async t => {
  const f = await fixture(t), info = await createPreparedCloudRegistry({ [f.id]: f.root }).open(f.id).info();
  const scene = canonicalModelScene({ mode: 'cloud', toronto: [], cloud: { id: f.id, revision: info.revision,
    frameId: info.descriptor.frameId, localOrigin: [0, 0, 0], points: [] } });
  const signal = new AbortController().signal;
  const bound = await bindModelScene(scene, '/unused', signal, undefined, undefined, { [f.id]: f.root });
  assert.deepEqual(bound.sceneMarkBinding, { mode: 'cloud', cloudId: f.id, artifactRevision: info.revision,
    frameId: info.descriptor.frameId, units: 'm', localOrigin: [0, 0, 0] });
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'cloud-fixture-only' });
  let round = 0, retained: any;
  const model = new ProviderModel(auth, withProductSkills(async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'cloud-marks' }] });
    const body = JSON.parse(String(init?.body));
    const result = (id: string) => JSON.parse(body.input.find((item: any) => item.type === 'function_call_output' && item.call_id === id).output);
    const tool = (name: string, args: unknown, call_id: string) => ({ type: 'function_call', namespace: 'scene', name, call_id, arguments: JSON.stringify(args) });
    let output: unknown[] = [];
    switch (round++) {
      case 0:
        for (const name of ['set_scene_marks', 'get_scene_marks']) assert.ok(body.tools[0].tools.some((tool: any) => tool.name === name));
        output = [tool('set_scene_marks', { expectedRevision: 0, marks: [{ position: [1, 2, 3], rationale: 'Check this feature.', uncertainty: 'Needs inspection.' }] }, 'cloud-create')]; break;
      case 1: retained = result('cloud-create'); assert.equal(retained.annotationRevision, 1); assert.deepEqual(retained.binding, bound.sceneMarkBinding); break;
      case 2: output = [tool('get_scene_marks', {}, 'cloud-read')]; break;
      case 3: {
        assert.deepEqual(result('cloud-read'), retained); const mark = retained.marks[0];
        output = [tool('set_scene_marks', { expectedRevision: 1, marks: [{ id: mark.id, position: [4, 5, 6], rationale: mark.rationale, uncertainty: mark.uncertainty }] }, 'cloud-uncommitted')]; break;
      }
      case 4: assert.equal(result('cloud-uncommitted').annotationRevision, 2); throw new Error('Fixture downstream failure');
      case 5: output = [tool('get_scene_marks', {}, 'cloud-retry')]; break;
      case 6: assert.deepEqual(result('cloud-retry'), retained); break;
      default: assert.fail('Unexpected model round');
    }
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }, ['scene-inspection', 'visual-inspection', 'candidate-assessment']));
  t.after(async () => { model.close(); auth.close(); await bound.close(); });
  await model.models(signal);
  const events: ModelChatEvent[] = [];
  const call = { requestId: 'cloud-marks-first', conversationId: null, generation: auth.credentialGeneration(), model: 'cloud-marks', text: 'Investigate hypotheses.', scene };
  await model.turn(call, bound, async e => { events.push(e); }, signal);
  const started = events.find((e): e is Extract<ModelChatEvent, { kind: 'start' }> => e.kind === 'start')!;
  await assert.rejects(model.turn({ ...call, requestId: 'cloud-marks-failed', conversationId: started.conversationId }, bound, async () => {}, signal));
  await model.turn({ ...call, requestId: 'cloud-marks-retry', conversationId: started.conversationId }, bound, async () => {}, signal);
  assert.equal(round, 7); assert.ok(retained.marks[0].id);
  assert.equal(bound.proposeCad, undefined); assert.equal(bound.proposePointMove, undefined);
});

test('prepared captured pixels independently resolve original Float64 records without selecting or rebinding', async t => {
  const { createModelAgentRuntime } = await import('../../apps/server/src/agent/model-agent-runtime');
  const { ModelBrowserBroker } = await import('../../apps/server/src/agent/model-browser-broker');
  const f = await fixture(t), info = await createPreparedCloudRegistry({ [f.id]: f.root }).open(f.id).info();
  const scene = canonicalModelScene({ mode: 'cloud', toronto: [], cloud: { id: f.id, revision: info.revision, frameId: info.descriptor.frameId, localOrigin: [0, 0, 0], points: [] } });
  const signal = new AbortController().signal, initial = await bindModelScene(scene, '/unused', signal, undefined, undefined, { [f.id]: f.root });
  const binding = { sourceId: f.id, sourceRevision: info.revision, frameId: info.descriptor.frameId, units: 'm' as const, origin: [0, 0, 0] as const };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const observation = { schemaVersion: 1 as const, observationId: 'frozen-cloud', viewGeneration: 0,
    image: { mimeType: 'image/png' as const, dataUrl: '', sha256: 'a'.repeat(64), byteLength: 1 },
    viewport: { width: 101, height: 101, pixelRatio: 1, pixelOrigin: 'top-left' as const },
    camera: { position: [0, 0, 10] as const, quaternion: [0, 0, 0, 1], up: [0, 1, 0] as const, near: .1, far: 100, fov: 50, aspect: 1, zoom: 1, matrixWorld: identity, matrixWorldInverse: identity, projectionMatrix: identity }, binding,
    coverage: { kind: 'fixture', complete: false, displayedPointCount: 1 } };
  const call = { requestId: 'verify-cloud', conversationId: null, generation: 'fixture', model: 'fixture', text: 'Inspect', scene, visualObservation: observation };
  let forged = false, stale = false;
  const runtime = createModelAgentRuntime(call, initial, '/unused', signal, new ModelBrowserBroker(call.requestId, signal, async () => { throw new Error('No browser selection allowed'); }), undefined, { [f.id]: f.root },
    async args => ({ status: 'resolved', ...args, provenance: { datasetId: f.id, artifactRevision: stale ? 'b'.repeat(64) : info.revision,
      key: { sourceFileId: 25, sourceRow: 1 }, position: forged ? [.01000001, 0, 0] : [.01, 0, 0], frameId: binding.frameId, units: 'm', origin: binding.origin, layer: 'native' } }));
  t.after(() => runtime.close());
  const args = { observationId: observation.observationId, x: 50, y: 50 };
  const result = await runtime.resolveVisualPixel!(args, 'verify-one', signal);
  assert.equal(result.status, 'resolved');
  if (result.status === 'resolved') {
    assert.equal(result.provenance.recordValidation, 'server-verified-original-record');
    assert.deepEqual(result.provenance.position, [.01, 0, 0]);
    assert.deepEqual(result.provenance.selectReference, { kind: 'cloud-point', cloudId: f.id, revision: info.revision, key: { sourceFileId: 25, sourceRow: 1 } });
  }
  assert.equal(scene.cloud!.points.length, 0);
  forged = true; await assert.rejects(runtime.resolveVisualPixel!(args, 'forged-coordinate', signal), { code: 'invalid-tool-result' });
  forged = false; stale = true; await assert.rejects(runtime.resolveVisualPixel!(args, 'stale-source', signal), { code: 'invalid-tool-result' });
  await assert.rejects(runtime.resolveVisualPixel!({ ...args, observationId: 'old' }, 'stale-image', signal), { code: 'invalid-visual-pixel' });
});
