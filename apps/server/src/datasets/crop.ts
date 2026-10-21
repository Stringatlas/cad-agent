import { createHash } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { assertCropSelection, containsCropPoint, intersectsCropNode, CROP_BATCH_POINTS, type CropBox, type CropSelection, type CropEvent, type CropStats, type DatasetInfo, type Vec3 } from '@spatial/contracts';

// Per-format/per-read safeguards, NOT total point, source-work or elapsed-time budgets.
export const CROP_LIMITS = Object.freeze({ chunkBytes: 64 * 1024, nodeBytes: 4 * 1024 * 1024, depth: 24, batchPoints: CROP_BATCH_POINTS });
interface Node { name: string; box: CropBox }
interface Chunk { root: Node; offset: number; size: number; expected?: readonly [number, number] }
interface Input {
  dataset: DatasetInfo; rootBox: CropBox; scale: Vec3; stride: number; first: Buffer; hierarchySize: number; payloadSize: number;
  readHierarchy: (offset: number, size: number) => Promise<Buffer>;
  readPayload: (offset: number, size: number) => Promise<Buffer>;
  /** Actual prepared adapters require provenance; synthetic legacy decoders may omit it. */
  requireSourceIds?: boolean;
  decode: (bytes: Buffer, index: number) => { positions: number[]; colors: number[]; sourceIds?: readonly number[]; label?: number };
}
function range(offset: number, size: number, limit: number) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > limit - size) throw new Error('Invalid crop payload range');
}
/** Sorted ranges: overlap/cycle detection, one small pair per visited node/chunk, never point-sized state. */
function addRange(ranges: [number, number][], offset: number, size: number) {
  let lo = 0, hi = ranges.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (ranges[mid][0] < offset) lo = mid + 1; else hi = mid; }
  if ((lo > 0 && ranges[lo - 1][1] > offset) || (lo < ranges.length && offset + size > ranges[lo][0])) throw new Error('Overlapping/cyclic crop ranges');
  ranges.splice(lo, 0, [offset, offset + size]);
}
/** Potree child bits: X=4, Y=2, Z=1. Nominal boxes; expansion only for pruning. */
export function childBox(box: CropBox, child: number): CropBox {
  const middle = box.min.map((v, i) => (v + box.max[i]) / 2);
  return { min: box.min.map((v, i) => child & (4 >> i) ? middle[i] : v) as unknown as Vec3,
    max: box.max.map((v, i) => child & (4 >> i) ? v : middle[i]) as unknown as Vec3 };
}

/** Pull-based traversal: downstream backpressure stops reads; closing/aborting stops subsequent work.
 * Includes every intersecting ancestor/descendant payload and nested proxy. Never samples.
 */
export async function* readFullResolutionCrop(input: Input, requested: CropSelection, signal?: AbortSignal): AsyncGenerator<CropEvent> {
  assertCropSelection(requested);
  const selection: CropSelection = JSON.parse(JSON.stringify(requested));
  const checkpoint = () => signal?.throwIfAborted();
  checkpoint();
  yield { type: 'start', dataset: input.dataset, purpose: 'display-crop', algorithm: 'potree-inclusive-volume-v2', selection };
  const stats = { count: 0, bytesRead: 0, scannedPoints: 0, hierarchyRecords: 0, hierarchyChunks: 0, payloadNodes: 0, maxDepth: 0 };
  const snapshot = (): CropStats => ({ ...stats });
  const pending: Chunk[] = [{ root: { name: 'r', box: input.rootBox }, offset: 0, size: input.first.length }];
  const chunkRanges: [number, number][] = [], payloadRanges: [number, number][] = [];
  const hash = createHash('sha256').update(JSON.stringify(selection));
  let sequence = 0;
  let provenance: boolean | undefined = input.requireSourceIds ? true : undefined;
  let semanticLabels: boolean | undefined;
  while (pending.length) {
    checkpoint(); await yieldTurn(); checkpoint();
    const chunk = pending.pop()!;
    range(chunk.offset, chunk.size, input.hierarchySize);
    if (!chunk.size || chunk.size % 22 || chunk.size > CROP_LIMITS.chunkBytes) throw new Error('Invalid crop hierarchy chunk');
    addRange(chunkRanges, chunk.offset, chunk.size);
    const bytes = chunk.offset === 0 ? input.first : await input.readHierarchy(chunk.offset, chunk.size);
    checkpoint();
    if (bytes.length !== chunk.size) throw new Error('Truncated crop hierarchy');
    stats.hierarchyChunks++; stats.bytesRead += bytes.length;
    const queue: Node[] = [chunk.root];
    const proxies: Chunk[] = [];
    for (let i = 0; i < bytes.length / 22; i++) {
      checkpoint();
      const node = queue[i];
      if (!node) throw new Error('Unreachable crop hierarchy record');
      const depth = node.name.length - 1;
      if (depth > CROP_LIMITS.depth) throw new Error('Unsupported crop hierarchy depth');
      stats.hierarchyRecords++; stats.maxDepth = Math.max(stats.maxDepth, depth);
      const at = i * 22, type = bytes[at], mask = bytes[at + 1], count = bytes.readUInt32LE(at + 2);
      const offset = Number(bytes.readBigUInt64LE(at + 6)), size = Number(bytes.readBigUInt64LE(at + 14));
      if (type > 2) throw new Error('Unknown crop node type');
      if (i === 0 && chunk.expected && (type === 2 || mask !== chunk.expected[0] || count !== chunk.expected[1])) throw new Error('Proxy/root disagreement');
      range(offset, size, type === 2 ? input.hierarchySize : input.payloadSize);
      const hit = intersectsCropNode(selection, node.box, input.scale);
      if (type === 2) {
        if (!size || size % 22 || size > CROP_LIMITS.chunkBytes) throw new Error('Invalid crop proxy');
        if (hit) proxies.push({ root: node, offset, size, expected: [mask, count] });
        continue;
      }
      if (size !== count * input.stride || (type === 1 && mask !== 0) || (type === 0 && mask === 0)) throw new Error('Invalid crop node');
      if (hit && count) {
        addRange(payloadRanges, offset, size); stats.payloadNodes++;
        // Even an enormous valid node is decoded in bounded, point-aligned reads.
        const readPoints = Math.floor(CROP_LIMITS.nodeBytes / input.stride);
        for (let start = 0; start < count; start += readPoints) {
          checkpoint();
          const length = Math.min(readPoints, count - start);
          const payload = await input.readPayload(offset + start * input.stride, length * input.stride);
          checkpoint();
          if (payload.length !== length * input.stride) throw new Error('Truncated crop payload');
          stats.bytesRead += payload.length;
          for (let block = 0; block < length; block += CROP_BATCH_POINTS) {
            await yieldTurn(); checkpoint();
            const positions: number[] = [], colors: number[] = [], sourceIds: number[] = [], labels: number[] = [];
            for (let j = block; j < Math.min(length, block + CROP_BATCH_POINTS); j++) {
              const point = input.decode(payload, j); stats.scannedPoints++;
              const hasSourceIds = point.sourceIds !== undefined;
              if (provenance === undefined) provenance = hasSourceIds;
              if (hasSourceIds !== provenance || (hasSourceIds && (!Array.isArray(point.sourceIds) || point.sourceIds.length !== 2 ||
                  !Number.isInteger(point.sourceIds[0]) || point.sourceIds[0] < 1 || point.sourceIds[0] > 4 ||
                  !Number.isSafeInteger(point.sourceIds[1]) || point.sourceIds[1] < 0 || point.sourceIds[1] > 0xffffffff))) throw new Error('Invalid/missing crop provenance');
              const hasLabel = point.label !== undefined;
              if (semanticLabels === undefined) semanticLabels = hasLabel;
              if (hasLabel !== semanticLabels || (hasLabel && (!Number.isInteger(point.label) || point.label! < 0 || point.label! > 8))) throw new Error('Invalid/missing crop labels');
              if (containsCropPoint(selection, point.positions)) {
                positions.push(...point.positions); colors.push(...point.colors);
                if (point.sourceIds) sourceIds.push(...point.sourceIds);
                if (hasLabel) labels.push(point.label!);
                stats.count++;
              }
            }
            // Empty batches carry progress/provenance mode and let consumers stop a source-expensive query.
            const sample = { positions, colors, ...(provenance ? { sourceIds } : {}), ...(semanticLabels ? { labels } : {}) };
            hash.update(JSON.stringify(sample));
            yield { type: 'batch', sequence: sequence++, ...sample, stats: snapshot() };
          }
        }
      }
      for (let child = 0; child < 8; child++) if (mask & (1 << child)) {
        if (queue.length >= Math.floor(CROP_LIMITS.chunkBytes / 22)) throw new Error('Missing/excessive crop children');
        queue.push({ name: node.name + child, box: childBox(node.box, child) });
      }
    }
    if (queue.length !== bytes.length / 22) throw new Error('Missing crop children');
    // Depth-first proxy traversal bounds pending memory to hierarchy width per level.
    pending.push(...proxies.reverse());
  }
  checkpoint();
  yield { type: 'end', complete: true, stats: snapshot(), sampleHash: hash.digest('hex') };
}
