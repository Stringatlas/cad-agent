import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createViewportSizer } from '../apps/web/src/viewport-size';
import { createVisualCapture } from '../apps/web/src/visual-capture';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture(pixelRatio = 1) {
  let width = 1080, height = 842, bufferWidth = 300, bufferHeight = 150, renders = 0, resizes = 0;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
  const frames: { width: number; height: number; aspect: number; projection: number[] }[] = [];
  const host = { getBoundingClientRect: () => ({ width, height } as DOMRect) };
  const renderer = {
    setSize(w: number, h: number) { bufferWidth = Math.floor(w * pixelRatio); bufferHeight = Math.floor(h * pixelRatio); resizes++; },
    getContext: () => ({ isContextLost: () => false }),
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(bufferWidth, bufferHeight),
    getPixelRatio: () => pixelRatio,
    render(_scene: THREE.Scene, view: THREE.PerspectiveCamera) {
      renders++; frames.push({ width: bufferWidth, height: bufferHeight, aspect: view.aspect, projection: view.projectionMatrix.toArray() });
    },
    domElement: { toDataURL: () => PNG },
  } as unknown as THREE.WebGLRenderer;
  const visual = createVisualCapture({ renderer, scene, camera, available: () => viewport.sync(),
    binding: () => ({ sourceId: 'fixture', sourceRevision: 1, frameId: 'local', units: 'm', origin: [0, 0, 0] }),
    coverage: () => ({ kind: 'fixture', complete: true, displayedPointCount: 0 }), points: () => [], resolve: () => undefined });
  const viewport = createViewportSizer(host, renderer, camera, visual.invalidate);
  return { camera, renderer, scene, visual, viewport, frames, renders: () => renders, resizes: () => resizes,
    resize(w: number, h: number) { width = w; height = h; } };
}

test('initial synchronous sizing replaces the 300x150 default before the first render', () => {
  const f = fixture();
  assert.equal(f.viewport.sync(), true);
  f.renderer.render(f.scene, f.camera);
  assert.equal(f.frames[0]!.width, 1080);
  assert.equal(f.frames[0]!.height, 842);
  assert.equal(f.camera.aspect, 1080 / 842);
  assert.notEqual(f.camera.projectionMatrix.elements[0], new THREE.PerspectiveCamera(45, 1, .1, 100).projectionMatrix.elements[0]);
});

test('immediate remount capture sizes synchronously without an observer or animation frame', async () => {
  const f = fixture();
  const observation = await f.visual.capture({ kind: 'current' });
  assert.equal(observation.viewport.width, 1080);
  assert.equal(observation.viewport.height, 842);
  assert.equal(observation.camera.aspect, 1080 / 842);
  assert.deepEqual(observation.camera.projectionMatrix, f.frames[0]!.projection);
  assert.equal(f.visual.isCurrent(observation.observationId), true);
  assert.equal(f.resizes(), 1);
});

test('responsive resize before observer delivery updates buffer and cloned-camera projection at DPR 2', async () => {
  const f = fixture(2); f.viewport.sync();
  const old = await f.visual.capture();
  f.resize(390, 700);
  assert.equal(f.visual.isCurrent(old.observationId), false);
  const observation = await f.visual.capture({ kind: 'top-down' });
  assert.deepEqual(observation.viewport, { width: 780, height: 1400, pixelRatio: 2, pixelOrigin: 'top-left' });
  assert.equal(observation.camera.aspect, 390 / 700);
  assert.deepEqual(observation.camera.projectionMatrix, f.frames.at(-2)!.projection);
  assert.equal(f.frames.at(-1)!.aspect, 390 / 700);
  const resizes = f.resizes();
  f.viewport.sync(); // A later observer notification is an idempotent no-op.
  assert.equal(f.resizes(), resizes);
  assert.equal(f.visual.isCurrent(observation.observationId), true);
});

test('zero, subpixel and nonfinite hosts reject capture rather than reporting a previous/default image', async () => {
  for (const size of [[0, 842], [1080, 0], [0, 0], [.5, 10], [NaN, 10], [10, Infinity]]) {
    const f = fixture();
    const old = await f.visual.capture();
    f.resize(size[0]!, size[1]!);
    const renders = f.renders();
    await assert.rejects(f.visual.capture(), /Visual capture unavailable/);
    assert.equal(f.renders(), renders);
    assert.equal(f.visual.isCurrent(old.observationId), false);
    f.resize(1080, 842);
    const restored = await f.visual.capture();
    assert.equal(restored.viewport.width, 1080);
    assert.equal(f.visual.isCurrent(restored.observationId), true);
  }
});
