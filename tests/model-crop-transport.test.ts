import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { canonicalModelVisualObservation, modelVisualImageSize, modelVisualSourcePixel, type ModelVisualObservation, type ModelTurnRequest } from '@spatial/contracts';
import { validateModelVisual } from '../apps/server/src/model-visual';
import { inspectModelRequest } from '../apps/server/src/model-request-inspection';
import { streamModelTurn, type VisualModelAttachment } from '../apps/web/src/model-chat-client';
const jpeg = createRequire(new URL('../apps/server/package.json', import.meta.url))('jpeg-js') as { encode(image: { data: Buffer; width: number; height: number }, quality: number): { data: Buffer } };
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function visual(): ModelVisualObservation {
  const bytes = jpeg.encode({ width: 3, height: 2, data: Buffer.alloc(3 * 2 * 4, 200) }, 70).data;
  return { schemaVersion: 1, observationId: 'crop-one', viewGeneration: 5,
    image: { mimeType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length },
    sourceImage: { mimeType: 'image/png', sha256: 'b'.repeat(64), byteLength: 5000 },
    crop: { x: 2, y: 3, width: 7, height: 5, outputWidth: 3, outputHeight: 2 },
    viewport: { width: 12, height: 10, pixelRatio: 2, pixelOrigin: 'top-left' },
    camera: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], up: [0, 0, 1], near: .1, far: 100, fov: 50, aspect: 1.2, zoom: 1, matrixWorld: identity, matrixWorldInverse: identity, projectionMatrix: identity },
    binding: { sourceId: 'session-one', sourceRevision: 0, frameId: 'demo-local-v1', units: 'm', origin: [0, 0, 0] },
    coverage: { kind: 'displayed-sample', complete: false, displayedPointCount: 4 } };
}
function request(v = visual()): ModelTurnRequest { return { requestId: 'request-one', conversationId: null, generation: 'account-one', model: 'catalog-arbitrary-model', text: 'Inspect crop',
  scene: { mode: 'demo', project: { sessionId: 'session-one', projectRevision: 0, frameId: 'demo-local-v1', units: 'm', entityIds: [], points: [] }, toronto: [] }, visualObservation: v }; }
const signal = () => new AbortController().signal;
function withBytes(v: ModelVisualObservation, bytes: Buffer): ModelVisualObservation { return { ...v, image: { ...v.image, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), dataUrl: `data:${v.image.mimeType};base64,${bytes.toString('base64')}` } }; }

test('JPEG crop contract preserves original capture metadata and maps sent pixel centers to source', () => {
  const v = visual(); assert.deepEqual(canonicalModelVisualObservation(v), v); assert.deepEqual(modelVisualImageSize(v), { width: 3, height: 2 });
  assert.deepEqual(modelVisualSourcePixel(v, 0, 0), { x: 3, y: 4 });
  assert.deepEqual(modelVisualSourcePixel(v, 2, 1), { x: 7, y: 6 });
  for (const [x, y] of [[-1, 0], [3, 0], [0, 2], [.5, 0]]) assert.throws(() => modelVisualSourcePixel(v, x, y));
  for (const bad of [{ ...v, sourceImage: undefined }, { ...v, sourceImage: { ...v.sourceImage, byteLength: 0 } },
    ...[{ x: -1 }, { x: 8 }, { width: 0 }, { width: 1.1 }, { outputWidth: 8 }, { outputHeight: 0 }, { unknown: 1 }].map(crop => ({ ...v, crop: { ...v.crop, ...crop } }))]) assert.throws(() => canonicalModelVisualObservation(bad));
});

test('actual bounded JPEG decode rejects forged dimensions, MIME, hash, truncated and oversized decoded headers', async () => {
  const v = visual(); assert.deepEqual(await validateModelVisual(request(v), signal()), v);
  for (const bad of [{ ...v, crop: { ...v.crop!, outputWidth: 2 } }, { ...v, image: { ...v.image, sha256: 'a'.repeat(64) } },
    { ...v, image: { ...v.image, mimeType: 'image/png' as const, dataUrl: v.image.dataUrl.replace('image/jpeg', 'image/png') } },
    withBytes(v, Buffer.from([0xff, 0xd8, 0xff, 0xd9])), withBytes(v, Buffer.from(v.image.dataUrl.split(',')[1], 'base64').subarray(0, 100)),
    { ...v, binding: { ...v.binding, sourceRevision: 1 } }]) await assert.rejects(validateModelVisual(request(bad), signal()));
  const bomb = Buffer.from(v.image.dataUrl.split(',')[1], 'base64');
  const marker = bomb.indexOf(Buffer.from([0xff, 0xc0])); assert.ok(marker > 0);
  bomb.writeUInt16BE(65535, marker + 5); bomb.writeUInt16BE(65535, marker + 7);
  await assert.rejects(validateModelVisual(request(withBytes(v, bomb)), signal()));
  const abort = new AbortController(); abort.abort(); await assert.rejects(validateModelVisual(request(v), abort.signal));
});

test('JPEG inspection reports transmitted dimensions/hash/MIME, preserves source/crop metadata, excludes bytes', () => {
  const v = visual(); const { dataUrl: _bytes, ...image } = v.image;
  const snapshot = inspectModelRequest({ model: 'catalog-arbitrary-model', input: [
    { role: 'user', content: [{ type: 'input_image', image_url: v.image.dataUrl, detail: 'high' }] },
    { role: 'developer', content: JSON.stringify({ ...v, image }) }], tools: [] }, 'api-key', 1, false);
  assert.ok(snapshot.omissions.includes('image-bytes')); assert.ok(!snapshot.bodyJson.includes('base64'));
  const body = JSON.parse(snapshot.bodyJson); assert.deepEqual(body.input[0].content[0].image,
    { mimeType: 'image/jpeg', sha256: v.image.sha256, byteLength: v.image.byteLength, width: 3, height: 2, omitted: 'image-bytes' });
  const metadata = JSON.parse(body.input[1].content); assert.deepEqual(metadata.viewport, v.viewport); assert.deepEqual(metadata.camera, v.camera); assert.deepEqual(metadata.sourceImage, v.sourceImage); assert.deepEqual(metadata.crop, v.crop);
});

test('crop client resolves original source coordinates and POSTs sent coordinates, never source PNG bytes', async () => {
  const v = visual(), r = request(v), resolutions: unknown[] = []; let posts = 0;
  const attachment: VisualModelAttachment = { observation: v, isCurrent: () => true, resolvePixel(id, x, y) { resolutions.push({ id, x, y }); return { status: 'resolved', observationId: id, x, y, provenance: { pointIndex: 4 } }; } };
  const events: Record<string, unknown>[] = [{ kind: 'start', requestId: r.requestId, conversationId: 'conversation-one', model: r.model },
    { kind: 'tool-request', requestId: r.requestId, toolCallId: 'call-one', nonce: 'nonce-one', observationId: v.observationId, x: 2, y: 1 },
    { kind: 'done', requestId: r.requestId, conversationId: 'conversation-one' }];
  await streamModelTurn(r, signal(), () => {}, async (path, init) => {
    if (path === '/chat/turn') { assert.ok(!(init!.body as string).includes('data:image/png')); return new Response(events.map(e => JSON.stringify(e) + '\n').join(''), { headers: { 'content-type': 'application/x-ndjson' } }); }
    posts++; const payload = JSON.parse(init!.body as string); assert.equal(payload.result.x, 2); assert.equal(payload.result.y, 1); assert.deepEqual(payload.result.provenance, { pointIndex: 4 }); return new Response(null, { status: 204 });
  }, attachment);
  assert.equal(posts, 1); assert.deepEqual(resolutions, [{ id: v.observationId, x: 7, y: 6 }]);
  events[1] = { ...events[1], x: 3 };
  await assert.rejects(streamModelTurn(r, signal(), () => {}, async () => new Response(events.map(e => JSON.stringify(e) + '\n').join(''), { headers: { 'content-type': 'application/x-ndjson' } }), attachment));
  assert.equal(resolutions.length, 1);
});
