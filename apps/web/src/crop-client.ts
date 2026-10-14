import { assertCropSelection, containsCropPoint, CROP_BATCH_POINTS, CROP_LINE_BYTES, type CropSelection, type CropEvent, type CropStats } from '@spatial/contracts';
export type CropLoader = (selection: CropSelection, signal: AbortSignal, publish: (event: CropEvent) => Promise<void> | void) => Promise<void>;
/** Bounded NDJSON parser; never combines full response or retains prior batches. */
export const fetchCrop: CropLoader = async (selection, signal, publish) => {
  assertCropSelection(selection);
  const query = new URLSearchParams();
  ['X', 'Y', 'Z'].forEach((axis, i) => { query.set('min' + axis, String(selection.min[i])); query.set('max' + axis, String(selection.max[i])); });
  if (selection.planes) query.set('planes', JSON.stringify(selection.planes));
  const response = await fetch(`/datasets/toronto3d/crop?${query}`, { signal });
  if (!response.ok) throw new Error(`Full-resolution request failed (${response.status}); retry if busy. No downsampling.`);
  if (!response.body) throw new Error('Missing full-resolution stream');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', started = false, ended = false, sequence = 0, count = 0;
  let previous: CropStats | undefined, provenance: boolean | undefined;
  const statsValid = (stats: CropStats) => stats && ['count', 'bytesRead', 'scannedPoints', 'hierarchyRecords', 'hierarchyChunks', 'payloadNodes', 'maxDepth'].every(key => {
    const k = key as keyof CropStats;
    return Number.isSafeInteger(stats[k]) && stats[k] >= 0 && (!previous || stats[k] >= previous[k]);
  }) && stats.count === count && stats.count <= stats.scannedPoints;
  const consume = async (line: string) => {
    signal.throwIfAborted();
    if (line.length > CROP_LINE_BYTES || ended) throw new Error('Invalid full-resolution stream framing');
    const event = JSON.parse(line) as CropEvent;
    if (event.type === 'error') throw new Error('Full resolution incomplete: data/server/resource failure. No reduced sample returned.');
    if (!started) {
      if (event.type !== 'start' || event.purpose !== 'display-crop' || event.algorithm !== 'potree-inclusive-volume-v2' ||
          JSON.stringify(event.selection) !== JSON.stringify(selection) || event.dataset?.id !== 'toronto3d' ||
          typeof event.dataset.revision !== 'string' || !/^[a-f0-9]{64}$/.test(event.dataset.revision) ||
          event.dataset.coordinates?.units !== 'm' || event.dataset.coordinates.upAxis !== 'Z' || event.dataset.coordinates.handedness !== 'right' ||
          JSON.stringify(event.dataset.coordinates.localOrigin) !== '[627285,4841948,0]') throw new Error('Invalid full-resolution start');
      started = true;
    } else if (event.type === 'batch') {
      if (event.sequence !== sequence++ || !Array.isArray(event.positions) || event.positions.length % 3 || event.positions.length > CROP_BATCH_POINTS * 3 ||
          !event.positions.every(Number.isFinite) || !Array.isArray(event.colors) || event.colors.length !== event.positions.length ||
          !event.colors.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error('Invalid full-resolution batch');
      const hasSourceIds = event.sourceIds !== undefined;
      if (provenance === undefined) provenance = hasSourceIds;
      if (hasSourceIds !== provenance || (hasSourceIds && (!Array.isArray(event.sourceIds) || event.sourceIds.length !== event.positions.length / 3 * 2 ||
          !event.sourceIds.every((n, i) => Number.isSafeInteger(n) && n >= (i % 2 ? 0 : 1) && n <= (i % 2 ? 0xffffffff : 4))))) throw new Error('Invalid/missing full-resolution provenance');
      for (let i = 0; i < event.positions.length; i += 3) if (!containsCropPoint(selection, event.positions.slice(i, i + 3))) throw new Error('Point outside selected volume');
      count += event.positions.length / 3;
      if (!statsValid(event.stats)) throw new Error('Invalid full-resolution progress');
      previous = event.stats;
    } else if (event.type === 'end') {
      if (event.complete !== true || !statsValid(event.stats) || !/^[a-f0-9]{64}$/.test(event.sampleHash)) throw new Error('Invalid full-resolution completion');
      ended = true;
    } else throw new Error('Invalid full-resolution event');
    await publish(event); signal.throwIfAborted();
  };
  const consumeText = async (text: string) => {
    let offset = 0;
    while (offset < text.length) {
      const newline = text.indexOf('\n', offset), end = newline < 0 ? text.length : newline;
      if (buffer.length + end - offset > CROP_LINE_BYTES) throw new Error('Full-resolution event exceeds per-batch buffer limit');
      buffer += text.slice(offset, end); offset = end + 1;
      if (newline >= 0) { await consume(buffer); buffer = ''; }
    }
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) { await consumeText(decoder.decode()); break; }
      // Fetch owns transport chunk allocation; do not duplicate a giant chunk as one string.
      for (let offset = 0; offset < value.length; offset += 64 * 1024) {
        signal.throwIfAborted();
        await consumeText(decoder.decode(value.subarray(offset, offset + 64 * 1024), { stream: true }));
      }
    }
    if (buffer || !started || !ended) throw new Error('Full-resolution stream interrupted; selection incomplete');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
};

/** Stale events/errors cannot publish even when transport ignores cancellation. */
export function createCropChannel(publish: (event: CropEvent) => Promise<void> | void, loader: CropLoader = fetchCrop) {
  let generation = 0, disposed = false;
  let controller: AbortController | undefined;
  const cancel = () => { generation++; controller?.abort(); };
  return {
    cancel,
    async load(requested: CropSelection) {
      if (disposed) return;
      assertCropSelection(requested); cancel(); const token = generation;
      const selection: CropSelection = JSON.parse(JSON.stringify(requested));
      const current = new AbortController(); controller = current;
      try {
        await loader(selection, current.signal, async event => { if (!disposed && token === generation && !current.signal.aborted) await publish(event); });
      } catch (error) { if (!disposed && token === generation && !current.signal.aborted) throw error; }
    },
    dispose() { disposed = true; cancel(); },
  };
}
