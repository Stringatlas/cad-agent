import { decodePreparedNode, PREPARED_NODE_LIMITS, PREPARED_NODE_MIME, type PreparedNodePayload } from '@spatial/contracts';
import type { AdaptiveNode } from '../../viewer/adaptive-plan';
import type { PreparedScene, PreparedPoint } from './prepared-cloud-client';

async function bytes(path: string, signal: AbortSignal, max: number, mime: string): Promise<Uint8Array> {
  const response = await fetch(path, { signal, cache: 'no-store' });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== mime || !response.body || Number(response.headers.get('content-length') ?? 0) > max) {
    await response.body?.cancel(); throw new Error('Detail unavailable. Retry loading detail.');
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted(); const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new Error('Detail response exceeds limit');
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel(); reader.releaseLock(); }
  signal.throwIfAborted();
  const result = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
  return result;
}
export async function loadPreparedHierarchy(cloud: PreparedScene, signal: AbortSignal): Promise<AdaptiveNode[]> {
  const raw = await bytes(`/datasets/prepared/${encodeURIComponent(cloud.descriptor.id)}/display-hierarchy?revision=${cloud.revision}`, signal, 16 * 1024 * 1024, 'application/json');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as { cloud: PreparedScene; nodes: AdaptiveNode[] };
  if (JSON.stringify(value.cloud) !== JSON.stringify(cloud) || !Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > 100000) throw new Error('Stale or invalid detail hierarchy');
  const nodes = new Map<string, AdaptiveNode>(); let total = 0;
  for (const node of value.nodes) {
    if (!/^r[0-7]{0,24}$/.test(node.name) || nodes.has(node.name) || !Number.isSafeInteger(node.count) || node.count < 0 || node.count > PREPARED_NODE_LIMITS.points ||
      ![node.bounds?.min, node.bounds?.max].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) || node.bounds.min.some((n, a) => n > node.bounds.max[a])) throw new Error('Invalid detail node');
    nodes.set(node.name, node); total += node.count;
  }
  const root = nodes.get('r');
  if (!root || total !== cloud.totalPoints || root.bounds.min.some((n, a) => n > cloud.bounds.min[a] || root.bounds.max[a] < cloud.bounds.max[a])) throw new Error('Incomplete detail hierarchy');
  for (const node of nodes.values()) {
    if (node.name === 'r') continue;
    const parent = nodes.get(node.name.slice(0, -1)), octant = Number(node.name.at(-1));
    if (!parent) throw new Error('Missing detail ancestor');
    for (let a = 0; a < 3; a++) {
      const middle = (parent.bounds.min[a] + parent.bounds.max[a]) / 2, high = (octant & (4 >> a)) !== 0;
      if (node.bounds.min[a] !== (high ? middle : parent.bounds.min[a]) || node.bounds.max[a] !== (high ? parent.bounds.max[a] : middle)) throw new Error('Invalid detail bounds');
    }
  }
  return value.nodes;
}
export async function loadPreparedNode(cloud: PreparedScene, node: AdaptiveNode, signal: AbortSignal): Promise<PreparedNodePayload> {
  const query = new URLSearchParams({ revision: cloud.revision, name: node.name });
  const raw = await bytes(`/datasets/prepared/${encodeURIComponent(cloud.descriptor.id)}/display-node?${query}`, signal, PREPARED_NODE_LIMITS.responseBytes, PREPARED_NODE_MIME);
  const payload = decodePreparedNode(raw, { cloudId: cloud.descriptor.id, revision: cloud.revision, name: node.name, count: node.count });
  const d = cloud.descriptor;
  if (!!payload.labels !== !!d.semantics || !!payload.instances !== !!d.instances) throw new Error('Mismatched native attributes');
  const sources = new Map(d.sources.map(source => [source.id, source.points]));
  for (let i = 0; i < payload.count; i++) {
    if (!sources.has(payload.sourceIds[i * 2]) || payload.sourceIds[i * 2 + 1] >= sources.get(payload.sourceIds[i * 2])! ||
      payload.labels && !Object.hasOwn(d.semantics!.classes, String(payload.labels[i]))) throw new Error('Invalid native source identity');
    for (let axis = 0; axis < 3; axis++) {
      const p = payload.positions[i * 3 + axis];
      if (p < cloud.bounds.min[axis] - 0.002 || p > cloud.bounds.max[axis] + 0.002) throw new Error('Native point outside source bounds');
    }
  }
  return payload;
}
export function preparedNativePoint(cloud: PreparedScene, payload: PreparedNodePayload, index: number): PreparedPoint {
  if (!Number.isSafeInteger(index) || index < 0 || index >= payload.count || payload.cloudId !== cloud.descriptor.id || payload.revision !== cloud.revision) throw new Error('Invalid native point');
  const d = cloud.descriptor, label = payload.labels?.[index];
  return { cloudId: d.id, revision: cloud.revision, frameId: d.frameId, units: 'm', localOrigin: [...d.coordinates.localOrigin],
    sourceId: payload.sourceIds[index * 2], sourceRow: payload.sourceIds[index * 2 + 1], position: Array.from(payload.positions.subarray(index * 3, index * 3 + 3)),
    ...(label === undefined ? {} : { label }), type: label === undefined ? 'Unknown' : d.semantics?.classes[String(label)] ?? 'Unknown',
    ...(payload.instances ? { instanceId: payload.instances[index] } : {}) };
}
