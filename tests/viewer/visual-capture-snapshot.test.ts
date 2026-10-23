import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVisualCapture } from '../../apps/web/src/viewer/visual-capture';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([10, 0, 0], 3));
  const material = new THREE.PointsMaterial({ sizeAttenuation: false }), points = new THREE.Points(geometry, material); scene.add(points);
  let source = new Float64Array([10, 0, 0]), revision = 'a'.repeat(64), lost = false;
  let contextLoss: (() => void) | undefined;
  const renderer = { getContext: () => ({ isContextLost: () => lost }), getDrawingBufferSize: (v: THREE.Vector2) => v.set(101, 101), getPixelRatio: () => 1, render() {}, domElement: { toDataURL: () => PNG, addEventListener(name: string, listener: () => void) { if (name === 'webglcontextlost') contextLoss = listener; }, removeEventListener() {} } } as unknown as THREE.WebGLRenderer;
  const capture = createVisualCapture({ renderer, scene, camera, available: () => !lost,
    binding: () => ({ sourceId: 'fixture', sourceRevision: revision, frameId: 'local', units: 'm', origin: [0, 0, 0] }),
    coverage: () => ({ kind: 'source', complete: false, displayedPointCount: 1 }), points: () => [points], resolve: () => undefined,
    captureSource: object => object === points ? { count: 1, copy(start, count, xyz, keys) { xyz.set(source.subarray(start * 3, (start + count) * 3)); keys.set([1, 7]); } } : undefined,
    prepare: async () => ({ coverage: { status: 'ready', budgetLimited: false, targetPointCount: 1, targetNodeCount: 1, pointBudget: 3000000 }, release() {}, render() {
      source = new Float64Array([0.000000000001, 0, 0]); geometry.getAttribute('position').setXYZ(0, 0, 0, 0);
      return { changed: true, restore() { source.fill(99); geometry.getAttribute('position').setXYZ(0, 10, 0, 0); } };
    } }),
  });
  return { capture, points, camera, material, stale: () => revision = 'b'.repeat(64), lose: () => { lost = true; contextLoss?.(); }, restore: () => { lost = false; } };
}
test('tool snapshot resolves borrowed image after restore/navigation/legacy invalidation and returns original binary64', async () => {
  const f = fixture(); const observation = await f.capture.captureSnapshot({ kind: 'top-down' });
  assert.equal(f.points.geometry.getAttribute('position').getX(0), 10);
  f.camera.position.x = 99; f.capture.invalidate();
  assert.equal(f.capture.isCurrent(observation.observationId), true);
  const result = f.capture.resolvePixel(observation.observationId, 50, 50);
  assert.equal(result.status, 'resolved'); if (result.status === 'resolved') assert.deepEqual(result.provenance.position, [.000000000001, 0, 0]);
  assert.equal((observation.coverage.grounding as any).status, 'ready');
  f.capture.dispose(); assert.equal(f.capture.isCurrent(observation.observationId), false);
});
test('latest-only replacement, unknown old ID, release, source changes and context loss revoke correctly', async () => {
  const f = fixture(), first = await f.capture.captureSnapshot({ kind: 'current' }), second = await f.capture.captureSnapshot({ kind: 'current' });
  assert.equal(f.capture.isCurrent(first.observationId), false); assert.equal(f.capture.isCurrent(second.observationId), true);
  f.stale(); assert.equal(f.capture.isCurrent(second.observationId), false);
  const third = await f.capture.captureSnapshot({ kind: 'current' }); f.lose(); assert.equal(f.capture.isCurrent(third.observationId), false); f.capture.dispose();
});
test('unsupported tool image remains usable without falling back to live grounding; cancellation releases snapshot', async () => {
  const f = fixture(); f.material.transparent = true;
  const unsupported = await f.capture.captureSnapshot({ kind: 'current' });
  assert.equal((unsupported.coverage.grounding as any).status, 'unavailable'); assert.equal(f.capture.isCurrent(unsupported.observationId), false);
  f.material.transparent = false; const controller = new AbortController();
  const ready = await f.capture.captureSnapshot({ kind: 'current' }, controller.signal); assert(f.capture.isCurrent(ready.observationId));
  controller.abort(); assert.equal(f.capture.isCurrent(ready.observationId), false);
  const last = await f.capture.captureSnapshot({ kind: 'current' }); f.capture.releaseGrounding(); assert.equal(f.capture.isCurrent(last.observationId), false); f.capture.dispose();
});
test('derived raster capture stays usable but cannot publish ready original-point grounding', async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ vertexColors: true })));
  const renderer = { getContext: () => ({ isContextLost: () => false }), getDrawingBufferSize: (v: THREE.Vector2) => v.set(101, 101), getPixelRatio: () => 1, render() {},
    domElement: { toDataURL: () => PNG } } as unknown as THREE.WebGLRenderer;
  const capture = createVisualCapture({ renderer, scene, camera, available: () => true,
    binding: () => ({ sourceId: 'fixture', sourceRevision: 'a'.repeat(64), frameId: 'local', units: 'm', origin: [0, 0, 0] }),
    coverage: () => ({ kind: 'prepared-elevation-surface', complete: false, displayedPointCount: 0 }),
    points: () => [], resolve: () => undefined });
  try {
    const observation = await capture.captureSnapshot({ kind: 'current' });
    assert.equal(observation.image.dataUrl, PNG);
    assert.equal((observation.coverage.grounding as any).status, 'unavailable');
    assert.match((observation.coverage.grounding as any).reason, /original source points unavailable/);
    assert.equal(capture.isCurrent(observation.observationId), false);
    assert.notEqual(capture.resolvePixel(observation.observationId, 50, 50).status, 'no-hit');
  } finally { capture.dispose(); }
});

test('relative browser request consumes only latest locally issued tool view and survives navigation even without grounding', async () => {
  const f = fixture(); f.material.transparent = true;
  const first = await f.capture.captureSnapshot({ kind: 'current' });
  const base = first.coverage.agentView as unknown as import('@spatial/contracts').AgentViewReceipt;
  assert(base); assert.equal((first.coverage.grounding as any).status, 'unavailable');
  f.camera.position.x = 99; f.capture.invalidate();
  const binding = { sourceId: first.binding.sourceId, sourceRevision: String(first.binding.sourceRevision), frameId: first.binding.frameId, units: 'm' as const, origin: first.binding.origin };
  const adjustment = { azimuthDeltaDegrees: 90, elevationDeltaDegrees: -45, distanceScale: .5 };
  const next = await f.capture.captureSnapshot({ kind: 'adjust', binding, observationId: first.observationId, base, adjustment });
  const receipt = next.coverage.agentView as unknown as import('@spatial/contracts').AgentViewReceipt;
  assert.deepEqual(receipt.pivot, base.pivot); assert.equal(receipt.distance, base.distance / 2); assert.equal(receipt.elevationDegrees, 45);
  await assert.rejects(f.capture.captureSnapshot({ kind: 'adjust', binding, observationId: first.observationId, base, adjustment }), { code: 'view-unavailable' });
  // A failed replacement also revokes the previous successful local view.
  await assert.rejects(f.capture.captureSnapshot({ kind: 'adjust', binding, observationId: next.observationId, base: receipt, adjustment }), { code: 'view-unavailable' });
  f.capture.dispose();
});


test('context loss while hashing cancels capture even when context restores before digest completes', async t => {
  const f = fixture(); t.after(() => f.capture.dispose());
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const enteredDigest = new Promise<void>(resolve => { entered = resolve; });
  t.mock.method(crypto.subtle, 'digest', async (...args: Parameters<typeof digest>) => {
    entered(); await gate; return digest(...args);
  });
  const pending = f.capture.captureSnapshot({ kind: 'current' });
  const rejected = assert.rejects(pending, /context lost/);
  await enteredDigest; f.lose(); f.restore(); release();
  await rejected;
  // Cancellation cannot install grounding or a relative base after restoration.
  assert.equal(f.capture.isCurrent('never-issued'), false);
  const next = await f.capture.captureSnapshot({ kind: 'current' });
  assert(f.capture.isCurrent(next.observationId));
});
