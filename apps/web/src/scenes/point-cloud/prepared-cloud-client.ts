export interface PreparedScene {
  descriptor: {
    id: string; frameId: string;
    coordinates: { units: 'm'; handedness: 'right'; upAxis: 'Z'; localOrigin: number[] };
    sources: { id: number; name: string; points: number }[];
    semantics?: { attribute: string; classes: Record<string, string> };
    instances?: { attribute: string; type: 'int32'; unassigned: number };
  };
  revision: string; bounds: { min: number[]; max: number[] }; totalPoints: number;
  capabilities: { boundedSample: true; adaptiveDisplay?: boolean; semanticLabels: boolean; instanceLabels?: boolean; fullResolution: false; editing: false };
}
export interface PreparedSample {
  cloud: PreparedScene; count: number; positions: number[]; colors: number[]; sourceIds: number[];
  labels?: number[]; instances?: number[];
}
export interface PreparedPoint {
  cloudId: string; revision: string; frameId: string; units: 'm'; localOrigin: number[];
  sourceId: number; sourceRow: number; position: number[]; label?: number; type: string; instanceId?: number;
}
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
async function get(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 429 ? 'Scene busy. Retry shortly.' : 'Scene unavailable. Retry loading.');
  return response.json();
}
export async function loadPreparedScenes(signal: AbortSignal): Promise<{ id: string; name: string }[]> {
  const result = await get('/datasets/prepared', signal) as { scenes?: { id: string; name: string }[] };
  if (!Array.isArray(result.scenes) || result.scenes.length > 100 || result.scenes.some(s => !identifier.test(s.id) || typeof s.name !== 'string') ||
    new Set(result.scenes.map(s => s.id)).size !== result.scenes.length) throw new Error('Invalid scene inventory.');
  return result.scenes;
}
function scene(value: PreparedScene, id: string): PreparedScene {
  const d = value?.descriptor, c = d?.coordinates;
  const triple = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (d?.id !== id || !identifier.test(d.frameId) || !/^[a-f0-9]{64}$/.test(value.revision) || c?.units !== 'm' || c.handedness !== 'right' || c.upAxis !== 'Z' ||
    !triple(c.localOrigin) || !triple(value.bounds?.min) || !triple(value.bounds?.max) || value.bounds.min.some((n, a) => n >= value.bounds.max[a]) ||
    value.capabilities?.editing !== false || value.capabilities.fullResolution !== false || !Array.isArray(d.sources) || !d.sources.length ||
    (d.instances && (d.instances.type !== 'int32' || !Number.isInteger(d.instances.unassigned)))) throw new Error('Invalid scene binding.');
  return value;
}
export async function loadPreparedSample(id: string, budget: number, depth: number, signal: AbortSignal): Promise<PreparedSample> {
  if (!identifier.test(id)) throw new Error('Invalid scene ID.');
  const path = `/datasets/prepared/${encodeURIComponent(id)}`;
  const info = scene(await get(path, signal) as PreparedScene, id);
  const params = new URLSearchParams({ revision: info.revision, budget: String(budget), depth: String(depth) });
  const sample = await get(`${path}/sample?${params}`, signal) as PreparedSample;
  scene(sample.cloud, id);
  if (sample.cloud.revision !== info.revision || JSON.stringify(sample.cloud.descriptor) !== JSON.stringify(info.descriptor) ||
    !Number.isSafeInteger(sample.count) || sample.count < 0 || sample.count > budget || sample.count > 100000 ||
    !Array.isArray(sample.positions) || sample.positions.length !== sample.count * 3 || sample.positions.some(n => !Number.isFinite(n)) ||
    !Array.isArray(sample.colors) || sample.colors.length !== sample.count * 3 || sample.colors.some(n => !Number.isInteger(n) || n < 0 || n > 255) ||
    !Array.isArray(sample.sourceIds) || sample.sourceIds.length !== sample.count * 2 || sample.sourceIds.some(n => !Number.isSafeInteger(n) || n < 0) ||
    (info.descriptor.semantics && (!sample.labels || sample.labels.length !== sample.count || sample.labels.some(n => !Number.isInteger(n) || !Object.hasOwn(info.descriptor.semantics!.classes, String(n))))) ||
    (info.descriptor.instances && (!sample.instances || sample.instances.length !== sample.count || sample.instances.some(n => !Number.isInteger(n) || n < -2147483648 || n > 2147483647)))) throw new Error('Invalid or stale scene sample.');
  for (let i = 0; i < sample.count; i++) {
    const source = info.descriptor.sources.find(s => s.id === sample.sourceIds[i * 2]);
    if (!source || sample.sourceIds[i * 2 + 1] >= source.points) throw new Error('Invalid point source.');
  }
  return sample;
}
/** Original CPU record; GPU Float32 coordinates never become authoritative references. */
export function preparedPoint(sample: PreparedSample, index: number): PreparedPoint {
  if (!Number.isSafeInteger(index) || index < 0 || index >= sample.count) throw new Error('Invalid sample point.');
  const { descriptor: d, revision } = sample.cloud, label = sample.labels?.[index];
  return { cloudId: d.id, revision, frameId: d.frameId, units: 'm', localOrigin: [...d.coordinates.localOrigin],
    sourceId: sample.sourceIds[index * 2], sourceRow: sample.sourceIds[index * 2 + 1], position: sample.positions.slice(index * 3, index * 3 + 3),
    ...(label === undefined ? {} : { label }), type: label === undefined ? 'Unknown' : d.semantics?.classes[String(label)] ?? 'Unknown',
    ...(sample.instances ? { instanceId: sample.instances[index] } : {}) };
}
