import { setImmediate as yieldTurn } from 'node:timers/promises';
import { assertCropBox, TORONTO_SEMANTIC_LABELS, type Vec3 } from '@spatial/contracts';
import { recordBytes, type SemanticDiskIndex } from '../spatial/semantic-disk-index';
import { SpatialPageIndex, type PageKdNode, type SpatialBoxPoint } from '../spatial/spatial-page-index';

export interface ModelPointQuery {
  operation: 'nearest' | 'radius' | 'box'; position?: Vec3; radiusMeters?: number;
  bounds?: { min: Vec3; max: Vec3 }; label?: number | null; maxResults: number;
}
const vector = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7);
/** Copy and defend inputs before any asynchronous work; provider schemas are not authority. */
export function canonicalPerceptionQuery(args: ModelPointQuery, allowedLabels: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8]): ModelPointQuery {
  if (!args || !['nearest', 'radius', 'box'].includes(args.operation) ||
    Object.keys(args).some(k => !['operation', 'position', 'radiusMeters', 'bounds', 'label', 'maxResults'].includes(k)) ||
    !Number.isSafeInteger(args.maxResults) || args.maxResults < 1 || args.maxResults > 64 ||
    (args.label != null && (!Number.isInteger(args.label) || !allowedLabels.includes(args.label)))) throw new RangeError('Invalid spatial query');
  if (args.operation === 'box') {
    if (!args.bounds || Object.keys(args.bounds).sort().join(',') !== 'max,min' || !vector(args.bounds.min) || !vector(args.bounds.max) ||
      args.position !== undefined || args.radiusMeters !== undefined) throw new RangeError('Invalid spatial box');
    assertCropBox(args.bounds);
    return { ...args, bounds: { min: [...args.bounds.min] as Vec3, max: [...args.bounds.max] as Vec3 } };
  }
  if (!vector(args.position) || args.bounds !== undefined ||
    (args.operation === 'radius' ? !Number.isFinite(args.radiusMeters) || args.radiusMeters! < 0 || args.radiusMeters! > 1000 : args.radiusMeters !== undefined)) throw new RangeError('Invalid spatial position/radius');
  return { ...args, position: [...args.position] as Vec3 };
}
export function perceptionWitness({ source, ...point }: SpatialBoxPoint) {
  const key = { sourceFileId: source.sourceFileId, sourceRow: source.sourceRow };
  return { ...point, source, key, semanticType: TORONTO_SEMANTIC_LABELS[point.label as keyof typeof TORONTO_SEMANTIC_LABELS],
    selectReference: { kind: 'toronto-point' as const, key } };
}

/** Label-aware exact AABB observation using the same complete physical pages/BVH.
 * Unlike placement occupancy, every matching label (including ground) can be a witness.
 * Retained records are capped, not ranked; counts still cover the entire inclusive box.
 */
export async function queryPerceptionBox(spatial: SpatialPageIndex, disk: SemanticDiskIndex, args: ModelPointQuery, signal: AbortSignal, maxMilliseconds: number) {
  const bounds = args.bounds!, cap = args.maxResults, label = args.label ?? undefined;
  const started = performance.now(); let totalCount = 0, checkedPages = 0, checkedPoints = 0;
  const countsByLabel = Array<number>(9).fill(0), points: SpatialBoxPoint[] = [];
  const checkpoint = () => { signal.throwIfAborted(); if (performance.now() - started >= maxMilliseconds) throw new RangeError('Spatial query deadline exceeded'); };
  const intersects = (box: { min: Vec3; max: Vec3 }) => bounds.min.every((n, a) => n <= box.max[a] && bounds.max[a] >= box.min[a]);
  const visit = async (node: PageKdNode): Promise<void> => {
    checkpoint(); if (!intersects(node)) return;
    if (node.page === undefined) { await visit(node.left!); await visit(node.right!); return; }
    const page = disk.pages[node.page];
    if (label !== undefined && (!page.labels[label] || !intersects(page.labels[label]!))) return;
    const bytes = await disk.readPage(page, signal); checkedPages++; checkpoint();
    for (let n = 0; n < page.count; n++) {
      checkedPoints++; const at = n * recordBytes, category = bytes.readUInt32LE(at + 36);
      if (label !== undefined && category !== label) continue;
      const position: Vec3 = [bytes.readDoubleLE(at), bytes.readDoubleLE(at + 8), bytes.readDoubleLE(at + 16)];
      if (!position.every((v, a) => v >= bounds.min[a] && v <= bounds.max[a])) continue;
      totalCount++; countsByLabel[category]++;
      if (points.length < cap) points.push({ position, label: category,
        source: { sourceFileId: bytes.readUInt32LE(at + 24), sourceRow: bytes.readUInt32LE(at + 28), preparedRecordIndex: bytes.readUInt32LE(at + 32) },
        artifactRevision: spatial.binding.artifactRevision, frameId: 'toronto3d-local-v1', units: 'm' });
    }
    await yieldTurn(); checkpoint();
  };
  checkpoint(); await disk.check(signal);
  if (spatial.tree.root) await visit(spatial.tree.root);
  await disk.check(signal); checkpoint();
  return { complete: true, binding: spatial.binding, bounds, totalCount, countsByLabel, maxResults: cap, points,
    truncated: totalCount > points.length, statistics: { checkedPages, totalPages: disk.pages.length, checkedPoints, milliseconds: performance.now() - started } };
}
