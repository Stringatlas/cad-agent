import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createAdaptiveLoader } from '../../apps/web/src/viewer/adaptive-loader';
import { captureDetailView } from '../../apps/web/src/viewer/capture-detail';
import { createNativeCloudRender } from '../../apps/web/src/viewer/native-cloud-render';
import type { PreparedNodePayload } from '@spatial/contracts';
import { createVisualCapture } from '../../apps/web/src/viewer/visual-capture';
import type { AdaptiveNode, AdaptiveView } from '../../apps/web/src/viewer/adaptive-plan';

const nodes: AdaptiveNode[] = [
  { name: 'r', count: 2, bounds: { min: [0, 0, 0], max: [8, 8, 8] } },
  { name: 'r0', count: 2, bounds: { min: [0, 0, 0], max: [4, 4, 4] } },
  { name: 'r7', count: 2, bounds: { min: [4, 4, 4], max: [8, 8, 8] } },
];
const user: AdaptiveView = { position: [1, 1, 1], focus: [1, 1, 1], planes: [[-1, 0, 0, 3]], viewportHeight: 800, fovDegrees: 50 };
const other: AdaptiveView = { ...user, focus: [7, 7, 7], planes: [[1, 0, 0, -5]] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function until(condition: () => boolean) {
  for (let i = 0; i < 300; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 2)); }
  assert.fail('Condition did not become true');
}
const settings = { pointBudget: 4, nearRadius: 30, pixelThreshold: 60 };

test('capture waits only for its frozen admitted target, retains live geometry, reuses cache and resumes navigation', async () => {
  const held = deferred<{ name: string; count: number }>(), started = deferred<void>();
  const live = new Set<string>(), requests: string[] = [];
  let pending = 1;
  const loader = createAdaptiveLoader({ settings, hierarchy: async () => nodes,
    load: async n => { requests.push(n.name); if (n.name === 'r7') { started.resolve(); return held.promise; } return { name: n.name, count: n.count }; },
    add: p => live.add(p.name), remove: names => names.forEach(n => live.delete(n)), status: s => { pending = s.pending; assert(s.loadedPoints <= 4); } });
  try {
    loader.update(user); await until(() => pending === 0);
    assert.deepEqual([...live], ['r', 'r0']);
    let resolved = false;
    const capture = loader.capture(other, new AbortController().signal).then(v => { resolved = true; return v; });
    await started.promise;
    loader.update({ ...other, position: [7, 7, 7] });
    assert(!resolved); assert.deepEqual([...live], ['r', 'r0']);
    held.resolve({ name: 'r7', count: 2 });
    const lease = await capture;
    assert.deepEqual(lease.coverage, { status: 'ready', targetPointCount: 4, targetNodeCount: 2, budgetLimited: false, pointBudget: 4 });
    assert.deepEqual([...live], ['r', 'r0'], 'loading never blanks user geometry');
    const borrow = lease.render(); assert(borrow.changed); assert.deepEqual([...live], ['r', 'r7']);
    borrow.restore(); assert.deepEqual([...live], ['r', 'r0']); lease.release();
    await until(() => live.has('r7') && pending === 0);
    const before = [...requests];
    const reused = await loader.capture(other, new AbortController().signal);
    const same = reused.render(); assert(!same.changed); same.restore(); reused.release();
    assert.deepEqual(requests, before, 'overlapping capture/user demands never download a node twice');
    assert.deepEqual(requests, ['r', 'r0', 'r7']);
  } finally { loader.dispose(); }
});

test('budget-limited readiness describes admitted nodes; missing and failed nodes never resolve ready', async () => {
  const live = new Set<string>();
  const loader = createAdaptiveLoader({ settings, hierarchy: async () => nodes,
    load: async n => ({ name: n.name, count: n.count }), add: p => live.add(p.name), remove: ns => ns.forEach(n => live.delete(n)), status: () => {} });
  try {
    const lease = await loader.capture({ ...user, planes: [] }, new AbortController().signal);
    assert.equal(lease.coverage.budgetLimited, true); assert.equal(lease.coverage.targetPointCount, 4);
    const borrow = lease.render(); assert.equal(live.size, 2); borrow.restore(); assert.equal(live.size, 0); lease.release();
  } finally { loader.dispose(); }
  const failed = createAdaptiveLoader({ settings, hierarchy: async () => nodes,
    load: async () => { throw new Error('missing node'); }, add: () => assert.fail('must not add'), remove: () => {}, status: () => {} });
  try { await assert.rejects(failed.capture(other, new AbortController().signal), /missing node/); }
  finally { failed.dispose(); }
});

test('abort, replacement, configure, reset and disposal reject pending captures and discard late replies without overlapping requests', async () => {
  for (const action of ['abort', 'replace', 'configure', 'reset', 'dispose'] as const) {
    const held = deferred<{ name: string; count: number }>(), started = deferred<void>();
    let active = 0, peak = 0, adds = 0;
    const loader = createAdaptiveLoader({ settings, hierarchy: async () => nodes,
      load: async n => { active++; peak = Math.max(active, peak); started.resolve(); try { return await held.promise; } finally { active--; } },
      add: () => { adds++; }, remove: () => {}, status: () => {} });
    const abort = new AbortController();
    try {
      const capture = loader.capture(other, abort.signal); const rejection = assert.rejects(capture);
      await started.promise;
      if (action === 'abort') abort.abort();
      if (action === 'replace') { const nextAbort = new AbortController(); const next = loader.capture(other, nextAbort.signal); const rejected = assert.rejects(next); nextAbort.abort(); await rejected; }
      if (action === 'configure') loader.configure({ pointBudget: 1 });
      if (action === 'reset') loader.reset();
      if (action === 'dispose') loader.dispose();
      await rejection; loader.dispose(); held.resolve({ name: 'r', count: 2 });
      await until(() => active === 0); assert.equal(peak, 1); assert.equal(adds, 0);
    } finally { loader.dispose(); }
  }
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function visualFixture() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .1, 1000);
  camera.up.set(0, 0, 1); camera.position.set(0, -10, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const ready = deferred<void>(); let prepared: AdaptiveView | undefined, borrowed = false, restores = 0, releases = 0, revision = 1;
  let fail = false;
  const frames: { position: number[]; borrowed: boolean }[] = [];
  const renderer = { getContext: () => ({ isContextLost: () => false }), getDrawingBufferSize: (v: THREE.Vector2) => v.set(100, 100), getPixelRatio: () => 1,
    render: (_s: THREE.Scene, c: THREE.PerspectiveCamera) => frames.push({ position: c.position.toArray(), borrowed }),
    domElement: { toDataURL: () => { if (fail) throw new Error('PNG failed'); return PNG; } } } as unknown as THREE.WebGLRenderer;
  const visual = createVisualCapture({ renderer, camera, scene, target: () => [0, 0, 0], available: () => true,
    binding: () => ({ sourceId: 'fixture', sourceRevision: revision, frameId: 'local', units: 'm', origin: [0, 0, 0] }),
    coverage: () => ({ kind: 'native', complete: false, displayedPointCount: borrowed ? 4 : 2 }), points: () => [], resolve: () => undefined,
    prepare: async (c, focus, height, signal) => {
      prepared = captureDetailView(c, focus, height);
      await Promise.race([ready.promise, new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))]);
      return { coverage: { status: 'ready', targetPointCount: 4, targetNodeCount: 2, pointBudget: 4, budgetLimited: true },
        render() { borrowed = true; return { changed: true, restore() { borrowed = false; restores++; } }; }, release() { releases++; } };
    } });
  return { visual, camera, ready, frames, prepared: () => prepared, restores: () => restores, releases: () => releases,
    fail: () => { fail = true; }, stale: () => { revision++; } };
}

test('top-down/explicit captures await their own frustum, render loaded target and restore the concurrently navigated camera', async () => {
  for (const kind of ['top-down', 'camera'] as const) {
    const f = visualFixture();
    const request = kind === 'top-down' ? { kind } : { kind, position: [20, 20, 50] as const, target: [20, 20, 0] as const };
    const capture = f.visual.capture(request);
    assert.equal(f.frames.length, 0);
    assert.equal(f.prepared()?.planes.length, 6);
    assert.deepEqual(f.prepared()?.focus, kind === 'top-down' ? [0, 0, 0] : [20, 20, 0]);
    f.camera.position.set(50, -50, 25); f.camera.lookAt(20, 20, 0);
    f.ready.resolve(); const observation = await capture;
    assert.equal(observation.coverage.displayedPointCount, 4); assert.equal(observation.coverage.complete, false);
    assert.equal(f.frames[0]?.borrowed, true); assert.deepEqual(f.frames.at(-1), { position: [50, -50, 25], borrowed: false });
    assert.deepEqual(observation.camera.position, f.prepared()?.position); assert.equal(f.restores(), 1); assert.equal(f.releases(), 1);
    assert.equal(f.visual.isCurrent(observation.observationId), false, 'restored buffers cannot ground borrowed imagery');
    f.visual.dispose();
  }
});

test('extraction failure restores borrowed display; stale source/cancel/dispose never render after preparation', async () => {
  const f = visualFixture(); f.fail(); const capture = f.visual.capture({ kind: 'top-down' }); f.ready.resolve();
  await assert.rejects(capture, /PNG failed/); assert.equal(f.restores(), 1); assert.equal(f.releases(), 1); assert.equal(f.frames.at(-1)?.borrowed, false); f.visual.dispose();
  const stale = visualFixture(); const old = stale.visual.capture(); stale.stale(); stale.ready.resolve();
  await assert.rejects(old, /scene changed/); assert.equal(stale.frames.length, 0); assert.equal(stale.releases(), 1); stale.visual.dispose();
  for (const action of ['cancel', 'dispose'] as const) {
    const f = visualFixture(), abort = new AbortController(); const pending = f.visual.capture(undefined, abort.signal);
    if (action === 'cancel') abort.abort(); else f.visual.dispose();
    await assert.rejects(pending); assert.equal(f.frames.length, 0); f.visual.dispose();
  }
});


test('capture deadline rejects stalled preparation without a frame or retained demand', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = visualFixture();
  const pending = f.visual.capture({ kind: 'top-down' });
  const rejection = assert.rejects(pending, /deadline/);
  t.mock.timers.tick(11000); await rejection;
  assert.equal(f.frames.length, 0); f.visual.dispose();
});

test('packing multiple capture nodes preserves all pending GPU uploads and exact provenance through restoration', () => {
  const material = new THREE.PointsMaterial(), native = createNativeCloudRender(material, 65536);
  const payload = (name: string, x: number): PreparedNodePayload => ({ cloudId: 'fixture', revision: 'a'.repeat(64), name, count: 2,
    positions: new Float64Array([x, 1, 1, x + .00000000001, 2, 2]), colors: new Uint8Array([1, 2, 3, 4, 5, 6]), sourceIds: new Uint32Array([1, 7, 1, 8]) });
  try {
    native.add(payload('r', 0)); native.add(payload('r0', 1));
    const attr = native.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    assert(attr.updateRanges.some(r => r.start === 0 && r.count >= 6));
    assert(attr.updateRanges.some(r => r.start === 6 && r.count >= 6));
    attr.clearUpdateRanges();
    native.remove(['r']); native.add(payload('r7', 7));
    assert(attr.updateRanges.some(r => r.start === 0 && r.count >= 6), 'compaction must upload before append');
    assert(attr.updateRanges.some(r => r.start === 6 && r.count >= 6));
    assert.equal(native.resolve(1)?.payload.positions[3], 1.00000000001);
    assert.equal(native.resolve(2)?.payload.name, 'r7');
  } finally { native.dispose(); material.dispose(); }
});

test('a capture shares an already in-flight ancestor and preempts unrelated background work without overlapping the lane', async () => {
  const held = deferred<{ name: string; count: number }>(), started = deferred<void>();
  const requests: string[] = [], live = new Set<string>();
  let rootSignal: AbortSignal | undefined;
  const loader = createAdaptiveLoader({ settings, hierarchy: async () => nodes,
    load: async (n, signal) => { requests.push(n.name); if (n.name === 'r') { rootSignal = signal; started.resolve(); return held.promise; } return { name: n.name, count: n.count }; },
    add: p => live.add(p.name), remove: names => names.forEach(n => live.delete(n)), status: () => {} });
  try {
    loader.update(user); await started.promise;
    const pending = loader.capture(other, new AbortController().signal);
    assert.equal(rootSignal?.aborted, false, 'capture must reuse its useful in-flight ancestor');
    held.resolve({ name: 'r', count: 2 });
    const lease = await pending;
    assert.deepEqual(requests, ['r', 'r7']);
    const borrowed = lease.render(); assert.deepEqual([...live], ['r', 'r7']); borrowed.restore(); lease.release();
    await until(() => live.has('r0'));
    assert.equal(requests.filter(n => n === 'r').length, 1);
  } finally { loader.dispose(); }

  const entered = deferred<void>(); let aborted = false, active = 0, peak = 0;
  const second = createAdaptiveLoader({ settings, hierarchy: async () => nodes,
    load: async (n, signal) => {
      active++; peak = Math.max(peak, active);
      try {
        if (n.name === 'r0' && !aborted) { entered.resolve(); await new Promise<never>((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true })); }
        return { name: n.name, count: n.count };
      } finally { active--; }
    }, add: () => {}, remove: () => {}, status: () => {} });
  try {
    second.update(user); await entered.promise;
    const lease = await second.capture(other, new AbortController().signal);
    assert(aborted, 'uncaptured background request must yield to capture demand'); assert.equal(peak, 1);
    lease.release();
  } finally { second.dispose(); }
});

test('failure of capture-only detail does not latch or starve the user lane', async () => {
  const live = new Set<string>(); let attempts = 0, error: string | null = null;
  const loader = createAdaptiveLoader({ settings, hierarchy: async () => nodes,
    load: async n => { if (n.name === 'r7' && ++attempts === 1) throw new Error('capture node offline'); return { name: n.name, count: n.count }; },
    add: p => live.add(p.name), remove: names => names.forEach(n => live.delete(n)), status: s => { error = s.error; } });
  try {
    loader.update(user); await until(() => live.has('r0'));
    await assert.rejects(loader.capture(other, new AbortController().signal), /offline/);
    assert.equal(error, null); assert.deepEqual([...live], ['r', 'r0']);
    loader.update(other); await until(() => live.has('r7'));
    assert.equal(attempts, 2); assert.equal(error, null);
  } finally { loader.dispose(); }
});
