import { createAdaptiveLoader } from '../../../viewer/adaptive-loader';
import { DEFAULT_ADAPTIVE_SETTINGS, type AdaptiveNode, type AdaptiveStats } from '../../../viewer/adaptive-plan';
export { planAdaptiveDisplay, DEFAULT_ADAPTIVE_SETTINGS } from '../../../viewer/adaptive-plan';
export type { AdaptiveNode, AdaptiveView, AdaptiveSettings, AdaptiveStats, AdaptivePlan } from '../../../viewer/adaptive-plan';
import { ADAPTIVE_BINARY_LIMITS, ADAPTIVE_BINARY_MIME, decodeAdaptiveBinary, type CropBox, type DatasetInfo } from '@spatial/contracts';

export interface AdaptiveHierarchy { dataset: DatasetInfo; nodes: AdaptiveNode[] }
export interface AdaptivePayload { dataset: DatasetInfo; name: string; count: number; positions: ArrayLike<number>; colors: ArrayLike<number>; sourceIds: ArrayLike<number>; labels: ArrayLike<number> }
export interface AdaptiveCallbacks {
  add(payload: AdaptivePayload): void;
  remove(name: string): void;
  /** Atomic eviction: throwing must leave the previous rendered set intact. */
  removeMany?(names: readonly string[]): void;
  status(stats: AdaptiveStats): void;
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

/** Toronto protocol/validation adapter over the shared user/capture scheduler. */
export function createAdaptiveDisplay(callbacks: AdaptiveCallbacks, fetcher: typeof fetch = fetch) {
  let dataset: DatasetInfo | undefined;
  const loader = createAdaptiveLoader<AdaptivePayload>({
    enabled: false, settings: { ...DEFAULT_ADAPTIVE_SETTINGS },
    hierarchy: async signal => {
      const bound = dataset!;
      return validateAdaptiveHierarchy(await boundedJson(fetcher, '/datasets/toronto3d/display-hierarchy', signal, 8 * 1024 * 1024) as AdaptiveHierarchy, bound).nodes;
    },
    load: async (node, signal) => {
      const bound = dataset!, query = new URLSearchParams({ revision: bound.revision, name: node.name, format: 'binary' });
      const bytes = await boundedBytes(fetcher, `/datasets/toronto3d/display-node?${query}`, signal, ADAPTIVE_BINARY_LIMITS.responseBytes, ADAPTIVE_BINARY_MIME);
      return decodeAdaptiveBinary(bytes, { dataset: bound, name: node.name, count: node.count });
    },
    add: callbacks.add,
    remove: names => { if (callbacks.removeMany) callbacks.removeMany(names); else for (const name of names) callbacks.remove(name); },
    status: callbacks.status,
  });
  return {
    ...loader,
    bind(next: DatasetInfo) {
      if (next.id !== 'toronto3d' || !/^[a-f0-9]{64}$/.test(next.revision) || next.coordinates.units !== 'm' || next.coordinates.upAxis !== 'Z' || next.coordinates.handedness !== 'right' || !validBounds(next.bounds) || !Number.isSafeInteger(next.totalPoints) || next.totalPoints < 0) throw new Error('Invalid adaptive display dataset');
      dataset = structuredClone(next); loader.reset();
    },
  };
}
