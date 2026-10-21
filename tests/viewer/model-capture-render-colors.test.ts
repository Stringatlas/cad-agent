import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { ModelCaptureColorMode, ModelCaptureRequest } from '@spatial/contracts';
import { createVisualCapture } from '../../apps/web/src/viewer/visual-capture';
import { createCropLayer } from '../../apps/web/src/scenes/toronto/display/crop-render';
import { pointColors } from '../../apps/web/src/scenes/toronto/display/point-colors';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture(initial: ModelCaptureColorMode = 'rgb', supported = true) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .1, 100);
  camera.position.set(0, -10, 0); camera.up.set(0, 0, 1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const crop = createCropLayer(scene), rgb = [255, 0, 0], labels = [6];
  const point = crop.append([0, 0, 0], rgb, labels)!;
  let mode = initial, fail = false, failRender = false;
  crop.setColorMode(mode);
  const frames: { mode: string; colors: number[]; camera: number[] }[] = [];
  const set = (value: ModelCaptureColorMode) => { mode = value; crop.setColorMode(value); };
  const renderer = { getContext: () => ({ isContextLost: () => false }), getDrawingBufferSize: (v: THREE.Vector2) => v.set(101, 101), getPixelRatio: () => 1,
    render: (_scene: THREE.Scene, view: THREE.PerspectiveCamera) => {
      frames.push({ mode, colors: Array.from(point.geometry.getAttribute('color').array), camera: view.position.toArray() });
      if (failRender && mode !== initial) throw new Error('render failed');
    }, domElement: { toDataURL: () => { if (fail) throw new Error('extraction failed'); return PNG; } } } as unknown as THREE.WebGLRenderer;
  const capture = createVisualCapture({ scene, camera, renderer, target: () => [0, 0, 0], available: () => true,
    ...(supported ? { pointColorMode: { get: () => mode, set } } : {}),
    binding: () => ({ sourceId: 'fixture', sourceRevision: 1, frameId: 'local', units: 'm', origin: [0, 0, 0] }),
    coverage: () => ({ kind: 'fixture', complete: false, displayedPointCount: 1, pointColorMode: mode }),
    points: () => [point], resolve: () => ({ entityId: 'cloud', pointIndex: 0, position: [0, 0, 0] }) });
  return { capture, frames, camera, point, set, mode: () => mode, fail: () => { fail = true; }, failRender: () => { failRender = true; }, rgb, labels };
}
const scenarios: { initial: ModelCaptureColorMode; view: ModelCaptureRequest; requested?: ModelCaptureColorMode }[] = [
  { initial: 'rgb', view: { kind: 'current' } },
  { initial: 'rgb', view: { kind: 'top-down' }, requested: 'type' },
  { initial: 'type', view: { kind: 'camera', position: [0, -10, 0], target: [0, 0, 0] }, requested: 'rgb' },
  { initial: 'type', view: { kind: 'current' }, requested: 'type' },
];
for (const { initial, view, requested } of scenarios) {
  test(`render ${view.kind}, UI ${initial}, capture ${requested ?? 'omitted'}`, async () => {
    const f = fixture(initial), camera = f.camera.toJSON();
    const image = await f.capture.capture({ ...view, ...(requested ? { colorMode: requested } : {}) });
    assert.equal(image.coverage.pointColorMode, requested ?? initial);
    assert.equal(f.frames[0].mode, requested ?? initial);
    assert.deepEqual(f.frames[0].colors, Array.from(pointColors(f.rgb, f.labels, requested ?? initial)));
    assert.deepEqual(Array.from(f.point.geometry.getAttribute('color').array), Array.from(pointColors(f.rgb, f.labels, initial)));
    assert.equal(f.mode(), initial);
    assert.deepEqual(f.camera.toJSON(), camera);
    assert.equal(f.capture.isCurrent(image.observationId), true, 'restoring color buffer versions does not discard grounding');
    assert.equal(f.capture.resolvePixel(image.observationId, 50, 50).status, 'resolved');
    if (requested !== undefined && requested !== initial || view.kind !== 'current') assert.equal(f.frames.at(-1)!.mode, initial);
    f.set(initial === 'rgb' ? 'type' : 'rgb');
    assert.equal(f.capture.isCurrent(image.observationId), false, 'later user color changes invalidate grounding');
  });
}
for (const failure of ['fail', 'failRender'] as const) test(`restores colors and current frame on ${failure}`, async () => {
  const f = fixture(); f[failure]();
  await assert.rejects(f.capture.capture({ kind: 'top-down', colorMode: 'type' }), /failed/);
  assert.equal(f.mode(), 'rgb'); assert.equal(f.frames.at(-1)!.mode, 'rgb');
  assert.deepEqual(f.frames.at(-1)!.camera, f.camera.position.toArray());
  assert.deepEqual(Array.from(f.point.geometry.getAttribute('color').array), Array.from(pointColors(f.rgb, f.labels, 'rgb')));
});
test('viewers without source colors reject explicit mode without rendering; omitted mode remains supported', async () => {
  const f = fixture('rgb', false);
  for (const colorMode of ['rgb', 'type'] as const) await assert.rejects(f.capture.capture({ kind: 'current', colorMode }), /unavailable/);
  assert.equal(f.frames.length, 0);
  await f.capture.capture({ kind: 'current' }); assert.equal(f.frames.length, 1);
});
test('invalid mode never recolors or renders', async () => {
  const f = fixture();
  await assert.rejects(f.capture.capture({ kind: 'current', colorMode: 'bad' } as unknown as ModelCaptureRequest));
  assert.equal(f.frames.length, 0); assert.equal(f.mode(), 'rgb');
});
