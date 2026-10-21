import type { PointLod, PointObservation } from '@spatial/contracts';

export type ObservationLoader = (purpose: 'display' | 'harness', lod: PointLod, signal: AbortSignal) => Promise<PointObservation>;
const MAX_RESPONSE = 16 * 1024 * 1024;

export const fetchObservation: ObservationLoader = async (purpose, lod, signal) => {
  const query = new URLSearchParams({ purpose, budget: String(lod.budget), depth: String(lod.depth) });
  const response = await fetch(`/datasets/toronto3d/observation?${query}`, { signal });
  if (!response.ok) throw new Error(`Dataset request failed (${response.status}). Check prepared data and local server; retry if busy.`);
  if (Number(response.headers.get('content-length') ?? 0) > MAX_RESPONSE || !response.body) throw new Error('Oversized or missing response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE) throw new Error('Response exceeds limit');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const value = JSON.parse(new TextDecoder().decode(bytes)) as PointObservation;
  if (!Number.isSafeInteger(value.count) || value.count < 0 || value.count > Math.min(lod.budget, purpose === 'display' ? 100_000 : 4096) ||
      value.purpose !== purpose || value.lod?.budget !== lod.budget || value.lod?.depth !== lod.depth ||
      !Array.isArray(value.positions) || value.positions.length !== value.count * 3 || !value.positions.every(Number.isFinite) ||
      !Array.isArray(value.colors) || value.colors.length !== value.count * 3 || !value.colors.every(n => Number.isInteger(n) && n >= 0 && n <= 255) ||
      !Array.isArray(value.sourceIds) || value.sourceIds.length !== value.count * 2 || !Array.isArray(value.labels) || value.labels.length !== value.count ||
      value.dataset?.id !== 'toronto3d' || value.dataset.coordinates?.units !== 'm' || value.dataset.coordinates.upAxis !== 'Z' || value.dataset.coordinates.handedness !== 'right' ||
      JSON.stringify(value.dataset.coordinates.localOrigin) !== '[627285,4841948,0]' ||
      ![value.dataset.bounds?.min, value.dataset.bounds?.max].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) {
    throw new Error('Invalid bounded observation response');
  }
  return value;
};

/** Separate instances own separate cancellation, settings and outputs. No shared display/harness state. */
export function createObservationChannel(purpose: 'display' | 'harness', publish: (sample: PointObservation) => void, loader: ObservationLoader = fetchObservation) {
  let generation = 0;
  let controller: AbortController | undefined;
  let disposed = false;
  return {
    async load(lod: PointLod, progressive = false): Promise<void> {
      if (disposed) return;
      const token = ++generation;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const settings = { ...lod };
      try {
        if (progressive && purpose === 'display' && lod.depth > 0) {
          const root = await loader(purpose, { budget: Math.min(lod.budget, 10_000), depth: 0 }, current.signal);
          if (token !== generation || disposed) return;
          publish(root);
        }
        const sample = await loader(purpose, settings, current.signal);
        if (token === generation && !disposed) publish(sample);
      } catch (error) {
        if (token === generation && !disposed && !current.signal.aborted) throw error;
      }
    },
    dispose() { disposed = true; generation++; controller?.abort(); },
  };
}
