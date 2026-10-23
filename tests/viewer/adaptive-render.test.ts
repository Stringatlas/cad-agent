import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { DatasetInfo, PointOverrideSnapshot } from '@spatial/contracts';
import { createAdaptiveRender } from '../../apps/web/src/scenes/toronto/display/adaptive-render';
import type { AdaptivePayload } from '../../apps/web/src/scenes/toronto/display/adaptive-display';
import { createPointOverrideRender } from '../../apps/web/src/scenes/toronto/points/point-override-render';
import { pointTypeColor } from '../../apps/web/src/scenes/toronto/display/point-colors';

const dataset: DatasetInfo = { id: 'toronto3d', revision: 'a'.repeat(64), coordinates: { units: 'm', upAxis: 'Z', handedness: 'right', localOrigin: [627285, 4841948, 0] }, bounds: { min: [0, 0, 0], max: [100, 100, 100] }, totalPoints: 78_000_000 };
function payload(name: string, count: number, base = 0): AdaptivePayload {
  const positions = new Float64Array(count * 3), colors = new Uint8Array(count * 3), sourceIds = new Uint32Array(count * 2), labels = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    positions.set([base + i / 1000 + 0.00000000001, 2, 3], i * 3);
    colors.set([128, 255, 0], i * 3); sourceIds.set([1, base + i], i * 2); labels[i] = i % 9;
  }
  return { dataset, name, count, positions, colors, sourceIds, labels };
}
const name = (index: number) => `r${index.toString(8)}`;
function projected(render: ReturnType<typeof createAdaptiveRender>) {
  return render.objects.flatMap(object => Array.from({ length: object.geometry.drawRange.count }, (_, index) => render.resolve(object, index)!));
}

test('color modes roundtrip original RGB bytes in place without changing positions or picks', () => {
  const material = new THREE.PointsMaterial({ vertexColors: true });
  let registrations = 0, removals = 0;
  const render = createAdaptiveRender(material, { pointBudget: 256,
    register() { registrations++; }, unregister() { removals++; },
  });
  const input = payload('r', 256);
  for (let i = 0; i < input.count; i++) (input.colors as Uint8Array).set([i, 255 - i, i % 128], i * 3);
  try {
    render.add(input);
    const object = render.objects[0], geometry = object.geometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const color = geometry.getAttribute('color') as THREE.BufferAttribute;
    const positions = position.array, colors = color.array;
    const rgb = Uint8Array.from(colors), beforePositions = Float32Array.from(positions);
    const picks = projected(render), version = position.version;
    const box = geometry.boundingBox, sphere = geometry.boundingSphere;
    // Transport arrays are disposable: toggles must consult the owned originals.
    (input.colors as Uint8Array).fill(0); (input.labels as Uint8Array).fill(8);
    (input.positions as Float64Array).fill(999);
    render.setColorMode('rgb');
    assert.equal(color.version, 1);
    for (let round = 0; round < 2; round++) {
      render.setColorMode('type');
      for (let i = 0; i < input.count; i++) {
        assert.deepEqual(Array.from(colors.slice(i * 3, i * 3 + 3)), pointTypeColor(i % 9).map(value => Math.round(255 * value)));
      }
      const colorVersion: number = color.version;
      render.setColorMode('type'); assert.equal(color.version, colorVersion);
      render.setColorMode('rgb'); assert.deepEqual(colors, rgb);
    }
    assert.equal(geometry.getAttribute('color'), color); assert.equal(color.array, colors);
    assert.ok(colors instanceof Uint8Array); assert.equal(color.normalized, true);
    assert.equal(geometry.getAttribute('position'), position); assert.equal(position.array, positions);
    assert.deepEqual(positions, beforePositions); assert.equal(position.version, version);
    assert.equal(geometry.boundingBox, box); assert.equal(geometry.boundingSphere, sphere);
    assert.deepEqual(projected(render), picks);
    assert.equal(registrations, 1); assert.equal(removals, 0);
  } finally { render.dispose(); material.dispose(); }
});

test('type mode applies to arrivals, split spans and eviction repacking, then restores source RGB', () => {
  const material = new THREE.PointsMaterial({ vertexColors: true });
  const render = createAdaptiveRender(material, { capacity: 65_536 });
  function assertTypeColors() {
    for (const object of render.objects) {
      const colors = object.geometry.getAttribute('color');
      for (let i = 0; i < object.geometry.drawRange.count; i++) {
        const point = render.resolve(object, i)!;
        const expected = pointTypeColor(point.semanticLabel);
        for (let axis = 0; axis < 3; axis++) assert.equal(colors.array[i * 3 + axis], Math.round(255 * expected[axis]));
      }
    }
  }
  try {
    render.setColorMode('type');
    for (let i = 0; i < 3; i++) render.add(payload(name(i), 40_000, i * 40_000));
    assert.equal(render.chunks, 2); assertTypeColors();
    render.remove('r0');
    assert.equal(render.count, 80_000); assert.equal(render.chunks, 2); assertTypeColors();
    assert.deepEqual(new Set(projected(render).map(point => point.key.sourceRow)), new Set(Array.from({ length: 80_000 }, (_, i) => i + 40_000)));
    render.add(payload('r3', 60_000, 120_000));
    assert.equal(render.chunks, 3); assertTypeColors();
    render.remove('r2');
    assert.equal(render.chunks, 2); assertTypeColors();
    const picks = projected(render);
    render.setColorMode('rgb');
    for (const object of render.objects) {
      const colors = object.geometry.getAttribute('color');
      for (let i = 0; i < object.geometry.drawRange.count; i++) {
        assert.equal(colors.array[i * 3], 55); assert.equal(colors.array[i * 3 + 1], 255); assert.equal(colors.array[i * 3 + 2], 0);
      }
    }
    assert.deepEqual(projected(render), picks);
    render.setColorMode('type'); render.clear();
    render.add(payload('r4', 10, 200_000)); assertTypeColors();
  } finally { render.dispose(); material.dispose(); }
});

test('append only writes new color/ID spans and extends source bounds without geometry scans', () => {
  const material = new THREE.PointsMaterial();
  let ids: Uint32Array | undefined;
  const render = createAdaptiveRender(material, { pointBudget: 10,
    register(_object, sourceIds) { ids = sourceIds; }, unregister() {},
  });
  try {
    render.add(payload('r0', 2, 100));
    const object = render.objects[0], geometry = object.geometry;
    const colors = geometry.getAttribute('color').array;
    const box = geometry.boundingBox!, sphere = geometry.boundingSphere!;
    assert.ok(box.min.x > 0 && box.min.y > 0 && box.min.z > 0, 'unused slots must not include the origin');
    // Sentinels expose an accidental full recolor/ID rewrite on the append path.
    colors[0] = 17; ids![1] = 1234;
    geometry.computeBoundingBox = () => { throw new Error('whole-position box scan'); };
    geometry.computeBoundingSphere = () => { throw new Error('whole-position sphere scan'); };
    // External registrations may change live bounds, but not the source-only cache.
    box.min.set(-9999, -9999, -9999); box.max.set(9999, 9999, 9999);
    sphere.radius = 9999;
    const next = payload('r1', 1, 200);
    (next.positions as Float64Array).set([-7.123456789, 5, 9]);
    render.add(next);
    assert.equal(colors[0], 17); assert.equal(ids![1], 1234);
    assert.deepEqual(Array.from(colors.slice(6, 9)), [55, 255, 0]);
    assert.deepEqual(Array.from(ids!.slice(4, 6)), [1, 200]);
    assert.equal(geometry.boundingBox, box); assert.equal(geometry.boundingSphere, sphere);
    assert.equal(box.min.x, Math.min(-7.123456789, Math.fround(-7.123456789)));
    const lastOriginalX = 100 + 1 / 1000 + 0.00000000001;
    assert.equal(box.max.x, Math.max(lastOriginalX, Math.fround(lastOriginalX)));
    assert.equal(box.min.y, 2); assert.equal(box.max.y, 5);
    assert.equal(box.min.z, 3); assert.equal(box.max.z, 9);
    assert.ok(Math.abs(sphere.radius - box.getSize(new THREE.Vector3()).length() / 2) < 1e-12);
    for (const point of projected(render)) {
      const original = new THREE.Vector3(...point.position);
      assert.ok(box.containsPoint(original));
      assert.ok(sphere.distanceToPoint(original) <= 1e-12);
      assert.ok(box.containsPoint(new THREE.Vector3(...point.position.map(Math.fround))));
    }
    // Exact picks consult immutable binary64 caches, not the sentinel GPU IDs.
    assert.equal(render.resolve(object, 0)!.key.sourceRow, 100);
    assert.equal(render.resolve(object, 2)!.position[0], -7.123456789);
  } finally { render.dispose(); material.dispose(); }
});

test('queued recolors and multiple appends retain every required GPU upload range', () => {
  const material = new THREE.PointsMaterial();
  const render = createAdaptiveRender(material, { pointBudget: 10 });
  function covers(attribute: THREE.BufferAttribute, start: number, end: number) {
    for (let index = start; index < end; index++) assert.ok(attribute.updateRanges.some(range => range.start <= index && range.start + range.count > index), `missing upload component ${index}`);
  }
  try {
    render.add(payload('r0', 2));
    const geometry = render.objects[0].geometry;
    const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    // Simulate WebGL consuming the previous frame's queued ranges.
    colors.clearUpdateRanges(); positions.clearUpdateRanges();
    render.add(payload('r1', 1, 100));
    render.add(payload('r2', 1, 200));
    covers(colors, 6, 12); covers(positions, 6, 12);
    assert.ok(colors.updateRanges.every(range => range.start >= 6), 'append must not upload the old color prefix');
    assert.ok(positions.updateRanges.every(range => range.start >= 6));
    render.setColorMode('type');
    render.add(payload('r3', 1, 300));
    covers(colors, 0, 15); covers(positions, 6, 15);
    for (let index = 0; index < 5; index++) {
      const expected = pointTypeColor(render.resolve(render.objects[0], index)!.semanticLabel).map(value => Math.round(255 * value));
      assert.deepEqual(Array.from(colors.array.slice(index * 3, index * 3 + 3)), expected);
    }
  } finally { render.dispose(); material.dispose(); }
});

test('append restores source positions before override re-registration and rollback rebuilds bounds', () => {
  const material = new THREE.PointsMaterial();
  const overrides = createPointOverrideRender(new THREE.Scene());
  overrides.setArtifactRevision(dataset.revision);
  let fail = false;
  const render = createAdaptiveRender(material, { pointBudget: 10,
    register(object, ids) {
      // The first source must always be original at registration, not its old override.
      assert.equal(object.geometry.getAttribute('position').getX(0), Math.fround(100.00000000001));
      overrides.register(object, ids);
      if (fail) { fail = false; throw new Error('append failed'); }
    },
    unregister(object) { overrides.unregister(object); },
  });
  const snapshot: PointOverrideSnapshot = { datasetId: 'toronto3d', artifactRevision: dataset.revision, sessionId: 'append-test', revision: 1, frameId: 'toronto3d-local-v1', units: 'm', nextUndoTransactionId: null, entries: [{ key: { sourceFileId: 1, sourceRow: 100 }, originalPosition: [100.00000000001, 2, 3], position: [-900, 91, 92] }] };
  try {
    render.add(payload('r0', 2, 100));
    overrides.setPointOverrides(snapshot);
    render.add(payload('r1', 1, 200));
    const geometry = render.objects[0].geometry;
    assert.equal(geometry.getAttribute('position').getX(0), -900);
    overrides.setPointOverrides(undefined);
    assert.equal(geometry.getAttribute('position').getX(0), Math.fround(100.00000000001));
    assert.equal(render.resolve(render.objects[0], 0)!.position[0], 100.00000000001);
    const before = projected(render), box = new THREE.Box3();
    // Override refresh computes live bounds including unused slots; the renderer
    // rebuild must recover its own tighter, conservative source-only bounds.
    for (const point of before) {
      box.expandByPoint(new THREE.Vector3(...point.position));
      box.expandByPoint(new THREE.Vector3(...point.position.map(Math.fround)));
    }
    const color = geometry.getAttribute('color') as THREE.BufferAttribute;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    color.clearUpdateRanges(); position.clearUpdateRanges();
    fail = true;
    assert.throws(() => render.add(payload('r2', 1, 900_000)), /append failed/);
    assert.deepEqual(projected(render), before); assert.equal(render.count, 3);
    assert.ok(geometry.boundingBox!.equals(box), 'failed append must not leave expanded bounds');
    assert.deepEqual(color.updateRanges, [{ start: 0, count: color.array.length }]);
    assert.deepEqual(position.updateRanges, [{ start: 0, count: position.array.length }]);
    assert.equal(position.getX(3), 0, 'rollback clears the unpublished tail');
    render.add(payload('r3', 1, 300));
    assert.ok(geometry.boundingBox!.max.x < 301, 'later append uses recovered source bounds');
    assert.equal(geometry.getAttribute('position').count, 10, 'small budget caps allocation');
  } finally { render.dispose(); overrides.dispose(); material.dispose(); }
});

test('1000 native nodes use bounded dense GPU batches with compact linear colors and exact picks', () => {
  const material = new THREE.PointsMaterial({ vertexColors: true });
  const render = createAdaptiveRender(material);
  try {
    for (let i = 0; i < 1000; i++) render.add(payload(name(i), 3000, i * 3000));
    assert.equal(render.count, 3_000_000); assert.equal(render.chunks, 23);
    assert.equal(render.group.children.length, 23); assert.equal(render.names.length, 1000);
    assert.equal(render.objects.reduce((n, object) => n + object.geometry.getAttribute('position').count, 0), 3_000_000);
    for (const object of render.objects) {
      assert.equal(object.material, material);
      assert.ok(object.geometry.getAttribute('position').array instanceof Float32Array);
      const color = object.geometry.getAttribute('color');
      assert.ok(color.array instanceof Uint8Array); assert.equal(color.normalized, true);
      assert.equal(color.array[0], 55); assert.equal(color.array[1], 255); assert.equal(color.array[2], 0);
      assert.equal(object.geometry.index, null);
      assert.ok(object.geometry.boundingSphere && Number.isFinite(object.geometry.boundingSphere.radius));
    }
    const first = render.resolve(render.objects[0], 0)!;
    assert.equal(first.position[0], 0.00000000001); assert.equal(first.semanticLabel, 0);
    const boundary = render.resolve(render.objects[1], 0)!;
    assert.deepEqual(boundary.key, { sourceFileId: 1, sourceRow: 131_072 });
    assert.equal(boundary.position[0], 129000 + 2072 / 1000 + 0.00000000001);
    assert.equal(boundary.semanticLabel, 2072 % 9);
    assert.throws(() => render.add(payload('r777777', 1)), /budget/);
    assert.equal(render.count, 3_000_000);
  } finally { render.dispose(); material.dispose(); }
});

test('fragmented removals and additions stay packed, preserve every source and release emptied geometry', () => {
  const material = new THREE.PointsMaterial();
  const render = createAdaptiveRender(material, { capacity: 65_536 });
  const expected = new Map<number, number>();
  let disposedGeometry = 0;
  try {
    for (let i = 0; i < 12; i++) {
      render.add(payload(name(i), 20_000, i * 20_000));
      for (let row = i * 20_000; row < (i + 1) * 20_000; row++) expected.set(row, i);
    }
    for (const object of render.objects) object.geometry.addEventListener('dispose', () => disposedGeometry++);
    const oldTail = render.objects.at(-1)!;
    for (const i of [2, 7, 0, 10, 4]) {
      render.remove(name(i));
      for (let row = i * 20_000; row < (i + 1) * 20_000; row++) expected.delete(row);
      assert.equal(render.chunks, Math.ceil(render.count / 65_536));
      const points = projected(render);
      assert.equal(points.length, expected.size);
      assert.deepEqual(new Set(points.map(point => point.key.sourceRow)), new Set(expected.keys()));
      for (let batch = 0; batch < render.objects.length - 1; batch++) assert.equal(render.objects[batch].geometry.drawRange.count, 65_536);
    }
    assert.ok(disposedGeometry > 0); assert.equal(render.resolve(oldTail, 0), undefined);
    render.add(payload('r777', 65_536, 400_000));
    assert.equal(render.chunks, Math.ceil(render.count / 65_536));
    const points = projected(render);
    assert.equal(new Set(points.map(point => point.key.sourceRow)).size, expected.size + 65_536);
    assert.equal(render.resolve(render.objects.at(-1)!, render.objects.at(-1)!.geometry.drawRange.count), undefined);
    assert.equal(render.resolve(new THREE.Points(), 0), undefined);
    assert.equal(render.resolve(render.objects[0], NaN), undefined);
    assert.equal(render.resolve(render.objects[0], -1), undefined);
  } finally { render.dispose(); material.dispose(); }
});

test('bulk eviction rebuilds each affected batch at most once and preserves exact remaining picks', () => {
  const material = new THREE.PointsMaterial();
  const registrations = new Map<THREE.Points, number>();
  const render = createAdaptiveRender(material, { capacity: 65_536,
    register(object) { registrations.set(object, (registrations.get(object) ?? 0) + 1); },
    unregister() {},
  });
  try {
    for (let i = 0; i < 12; i++) render.add(payload(name(i), 20_000, i * 20_000));
    registrations.clear();
    render.remove([name(0), name(2), name(4), name(7), name(10), name(2), 'missing']);
    assert.equal(render.count, 140_000); assert.equal(render.chunks, 3);
    assert.ok(registrations.size > 0);
    assert.ok([...registrations.values()].every(count => count === 1));
    const points = projected(render);
    const expected = new Set(Array.from({ length: 240_000 }, (_, i) => i).filter(i => ![0, 2, 4, 7, 10].includes(Math.floor(i / 20_000))));
    assert.deepEqual(new Set(points.map(point => point.key.sourceRow)), expected);
    for (const point of points) {
      const offset = point.key.sourceRow % 20_000;
      assert.equal(point.semanticLabel, offset % 9);
      assert.equal(point.position[0], Math.floor(point.key.sourceRow / 20_000) * 20_000 + offset / 1000 + 0.00000000001);
    }
    registrations.clear(); render.remove(render.names);
    assert.equal(registrations.size, 0); assert.equal(render.count, 0); assert.equal(render.chunks, 0);
  } finally { render.dispose(); material.dispose(); }
});

test('bulk partial and full eviction roll back callback failures without losing nodes or picks', () => {
  const material = new THREE.PointsMaterial();
  const registered = new Set<THREE.Points>();
  let failRegister = false, failUnregister = false;
  const render = createAdaptiveRender(material, { capacity: 65_536,
    register(object) { registered.add(object); if (failRegister) { failRegister = false; throw new Error('register failed'); } },
    unregister(object) { registered.delete(object); if (failUnregister) { failUnregister = false; throw new Error('unregister failed'); } },
  });
  try {
    for (let i = 0; i < 4; i++) render.add(payload(name(i), 40_000, i * 40_000));
    const objects = [...render.objects], names = [...render.names];
    const before = projected(render).map(point => point.key.sourceRow);
    failRegister = true;
    assert.throws(() => render.remove([name(0), name(2)]), /register failed/);
    assert.deepEqual(render.names, names); assert.equal(render.count, 160_000);
    assert.deepEqual(render.objects, objects); assert.deepEqual(new Set(render.objects), registered);
    assert.deepEqual(projected(render).map(point => point.key.sourceRow), before);
    failUnregister = true;
    assert.throws(() => render.remove(render.names), /unregister failed/);
    assert.deepEqual(render.names, names); assert.equal(render.count, 160_000);
    assert.deepEqual(render.objects, objects); assert.deepEqual(new Set(render.objects), registered);
    assert.deepEqual(projected(render).map(point => point.key.sourceRow), before);
    render.remove(render.names); assert.equal(render.count, 0); assert.equal(registered.size, 0);
  } finally { render.dispose(); material.dispose(); }
});

test('batch edits reconstruct originals before applying committed overrides; no authority or ghost leakage', () => {
  const material = new THREE.PointsMaterial();
  const scene = new THREE.Scene(), overrides = createPointOverrideRender(scene);
  overrides.setArtifactRevision(dataset.revision);
  const registrations: THREE.Points[] = [], removals: THREE.Points[] = [];
  const render = createAdaptiveRender(material, { capacity: 65_536,
    register(object, ids) { registrations.push(object); overrides.register(object, ids as unknown as readonly number[]); },
    unregister(object) { removals.push(object); overrides.unregister(object); },
  });
  const snapshot: PointOverrideSnapshot = { datasetId: 'toronto3d', artifactRevision: dataset.revision, sessionId: 'override-test', revision: 1, frameId: 'toronto3d-local-v1', units: 'm', nextUndoTransactionId: null, entries: [{ key: { sourceFileId: 1, sourceRow: 100 }, originalPosition: [100.00000000001, 2, 3], position: [90, 91, 92] }] };
  try {
    render.add(payload('r0', 100, 0)); render.add(payload('r1', 65_536, 100)); render.add(payload('r2', 30, 70_000));
    overrides.setPointOverrides(snapshot);
    assert.equal(render.objects[0].geometry.getAttribute('position').getX(100), 90);
    function toggleWithoutPositionChanges() {
      const objects = [...render.objects], picks = projected(render);
      const positions = objects.map(object => Float32Array.from(object.geometry.getAttribute('position').array));
      const positionAttributes = objects.map(object => object.geometry.getAttribute('position'));
      const versions = positionAttributes.map(attribute => (attribute as THREE.BufferAttribute).version);
      const registerCount = registrations.length, removalCount = removals.length;
      for (const mode of ['type', 'rgb'] as const) {
        render.setColorMode(mode);
        assert.deepEqual(render.objects, objects);
        for (let i = 0; i < objects.length; i++) {
          const attribute = objects[i].geometry.getAttribute('position') as THREE.BufferAttribute;
          assert.equal(attribute, positionAttributes[i]); assert.equal(attribute.version, versions[i]);
          assert.deepEqual(attribute.array, positions[i]);
        }
        assert.deepEqual(projected(render), picks);
        assert.equal(registrations.length, registerCount); assert.equal(removals.length, removalCount);
      }
    }
    toggleWithoutPositionChanges();
    // Node removal shifts the edited record, but never shifts its GPU override into another source.
    render.remove('r0');
    const all = projected(render), keyAt = all.findIndex(point => point.key.sourceRow === 100);
    assert.ok(keyAt >= 0);
    let absolute = 0;
    for (const object of render.objects) {
      const attr = object.geometry.getAttribute('position');
      for (let i = 0; i < object.geometry.drawRange.count; i++, absolute++) {
        const point = all[absolute];
        assert.equal(attr.getX(i), point.key.sourceRow === 100 ? 90 : Math.fround(point.position[0]));
      }
    }
    assert.equal(all[keyAt].position[0], 100.00000000001);
    assert.equal(all[keyAt].semanticLabel, 0);
    toggleWithoutPositionChanges();
    overrides.setPointOverrides(undefined);
    absolute = 0;
    for (const object of render.objects) for (let i = 0; i < object.geometry.drawRange.count; i++, absolute++) assert.equal(object.geometry.getAttribute('position').getX(i), Math.fround(all[absolute].position[0]));
    // Appending to the tail must not register or unregister an unrelated full first batch.
    registrations.length = 0; removals.length = 0;
    render.add(payload('r3', 10, 80_000));
    assert.equal(registrations.length, 1); assert.equal(removals.length, 1);
    assert.equal(registrations[0], render.objects.at(-1));
  } finally { render.dispose(); overrides.dispose(); material.dispose(); }
});

test('callback failure rolls back append and eviction including original pick mappings', () => {
  const material = new THREE.PointsMaterial();
  let fail = false;
  const registered = new Set<THREE.Points>();
  const render = createAdaptiveRender(material, {
    register(object) { registered.add(object); if (fail) { fail = false; throw new Error('registration failure'); } },
    unregister(object) { registered.delete(object); },
  });
  try {
    render.add(payload('r0', 100, 0));
    const object = render.objects[0];
    fail = true;
    assert.throws(() => render.add(payload('r1', 10, 100)), /registration failure/);
    assert.equal(render.count, 100); assert.deepEqual(render.names, ['r0']);
    assert.equal(object.geometry.drawRange.count, 100); assert.equal(registered.size, 1);
    assert.equal(render.resolve(object, 99)?.key.sourceRow, 99); assert.equal(render.resolve(object, 100), undefined);
    render.add(payload('r1', 10, 100));
    fail = true;
    assert.throws(() => render.remove('r0'), /registration failure/);
    assert.equal(render.count, 110); assert.deepEqual(render.names, ['r0', 'r1']);
    assert.equal(render.resolve(object, 0)?.key.sourceRow, 0); assert.equal(render.resolve(object, 100)?.key.sourceRow, 100);
    assert.equal(registered.size, 1);
  } finally { render.dispose(); material.dispose(); }
});

test('new-batch callback failure disposes unpublished buffers and cleanup finishes despite callback errors', () => {
  const material = new THREE.PointsMaterial();
  let failRegister = false, failUnregister = false, released = 0;
  const render = createAdaptiveRender(material, { capacity: 65_536,
    register(object) {
      if (!failRegister) return;
      failRegister = false;
      object.geometry.addEventListener('dispose', () => released++);
      throw new Error('new allocation failed');
    },
    unregister() { if (failUnregister) throw new Error('unregister failed'); },
  });
  try {
    render.add(payload('r0', 65_536));
    const first = render.objects[0];
    failRegister = true;
    assert.throws(() => render.add(payload('r1', 1, 70_000)), /allocation failed/);
    assert.equal(released, 1); assert.deepEqual(render.objects, [first]); assert.equal(render.group.children.length, 1);
    assert.equal(render.count, 65_536); assert.equal(render.resolve(first, 0)?.key.sourceRow, 0);
    failUnregister = true;
    assert.throws(() => render.dispose(), /cleanup callback failed/);
    assert.equal(render.count, 0); assert.equal(render.group.children.length, 0);
    assert.equal(render.resolve(first, 0), undefined);
    render.dispose();
  } finally { render.dispose(); material.dispose(); }
});

test('validation, ownership, clear/disposal, and small hard budget are fail-closed', () => {
  const material = new THREE.PointsMaterial();
  let materialDisposed = false;
  material.addEventListener('dispose', () => { materialDisposed = true; });
  const render = createAdaptiveRender(material, { pointBudget: 10 });
  const input = payload('r', 10);
  try {
    assert.throws(() => createAdaptiveRender(material, { pointBudget: 50_000_001 }), /options/);
    assert.throws(() => createAdaptiveRender(material, { register() {} }), /options/);
    assert.throws(() => render.add({ ...input, labels: [99] }), /payload/);
    assert.throws(() => render.add({ ...input, labels: Array(10).fill(99) }), /labels/);
    assert.equal(render.count, 0); assert.equal(render.chunks, 0);
    render.add(input);
    const object = render.objects[0];
    let disposed = 0;
    object.geometry.addEventListener('dispose', () => disposed++);
    assert.equal(object.geometry.getAttribute('position').count, 10);
    const original = render.resolve(object, 0)!;
    (input.positions as Float64Array)[0] = 999;
    (input.sourceIds as Uint32Array)[1] = 999;
    (input.labels as Uint8Array)[0] = 8;
    assert.deepEqual(render.resolve(object, 0), original);
    assert.throws(() => render.add(input), /Duplicate/);
    assert.throws(() => render.add(payload('r0', 1)), /budget/);
    render.remove('missing'); assert.equal(render.count, 10);
    render.clear(); assert.equal(disposed, 1); assert.equal(render.count, 0); assert.equal(render.chunks, 0);
    assert.equal(render.resolve(object, 0), undefined); assert.equal(render.group.children.length, 0);
    render.add(payload('r1', 1)); render.dispose(); render.dispose();
    assert.equal(materialDisposed, false); assert.equal(render.count, 0);
    assert.throws(() => render.add(payload('r0', 1)), /disposed/);
  } finally { render.dispose(); material.dispose(); }
});

test('Toronto bulk capture copies original source spans after compaction and never effective GPU overrides', () => {
  const material = new THREE.PointsMaterial(), render = createAdaptiveRender(material, { pointBudget: 256 });
  render.add(payload('r', 2)); render.add(payload('r0', 2, 10)); render.add(payload('r7', 2, 20)); render.remove('r0');
  const object = render.objects[0], source = render.captureSource(object)!;
  const originals = new Float64Array(source.count * 3), keys = new Uint32Array(source.count * 2);
  object.geometry.getAttribute('position').setXYZ(0, 999, 999, 999);
  source.copy(0, source.count, originals, keys);
  assert.equal(originals[0], .00000000001);
  for (let i = 0; i < source.count; i++) {
    const expected = render.resolve(object, i)!;
    assert.deepEqual(Array.from(originals.subarray(i * 3, i * 3 + 3)), expected.position);
    assert.deepEqual(Array.from(keys.subarray(i * 2, i * 2 + 2)), [expected.key.sourceFileId, expected.key.sourceRow]);
  }
  render.dispose(); assert.throws(() => source.copy(0, source.count, originals, keys)); material.dispose();
});
