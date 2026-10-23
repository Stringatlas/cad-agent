import test from 'node:test';
import { withProductSkills } from '../helpers/product-skill-transport';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { MODEL_VISUAL_LIMITS, canonicalModelChatEvent, canonicalModelTurnRequest, canonicalModelVisualObservation, canonicalModelVisualToolResult,
  type ModelTurnRequest, type ModelChatEvent, type VisualObservation } from '@spatial/contracts';
import { createDemoServer } from '../../apps/server/src/index';
import { validateModelVisual } from '../../apps/server/src/agent/model-visual';
import { ModelVisualBroker } from '../../apps/server/src/agent/model-visual-broker';
import { ProviderModel, type ModelAuth } from '../../apps/server/src/agent/provider-model';
import { candidateSource } from '../fixtures/area-candidate-source';

const signal = () => new AbortController().signal;
const jpeg = createRequire(new URL('../../apps/server/package.json', import.meta.url))('jpeg-js') as { encode(image: { data: Buffer; width: number; height: number }, quality: number): { data: Buffer } };
function png(width = 2, height = 2, noise = false) {
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name), payload = Buffer.concat([type, data]); let crc = 0xffffffff;
    for (const b of payload) { crc ^= b; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); payload.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = noise ? randomBytes(height * (width * 4 + 1)) : Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row++) raw[row * (width * 4 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function observation(): VisualObservation {
  const bytes = png(), identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return { schemaVersion: 1, observationId: 'observation-one', viewGeneration: 1,
    image: { mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length },
    viewport: { width: 2, height: 2, pixelRatio: 1, pixelOrigin: 'top-left' },
    camera: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], up: [0, 0, 1], near: .1, far: 100, fov: 50, aspect: 1, zoom: 1, matrixWorld: identity, matrixWorldInverse: identity, projectionMatrix: identity },
    binding: { sourceId: 'toronto3d', sourceRevision: 'a'.repeat(64), frameId: 'toronto3d-local-v1', units: 'm', origin: [627285, 4841948, 0] },
    coverage: { kind: 'displayed-sample', complete: false, displayedPointCount: 4 } };
}
const complete = (output: unknown[] = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Grounded' }] }]) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const tool = (args: unknown) => ({ type: 'function_call', namespace: 'scene', name: 'resolve_visual_pixel', call_id: 'pixel-call', arguments: JSON.stringify(args) });
async function fixture(t: { after(fn: () => unknown): void }, args: unknown = { observationId: 'observation-one', x: 1, y: 1 }) {
  const source = await candidateSource([{ xyz: [0, 0, 0], label: 1 }]);
  const root = source.root, requests: Record<string, unknown>[] = [], skillRequests: Record<string, unknown>[] = [];
  t.after(() => source.close());
  // Workflow requests retain their numbering; load requests are real additional network rounds.
  const server = createDemoServer({ datasetRoot: root, provider: { mode: 'api-key', apiKey: 'fake-no-live-key' },
    modelTransport: withProductSkills(async (url, init) => {
      if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture-vision-vNext' }, { id: 'fixture-image-rejected' }] });
      const body = JSON.parse(String(init?.body)); requests.push(body);
      if (body.model === 'fixture-image-rejected') return Response.json({ error: { code: 'unsupported_image', message: 'Fixture rejects images' } }, { status: 400 });
      return requests.length === 1 ? complete([tool(args)]) : complete();
    }, ['visual-inspection'], skillRequests) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); });
  const catalog = await (await fetch(base + '/chat/models')).json();
  const visual = observation();
  const boundVisual: VisualObservation = { ...visual, binding: { ...visual.binding, sourceRevision: source.snapshot.dataset.revision } };
  const call: ModelTurnRequest = { requestId: 'request-one', conversationId: null, generation: catalog.generation, model: 'fixture-vision-vNext', text: 'Ground this pixel',
    scene: { mode: 'toronto', toronto: [] }, visualObservation: boundVisual };
  const post = (body: unknown) => fetch(base + '/chat/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = (body: unknown, origin: string | null = base) => fetch(base + '/chat/tool-result', { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
  return { server, base, call, requests, skillRequests, post, result };
}
async function readEvents(response: Response, onEvent?: (e: ModelChatEvent) => Promise<void>) {
  assert.equal(response.status, 200); const events: ModelChatEvent[] = [], reader = response.body!.getReader(); let pending = '';
  for (;;) { const next = await reader.read(); if (next.done) break; pending += new TextDecoder().decode(next.value); for (;;) { const i = pending.indexOf('\n'); if (i < 0) break; const e = canonicalModelChatEvent(JSON.parse(pending.slice(0, i))); pending = pending.slice(i + 1); events.push(e); await onEvent?.(e); } }
  assert.equal(pending, ''); return events;
}
test('visual contract bounds and event/result schemas do not infer model capability', () => {
  const v = observation(); assert.deepEqual(canonicalModelVisualObservation(v), v);
  for (const bad of [{ ...v, viewport: { ...v.viewport, width: 4097 } }, { ...v, image: { ...v.image, byteLength: MODEL_VISUAL_LIMITS.pngBytes + 1 } }, { ...v, extra: true }, { ...v, image: { ...v.image, dataUrl: 'https://evil.invalid/image.png' } }]) assert.throws(() => canonicalModelVisualObservation(bad));
  assert.throws(() => canonicalModelVisualToolResult({ requestId: 'r', toolCallId: 't', nonce: 'n', observationId: 'o', result: { status: 'resolved', observationId: 'other', x: 1, y: 1, provenance: {} } }));
});
test('actual PNG bytes/hash/CRC/dimensions are validated before dispatch; image revisions are historical', async t => {
  const f = await fixture(t); const call = canonicalModelTurnRequest(f.call); await validateModelVisual(call, signal());
  for (const visual of [{ ...f.call.visualObservation!, image: { ...f.call.visualObservation!.image, sha256: '0'.repeat(64) } },
    { ...f.call.visualObservation!, viewport: { ...f.call.visualObservation!.viewport, width: 1 } }]) {
    const e = await readEvents(await f.post({ ...f.call, visualObservation: visual })); assert.equal(e.at(-1)?.kind, 'error');
  }
  const bytes = png(); bytes[bytes.length - 1] ^= 1;
  await assert.rejects(validateModelVisual({ ...call, visualObservation: { ...call.visualObservation!, image: { ...call.visualObservation!.image, dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, sha256: createHash('sha256').update(bytes).digest('hex') } } }, signal()));
  assert.equal(f.requests.length, 0);
  const historical = { ...call.visualObservation!, binding: { ...call.visualObservation!.binding, sourceRevision: 'b'.repeat(64) } };
  assert.deepEqual(await validateModelVisual({ ...call, visualObservation: historical }, signal()), historical);
});
test('image pixel roundtrip is nonce-bound, origin-guarded, one-use, truthful and image turns retain conversation history', async t => {
  const f = await fixture(t); let answer: unknown;
  const e = await readEvents(await f.post(f.call), async event => {
    if (event.kind !== 'tool-request') return;
    assert.equal(f.requests.length, 1);
    const { kind: _kind, x, y, ...identity } = event;
    answer = { ...identity, result: { status: 'resolved', observationId: event.observationId, x, y, provenance: { datasetId: 'toronto3d', artifactRevision: f.call.visualObservation!.binding.sourceRevision, key: { sourceFileId: 1, sourceRow: 0 }, position: [0, 0, 0], frameId: 'toronto3d-local-v1', units: 'm', origin: [627285, 4841948, 0], layer: 'overview' } } };
    assert.equal((await f.result(answer, null)).status, 403);
    assert.equal((await f.result(answer, 'https://evil.invalid')).status, 403);
    assert.equal((await f.result({ ...(answer as object), nonce: 'wrong-nonce' })).status, 400);
    assert.equal((await f.result({ ...(answer as object), toolCallId: 'wrong-tool' })).status, 400);
    assert.equal((await f.result({ ...(answer as object), result: { status: 'no-hit', observationId: event.observationId, x: 0, y, reason: 'wrong pixel' } })).status, 400);
    assert.equal((await f.result(answer)).status, 204);
    assert.equal((await f.result(answer)).status, 400);
  });
  assert.equal(e.at(-1)?.kind, 'done'); assert.equal(f.requests.length, 2);
  assert.equal(f.skillRequests.length, 1); assert.equal(f.requests.length + f.skillRequests.length, 3);
  const first = f.requests[0], input = first.input as { role?: string; content?: unknown }[];
  assert.equal(first.model, 'fixture-vision-vNext');
  assert.deepEqual((input[0].content as unknown[])[1], { type: 'input_image', image_url: f.call.visualObservation!.image.dataUrl, detail: 'high' });
  const inspections = e.filter(v => v.kind === 'request-inspection'); assert.equal(inspections.length, 3); // skill load + pixel call + answer
  for (const inspection of inspections) if (inspection.kind === 'request-inspection') { assert.equal(inspection.inspection.omissions.includes('image-bytes'), true); assert.equal(inspection.inspection.bodyJson.includes('data:image/png'), false); assert.ok(inspection.inspection.bodyJson.includes(f.call.visualObservation!.image.sha256)); assert.ok(inspection.inspection.bodyJson.includes('resolve_visual_pixel')); }
  const context = e.find(v => v.kind === 'tool' && v.name === 'resolve_visual_pixel'); assert.ok(context?.kind === 'tool'); assert.equal((context.context as { recordValidation: string }).recordValidation, 'server-verified-original-record');
  const done = e.at(-1); assert.ok(done?.kind === 'done');
  const replay = await readEvents(await f.post({ ...f.call, text: 'Refer to the previous screenshot', visualObservation: undefined, conversationId: done.conversationId }));
  assert.equal(replay.at(-1)?.kind, 'done');
  const retained = JSON.stringify(f.requests.at(-1)!.input);
  assert.ok(retained.includes(f.call.visualObservation!.image.dataUrl));
  assert.ok(retained.includes('Ground this pixel'));
  assert.ok(retained.includes('Refer to the previous screenshot'));
  assert.equal(JSON.stringify(f.requests.at(-1)!.tools).includes('resolve_visual_pixel'), false);
  const withAnotherImage = await readEvents(await f.post({ ...f.call, text: 'Another screenshot', conversationId: done.conversationId }));
  assert.equal(withAnotherImage.at(-1)?.kind, 'done');
  assert.equal(JSON.stringify(f.requests.at(-1)!.input).split(f.call.visualObservation!.image.dataUrl).length - 1, 2);
});
test('no attached image advertises no pixel tool; forged catalog model and unknown conversation handles reject explicitly', async t => {
  const f = await fixture(t);
  for (const [change, code] of [[{ model: 'forged-not-in-catalog' }, 'model-unavailable'], [{ conversationId: 'previous-conversation' }, 'stale-conversation']] as const) {
    const e = await readEvents(await f.post({ ...f.call, ...change })); assert.deepEqual(e.at(-1), { kind: 'error', requestId: f.call.requestId, code });
  }
  assert.equal(f.requests.length, 0);
  const e = await readEvents(await f.post({ ...f.call, visualObservation: undefined })); assert.equal(e.at(-1)?.kind, 'error');
  assert.equal(JSON.stringify(f.requests[0].tools).includes('resolve_visual_pixel'), false);
});
test('API-key catalog model image rejection is explicit, with no text-only retry or retained history', async t => {
  const f = await fixture(t);
  const events = await readEvents(await f.post({ ...f.call, model: 'fixture-image-rejected' }));
  assert.deepEqual(events.at(-1), { kind: 'error', requestId: f.call.requestId, code: 'provider-unavailable' });
  assert.equal(events.some(e => e.kind === 'done'), false); assert.equal(f.requests.length, 1);
  assert.deepEqual((f.requests[0].input as { content: unknown[] }[])[0].content[1], { type: 'input_image', image_url: f.call.visualObservation!.image.dataUrl, detail: 'high' });
  const started = events.find(e => e.kind === 'start'); assert.ok(started?.kind === 'start');
  const replay = await readEvents(await f.post({ ...f.call, model: 'fixture-image-rejected', visualObservation: undefined, conversationId: started.conversationId }));
  assert.deepEqual(replay.at(-1), { kind: 'error', requestId: f.call.requestId, code: 'stale-conversation' }); assert.equal(f.requests.length, 1);
});
for (const args of [{ observationId: 'wrong', x: 1, y: 1 }, { observationId: 'observation-one', x: 2, y: 1 }, { observationId: 'observation-one', x: .5, y: 1 }]) test(`invalid model pixel arguments fail before browser RPC: ${JSON.stringify(args)}`, async t => {
  const f = await fixture(t, args); const events = await readEvents(await f.post(f.call)); assert.equal(events.some(e => e.kind === 'tool-request'), false); assert.equal(events.at(-1)?.kind, 'error'); assert.equal(f.requests.length, 1);
});
test('unavailable historical pixel grounding permits provider continuation; explicit abort still clears broker', async t => {
  const f = await fixture(t);
  const e = await readEvents(await f.post(f.call), async event => { if (event.kind !== 'tool-request') return; const { kind: _kind, x, y, ...identity } = event;
    assert.equal((await f.result({ ...identity, result: { status: 'stale', observationId: event.observationId, x, y, reason: 'camera changed' } })).status, 204);
  });
  assert.equal(e.at(-1)?.kind, 'done'); assert.equal(f.requests.length, 2);
  const pixel = e.find(v => v.kind === 'tool' && v.name === 'resolve_visual_pixel');
  assert.ok(pixel?.kind === 'tool'); assert.equal((pixel.context as { result: { status: string } }).result.status, 'unavailable');
  assert.match(String(f.requests[0].instructions), /capture-time.*may predate/);
  const controller = new AbortController(); let request: ModelChatEvent | undefined;
  const broker = new ModelVisualBroker('r', controller.signal, async e => { request = e; });
  const pending = broker.resolve({ observationId: 'o', x: 0, y: 0 }, 't'); assert.equal(broker.waiting, true); controller.abort(); await assert.rejects(pending); assert.equal(broker.waiting, false); assert.ok(request);
});
test('browser RPC has a bounded timeout and late result is rejected', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let request: Extract<ModelChatEvent, { kind: 'tool-request' }> | undefined;
  const broker = new ModelVisualBroker('r', signal(), async e => { if (e.kind === 'tool-request') request = e; });
  const pending = broker.resolve({ observationId: 'o', x: 0, y: 0 }, 't'); await Promise.resolve();
  t.mock.timers.tick(MODEL_VISUAL_LIMITS.toolDeadlineMs + 1); await assert.rejects(pending); assert.equal(broker.waiting, false);
  assert.throws(() => broker.accept({ ...request, result: { status: 'no-hit', observationId: 'o', x: 0, y: 0, reason: 'late' } }));
});
test('large screenshots get a dedicated retained image budget without increasing text/history limits', async t => {
  const f = await fixture(t); const bytes = png(256, 256, true), v = f.call.visualObservation!;
  assert.ok(bytes.length > 256 * 1024);
  const call = { ...f.call, visualObservation: { ...v, viewport: { ...v.viewport, width: 256, height: 256 }, image: { ...v.image, dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length } } };
  const e = await readEvents(await f.post(call), async event => { if (event.kind !== 'tool-request') return; const { kind: _kind, x, y, ...identity } = event;
    assert.equal((await f.result({ ...identity, result: { status: 'no-hit', observationId: event.observationId, x, y, reason: 'empty' } })).status, 204);
  });
  assert.equal(e.at(-1)?.kind, 'done'); assert.equal(f.requests.length, 2);
  const tooLarge = await f.post({ ...f.call, visualObservation: { ...v, image: { ...v.image, byteLength: MODEL_VISUAL_LIMITS.pngBytes + 1 } } });
  assert.equal(tooLarge.status, 400); assert.equal(f.requests.length, 2);
  const text = await f.post({ ...f.call, visualObservation: undefined, text: 'x'.repeat(70000) }); assert.equal(text.status, 400);
});
test('JPEG crop HTTP roundtrip transmits only compressed bytes, reports truthful metadata and bounds model pixels to sent size', async t => {
  for (const x of [0, 1]) {
    const f = await fixture(t, { observationId: 'observation-one', x, y: 0 }), v = f.call.visualObservation!;
    const bytes = jpeg.encode({ width: 1, height: 1, data: Buffer.alloc(4, 200) }, 70).data;
    const { dataUrl: _sourceBytes, ...sourceImage } = v.image;
    const call: ModelTurnRequest = { ...f.call, visualObservation: { ...v, sourceImage: { ...sourceImage, mimeType: 'image/png' },
      crop: { x: 1, y: 0, width: 1, height: 2, outputWidth: 1, outputHeight: 1 },
      image: { mimeType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
    let rpcs = 0;
    const events = await readEvents(await f.post(call), async event => {
      if (event.kind !== 'tool-request') return;
      rpcs++; const { kind: _kind, x, y, ...ids } = event;
      assert.equal((await f.result({ ...ids, result: { status: 'no-hit', observationId: event.observationId, x, y, reason: 'No displayed point' } })).status, 204);
    });
    assert.equal(rpcs, x === 0 ? 1 : 0);
    assert.equal(events.at(-1)?.kind, x === 0 ? 'done' : 'error');
    if (x === 1) assert.deepEqual(events.at(-1), { kind: 'error', requestId: call.requestId, code: 'invalid-visual-pixel' });
    assert.equal(JSON.stringify(f.requests).includes(v.image.dataUrl), false);
    assert.ok(JSON.stringify(f.requests).includes(call.visualObservation!.image.dataUrl));
    const inspection = events.find(e => e.kind === 'request-inspection' && e.inspection.bodyJson.includes('Runtime skill visual-inspection:')); assert.ok(inspection?.kind === 'request-inspection');
    const body = JSON.parse(inspection.inspection.bodyJson), image = body.input[0].content[1].image;
    assert.equal(image.mimeType, 'image/jpeg'); assert.equal(image.width, 1); assert.equal(image.height, 1);
    assert.ok(!inspection.inspection.bodyJson.includes('base64'));
    assert.ok(inspection.inspection.bodyJson.includes(sourceImage.sha256));
    assert.ok(inspection.inspection.bodyJson.includes('SENT-IMAGE'));
  }
});
function paddedJpeg(byteLength: number): Buffer {
  const encoded = jpeg.encode({ width: 1, height: 1, data: Buffer.alloc(4, 200) }, 70).data;
  const segments: Buffer[] = []; let remaining = byteLength - encoded.length;
  // Legal APP15 segments: two marker bytes, two length bytes, then ignored payload.
  while (remaining > 0) {
    let size = Math.min(remaining, 65537);
    if (remaining - size > 0 && remaining - size < 4) size -= 4;
    assert.ok(size >= 4);
    const segment = Buffer.alloc(size); segment[0] = 0xff; segment[1] = 0xef; segment.writeUInt16BE(size - 2, 2);
    segments.push(segment); remaining -= size;
  }
  return Buffer.concat([encoded.subarray(0, 2), ...segments, encoded.subarray(2)]);
}
test('HTTP admits decoded JPEGs at both upper byte boundaries and omits bytes from request inspection', async t => {
  for (const size of [MODEL_VISUAL_LIMITS.imageBytes - 1, MODEL_VISUAL_LIMITS.imageBytes]) {
    const f = await fixture(t, { observationId: 'observation-one', x: 0, y: 0 }), v = f.call.visualObservation!;
    const bytes = paddedJpeg(size), { dataUrl: _sourceBytes, ...sourceImage } = v.image;
    const image = { mimeType: 'image/jpeg' as const, dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    assert.equal(bytes.length, size);
    const call: ModelTurnRequest = { ...f.call, visualObservation: { ...v, sourceImage: { ...sourceImage, mimeType: 'image/png' },
      crop: { x: 0, y: 0, width: 2, height: 2, outputWidth: 1, outputHeight: 1 }, image } };
    const events = await readEvents(await f.post(call), async event => {
      if (event.kind !== 'tool-request') return;
      const { kind: _kind, x, y, ...ids } = event;
      assert.equal((await f.result({ ...ids, result: { status: 'no-hit', observationId: event.observationId, x, y, reason: 'empty' } })).status, 204);
    });
    assert.equal(events.at(-1)?.kind, 'done'); assert.equal(f.requests.length, 2);
    const providerImage = ((f.requests[0].input as { content: { image_url?: string }[] }[])[0].content)[1];
    assert.equal(providerImage.image_url === image.dataUrl, true);
    const inspections = events.filter(e => e.kind === 'request-inspection'); assert.equal(inspections.length, 3); // includes the explicit skill round
    for (const event of inspections) if (event.kind === 'request-inspection') {
      assert.equal(event.inspection.omissions.includes('image-bytes'), true);
      assert.equal(event.inspection.bodyJson.includes('base64'), false);
      assert.equal(event.inspection.bodyJson.includes(image.sha256), true);
      assert.equal(event.inspection.bodyJson.includes(sourceImage.sha256), true);
    }
  }
});
test('HTTP rejects a JPEG one byte above the image cap before provider dispatch', async t => {
  const f = await fixture(t), v = f.call.visualObservation!, bytes = paddedJpeg(MODEL_VISUAL_LIMITS.imageBytes + 1);
  const response = await f.post({ ...f.call, visualObservation: { ...v,
    image: { mimeType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } });
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: { code: 'image-too-large' } });
  assert.equal(f.requests.length, 0);
});
test('catalog-listed unfamiliar ChatGPT model receives input_image; provider rejection never retries or strips it', async () => {
  const requests: Record<string, unknown>[] = [], auth: ModelAuth = { status: () => ({ mode: 'chatgpt', authenticated: true, ready: true, planUsageEnabled: true, selectedAccount: null, accounts: [] }), credentialGeneration: () => 'g', onCredentialChange: () => () => {},
    credential: async () => ({ mode: 'chatgpt', bearer: 'fake-not-live', baseUrl: 'https://ignored.invalid', constraints: { billing: 'chatgpt-plan', responsesOnly: true } }) };
  let rejectImage = false;
  const model = new ProviderModel(auth, async (url, init) => { if (String(url).endsWith('/models')) return Response.json({ models: [{ slug: 'fixture-vision-vNext', display_name: 'Fixture model', visibility: 'list' }] }); requests.push(JSON.parse(String(init?.body))); return rejectImage ? Response.json({ error: { code: 'subscription_sharing_unsupported_capability' } }, { status: 400 }) : complete(); });
  try {
    await model.models(signal());
    const call: ModelTurnRequest = { requestId: 'r', conversationId: null, generation: 'g', model: 'fixture-vision-vNext', text: 'Look', scene: { mode: 'toronto', toronto: [] }, visualObservation: observation() };
    const bound = { context: {}, async check() {}, async close() {} };
    await model.turn(call, bound, async () => {}, signal());
    assert.equal(requests.length, 1); assert.equal('max_output_tokens' in requests[0], false);
    const image = () => ((requests.at(-1)!.input as { content: unknown[] }[])[0].content)[1];
    assert.deepEqual(image(), { type: 'input_image', image_url: call.visualObservation!.image.dataUrl, detail: 'high' });
    rejectImage = true; const events: ModelChatEvent[] = [];
    await assert.rejects(model.turn(call, bound, async e => { events.push(e); }, signal()), { code: 'unsupported-capability' });
    assert.equal(requests.length, 2); assert.deepEqual(image(), { type: 'input_image', image_url: call.visualObservation!.image.dataUrl, detail: 'high' });
    assert.equal(events.some(e => e.kind === 'done'), false);
    await assert.rejects(model.turn({ ...call, model: 'forged-not-in-catalog' }, bound, async () => {}, signal()), { code: 'model-unavailable' });
    assert.equal(requests.length, 2);
  } finally { model.close(); }
});

for (const change of [
  { key: { sourceFileId: 1, sourceRow: 99 } }, { position: [1, 0, 0] }, { frameId: 'foreign' },
  { artifactRevision: 'b'.repeat(64) }, { origin: [0, 0, 0] }, { datasetId: 'stpls3d-1' },
  { units: 'cm' }, { recordValidation: 'server-verified-original-record' },
]) test(`browser pixel provenance cannot forge verified original evidence: ${JSON.stringify(change)}`, async t => {
  const f = await fixture(t);
  const events = await readEvents(await f.post(f.call), async event => {
    if (event.kind !== 'tool-request') return;
    const { kind: _kind, x, y, ...identity } = event;
    const provenance = { datasetId: 'toronto3d', artifactRevision: f.call.visualObservation!.binding.sourceRevision,
      key: { sourceFileId: 1, sourceRow: 0 }, position: [0, 0, 0], frameId: 'toronto3d-local-v1', units: 'm', origin: [627285, 4841948, 0], layer: 'overview', ...change };
    assert.equal((await f.result({ ...identity, result: { status: 'resolved', observationId: event.observationId, x, y, provenance } })).status, 204);
  });
  assert.equal(events.at(-1)?.kind, 'error'); assert.equal(events.some(e => e.kind === 'tool' && e.name === 'resolve_visual_pixel'), false);
  assert.equal(f.requests.length, 1);
});
