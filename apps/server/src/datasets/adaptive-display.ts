import { setImmediate as yieldTurn } from 'node:timers/promises';
import type { CropBox, DatasetInfo } from '@spatial/contracts';
import { childBox, CROP_LIMITS } from './crop';

/** Fixed native-display budgets; no sampling or partial-success catalog. */
export const DISPLAY_LIMITS = Object.freeze({ nodes: 100_000, hierarchyBytes: 8 * 1024 * 1024, chunks: 10_000,
  nodePoints: 65_536, nodeBytes: 4 * 1024 * 1024, responseBytes: 16 * 1024 * 1024, deadlineMs: 15_000 });
export interface DisplayNode { name: string; count: number; bounds: CropBox }
export interface NativeDisplayNode extends DisplayNode { offset: number; size: number }
export interface DisplayHierarchy { dataset: DatasetInfo; nodes: DisplayNode[] }
export interface DisplayPayload { dataset: DatasetInfo; name: string; count: number; positions: number[]; colors: number[]; sourceIds: number[]; labels: number[] }
export function parseDisplayRequest(query: URLSearchParams): { revision: string; name: string; format?: 'binary' } {
  const keys = [...query.keys()];
  const revision = query.get('revision') ?? '', name = query.get('name') ?? '';
  const binary = query.has('format');
  if (keys.length !== (binary ? 3 : 2) || new Set(keys).size !== keys.length || keys.some(k => !['revision', 'name', 'format'].includes(k)) || (binary && query.get('format') !== 'binary') || !/^[a-f0-9]{64}$/.test(revision) || !/^r[0-7]{0,24}$/.test(name)) throw new RangeError('Invalid native display query');
  return { revision, name, ...(binary ? { format: 'binary' as const } : {}) };
}
function checkedRange(offset: number, size: number, limit: number) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > limit - size) throw new Error('Invalid native display range');
}
function disjoint(ranges: [number, number][]) {
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((r, i) => i > 0 && r[0] < ranges[i - 1][1])) throw new Error('Overlapping native display ranges');
}
/** Complete additive octree. Proxies are replaced by their native root, never duplicated. */
export async function readDisplayHierarchy(input: { first: Buffer; rootBox: CropBox; hierarchySize: number; payloadSize: number; stride: number; totalPoints: number;
  readHierarchy: (offset: number, size: number) => Promise<Buffer> }, signal?: AbortSignal): Promise<NativeDisplayNode[]> {
  const pending = [{ name: 'r', bounds: input.rootBox, offset: 0, size: input.first.length, expected: undefined as undefined | [number, number] }];
  const visited = new Set<number>(), chunks: [number, number][] = [], payloads: [number, number][] = [], nodes: NativeDisplayNode[] = [];
  let work = 0, total = 0, bytesRead = 0;
  while (pending.length) {
    signal?.throwIfAborted(); await yieldTurn(); signal?.throwIfAborted();
    const chunk = pending.pop()!;
    checkedRange(chunk.offset, chunk.size, input.hierarchySize);
    if (!chunk.size || chunk.size % 22 || chunk.size > CROP_LIMITS.chunkBytes || visited.has(chunk.offset) || visited.size >= DISPLAY_LIMITS.chunks) throw new Error('Invalid native hierarchy chunk');
    visited.add(chunk.offset); chunks.push([chunk.offset, chunk.offset + chunk.size]); bytesRead += chunk.size;
    if (bytesRead > DISPLAY_LIMITS.hierarchyBytes) throw new Error('Native hierarchy budget exceeded');
    const bytes = chunk.offset === 0 ? input.first : await input.readHierarchy(chunk.offset, chunk.size);
    signal?.throwIfAborted();
    if (bytes.length !== chunk.size) throw new Error('Truncated native hierarchy');
    const queue = [{ name: chunk.name, bounds: chunk.bounds }];
    for (let i = 0; i < bytes.length / 22; i++) {
      const node = queue[i];
      if (!node || node.name.length > 25 || ++work > DISPLAY_LIMITS.nodes + DISPLAY_LIMITS.chunks) throw new Error('Native hierarchy work limit exceeded');
      const at = i * 22, type = bytes[at], mask = bytes[at + 1], count = bytes.readUInt32LE(at + 2);
      const offset = Number(bytes.readBigUInt64LE(at + 6)), size = Number(bytes.readBigUInt64LE(at + 14));
      if (type > 2) throw new Error('Invalid native node type');
      checkedRange(offset, size, type === 2 ? input.hierarchySize : input.payloadSize);
      if (i === 0 && chunk.expected && (type === 2 || mask !== chunk.expected[0] || count !== chunk.expected[1])) throw new Error('Native proxy disagreement');
      if (type === 2) {
        if (pending.length >= DISPLAY_LIMITS.chunks) throw new Error('Native proxy budget exceeded');
        pending.push({ ...node, offset, size, expected: [mask, count] }); continue;
      }
      if (size !== count * input.stride || (type === 1 && mask !== 0) || (type === 0 && mask === 0) || count > DISPLAY_LIMITS.nodePoints || size > DISPLAY_LIMITS.nodeBytes || nodes.length >= DISPLAY_LIMITS.nodes) throw new Error('Native node exceeds limits');
      nodes.push({ ...node, count, offset, size }); total += count;
      if (size) payloads.push([offset, offset + size]);
      for (let child = 0; child < 8; child++) if (mask & (1 << child)) queue.push({ name: node.name + child, bounds: childBox(node.bounds, child) });
    }
    if (queue.length !== bytes.length / 22) throw new Error('Missing native children');
  }
  disjoint(chunks); disjoint(payloads);
  if (total !== input.totalPoints) throw new Error('Incomplete native hierarchy');
  return nodes.sort((a, b) => a.name.localeCompare(b.name));
}
