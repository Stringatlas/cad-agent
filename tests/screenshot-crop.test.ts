import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import type { VisualObservation } from '@spatial/contracts';
import { clampCrop, compressScreenshot, cropOutputSize, dragCrop, SCREENSHOT_JPEG_QUALITY } from '../apps/web/src/screenshot-crop';

test('compression hashes actual JPEG bytes, accepts >2 MiB local PNG, preserves metadata and rejects late stale output', async () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const source: VisualObservation = { schemaVersion: 1, observationId: 'source-one', viewGeneration: 4,
    image: { mimeType: 'image/png', dataUrl: 'data:image/png;base64,cG5n', sha256: 'a'.repeat(64), byteLength: 3 * 1024 * 1024 },
    viewport: { width: 4096, height: 2048, pixelRatio: 2, pixelOrigin: 'top-left' },
    camera: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], up: [0, 0, 1], near: .1, far: 100, fov: 50, aspect: 2, zoom: 1, matrixWorld: identity, matrixWorldInverse: identity, projectionMatrix: identity },
    binding: { sourceId: 'source-one', sourceRevision: 5, frameId: 'frame-one', units: 'm', origin: [0, 0, 0] },
    coverage: { kind: 'displayed-sample', complete: false, displayedPointCount: 4 } };
  const bytes = Buffer.from('actual-jpeg-byte-payload');
  let valid = true, staleAt = '', dimensions: number[] = [], draw: unknown[] = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect() {}, drawImage(...args: unknown[]) { draw = args.slice(1); } }),
    toBlob(callback: (blob: Blob) => void, mime: string, quality: number) { dimensions = [canvas.width, canvas.height]; assert.equal(mime, 'image/jpeg'); assert.equal(quality, .78); if (staleAt === 'encode') valid = false; callback(new Blob([bytes], { type: 'image/jpeg' })); } };
  const replacements = {
    document: { createElement: () => canvas },
    Image: class { src = ''; naturalWidth = 4096; naturalHeight = 2048; async decode() { if (staleAt === 'decode') valid = false; } },
    FileReader: class { result = ''; onload?: () => void; async readAsDataURL(blob: Blob) { this.result = `data:image/jpeg;base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; if (staleAt === 'read') valid = false; this.onload?.(); } },
  };
  const descriptors = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, value });
    const rect = { x: 100, y: 200, width: 3000, height: 1500 };
    const result = await compressScreenshot(source, rect, () => valid);
    assert.deepEqual(dimensions, [1280, 640]); assert.deepEqual(draw, [100, 200, 3000, 1500, 0, 0, 1280, 640]);
    assert.equal(result.image.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(result.image.byteLength, bytes.length); assert.equal(result.image.mimeType, 'image/jpeg');
    assert.deepEqual(result.sourceImage, { mimeType: 'image/png', sha256: source.image.sha256, byteLength: source.image.byteLength });
    assert.deepEqual(result.crop, { ...rect, outputWidth: 1280, outputHeight: 640 });
    for (const key of ['viewport', 'camera', 'binding', 'coverage'] as const) assert.deepEqual(result[key], source[key]);
    assert.ok(!JSON.stringify(result).includes(source.image.dataUrl)); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
    for (const phase of ['decode', 'encode', 'read']) {
      valid = true; staleAt = phase;
      await assert.rejects(compressScreenshot(source, rect, () => valid), /stale/);
    }
    valid = false; await assert.rejects(compressScreenshot(source, rect, () => valid), /stale/);
  } finally {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('crop selection clamps and rounds original drawing-buffer coordinates', () => {
  assert.deepEqual(clampCrop({ x: -10, y: 90.7, width: 999, height: 999 }, 100, 100), { x: 0, y: 91, width: 100, height: 9 });
  assert.deepEqual(clampCrop({ x: 100, y: 100, width: 0, height: -1 }, 100, 100), { x: 99, y: 99, width: 1, height: 1 });
  assert.deepEqual(clampCrop({ x: 12, y: 5, width: 25, height: 14 }, 100, 100), { x: 12, y: 5, width: 25, height: 14 });
  assert.throws(() => clampCrop({ x: NaN, y: 0, width: 1, height: 1 }, 100, 100));
  assert.throws(() => clampCrop({ x: 0, y: 0, width: 1, height: 1 }, 0, 100));
});
test('drag works in every direction, clamps outside pointer capture and keeps at least one pixel', () => {
  assert.deepEqual(dragCrop({ x: 80, y: 70 }, { x: 20, y: 10 }, 100, 100), { x: 20, y: 10, width: 60, height: 60 });
  assert.deepEqual(dragCrop({ x: 20, y: 10 }, { x: 80, y: 70 }, 100, 100), { x: 20, y: 10, width: 60, height: 60 });
  assert.deepEqual(dragCrop({ x: 20, y: 10 }, { x: 800, y: -80 }, 100, 100), { x: 20, y: 0, width: 80, height: 10 });
  assert.deepEqual(dragCrop({ x: 100, y: 100 }, { x: 100, y: 100 }, 100, 100), { x: 99, y: 99, width: 1, height: 1 });
});
test('JPEG output has max long edge 1280, preserves aspect within rounding and never upscales', () => {
  assert.equal(SCREENSHOT_JPEG_QUALITY, .78);
  assert.deepEqual(cropOutputSize(4096, 2048), { width: 1280, height: 640 });
  assert.deepEqual(cropOutputSize(2048, 4096), { width: 640, height: 1280 });
  assert.deepEqual(cropOutputSize(640, 480), { width: 640, height: 480 });
  assert.deepEqual(cropOutputSize(1280, 1), { width: 1280, height: 1 });
  assert.deepEqual(cropOutputSize(1, 4096), { width: 1, height: 1280 });
  assert.throws(() => cropOutputSize(0, 1)); assert.throws(() => cropOutputSize(1.5, 10));
  for (let width = 1; width <= 4096; width += 139) for (let height = 1; height <= 4096; height += 147) {
    const output = cropOutputSize(width, height);
    assert.ok(output.width <= width && output.height <= height && Math.max(output.width, output.height) <= 1280);
    assert.ok(output.width >= 1 && output.height >= 1);
  }
});
