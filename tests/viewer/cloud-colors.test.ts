import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cloudColors, instanceColor, UNASSIGNED_COLOR } from '../../apps/web/src/viewer/cloud-colors';

test('native signed instances retain stable colors and unassigned points remain neutral', () => {
  assert.equal(instanceColor(-100), UNASSIGNED_COLOR);
  assert.equal(instanceColor(2147483647), instanceColor(2147483647));
  assert.notEqual(instanceColor(1), instanceColor(2));
  const rgb = [255, 128, 0, 255, 128, 0], before = [...rgb];
  const actual = cloudColors(rgb, [14, 0], [-100, 2147483647], 'instance');
  assert.deepEqual(Array.from(actual.slice(0, 3)), Array.from(new Float32Array(new THREE.Color(UNASSIGNED_COLOR).toArray())));
  assert.deepEqual(rgb, before);
  assert.notDeepEqual(actual, cloudColors(rgb, [14, 0], [-100, 2147483647], 'semantic'));
  const expected = new Float32Array(new THREE.Color().setRGB(1, 128 / 255, 0, THREE.SRGBColorSpace).toArray());
  assert.deepEqual(cloudColors(rgb, undefined, undefined, 'rgb').slice(0, 3), expected);
});
