import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as THREE from 'three';
import type { VisualBinding, VisualCoverage } from '@spatial/contracts';
import { createVisualCapture } from '../../apps/web/src/viewer/visual-capture';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture(positions = [0, 0, 0]) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 1 })); scene.add(points);
  let width = 101, height = 101, pixelRatio = 2, live = true, lost = false, rendered = 0, dataUrl = PNG;
  let binding: VisualBinding = { sourceId: 'fixture', sourceRevision: 1, frameId: 'fixture-local', units: 'm', origin: [1000, 2000, 10] };
  let coverage: VisualCoverage = { kind: 'sampled', complete: false, displayedPointCount: positions.length / 3, lod: { depth: 2 } };
  const originals = positions.reduce<{ key: { sourceRow: number }; position: number[] }[]>((values, _, index) => {
    if (index % 3 === 0) values.push({ key: { sourceRow: 1000 + index / 3 }, position: positions.slice(index, index + 3) });
    return values;
  }, []);
  const renderer = {
    getContext: () => ({ isContextLost: () => lost }),
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(width, height),
    getPixelRatio: () => pixelRatio,
    render: () => { rendered++; }, domElement: { toDataURL: () => dataUrl },
  } as unknown as THREE.WebGLRenderer;
  const capture = createVisualCapture({ renderer, scene, camera, binding: () => binding, coverage: () => coverage,
    points: () => [points], resolve: (_object, index) => originals[index], available: () => live });
  return { capture, scene, camera, points, originals, rendered: () => rendered,
    resize: () => { width++; height++; }, dpr: (value: number) => { pixelRatio = value; },
    unavailable: () => { live = false; }, lose: () => { lost = true; },
    revision: () => { binding = { ...binding, sourceRevision: 2 }; },
    detail: () => { coverage = { ...coverage, detail: 'loading' }; }, badPng: () => { dataUrl = 'data:,'; },
    huge: () => { width = 4097; },
    hugePng: () => { dataUrl = 'data:image/png;base64,' + 'A'.repeat(17 * 1024 * 1024); },
    invalidMetadata: () => { binding = { ...binding, origin: [NaN, 0, 0] }; },
  };
}

test('capture hashes PNG bytes, freezes camera/frame/coverage and resolves original source provenance', async () => {
  const f = fixture(), observation = await f.capture.capture();
  assert.equal(f.rendered(), 1);
  assert.equal(observation.image.sha256, createHash('sha256').update(Buffer.from(PNG.slice(22), 'base64')).digest('hex'));
  assert.equal(observation.image.byteLength, Buffer.from(PNG.slice(22), 'base64').length);
  assert.deepEqual(observation.viewport, { width: 101, height: 101, pixelRatio: 2, pixelOrigin: 'top-left' });
  assert.equal(observation.coverage.complete, false);
  assert.ok(Object.isFrozen(observation.camera.matrixWorld));
  assert.ok(Object.isFrozen(observation.binding.origin));
  assert.ok(Object.isFrozen(observation.coverage.lod));
  const result = f.capture.resolvePixel(observation.observationId, 50, 50);
  assert.equal(result.status, 'resolved');
  if (result.status === 'resolved') {
    assert.deepEqual(result.provenance, { key: { sourceRow: 1000 }, position: [0, 0, 0] });
    assert.notEqual(result.provenance, f.originals[0]);
    assert.ok(Object.isFrozen(result.provenance.key));
  }
  assert.equal(f.capture.resolvePixel(observation.observationId, 0, 0).status, 'no-hit');
});

test('image top-left drawing-buffer coordinates project correctly independently of CSS/DPR', async () => {
  const f = fixture([1, 1, 0]);
  const projected = new THREE.Vector3(1, 1, 0).project(f.camera);
  const x = Math.floor((projected.x + 1) * 101 / 2), y = Math.floor((1 - projected.y) * 101 / 2);
  const observation = await f.capture.capture();
  assert.ok(x > 50 && y < 50);
  assert.equal(f.capture.resolvePixel(observation.observationId, x, y).status, 'resolved');
  assert.equal(f.capture.resolvePixel(observation.observationId, Math.floor(x / 2), Math.floor(y / 2)).status, 'no-hit');
});

test('zoom and DPR retain drawing-buffer projection and never use CSS pixels', async () => {
  for (const zoom of [0.5, 2, 4]) for (const dpr of [1, 2, 3]) {
    const f = fixture([0.4, 0.4, 0]);
    f.camera.zoom = zoom; f.camera.updateProjectionMatrix(); f.dpr(dpr);
    const projected = new THREE.Vector3(0.4, 0.4, 0).project(f.camera);
    const x = Math.floor((projected.x + 1) * 101 / 2), y = Math.floor((1 - projected.y) * 101 / 2);
    const observation = await f.capture.capture();
    assert.equal(observation.viewport.pixelRatio, dpr);
    assert.equal(f.capture.resolvePixel(observation.observationId, x, y).status, 'resolved', `zoom=${zoom}, DPR=${dpr}`);
  }
});

test('capture admits opaque solids and translucent ghosts as past imagery; meshes never become point provenance', async () => {
  for (const opacity of [1, .25]) {
    const f = fixture();
    const solid = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ opacity, transparent: opacity < 1 }));
    solid.position.z = 2; f.scene.add(solid);
    const observation = await f.capture.capture();
    assert.ok(observation.image.byteLength > 0);
    assert.equal(f.capture.resolvePixel(observation.observationId, 50, 50).status, 'no-hit', 'CAD/ghost mesh does not become a source point');
    solid.position.x = 4; f.camera.position.x = 3; f.revision(); f.capture.invalidate();
    assert.equal(observation.camera.position[0], 0); assert.equal(observation.binding.sourceRevision, 1);
    assert.equal(f.capture.isCurrent(observation.observationId), false, 'only live pixel grounding is unavailable');
    assert.ok(observation.image.dataUrl.startsWith('data:image/png;base64,'));
    f.capture.dispose(); solid.geometry.dispose(); solid.material.dispose();
  }
});

test('currency checks never raycast and wrong or superseded IDs preserve the latest capture', async () => {
  const f = fixture();
  f.points.raycast = () => { assert.fail('Currency checks must not raycast points'); };
  const blocker = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  blocker.raycast = () => { assert.fail('Currency checks must not raycast meshes'); };
  f.scene.add(blocker);
  assert.equal(f.capture.isCurrent('missing'), false);
  const first = await f.capture.capture();
  assert.equal(f.capture.isCurrent(first.observationId), true);
  assert.equal(f.capture.isCurrent('wrong'), false);
  assert.equal(f.capture.isCurrent(first.observationId), true);
  const second = await f.capture.capture();
  assert.equal(f.capture.isCurrent(first.observationId), false);
  for (let index = 0; index < 5; index++) assert.equal(f.capture.isCurrent(second.observationId), true);
  assert.equal(f.rendered(), 2);
});

test('currency checks reject changed live signatures, availability and generations without raycasting', async () => {
  const changes = [
    (f: ReturnType<typeof fixture>) => { f.camera.position.x++; },
    (f: ReturnType<typeof fixture>) => { f.camera.zoom++; f.camera.updateProjectionMatrix(); },
    (f: ReturnType<typeof fixture>) => f.resize(),
    (f: ReturnType<typeof fixture>) => f.dpr(3),
    (f: ReturnType<typeof fixture>) => f.revision(),
    (f: ReturnType<typeof fixture>) => f.detail(),
    (f: ReturnType<typeof fixture>) => { f.points.geometry.getAttribute('position').needsUpdate = true; },
    (f: ReturnType<typeof fixture>) => { f.points.visible = false; },
    (f: ReturnType<typeof fixture>) => f.invalidMetadata(),
    (f: ReturnType<typeof fixture>) => f.unavailable(),
    (f: ReturnType<typeof fixture>) => f.lose(),
    (f: ReturnType<typeof fixture>) => f.capture.invalidate(),
    (f: ReturnType<typeof fixture>) => f.capture.dispose(),
  ];
  for (const change of changes) {
    const f = fixture(), observation = await f.capture.capture();
    f.points.raycast = () => { assert.fail('Currency checks must not raycast'); };
    change(f);
    assert.equal(f.capture.isCurrent(observation.observationId), false);
    assert.equal(f.capture.isCurrent(observation.observationId), false);
  }
  const restored = fixture(), observation = await restored.capture.capture();
  restored.camera.position.x++;
  assert.equal(restored.capture.isCurrent(observation.observationId), false);
  restored.camera.position.x--;
  assert.equal(restored.capture.isCurrent(observation.observationId), false, 'Restoring the old view cannot resurrect invalidated retention');
});

test('pixel validation, unknown/old IDs, latest-only retention and disposal fail closed', async () => {
  const f = fixture(), first = await f.capture.capture();
  for (const [x, y] of [[-1, 0], [0.2, 0], [NaN, 0], [101, 50], [50, 101], [Infinity, 0]]) {
    assert.equal(f.capture.resolvePixel(first.observationId, x!, y!).status, 'invalid');
  }
  assert.equal(f.capture.resolvePixel('other', 50, 50).status, 'stale');
  const second = await f.capture.capture();
  assert.equal(f.capture.resolvePixel(first.observationId, 50, 50).status, 'stale');
  assert.equal(f.capture.resolvePixel(second.observationId, 50, 50).status, 'resolved');
  f.capture.dispose();
  assert.equal(f.capture.resolvePixel(second.observationId, 50, 50).status, 'unavailable');
  await assert.rejects(f.capture.capture(), /unavailable/);
});

test('all overlapping point hits are ambiguous, including different depths and missing provenance', async () => {
  const f = fixture([0, 0, 0, 0, 0, 2]);
  const observation = await f.capture.capture();
  assert.equal(f.capture.resolvePixel(observation.observationId, 50, 50).status, 'ambiguous');
});

test('duplicate original provenance in separate overview/detail layers is explicitly ambiguous', async () => {
  const f = fixture();
  const detail = new THREE.Points(f.points.geometry.clone(), new THREE.PointsMaterial({ size: 1 }));
  f.points.add(detail);
  const observation = await f.capture.capture();
  assert.equal(observation.coverage.displayedPointCount, 1);
  assert.equal(f.capture.resolvePixel(observation.observationId, 50, 50).status, 'ambiguous');
});

test('nearer meshes block points but farther meshes do not; hidden mesh is not a blocker', async () => {
  for (const [z, visible, expected] of [[2, true, 'no-hit'], [-2, true, 'resolved'], [2, false, 'resolved']] as const) {
    const f = fixture();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1), new THREE.MeshBasicMaterial());
    mesh.position.z = z; mesh.visible = visible; f.scene.add(mesh);
    const observation = await f.capture.capture();
    assert.equal(f.capture.resolvePixel(observation.observationId, 50, 50).status, expected);
  }
});

function clipFixture(positions: number[]) {
  const f = fixture(positions);
  f.camera.position.set(0, 0, 0); f.camera.rotation.set(0, 0, 0);
  f.camera.fov = 90; f.camera.near = 1; f.camera.far = 10;
  f.camera.updateProjectionMatrix(); f.camera.updateMatrixWorld(true);
  return f;
}

test('off-axis point inside far depth resolves even when radial distance exceeds far', async () => {
  const f = clipFixture([8, 0, -9]);
  assert.ok(new THREE.Vector3(8, 0, -9).length() > f.camera.far);
  const observation = await f.capture.capture();
  const result = f.capture.resolvePixel(observation.observationId, 95, 50);
  assert.equal(result.status, 'resolved');
  if (result.status === 'resolved') assert.deepEqual(result.provenance, f.originals[0]);
});

test('off-axis mesh inside far depth still blocks when its radial distance exceeds far', async () => {
  const f = clipFixture([8, 0, -9]);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.02), new THREE.MeshBasicMaterial());
  mesh.position.set(8 * 8 / 9, 0, -8); f.scene.add(mesh);
  assert.ok(mesh.position.length() > f.camera.far);
  const observation = await f.capture.capture();
  assert.equal(f.capture.resolvePixel(observation.observationId, 95, 50).status, 'no-hit');
});

test('off-axis mesh blockers use camera depth clipping rather than radial near/far', async () => {
  for (const [z, expected] of [[-0.9, 'resolved'], [-2, 'no-hit'], [-7, 'resolved'], [-11, 'resolved']] as const) {
    const f = clipFixture([3, 0, -5]);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), new THREE.MeshBasicMaterial());
    mesh.position.set(-z * 0.6, 0, z); f.scene.add(mesh);
    const observation = await f.capture.capture();
    assert.equal(f.capture.resolvePixel(observation.observationId, 80, 50).status, expected, `mesh depth=${-z}`);
  }
});

test('tolerated points are occlusion-tested on their own sightline, not the requested pixel ray', async () => {
  for (const blockerOnPoint of [true, false]) {
    const f = clipFixture([2 / 50.5 * 5, 0, -5]);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1, 0.03), new THREE.MeshBasicMaterial());
    mesh.position.set(blockerOnPoint ? 2 / 50.5 * 2 : 0, 0, -2); f.scene.add(mesh);
    const observation = await f.capture.capture();
    assert.equal(f.capture.resolvePixel(observation.observationId, 50, 50).status, blockerOnPoint ? 'no-hit' : 'resolved');
  }
});

test('point centers outside any clip-space axis cannot resolve within pixel tolerance', async () => {
  for (const [position, pixel] of [
    [[-5.1, 0, -5], [0, 50]], [[5.1, 0, -5], [100, 50]],
    [[0, 5.1, -5], [50, 0]], [[0, -5.1, -5], [50, 100]],
    [[0, 0, -0.9], [50, 50]], [[0, 0, -10.1], [50, 50]],
  ] as const) {
    const f = clipFixture([...position]), observation = await f.capture.capture();
    assert.equal(f.capture.resolvePixel(observation.observationId, pixel[0], pixel[1]).status, 'no-hit', `point=${position}`);
  }
  // Adjacent visible centers remain resolvable at each image boundary.
  for (const [position, pixel] of [
    [[-4.99, 0, -5], [0, 50]], [[4.99, 0, -5], [100, 50]],
    [[0, 4.99, -5], [50, 0]], [[0, -4.99, -5], [50, 100]],
  ] as const) {
    const f = clipFixture([...position]), observation = await f.capture.capture();
    assert.equal(f.capture.resolvePixel(observation.observationId, pixel[0], pixel[1]).status, 'resolved', `point=${position}`);
  }
});

test('camera, resize, binding, coverage, geometry, scene layer and explicit generation changes stale captures', async () => {
  const changes = [
    (f: ReturnType<typeof fixture>) => { f.camera.position.x++; },
    (f: ReturnType<typeof fixture>) => { f.camera.fov++; f.camera.updateProjectionMatrix(); },
    (f: ReturnType<typeof fixture>) => f.resize(),
    (f: ReturnType<typeof fixture>) => f.revision(),
    (f: ReturnType<typeof fixture>) => f.detail(),
    (f: ReturnType<typeof fixture>) => { f.points.geometry.getAttribute('position').needsUpdate = true; },
    (f: ReturnType<typeof fixture>) => { f.points.visible = false; },
    (f: ReturnType<typeof fixture>) => { f.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())); },
    (f: ReturnType<typeof fixture>) => f.capture.invalidate(),
  ];
  for (const change of changes) {
    const f = fixture(), observation = await f.capture.capture(); change(f);
    assert.equal(f.capture.resolvePixel(observation.observationId, 50, 50).status, 'stale');
    assert.deepEqual(observation.camera.position, [0, 0, 10]);
  }
});

test('capture preserves past pixels through navigation while hashing; replacement, invalid bytes and unavailable capture reject', async () => {
  const f = fixture();
  const pending = f.capture.capture(); f.camera.position.x++;
  const past = await pending; assert.equal(past.camera.position[0], 0); assert.equal(f.capture.isCurrent(past.observationId), false);
  const race = fixture();
  const first = race.capture.capture(), second = race.capture.capture();
  await assert.rejects(first, /replaced/); await second;
  const invalidated = fixture();
  const inFlight = invalidated.capture.capture(); invalidated.capture.invalidate();
  const retained = await inFlight; assert.equal(invalidated.capture.isCurrent(retained.observationId), false);
  const bad = fixture(); bad.badPng(); await assert.rejects(bad.capture.capture(), /PNG/);
  const huge = fixture(); huge.huge(); await assert.rejects(huge.capture.capture(), /limits/);
  const hugePng = fixture(); hugePng.hugePng(); await assert.rejects(hugePng.capture.capture(), /limit/);
  const invalidMetadata = fixture(); invalidMetadata.invalidMetadata(); await assert.rejects(invalidMetadata.capture.capture(), /Nonfinite/);
  for (const change of [(f: ReturnType<typeof fixture>) => f.unavailable(), (f: ReturnType<typeof fixture>) => f.lose()]) {
    const unavailable = fixture(), observation = await unavailable.capture.capture(); change(unavailable);
    assert.equal(unavailable.capture.resolvePixel(observation.observationId, 50, 50).status, 'unavailable');
    await assert.rejects(unavailable.capture.capture(), /unavailable/);
  }
});
