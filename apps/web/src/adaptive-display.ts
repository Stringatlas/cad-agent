import { ADAPTIVE_BINARY_LIMITS, ADAPTIVE_BINARY_MIME, decodeAdaptiveBinary, type CropBox, type DatasetInfo, type Vec3 } from '@spatial/contracts';

export interface AdaptiveNode { name: string; count: number; bounds: CropBox }
export interface AdaptiveHierarchy { dataset: DatasetInfo; nodes: AdaptiveNode[] }
export interface AdaptivePayload { dataset: DatasetInfo; name: string; count: number; positions: ArrayLike<number>; colors: ArrayLike<number>; sourceIds: ArrayLike<number>; labels: ArrayLike<number> }
export interface AdaptiveSettings { nearRadius: number; pixelThreshold: number; pointBudget: number }
export interface AdaptiveView {
  position: Vec3;
  /** Current inspection/orbit target in dataset-local meters, not the dataset center. */
  focus?: Vec3;
  planes: readonly (readonly [number, number, number, number])[];
  viewportHeight: number;
  fovDegrees: number;
}
export interface AdaptiveStats { loadedPoints: number; chunks: number; pending: number; budgetLimited: boolean; error: string | null }
export interface AdaptiveCallbacks {
  add(payload: AdaptivePayload): void;
  remove(name: string): void;
  /** Atomic eviction: throwing must leave the previous rendered set intact. */
  removeMany?(names: readonly string[]): void;
  status(stats: AdaptiveStats): void;
}
export interface AdaptivePlan { nodes: AdaptiveNode[]; points: number; budgetLimited: boolean }
export const DEFAULT_ADAPTIVE_SETTINGS: Readonly<AdaptiveSettings> = Object.freeze({ nearRadius: 30, pixelThreshold: 80, pointBudget: 3_000_000 });

function checkedSettings(value: AdaptiveSettings): AdaptiveSettings {
  if (!Number.isFinite(value.nearRadius) || value.nearRadius < 0 || value.nearRadius > 10_000 || !Number.isFinite(value.pixelThreshold) || value.pixelThreshold < 1 || value.pixelThreshold > 10_000 || !Number.isSafeInteger(value.pointBudget) || value.pointBudget < 1 || value.pointBudget > 3_000_000) throw new RangeError('Invalid adaptive display settings');
  return { ...value };
}
function checkedView(view: AdaptiveView) {
  if (view.position.length !== 3 || !view.position.every(Number.isFinite) || (view.focus !== undefined && (view.focus.length !== 3 || !view.focus.every(Number.isFinite))) || !Number.isFinite(view.viewportHeight) || view.viewportHeight <= 0 || !Number.isFinite(view.fovDegrees) || view.fovDegrees <= 0 || view.fovDegrees >= 180 || !view.planes.every(p => p.length === 4 && p.every(Number.isFinite) && Math.hypot(p[0], p[1], p[2]) > 0)) throw new RangeError('Invalid adaptive display camera');
}

/** Additive native nodes: children are eligible only after their ancestor payloads fit.
 * Near intersections refine to leaves; far nodes refine by projected box diameter.
 * An explicit inspection focus prioritizes its visible region over camera-near
 * foreground, without changing refinement eligibility or promising full detail.
 * A small visibility/refinement margin retains boundary nodes without an extra cache.
 */
export function planAdaptiveDisplay(hierarchy: AdaptiveHierarchy, view: AdaptiveView, settings: AdaptiveSettings = DEFAULT_ADAPTIVE_SETTINGS, previous: ReadonlySet<string> = new Set()): AdaptivePlan {
  checkedView(view); checkedSettings(settings);
  const children = new Map<string, AdaptiveNode[]>();
  for (const node of hierarchy.nodes) {
    const parent = node.name.slice(0, -1), siblings = children.get(parent) ?? [];
    siblings.push(node); children.set(parent, siblings);
  }
  type Candidate = { node: AdaptiveNode; distance: number; focusDistance: number; pixels: number; near: boolean };
  const heap: Candidate[] = [];
  const better = (a: Candidate, b: Candidate) => b.focusDistance - a.focusDistance || Number(a.near) - Number(b.near) || (a.near ? b.distance - a.distance : a.pixels - b.pixels) || b.node.name.localeCompare(a.node.name);
  const push = (node: AdaptiveNode) => {
    const diagonal = Math.hypot(...node.bounds.max.map((n, i) => n - node.bounds.min[i]));
    const margin = previous.has(node.name) ? Math.max(0.5, diagonal * 0.05) : 0;
    if (view.planes.some(p => p[0] * (p[0] >= 0 ? node.bounds.max[0] : node.bounds.min[0]) + p[1] * (p[1] >= 0 ? node.bounds.max[1] : node.bounds.min[1]) + p[2] * (p[2] >= 0 ? node.bounds.max[2] : node.bounds.min[2]) + p[3] < -margin * Math.hypot(p[0], p[1], p[2]))) return;
    const distance = Math.hypot(...view.position.map((n, i) => Math.max(node.bounds.min[i] - n, 0, n - node.bounds.max[i])));
    const pixels = diagonal * view.viewportHeight / (2 * Math.tan(view.fovDegrees * Math.PI / 360) * Math.max(0.01, distance));
    const focusDistance = view.focus ? Math.hypot(...view.focus.map((n, i) => Math.max(node.bounds.min[i] - n, 0, n - node.bounds.max[i]))) : 0;
    const item = { node, distance, focusDistance, pixels, near: distance <= settings.nearRadius + margin };
    let at = heap.length; heap.push(item);
    while (at > 0) { const parent = (at - 1) >> 1; if (better(heap[parent], item) >= 0) break; heap[at] = heap[parent]; at = parent; } heap[at] = item;
  };
  for (const root of children.get('') ?? []) push(root);
  const nodes: AdaptiveNode[] = []; let points = 0, budgetLimited = false;
  while (heap.length) {
    const item = heap[0], last = heap.pop()!;
    if (heap.length) {
      let at = 0; heap[0] = last;
      while (at * 2 + 1 < heap.length) { let child = at * 2 + 1; if (child + 1 < heap.length && better(heap[child + 1], heap[child]) > 0) child++; if (better(last, heap[child]) >= 0) break; heap[at] = heap[child]; at = child; } heap[at] = last;
    }
    if (points + item.node.count > settings.pointBudget) { budgetLimited = true; continue; }
    nodes.push(item.node); points += item.node.count;
    if (item.near || item.pixels >= settings.pixelThreshold * (previous.has(item.node.name) ? 0.9 : 1)) for (const child of children.get(item.node.name) ?? []) push(child);
  }
  return { nodes, points, budgetLimited };
}

function sameDataset(a: DatasetInfo, b: DatasetInfo) { return JSON.stringify(a) === JSON.stringify(b); }
function validBounds(box: CropBox) { return box && [box.min, box.max].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) && box.min.every((n, i) => n <= box.max[i]); }
export function validateAdaptiveHierarchy(value: AdaptiveHierarchy, dataset: DatasetInfo): AdaptiveHierarchy {
  if (!value || !sameDataset(value.dataset, dataset) || !Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > 100_000) throw new Error('Invalid display hierarchy');
  const seen = new Map<string, AdaptiveNode>(); let total = 0;
  for (const node of value.nodes) {
    if (!/^r[0-7]{0,24}$/.test(node.name) || seen.has(node.name) || !Number.isSafeInteger(node.count) || node.count < 0 || node.count > 65_536 || !validBounds(node.bounds)) throw new Error('Invalid native display node');
    seen.set(node.name, node); total += node.count;
  }
  if (!seen.has('r') || total !== dataset.totalPoints) throw new Error('Incomplete display hierarchy');
  for (const node of value.nodes) {
    if (node.name === 'r') {
      // Potree's cubic root encloses the occupied data bounds; they are not equal.
      if (node.bounds.min.some((n, i) => n > dataset.bounds.min[i] || node.bounds.max[i] < dataset.bounds.max[i])) throw new Error('Invalid root bounds');
      continue;
    }
    const parent = seen.get(node.name.slice(0, -1));
    if (!parent) throw new Error('Missing display ancestor');
    const octant = Number(node.name.at(-1));
    for (let i = 0; i < 3; i++) {
      const middle = (parent.bounds.min[i] + parent.bounds.max[i]) / 2, high = (octant & (4 >> i)) !== 0;
      if (node.bounds.min[i] !== (high ? middle : parent.bounds.min[i]) || node.bounds.max[i] !== (high ? parent.bounds.max[i] : middle)) throw new Error('Invalid octree bounds');
    }
  }
  return value;
}
export function validateAdaptivePayload(value: AdaptivePayload, dataset: DatasetInfo, node: AdaptiveNode): AdaptivePayload {
  if (!value || !sameDataset(value.dataset, dataset) || value.name !== node.name || value.count !== node.count || !Array.isArray(value.positions) || value.positions.length !== node.count * 3 || !value.positions.every(Number.isFinite) || !Array.isArray(value.colors) || value.colors.length !== node.count * 3 || !value.colors.every(n => Number.isInteger(n) && n >= 0 && n <= 255) || !Array.isArray(value.sourceIds) || value.sourceIds.length !== node.count * 2 || !value.sourceIds.every((n, i) => Number.isInteger(n) && n >= 0 && n <= (i % 2 === 0 ? 65535 : 0xffffffff)) || !Array.isArray(value.labels) || value.labels.length !== node.count || !value.labels.every(Number.isFinite)) throw new Error('Invalid exact native display payload');
  return value;
}
async function boundedBytes(fetcher: typeof fetch, url: string, signal: AbortSignal, limit: number, mime?: string): Promise<Uint8Array> {
  const response = await fetcher(url, { signal });
  const reject = async (message: string): Promise<never> => { await response.body?.cancel(); throw new Error(message); };
  if (!response.ok) return reject(`Display request failed (${response.status}); retry when the dataset server is available.`);
  if (mime && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== mime) return reject('Invalid binary display response MIME type');
  if (!response.body || Number(response.headers.get('content-length') ?? 0) > limit) return reject('Oversized or missing display response');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) { signal.throwIfAborted(); const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error('Display response exceeds limit'); chunks.push(value); }
  } finally { signal.removeEventListener('abort', cancel); try { await reader.cancel(); } finally { reader.releaseLock(); } }
  signal.throwIfAborted(); const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
async function boundedJson(fetcher: typeof fetch, url: string, signal: AbortSignal, limit: number): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await boundedBytes(fetcher, url, signal, limit)));
}

/** Single physical request lane, even when an aborted fetch ignores cancellation.
 * Only resident names/counts are retained here; payload ownership transfers to add().
 * Camera motion retains in-flight work; admission replans against the latest view.
 * Binding/configuration/disposal still invalidate outstanding responses.
 * Idle camera planning is throttled (not trailing-edge debounced) to 150ms;
 * an active serial lane keeps progressing during motion. Sub-10cm camera jitter
 * is ignored. retry is explicit: camera movement never spins on a failed request.
 */
export function createAdaptiveDisplay(callbacks: AdaptiveCallbacks, fetcher: typeof fetch = fetch) {
  let settings = { ...DEFAULT_ADAPTIVE_SETTINGS }, dataset: DatasetInfo | undefined, hierarchy: AdaptiveHierarchy | undefined, view: AdaptiveView | undefined;
  let disposed = false, generation = 0, busy = false, controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let signature = '', error: string | null = null, limited = false, desired: AdaptiveNode[] = [], planDirty = true;
  const resident = new Map<string, number>();
  const publish = () => callbacks.status({ loadedPoints: [...resident.values()].reduce((a, b) => a + b, 0), chunks: resident.size, pending: (dataset && !hierarchy ? 1 : desired.filter(n => !resident.has(n.name)).length), budgetLimited: limited, error });
  const evict = (keep: Set<string>) => {
    const names = [...resident.keys()].filter(name => !keep.has(name));
    if (!names.length) return;
    if (callbacks.removeMany) {
      callbacks.removeMany(names);
      for (const name of names) resident.delete(name);
    } else {
      for (const name of names) { callbacks.remove(name); resident.delete(name); }
    }
  };
  const invalidate = () => { generation++; planDirty = true; controller?.abort(); };
  const replan = () => {
    if (!planDirty) return;
    if (!hierarchy || !view) { desired = []; return; }
    const plan = planAdaptiveDisplay(hierarchy, view, settings, new Set(resident.keys())); desired = plan.nodes; limited = plan.budgetLimited; planDirty = false;
    evict(new Set(desired.map(n => n.name)));
  };
  const pump = () => {
    if (disposed || busy || error || !dataset) return;
    const bound = dataset, node = hierarchy ? desired.find(n => !resident.has(n.name)) : undefined;
    if (hierarchy && !node) { publish(); return; }
    const token = generation, abort = new AbortController(); controller = abort; busy = true; publish();
    const timeout = setTimeout(() => abort.abort(new Error('Display request timed out; retry.')), 20_000);
    void (async () => {
      try {
        if (!hierarchy) {
          const result = await boundedJson(fetcher, '/datasets/toronto3d/display-hierarchy', abort.signal, 8 * 1024 * 1024);
          if (disposed || token !== generation || abort.signal.aborted) return;
          hierarchy = validateAdaptiveHierarchy(result as AdaptiveHierarchy, bound); replan();
        } else if (node) {
          const query = new URLSearchParams({ revision: bound.revision, name: node.name, format: 'binary' });
          const result = await boundedBytes(fetcher, `/datasets/toronto3d/display-node?${query}`, abort.signal, ADAPTIVE_BINARY_LIMITS.responseBytes, ADAPTIVE_BINARY_MIME);
          if (disposed || token !== generation || abort.signal.aborted) return;
          const payload = decodeAdaptiveBinary(result, { dataset: bound, name: node.name, count: node.count });
          // A response can finish before the camera throttle fires. Evict against
          // the newest view before admission, never briefly publishing obsolete
          // chunks or exceeding the current additive point budget.
          replan();
          if (desired.some(n => n.name === node.name) && !resident.has(node.name)) {
            callbacks.add(payload); resident.set(node.name, node.count);
          }
        }
      } catch (failure) {
        if (!disposed && token === generation) error = failure instanceof Error ? failure.message : String(failure);
      } finally {
        clearTimeout(timeout); busy = false; if (controller === abort) controller = undefined;
        if (!disposed) { publish(); pump(); }
      }
    })();
  };
  return {
    bind(next: DatasetInfo) {
      if (disposed) return;
      if (next.id !== 'toronto3d' || !/^[a-f0-9]{64}$/.test(next.revision) || next.coordinates.units !== 'm' || next.coordinates.upAxis !== 'Z' || next.coordinates.handedness !== 'right' || !validBounds(next.bounds) || !Number.isSafeInteger(next.totalPoints) || next.totalPoints < 0) throw new Error('Invalid adaptive display dataset');
      invalidate(); if (timer) clearTimeout(timer); timer = undefined; evict(new Set()); dataset = structuredClone(next); hierarchy = undefined; desired = []; limited = false; error = null; publish(); pump();
    },
    update(next: AdaptiveView) {
      if (disposed) return; checkedView(next);
      const key = JSON.stringify([next.position.map(n => Math.round(n * 10)), next.focus?.map(n => Math.round(n * 10)), next.planes.map(p => p.map((n, i) => Math.round(n * (i === 3 ? 10 : 1000)))), next.viewportHeight, next.fovDegrees]);
      if (key === signature) return; signature = key; view = structuredClone(next); planDirty = true;
      if (!timer) timer = setTimeout(() => {
        timer = undefined; if (disposed) return;
        // Timer callbacks have no caller to catch renderer failures. Keep the
        // resident set and latch the failure until an explicit retry instead.
        try { if (!error) replan(); }
        catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
        publish(); pump();
      }, 150);
    },
    configure(next: Partial<AdaptiveSettings>) {
      if (disposed) return; const checked = checkedSettings({ ...settings, ...next });
      invalidate(); if (timer) clearTimeout(timer); timer = undefined; settings = checked; replan(); publish(); pump();
    },
    retry() { if (disposed) return; invalidate(); error = null; replan(); publish(); pump(); },
    dispose() { if (disposed) return; disposed = true; invalidate(); if (timer) clearTimeout(timer); timer = undefined; desired = []; evict(new Set()); },
  };
}
