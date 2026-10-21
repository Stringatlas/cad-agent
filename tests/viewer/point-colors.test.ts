import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { POINT_TYPE_KEY, pointColors, pointTypeColor } from '../../apps/web/src/scenes/toronto/display/point-colors';
import { createCropLayer } from '../../apps/web/src/scenes/toronto/display/crop-render';

test('semantic palette is complete, distinct and matches labeled sRGB swatches', () => {
  assert.equal(POINT_TYPE_KEY.length, 9);
  assert.equal(new Set(POINT_TYPE_KEY.map(entry => entry.color)).size, 9);
  for (const entry of POINT_TYPE_KEY) {
    assert.deepEqual(pointTypeColor(entry.label), new THREE.Color(entry.color).toArray());
    assert.ok(entry.name && !entry.name.includes('_'));
  }
  for (const label of [undefined, -1, 9, 1.5, NaN]) assert.deepEqual(pointTypeColor(label), [1, 1, 1]);
});

test('natural RGB uses linear vertex colors and never changes input arrays', () => {
  const rgb = [128, 255, 0, 10, 20, 30], labels = [6, 7];
  const expected = new Float32Array(6);
  new THREE.Color().setRGB(128 / 255, 1, 0, THREE.SRGBColorSpace).toArray(expected, 0);
  new THREE.Color().setRGB(10 / 255, 20 / 255, 30 / 255, THREE.SRGBColorSpace).toArray(expected, 3);
  assert.deepEqual(pointColors(rgb, labels, 'rgb'), expected);
  assert.deepEqual(pointColors(rgb, labels, 'type'), Float32Array.from([...pointTypeColor(6), ...pointTypeColor(7)]));
  assert.deepEqual(rgb, [128, 255, 0, 10, 20, 30]); assert.deepEqual(labels, [6, 7]);
});

test('crop toggles existing and incoming chunks without touching geometry or source colors', () => {
  const scene = new THREE.Scene(), layer = createCropLayer(scene);
  try {
    const rgb = [128, 255, 0], labels = [6];
    const first = layer.append([1, 2, 3], rgb, labels)!;
    const position = first.geometry.getAttribute('position'), color = first.geometry.getAttribute('color');
    const original = Array.from(color.array);
    // A committed point edit must survive switching display modes.
    position.setXYZ(0, 4, 5, 6); rgb.fill(0); labels[0] = 2;
    layer.setColorMode('type');
    assert.deepEqual(Array.from(color.array), Array.from(Float32Array.from(pointTypeColor(6))));
    assert.equal(first.geometry.getAttribute('position'), position); assert.equal(position.getX(0), 4);
    const next = layer.append([7, 8, 9], [255, 0, 0], [7])!;
    assert.deepEqual(Array.from(next.geometry.getAttribute('color').array), Array.from(Float32Array.from(pointTypeColor(7))));
    const legacy = layer.append([0, 0, 0], [0, 0, 0])!;
    assert.deepEqual(Array.from(legacy.geometry.getAttribute('color').array), [1, 1, 1]);
    layer.setColorMode('rgb'); assert.deepEqual(Array.from(color.array), original);
    assert.equal(layer.count, 3); assert.equal(position.getX(0), 4);
    assert.throws(() => layer.append([0, 0, 0], [0, 0, 0], [9]), /labels/);
    layer.clear(); assert.equal(layer.count, 0); assert.equal(layer.group.children.length, 0);
    layer.setColorMode('type');
    assert.deepEqual(Array.from(layer.append([0, 0, 0], [0, 0, 0], [1])!.geometry.getAttribute('color').array), Array.from(Float32Array.from(pointTypeColor(1))));
  } finally { layer.dispose(); }
});
