import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { PreparedNodePayload } from '@spatial/contracts';
import { DEFAULT_ADAPTIVE_POINTS, MAX_ADAPTIVE_POINTS, planAdaptiveDisplay, type AdaptiveNode, type AdaptiveView } from '../../apps/web/src/viewer/adaptive-plan';
import { createNativeCloudRender } from '../../apps/web/src/viewer/native-cloud-render';
import { DISPLAY_BUDGET_KEYS, readDisplayBudget, saveDisplayBudget, validDisplayBudget } from '../../apps/web/src/viewer/display-budget';

const near = { min: [0, 0, 0], max: [8, 8, 8] } as const;
const far = { min: [64, 0, 0], max: [72, 8, 8] } as const;
const nodes: AdaptiveNode[] = [
  { name: 'r', count: 10, bounds: { min: [0, 0, 0], max: [128, 128, 128] } },
  { name: 'r0', count: 10, bounds: near }, { name: 'r7', count: 10, bounds: far },
  { name: 'r00', count: 10, bounds: { min: [0, 0, 0], max: [4, 4, 4] } },
  { name: 'r77', count: 10, bounds: { min: [64, 0, 0], max: [68, 4, 4] } },
  { name: 'r000', count: 10, bounds: { min: [0, 0, 0], max: [2, 2, 2] } },
];
const view: AdaptiveView = { position: [0, -2, 2], focus: [68, 4, 4], planes: [], viewportHeight: 800, fovDegrees: 50 };
const settings = { nearRadius: 5, pixelThreshold: 120, pointBudget: 40 };

test('small cap retains coarse visible coverage and spends remaining capacity on nearer refinement', () => {
  const plan = planAdaptiveDisplay({ nodes }, view, settings);
  assert.deepEqual(plan.nodes.map(n => n.name), ['r', 'r0', 'r7', 'r00']);
  assert.equal(plan.budgetLimited, true); assert.equal(plan.points, 40);
  assert.deepEqual(planAdaptiveDisplay({ nodes }, { ...view, focus: [0, 0, 0] }, settings), plan);
  const moved = planAdaptiveDisplay({ nodes }, { ...view, position: [64, -2, 2] }, settings);
  assert.deepEqual(moved.nodes.map(n => n.name), ['r', 'r7', 'r0', 'r77']);
});

test('distance chooses the requested depth independently of unused memory capacity', () => {
  const distant = { ...view, position: [10000, 10000, 10000] as const };
  for (const pointBudget of [100, 3000000, 50000000]) {
    const plan = planAdaptiveDisplay({ nodes }, distant, { ...settings, pointBudget });
    assert.deepEqual(plan.nodes.map(n => n.name), ['r']); assert.equal(plan.budgetLimited, false);
  }
  const rich = planAdaptiveDisplay({ nodes }, view, { ...settings, pointBudget: 100 });
  assert(rich.nodes.some(n => n.name === 'r000'), 'nearby chunks reach native leaves with room under the cap');
  assert.equal(rich.budgetLimited, false);
});

test('custom point limits survive reload, remain per-viewer, and handle corrupted/unavailable browser storage', () => {
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  assert.equal(readDisplayBudget(DISPLAY_BUDGET_KEYS.cloud, storage), 3000000);
  assert(saveDisplayBudget(DISPLAY_BUDGET_KEYS.cloud, 12345678, storage));
  assert.equal(readDisplayBudget(DISPLAY_BUDGET_KEYS.cloud, storage), 12345678);
  assert.equal(readDisplayBudget(DISPLAY_BUDGET_KEYS.toronto, storage), DEFAULT_ADAPTIVE_POINTS);
  for (const value of ['0', '-1', 'NaN', 'Infinity', '50000001', '123.5', '', 'garbage']) {
    storage.setItem(DISPLAY_BUDGET_KEYS.cloud, value);
    assert.equal(readDisplayBudget(DISPLAY_BUDGET_KEYS.cloud, storage), DEFAULT_ADAPTIVE_POINTS);
  }
  assert(validDisplayBudget(65536)); assert(validDisplayBudget(MAX_ADAPTIVE_POINTS));
  for (const value of [NaN, Infinity, 65535, -1, 50000001, 100000.5]) assert.throws(() => saveDisplayBudget('key', value, storage), /budget/);
  assert.equal(readDisplayBudget('key', { getItem() { throw new Error('storage blocked'); } }), DEFAULT_ADAPTIVE_POINTS);
  assert.equal(saveDisplayBudget('key', 4000000, { setItem() { throw new Error('storage blocked'); } }), false);
});

function payload(name: string): PreparedNodePayload {
  const count = 65536, positions = new Float64Array(count * 3);
  positions[0] = 0.123456789012;
  return { cloudId: 'fixture', revision: 'a'.repeat(64), name, count, positions, colors: new Uint8Array(count * 3), sourceIds: new Uint32Array(count * 2) };
}
test('custom cap allocates GPU projection progressively, preserves source precision through growth and releases capacity on shrink', () => {
  const material = new THREE.PointsMaterial(), render = createNativeCloudRender(material, 50000000);
  let disposals = 0;
  render.points.geometry.addEventListener('dispose', () => { disposals++; });
  try {
    assert.equal(render.capacity, 131072, 'large cap must not reserve fifty million GPU slots up front');
    render.add(payload('r')); render.add(payload('r0'));
    assert.equal(render.capacity, 131072);
    const first = render.resolve(0)?.payload;
    render.add(payload('r7'));
    assert.equal(render.capacity, 262144); assert.equal(disposals, 1);
    assert.equal(render.resolve(0)?.payload, first); assert.equal(render.resolve(0)?.payload.positions[0], 0.123456789012);
    assert.equal(render.points.geometry.getAttribute('position').getX(131072), Math.fround(0.123456789012));
    assert.throws(() => render.setBudget(65536), /budget/, 'caller must evict before reducing capacity');
    render.remove(['r0', 'r7']); render.setBudget(65536);
    assert.equal(render.capacity, 65536); assert.equal(render.count, 65536); assert.equal(disposals, 2);
    assert.throws(() => render.add(payload('r1')), /admission/);
    render.setBudget(200000); render.add(payload('r1')); assert.equal(render.count, 131072);
    assert.equal(render.resolve(0)?.payload, first);
  } finally { render.dispose(); material.dispose(); }
});
