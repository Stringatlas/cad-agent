import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encodePreparedNode, decodePreparedNode, type PreparedNodePayload } from '@spatial/contracts';
import { createNativeCloudRender } from '../../apps/web/src/viewer/native-cloud-render';
import { createAdaptiveLoader } from '../../apps/web/src/viewer/adaptive-loader';
import { preparedNativePoint } from '../../apps/web/src/scenes/point-cloud/prepared-cloud-lod-client';
import type { AdaptiveNode, AdaptiveStats, AdaptiveView } from '../../apps/web/src/viewer/adaptive-plan';
import type { PreparedScene } from '../../apps/web/src/scenes/point-cloud/prepared-cloud-client';

const identity = { cloudId: 'native-test', revision: 'a'.repeat(64), name: 'r', count: 2 };
function payload(name = 'r'): PreparedNodePayload {
  return { ...identity, name, positions: Float64Array.of(0.123456789012, 1, 2, 3, 4, 5), colors: Uint8Array.of(255, 0, 1, 0, 128, 255), sourceIds: Uint32Array.of(42, 99, 42, 100), labels: Uint16Array.of(65535, 19), instances: Int32Array.of(-100, 2147483647) };
}
const wait = async (predicate: () => boolean) => {
  const until = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > until) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
};

test('native wire roundtrip keeps Float64 coordinates, uint16 semantics and signed int32 instances; rejects corrupt bindings/layouts', () => {
  const source = payload(), bytes = encodePreparedNode(source), decoded = decodePreparedNode(bytes, identity);
  assert.deepEqual(decoded, source);
  assert.throws(() => decodePreparedNode(bytes, { ...identity, revision: 'b'.repeat(64) }), /binding/);
  assert.throws(() => decodePreparedNode(bytes.subarray(0, bytes.length - 1), identity), /header/);
  const corrupt = bytes.slice(); new DataView(corrupt.buffer).setUint32(8, 65537, true);
  assert.throws(() => decodePreparedNode(corrupt, identity), /header/);
  assert.throws(() => encodePreparedNode({ ...source, labels: [65536, 19] }), /scalar/);
  assert.throws(() => encodePreparedNode({ ...source, instances: [-2147483649, 0] }), /scalar/);
  assert.throws(() => encodePreparedNode({ ...source, positions: [NaN, 0, 0, 1, 1, 1] }), /position/);
  const noLabels = decodePreparedNode(encodePreparedNode({ ...source, labels: undefined, instances: undefined }), identity);
  assert.equal(noLabels.labels, undefined); assert.equal(noLabels.instances, undefined);
  bytes.fill(0); assert.equal(decoded.positions[0], source.positions[0]);
});

test('packed native render compacts eviction without changing source precision, colors or instance identity', () => {
  const material = new THREE.PointsMaterial(), render = createNativeCloudRender(material, 65536);
  const first = payload('r'), second = payload('r0'), third = payload('r7');
  render.add(first); render.add(second); render.add(third);
  assert.equal(render.count, 6); assert.equal(render.points.geometry.drawRange.count, 6);
  render.setColorMode('instance');
  const before = Array.from(render.points.geometry.getAttribute('color').array.slice(12, 18));
  render.remove(['r0']);
  assert.equal(render.count, 4); assert.deepEqual(render.names, ['r', 'r7']);
  assert.equal(render.resolve(2)?.payload, third); assert.equal(render.resolve(2)?.index, 0);
  assert.equal(render.resolve(2)?.payload.positions[0], 0.123456789012);
  assert.notEqual(render.points.geometry.getAttribute('position').getX(2), third.positions[0]);
  assert.deepEqual(Array.from(render.points.geometry.getAttribute('color').array.slice(6, 12)), before);
  render.setColorMode('semantic'); render.setColorMode('rgb');
  assert.throws(() => render.add(first), /admission/);
  assert.throws(() => render.add({ ...payload('r3'), revision: 'b'.repeat(64) }), /binding/);
  const cloud = { descriptor: { id: identity.cloudId, frameId: 'native-local', coordinates: { localOrigin: [0, 0, 0] }, semantics: { classes: { '65535': 'Native class' } } }, revision: identity.revision } as unknown as PreparedScene;
  const point = preparedNativePoint(cloud, third, 0);
  assert.equal(point.position[0], 0.123456789012); assert.equal(point.type, 'Native class'); assert.equal(point.instanceId, -100);
  render.dispose(); assert.equal(render.resolve(0), undefined); material.dispose();
});

const nodes: AdaptiveNode[] = [
  { name: 'r', count: 2, bounds: { min: [0, 0, 0], max: [8, 8, 8] } },
  { name: 'r0', count: 2, bounds: { min: [0, 0, 0], max: [4, 4, 4] } },
  { name: 'r7', count: 2, bounds: { min: [4, 4, 4], max: [8, 8, 8] } },
];
const view: AdaptiveView = { position: [0, -5, 2], focus: [2, 2, 2], planes: [], viewportHeight: 800, fovDegrees: 50 };

test('LOD loader retains one request lane, replans moving views before admission and evicts under budget', async () => {
  let release: ((value: PreparedNodePayload) => void) | undefined, active = 0, maxActive = 0, stats: AdaptiveStats | undefined;
  const resident = new Map<string, number>(), requests: string[] = [];
  const loader = createAdaptiveLoader({ settings: { nearRadius: 30, pixelThreshold: 60, pointBudget: 4 }, hierarchy: async () => nodes,
    load: async node => {
      requests.push(node.name); active++; maxActive = Math.max(active, maxActive);
      try { return node.name === 'r0' ? await new Promise<PreparedNodePayload>(resolve => { release = resolve; }) : payload(node.name); }
      finally { active--; }
    }, add: p => resident.set(p.name, p.count), remove: names => names.forEach(name => resident.delete(name)), status: value => { stats = value; assert(value.loadedPoints <= 4); } });
  loader.update(view); await wait(() => !!release);
  loader.update({ ...view, focus: [7, 7, 7], planes: [[1, 0, 0, -5]] });
  release!(payload('r0'));
  await wait(() => resident.has('r7') && stats?.pending === 0);
  assert(!resident.has('r0')); assert.equal(maxActive, 1); assert.deepEqual(requests, ['r', 'r0', 'r7']);
  loader.dispose(); assert.equal(resident.size, 0);
});

test('LOD errors latch until explicit retry; disposed late responses never publish', async () => {
  let attempts = 0, stats: AdaptiveStats | undefined, release: ((value: PreparedNodePayload) => void) | undefined, added = 0;
  const loader = createAdaptiveLoader({ settings: { nearRadius: 30, pixelThreshold: 60, pointBudget: 6 },
    hierarchy: async () => { if (++attempts === 1) throw new Error('offline'); return nodes; },
    load: () => new Promise<PreparedNodePayload>(resolve => { release = resolve; }), add: () => added++, remove: () => {}, status: next => stats = next });
  loader.update(view); await wait(() => !!stats?.error);
  loader.update({ ...view, position: [1, -5, 2] }); await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(attempts, 1);
  loader.retry(); await wait(() => !!release); loader.dispose(); release!(payload());
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(added, 0);
});

test('prepared bulk capture copy preserves active source order and Float64 after eviction', () => {
  const material = new THREE.PointsMaterial(), render = createNativeCloudRender(material, 65536);
  render.add(payload('r')); render.add(payload('r0')); render.add(payload('r7')); render.remove(['r0']);
  const originals = new Float64Array(9), keys = new Uint32Array(6);
  render.copySource(1, 3, originals, keys);
  for (let i = 0; i < 3; i++) {
    const source = render.resolve(i + 1)!;
    assert.deepEqual(Array.from(originals.subarray(i * 3, i * 3 + 3)), Array.from(source.payload.positions.subarray(source.index * 3, source.index * 3 + 3)));
    assert.deepEqual(Array.from(keys.subarray(i * 2, i * 2 + 2)), Array.from(source.payload.sourceIds.subarray(source.index * 2, source.index * 2 + 2)));
  }
  render.dispose(); assert.throws(() => render.copySource(0, 3, originals, keys)); material.dispose();
});
