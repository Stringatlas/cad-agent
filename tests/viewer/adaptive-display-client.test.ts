import assert from 'node:assert/strict';
import test from 'node:test';
import { ADAPTIVE_BINARY_LIMITS, ADAPTIVE_BINARY_MIME, encodeAdaptiveBinary, type DatasetInfo, type PointObservation } from '@spatial/contracts';
import { observedPointLabel } from '../../apps/web/src/scenes/toronto/points/point-presentation';
import { createNativePickCache, createDetailPickCache } from '../../apps/web/src/scenes/toronto/inspection/pole-picking';
import { DEFAULT_ADAPTIVE_SETTINGS, createAdaptiveDisplay, planAdaptiveDisplay, validateAdaptiveHierarchy, validateAdaptivePayload, type AdaptiveHierarchy, type AdaptivePayload, type AdaptiveStats, type AdaptiveView } from '../../apps/web/src/scenes/toronto/display/adaptive-display';

const dataset: DatasetInfo = { id: 'toronto3d', revision: 'a'.repeat(64), coordinates: { units: 'm', upAxis: 'Z', handedness: 'right', localOrigin: [627285, 4841948, 0] }, bounds: { min: [0, 0, 0], max: [8, 8, 8] }, totalPoints: 8 };
const hierarchy: AdaptiveHierarchy = { dataset, nodes: [
  { name: 'r', count: 2, bounds: dataset.bounds },
  { name: 'r0', count: 2, bounds: { min: [0, 0, 0], max: [4, 4, 4] } },
  { name: 'r00', count: 2, bounds: { min: [0, 0, 0], max: [2, 2, 2] } },
  { name: 'r7', count: 2, bounds: { min: [4, 4, 4], max: [8, 8, 8] } },
] };
const view: AdaptiveView = { position: [1, 1, 1], planes: [], viewportHeight: 800, fovDegrees: 60 };
const settings = { nearRadius: 30, pixelThreshold: 80, pointBudget: 8 };
type JsonPayload = AdaptivePayload & { positions: number[]; colors: number[]; sourceIds: number[]; labels: number[] };
function payload(name: string, bound = dataset): JsonPayload {
  return { dataset: bound, name, count: 2, positions: [1.00000000001, 2, 3, 4, 5, 6], colors: [0, 1, 2, 253, 254, 255], sourceIds: [1, 0xffffffff, 65535, 0], labels: [0, 8] };
}
const pause = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition: () => boolean) { for (let i = 0; i < 100; i++) { if (condition()) return; await pause(10); } assert.fail('Timed out waiting for scheduler'); }
function response(value: AdaptiveHierarchy | JsonPayload) {
  return 'name' in value
    ? new Response(Uint8Array.from(encodeAdaptiveBinary(value)).buffer, { headers: { 'content-type': ADAPTIVE_BINARY_MIME } })
    : new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

test('near includes full native leaves plus ancestors; far remains coarse; budget is honest and additive', () => {
  const full = planAdaptiveDisplay(hierarchy, view, settings);
  assert.equal(full.points, 8); assert.equal(full.budgetLimited, false); assert.equal(full.nodes.length, 4);
  assert.ok(full.nodes.findIndex(n => n.name === 'r0') < full.nodes.findIndex(n => n.name === 'r00'));
  const coarse = planAdaptiveDisplay(hierarchy, { ...view, position: [10000, 10000, 10000] }, settings);
  assert.deepEqual(coarse.nodes.map(n => n.name), ['r']);
  const capped = planAdaptiveDisplay(hierarchy, view, { ...settings, pointBudget: 5 });
  assert.equal(capped.points, 4); assert.equal(capped.budgetLimited, true);
  for (const node of capped.nodes) if (node.name !== 'r') assert.ok(capped.nodes.some(n => n.name === node.name.slice(0, -1)));
  assert.deepEqual(planAdaptiveDisplay(hierarchy, { ...view, planes: [[1, 0, 0, -10]] }, settings).nodes, []);
  assert.equal(planAdaptiveDisplay(hierarchy, view, { ...settings, pointBudget: 1 }).budgetLimited, true);
});

test('inspection focus reaches a far/edge branch instead of spending its budget on near-camera foreground', () => {
  const edge: AdaptiveHierarchy = { dataset: { ...dataset, totalPoints: 10 }, nodes: [...hierarchy.nodes,
    { name: 'r77', count: 2, bounds: { min: [6, 6, 6], max: [8, 8, 8] } },
  ] };
  const tight = { ...settings, nearRadius: 1, pointBudget: 6 };
  const names = (v: AdaptiveView) => planAdaptiveDisplay(edge, v, tight).nodes.map(n => n.name);
  assert.deepEqual(names(view), ['r', 'r0', 'r00'], 'foreground previously starved the inspected far branch');
  const focused = { ...view, focus: [7, 7, 7] as const };
  assert.deepEqual(names(focused), ['r', 'r7', 'r77']);
  assert.deepEqual(names({ ...focused, focus: [1, 1, 1] }), ['r', 'r0', 'r00'], 'moving the focus restores detail at the other edge');
  for (const pointBudget of [1, 2, 3, 4, 5, 6, 8, 10]) {
    const plan = planAdaptiveDisplay(edge, focused, { ...tight, pointBudget });
    assert.ok(plan.points <= pointBudget);
    for (const node of plan.nodes) if (node.name !== 'r') assert.ok(plan.nodes.some(n => n.name === node.name.slice(0, -1)));
  }
  assert.equal(planAdaptiveDisplay(edge, focused, tight).budgetLimited, true);
  assert.deepEqual(names({ ...focused, planes: [[-1, 0, 0, 3]] }), ['r', 'r0', 'r00'], 'focus never bypasses frustum culling');
  assert.deepEqual(names({ ...focused, position: [10000, 10000, 10000] }), ['r'], 'focus does not invent distant full-detail eligibility');
  for (const focus of [[NaN, 0, 0], [Infinity, 0, 0], [1, 2]]) {
    assert.throws(() => planAdaptiveDisplay(edge, { ...view, focus: focus as unknown as AdaptiveView['position'] }, tight), /camera/);
  }
});

test('focus-only motion replans and evicts within budget even if camera pose and frustum stay unchanged', async () => {
  const visible = new Set<string>(); let points = 0;
  const fetcher: typeof fetch = async input => response(String(input).endsWith('display-hierarchy') ? hierarchy : payload(new URL(String(input), 'http://local').searchParams.get('name')!));
  const channel = createAdaptiveDisplay({ add(p) { visible.add(p.name); }, remove(n) { visible.delete(n); }, status(s) { points = s.loadedPoints; assert.ok(points <= 4); } }, fetcher);
  try {
    channel.configure({ ...settings, pointBudget: 4 }); channel.update({ ...view, focus: [1, 1, 1] }); channel.bind(dataset);
    await until(() => points === 4); assert.deepEqual([...visible], ['r', 'r0']);
    channel.update({ ...view, focus: [7, 7, 7] });
    await until(() => visible.has('r7')); assert.deepEqual([...visible], ['r', 'r7']);
  } finally { channel.dispose(); }
});

test('default and maximum budget are hard-capped at three million native points', () => {
  assert.equal(DEFAULT_ADAPTIVE_SETTINGS.pointBudget, 3_000_000);
  const names = ['r', ...Array.from({ length: 8 }, (_, i) => `r${i}`), ...Array.from({ length: 64 }, (_, i) => `r${i >> 3}${i % 8}`)];
  const large = { dataset, nodes: names.map(name => ({ name, count: 65_536, bounds: dataset.bounds })) };
  const plan = planAdaptiveDisplay(large, view);
  assert.equal(plan.points, Math.floor(3_000_000 / 65_536) * 65_536);
  assert.equal(plan.budgetLimited, true);
  assert.throws(() => planAdaptiveDisplay(large, view, { ...settings, pointBudget: 3_000_001 }), /settings/);
  const channel = createAdaptiveDisplay({ add() {}, remove() {}, status() {} });
  try { assert.throws(() => channel.configure({ pointBudget: 3_000_001 }), /settings/); } finally { channel.dispose(); }
});

test('frustum and screen hysteresis retain only modest boundary crossings; settings and camera validated', () => {
  const boundary = { ...view, planes: [[1, 0, 0, -8.2] as const] };
  assert.equal(planAdaptiveDisplay(hierarchy, boundary, settings).nodes.length, 0);
  assert.ok(planAdaptiveDisplay(hierarchy, boundary, settings, new Set(['r'])).nodes.length > 0);
  for (const bad of [{ pointBudget: 0 }, { pointBudget: 4_000_001 }, { nearRadius: -1 }, { pixelThreshold: NaN }]) assert.throws(() => planAdaptiveDisplay(hierarchy, view, { ...settings, ...bad }), /settings/);
  assert.throws(() => planAdaptiveDisplay(hierarchy, { ...view, fovDegrees: 180 }, settings), /camera/);
});

test('catalog requires complete additive tree and exact octant boxes; payload provenance remains exact', () => {
  assert.equal(validateAdaptiveHierarchy(hierarchy, dataset), hierarchy);
  const exact = payload('r'); assert.equal(validateAdaptivePayload(exact, dataset, hierarchy.nodes[0]), exact);
  assert.equal(exact.positions[0], 1.00000000001);
  for (const mutate of [
    (p: JsonPayload) => { p.sourceIds[0] = -1; }, (p: JsonPayload) => { p.sourceIds[1] = 0x100000000; },
    (p: JsonPayload) => { p.sourceIds.pop(); }, (p: JsonPayload) => { p.positions[0] = Infinity; },
    (p: JsonPayload) => { p.colors[0] = 256; }, (p: JsonPayload) => { p.labels.pop(); },
    (p: JsonPayload) => { p.dataset = { ...dataset, revision: 'b'.repeat(64) }; }, (p: JsonPayload) => { p.name = 'r7'; },
  ]) { const p = structuredClone(exact); mutate(p); assert.throws(() => validateAdaptivePayload(p, dataset, hierarchy.nodes[0]), /payload/); }
  for (const mutate of [
    (h: AdaptiveHierarchy) => { h.nodes.pop(); }, (h: AdaptiveHierarchy) => { h.nodes[2].name = 'r10'; },
    (h: AdaptiveHierarchy) => { h.nodes[1].bounds = { ...h.nodes[1].bounds, min: [1, 0, 0] }; }, (h: AdaptiveHierarchy) => { h.nodes.push(h.nodes[0]); },
  ]) { const h = structuredClone(hierarchy); mutate(h); assert.throws(() => validateAdaptiveHierarchy(h, dataset)); }
});

test('native cubic root encloses narrower occupied bounds and preserves exact picks beyond crop batch limits', () => {
  const occupied = { ...dataset, bounds: { min: [1, 1, 1], max: [7, 7, 7] } as const };
  assert.doesNotThrow(() => validateAdaptiveHierarchy({ ...hierarchy, dataset: occupied }, occupied));
  assert.throws(() => validateAdaptiveHierarchy({ ...hierarchy, dataset: { ...dataset, bounds: { min: [-1, 0, 0], max: [8, 8, 8] } } }, { ...dataset, bounds: { min: [-1, 0, 0], max: [8, 8, 8] } }), /root/);
  const count = 34_401, positions = Array(count * 3).fill(1.00000000001), ids: number[] = Array.from({ length: count * 2 }, (_, i) => i % 2 ? 0xffffffff : 4);
  const cache = createNativePickCache(dataset, positions, ids);
  assert.equal(cache.resolve(count - 1)?.position[0], 1.00000000001);
  assert.deepEqual(cache.resolve(count - 1)?.key, { sourceFileId: 4, sourceRow: 0xffffffff });
  positions[0] = 9; ids[0] = 1; assert.equal(cache.resolve(0)?.position[0], 1.00000000001);
  assert.throws(() => createDetailPickCache(dataset, positions, ids), /provenance/);
  assert.throws(() => createNativePickCache(dataset, Array(65_537 * 3).fill(0), Array(65_537 * 2).fill(1)), /provenance/);
  cache.dispose(); assert.equal(cache.resolve(0), undefined);
});

test('native picks snapshot exact labels with source identity, coordinates and artifact revision without a lookup', () => {
  const bound = { ...structuredClone(dataset) }, labels = Array.from({ length: 9 }, (_, i) => i);
  const positions = labels.flatMap(i => [1.00000000001 + i, 2, 3]);
  const ids = labels.flatMap(i => [1 + i % 4, 0xffffffff - i]);
  const cache = createNativePickCache(bound, positions, ids, labels);
  bound.revision = 'b'.repeat(64); labels.fill(8); positions.fill(0); ids.fill(0);
  for (let i = 0; i < 9; i++) {
    const point = cache.resolve(i)!;
    assert.equal(point.artifactRevision, dataset.revision);
    assert.deepEqual(point.key, { sourceFileId: 1 + i % 4, sourceRow: 0xffffffff - i });
    assert.deepEqual(point.position, [1.00000000001 + i, 2, 3]);
    assert.equal(point.semanticLabel, i);
    assert.equal(observedPointLabel(point), i);
  }
  for (const index of [-1, 9, 0.5, NaN]) assert.equal(cache.resolve(index), undefined);
  cache.dispose(); assert.equal(cache.resolve(0), undefined);
});

test('native labels reject malformed input; absent metadata preserves observation matching', () => {
  const positions = [1.00000000001, 2, 3], ids = [4, 0xffffffff];
  for (const labels of [[], [0, 1], [-1], [9], [0.5], [NaN], [Infinity], new Array<number>(1)]) {
    assert.throws(() => createNativePickCache(dataset, positions, ids, labels), /labels/);
  }
  const observation: PointObservation = { dataset, positions, sourceIds: ids, labels: [7], colors: [0, 0, 0],
    count: 1, purpose: 'display', lod: { budget: 1, depth: 0 }, algorithm: 'potree-bfs-even-v1',
    candidatePoints: 1, bytesRead: 0, nodes: ['r'], sampleHash: '0'.repeat(64) };
  const legacy = createNativePickCache(dataset, positions, ids).resolve(0)!;
  assert.equal(legacy.semanticLabel, undefined);
  assert.equal(observedPointLabel(legacy), undefined);
  assert.equal(observedPointLabel(legacy, observation), 7);
  assert.equal(observedPointLabel({ ...legacy, artifactRevision: 'b'.repeat(64) }, observation), undefined);
  assert.equal(observedPointLabel({ ...legacy, key: { sourceFileId: 4, sourceRow: 1 } }, observation), undefined);
  assert.equal(observedPointLabel({ ...legacy, position: [Math.fround(positions[0]), 2, 3] }, observation), undefined);
  assert.equal(observedPointLabel({ ...legacy, semanticLabel: 99 as never }, observation), 7);
  assert.equal(observedPointLabel({ ...legacy, semanticLabel: 99 as never }), undefined);
  const native = createNativePickCache(dataset, positions, ids, [0]).resolve(0)!;
  assert.equal(observedPointLabel(native, observation), 0);
});

test('renderer callback failure never publishes phantom resident points and retries explicitly', async () => {
  let error: string | null = null, points = 0, fail = true;
  const fetcher: typeof fetch = async input => response(String(input).endsWith('display-hierarchy') ? hierarchy : payload(new URL(String(input), 'http://local').searchParams.get('name')!));
  const channel = createAdaptiveDisplay({ add() { if (fail) throw new Error('render failed'); }, remove() {}, status(s) { error = s.error; points = s.loadedPoints; } }, fetcher);
  try {
    channel.configure(settings); channel.update(view); channel.bind(dataset); await until(() => !!error);
    assert.equal(error, 'render failed'); assert.equal(points, 0); fail = false; channel.retry(); await until(() => points === 8);
  } finally { channel.dispose(); }
});

test('scheduler serializes, enforces resident budget, evicts obsolete chunks and avoids stationary reloads', async () => {
  let active = 0, peak = 0, calls = 0; const visible = new Map<string, AdaptivePayload>(); const stats: AdaptiveStats[] = [];
  const fetcher: typeof fetch = async input => {
    calls++; active++; peak = Math.max(peak, active); await pause(1); active--;
    const url = String(input); return response(url.endsWith('display-hierarchy') ? hierarchy : payload(new URL(url, 'http://local').searchParams.get('name')!));
  };
  const channel = createAdaptiveDisplay({ add: p => visible.set(p.name, p), remove: n => { visible.delete(n); }, status: s => stats.push(s) }, fetcher);
  try {
    channel.configure(settings); channel.update(view); channel.bind(dataset);
    await until(() => visible.size === 4); assert.equal(peak, 1);
    const before = calls; for (let i = 0; i < 20; i++) channel.update(view); await pause(180); assert.equal(calls, before);
    assert.throws(() => channel.configure({ pointBudget: 0 })); assert.equal(visible.size, 4);
    channel.configure({ pointBudget: 4 }); assert.ok([...visible.values()].reduce((n, p) => n + p.count, 0) <= 4);
    await until(() => stats.at(-1)?.pending === 0); assert.equal(stats.at(-1)?.budgetLimited, true);
    channel.update({ ...view, planes: [[1, 0, 0, -100]] }); await until(() => visible.size === 0);
    assert.ok(stats.every(s => s.loadedPoints <= 8));
  } finally { channel.dispose(); } assert.equal(visible.size, 0);
});

test('bulk eviction is one callback per plan, commits residency only after success, and retries', async () => {
  const visible = new Set<string>(), removals: string[][] = [];
  let fail = false, latest: AdaptiveStats | undefined;
  const fetcher: typeof fetch = async input => response(String(input).endsWith('display-hierarchy') ? hierarchy : payload(new URL(String(input), 'http://local').searchParams.get('name')!));
  const channel = createAdaptiveDisplay({
    add(p) { visible.add(p.name); },
    remove() { assert.fail('bulk callback must replace single eviction'); },
    removeMany(names) {
      removals.push([...names]);
      if (fail) throw new Error('eviction failed');
      for (const name of names) visible.delete(name);
    },
    status(stats) { latest = stats; },
  }, fetcher);
  try {
    channel.configure(settings); channel.update(view); channel.bind(dataset);
    await until(() => visible.size === 4);
    fail = true;
    assert.throws(() => channel.configure({ pointBudget: 4 }), /eviction failed/);
    assert.equal(visible.size, 4);
    // A failed transaction must retain all resident names for the explicit retry.
    fail = false; channel.retry();
    assert.equal(latest?.loadedPoints, 4); assert.equal(visible.size, 2);
    assert.equal(removals.length, 2); assert.deepEqual(removals[0], removals[1]);
    assert.equal(removals[0].length, 2);
    channel.dispose();
    assert.equal(visible.size, 0); assert.equal(removals.length, 3); assert.equal(removals[2].length, 2);
    channel.dispose(); assert.equal(removals.length, 3);
  } finally { fail = false; channel.dispose(); }
});

test('camera timer eviction failure stays resident, reports a latched error and retries explicitly', async () => {
  const visible = new Set<string>(), removals: string[][] = [];
  let fail = true, calls = 0, latest: AdaptiveStats | undefined;
  const fetcher: typeof fetch = async input => {
    calls++;
    return response(String(input).endsWith('display-hierarchy') ? hierarchy : payload(new URL(String(input), 'http://local').searchParams.get('name')!));
  };
  const channel = createAdaptiveDisplay({
    add(p) { visible.add(p.name); },
    remove() { assert.fail('bulk callback must replace single eviction'); },
    removeMany(names) {
      removals.push([...names]);
      if (fail) throw new Error('Camera eviction failed; retry.');
      for (const name of names) visible.delete(name);
    },
    status(stats) { latest = stats; },
  }, fetcher);
  try {
    channel.configure(settings); channel.update(view); channel.bind(dataset);
    await until(() => visible.size === 4 && latest?.pending === 0);
    const before = calls, residentNames = [...visible].sort();
    // No request is active: this failure must be caught by the camera timer,
    // not the request lane. node:test also fails on uncaught async exceptions.
    channel.update({ ...view, planes: [[1, 0, 0, -100]] });
    await until(() => latest?.error !== null);
    assert.equal(latest?.error, 'Camera eviction failed; retry.');
    assert.equal(latest?.loadedPoints, 8); assert.equal(latest?.chunks, 4);
    assert.deepEqual([...visible].sort(), residentNames);
    fail = false;
    channel.update({ ...view, position: [2, 2, 2], planes: [[1, 0, 0, -100]] });
    await pause(200);
    assert.equal(latest?.error, 'Camera eviction failed; retry.');
    assert.equal(removals.length, 1); assert.equal(calls, before);
    assert.deepEqual([...visible].sort(), residentNames);
    channel.retry();
    assert.equal(latest?.error, null); assert.equal(latest?.loadedPoints, 0);
    assert.equal(latest?.pending, 0); assert.equal(visible.size, 0);
    assert.equal(removals.length, 2); assert.deepEqual(removals[0], removals[1]);
    assert.equal(calls, before);
  } finally { fail = false; channel.dispose(); }
});

test('physical request occupies the sole lane; stale artifact/config/camera/dispose never adds', async () => {
  for (const change of ['artifact', 'config', 'camera', 'dispose'] as const) {
    let release: (() => void) | undefined, active = 0, peak = 0, nodeCalls = 0; const adds: string[] = []; let oldSignal: AbortSignal | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input); if (url.endsWith('display-hierarchy')) return response(hierarchy);
      active++; peak = Math.max(peak, active); nodeCalls++;
      if (nodeCalls === 1) { oldSignal = init?.signal as AbortSignal; await new Promise<void>(resolve => { release = resolve; }); }
      active--; return response(payload(new URL(url, 'http://local').searchParams.get('name')!));
    };
    const channel = createAdaptiveDisplay({ add: p => adds.push(p.name), remove() {}, status() {} }, fetcher);
    channel.configure(settings); channel.update(view); channel.bind(dataset); await until(() => !!release);
    if (change === 'artifact') channel.bind({ ...dataset, revision: 'b'.repeat(64) });
    if (change === 'config') channel.configure({ pointBudget: 1 });
    if (change === 'camera') channel.update({ ...view, planes: [[1, 0, 0, -100]] });
    if (change === 'dispose') channel.dispose();
    assert.equal(oldSignal?.aborted, change !== 'camera'); assert.equal(nodeCalls, 1); release!();
    // Camera admission must reject obsolete nodes even before its 150ms timer.
    await pause(10); assert.deepEqual(adds, [], change);
    await pause(190);
    assert.deepEqual(adds, [], change); assert.equal(peak, 1); channel.dispose();
  }
});

test('camera motion retains useful hierarchy and node requests without restarting or overlapping', async () => {
  let releaseHierarchy: (() => void) | undefined, releaseNode: (() => void) | undefined;
  let hierarchySignal: AbortSignal | undefined, nodeSignal: AbortSignal | undefined;
  let hierarchyCalls = 0, rootCalls = 0, active = 0, peak = 0;
  const adds: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    active++; peak = Math.max(peak, active);
    const url = String(input);
    if (url.endsWith('display-hierarchy')) {
      hierarchyCalls++; hierarchySignal = init?.signal as AbortSignal;
      await new Promise<void>(resolve => { releaseHierarchy = resolve; });
      active--; return response(hierarchy);
    }
    const name = new URL(url, 'http://local').searchParams.get('name')!;
    if (name === 'r') {
      rootCalls++; nodeSignal = init?.signal as AbortSignal;
      await new Promise<void>(resolve => { releaseNode = resolve; });
    }
    active--; return response(payload(name));
  };
  const channel = createAdaptiveDisplay({ add: p => adds.push(p.name), remove() {}, status() {} }, fetcher);
  try {
    channel.configure(settings); channel.update(view); channel.bind(dataset);
    await until(() => !!releaseHierarchy);
    for (let i = 2; i < 10; i++) channel.update({ ...view, position: [i, 1, 1] });
    assert.equal(hierarchySignal?.aborted, false); releaseHierarchy!();
    await until(() => !!releaseNode);
    for (let i = 10; i < 20; i++) channel.update({ ...view, position: [i, 1, 1] });
    assert.equal(nodeSignal?.aborted, false); releaseNode!();
    await until(() => adds.length === 4);
    assert.equal(hierarchyCalls, 1); assert.equal(rootCalls, 1); assert.equal(peak, 1);
    assert.equal(adds.filter(name => name === 'r').length, 1);
  } finally { releaseHierarchy?.(); releaseNode?.(); channel.dispose(); }
});

test('active serial lane finishes useful parent-before-child loads while camera timer is frozen', async t => {
  const setTimer = globalThis.setTimeout;
  // Freeze only camera planning; real request deadlines/cleanup keep normal handles.
  t.mock.method(globalThis, 'setTimeout', (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
    setTimer(callback, delay === 150 ? 60_000 : delay, ...args));
  const adds: string[] = []; let active = 0, peak = 0;
  const fetcher: typeof fetch = async input => {
    active++; peak = Math.max(peak, active);
    try {
      if (String(input).endsWith('display-hierarchy')) return response(hierarchy);
      const name = new URL(String(input), 'http://local').searchParams.get('name')!;
      // Schedule the camera throttle during an active request, then never fire it.
      if (name === 'r') channel.update({ ...view, position: [2, 1, 1] });
      return response(payload(name));
    } finally { active--; }
  };
  const channel = createAdaptiveDisplay({ add: p => adds.push(p.name), remove() {}, status() {} }, fetcher);
  try {
    channel.configure(settings); channel.update(view); channel.bind(dataset);
    for (let i = 0; i < 30 && adds.length < 4; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(adds.length, 4, 'camera throttle must not pause the active lane');
    assert.equal(peak, 1);
    assert.ok(adds.indexOf('r') < adds.indexOf('r0'));
    assert.ok(adds.indexOf('r0') < adds.indexOf('r00'));
  } finally { channel.dispose(); }
});

test('errors stay latched across camera frames until explicit retry; bounded streams and invalid payloads fail closed', async () => {
  let calls = 0, fail = true; const errors: (string | null)[] = []; const adds: string[] = [];
  const fetcher: typeof fetch = async input => {
    calls++; if (fail) return new Response('busy', { status: 503 });
    const url = String(input); return response(url.endsWith('display-hierarchy') ? hierarchy : payload(new URL(url, 'http://local').searchParams.get('name')!));
  };
  const channel = createAdaptiveDisplay({ add: p => adds.push(p.name), remove() {}, status: s => errors.push(s.error) }, fetcher);
  try {
    channel.configure(settings); channel.update(view); channel.bind(dataset); await until(() => !!errors.at(-1));
    const before = calls; channel.update({ ...view, position: [2, 2, 2] }); await pause(200); assert.equal(calls, before);
    fail = false; channel.retry(); await until(() => adds.length === 4); assert.equal(errors.at(-1), null);
  } finally { channel.dispose(); }
  for (const badResponse of [() => new Response('{}', { headers: { 'content-length': String(9 * 1024 * 1024) } }), () => response({ ...hierarchy, dataset: { ...dataset, revision: 'b'.repeat(64) } })]) {
    let error: string | null = null;
    const bad = createAdaptiveDisplay({ add() { assert.fail('invalid payload added'); }, remove() {}, status: s => { error = s.error; } }, async () => badResponse());
    bad.bind(dataset); await until(() => !!error); bad.dispose();
  }
});

test('binary node requests retain exact typed arrays and are bound to revision, node and count', async () => {
  const adds: AdaptivePayload[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input), 'http://local');
    if (url.pathname.endsWith('display-hierarchy')) return response(hierarchy);
    assert.equal(url.searchParams.get('format'), 'binary');
    assert.equal(url.searchParams.get('revision'), dataset.revision);
    return response(payload(url.searchParams.get('name')!));
  };
  const channel = createAdaptiveDisplay({ add: p => adds.push(p), remove() {}, status() {} }, fetcher);
  try {
    channel.configure(settings); channel.update(view); channel.bind(dataset);
    await until(() => adds.length === 4);
    for (const p of adds) {
      assert.ok(p.positions instanceof Float64Array); assert.ok(p.colors instanceof Uint8Array);
      assert.ok(p.sourceIds instanceof Uint32Array); assert.ok(p.labels instanceof Uint8Array);
      assert.equal(p.positions[0], 1.00000000001);
      assert.deepEqual(Array.from(p.sourceIds), [1, 0xffffffff, 65535, 0]);
      assert.deepEqual(Array.from(p.labels), [0, 8]);
    }
  } finally { channel.dispose(); }
});

test('binary controller fails closed on MIME, identity, corrupt bytes and bounded streamed bodies', async () => {
  const binary = (bytes: Uint8Array, headers: Record<string, string> = {}) => new Response(Uint8Array.from(bytes).buffer, { headers: { 'content-type': ADAPTIVE_BINARY_MIME, ...headers } });
  const exact = encodeAdaptiveBinary(payload('r'));
  const wrongCount = exact.slice(); new DataView(wrongCount.buffer).setUint32(8, 1, true);
  const invalidPosition = exact.slice();
  const metadataLength = new DataView(invalidPosition.buffer).getUint32(12, true);
  new DataView(invalidPosition.buffer).setFloat64(16 + metadataLength, NaN, true);
  const invalidLabel = exact.slice(); invalidLabel[16 + metadataLength + 33] = 255;
  let canceled = 0;
  const badResponses = [
    () => binary(exact, { 'content-type': 'application/json' }),
    () => new Response(Uint8Array.from(exact).buffer),
    () => binary(encodeAdaptiveBinary(payload('r7'))),
    () => binary(encodeAdaptiveBinary(payload('r', { ...dataset, revision: 'b'.repeat(64) }))),
    () => binary(wrongCount), () => binary(invalidPosition), () => binary(invalidLabel),
    () => binary(exact.subarray(0, -1)),
    () => binary(exact, { 'content-length': String(ADAPTIVE_BINARY_LIMITS.responseBytes + 1) }),
    () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(ADAPTIVE_BINARY_LIMITS.responseBytes)); controller.enqueue(new Uint8Array(1)); },
      cancel() { canceled++; },
    }), { headers: { 'content-type': ADAPTIVE_BINARY_MIME } }),
  ];
  for (const badResponse of badResponses) {
    let error: string | null = null, adds = 0, nodeCalls = 0;
    const channel = createAdaptiveDisplay({ add() { adds++; }, remove() {}, status(s) { error = s.error; } }, async input => {
      if (String(input).endsWith('display-hierarchy')) return response(hierarchy);
      nodeCalls++; return badResponse();
    });
    try {
      channel.configure(settings); channel.update(view); channel.bind(dataset);
      await until(() => !!error); assert.equal(adds, 0); assert.equal(nodeCalls, 1);
    } finally { channel.dispose(); }
  }
  assert.equal(canceled, 1);
});

test('abort cancels a stalled binary body read and never admits its partially received points', async () => {
  let started = false, canceled = false, adds = 0, error: string | null = null;
  const channel = createAdaptiveDisplay({ add() { adds++; }, remove() {}, status(s) { error = s.error; } }, async input => {
    if (String(input).endsWith('display-hierarchy')) return response(hierarchy);
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { started = true; controller.enqueue(encodeAdaptiveBinary(payload('r')).subarray(0, 16)); },
      cancel() { canceled = true; },
    }), { headers: { 'content-type': ADAPTIVE_BINARY_MIME } });
  });
  try {
    channel.configure(settings); channel.update(view); channel.bind(dataset);
    await until(() => started); await pause(5);
    channel.configure({ pointBudget: 1 });
    await until(() => canceled); await pause(10);
    assert.equal(adds, 0); assert.equal(error, null);
  } finally { channel.dispose(); }
});
