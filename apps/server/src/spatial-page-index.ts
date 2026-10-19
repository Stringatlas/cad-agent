import { setImmediate as yieldTurn } from 'node:timers/promises';
import { assertCropBox, type CropBox, type ModelAreaOfInterest, type Vec3 } from '@spatial/contracts';
import { SemanticArtifact, requireData } from './semantic-artifact';
import { getSemanticDiskIndex, pagePoints, recordBytes, type SemanticDiskIndex, type SemanticDiskPage } from './semantic-disk-index';

export interface PageKdNode {
  readonly min: Vec3; readonly max: Vec3;
  readonly page?: number; readonly left?: PageKdNode; readonly right?: PageKdNode;
}
export interface PageKdTree { readonly root?: PageKdNode; readonly pageCount: number; readonly totalPoints: number }
const vector = (v: readonly number[]): Vec3 => Object.freeze([v[0], v[1], v[2]]) as Vec3;

/** Pure, median-split page KD-tree/BVH: leaves are COMPLETE physical disk pages, not point samples.
 * All-label bounds are unions of every nonempty label, including Unclassified.
 * Memory scales with page count (~19k leaves for 78M points), never point count.
 */
export function buildPageKdTree(pages: readonly SemanticDiskPage[], totalPoints: number): PageKdTree {
  if (!Number.isSafeInteger(totalPoints) || totalPoints < 0 || totalPoints >= 0xffffffff ||
    pages.length !== Math.ceil(totalPoints / pagePoints) || pages.length > 65536) throw new RangeError('Invalid page tree coverage/budget');
  const leaves = pages.map((p, i) => {
    requireData(p.start === i * pagePoints && p.count === Math.min(pagePoints, totalPoints - p.start) && p.labels.length === 9, 'Incomplete page tree coverage');
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; let count = 0;
    for (const label of p.labels) if (label) {
      requireData(Number.isSafeInteger(label.count) && label.count > 0 && label.min.length === 3 && label.max.length === 3 &&
        [...label.min, ...label.max].every(Number.isFinite) && label.min.every((n, a) => n <= label.max[a]), 'Invalid page tree bounds');
      count += label.count;
      for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], label.min[a]); max[a] = Math.max(max[a], label.max[a]); }
    }
    requireData(count === p.count, 'Incomplete all-label page bounds');
    return Object.freeze({ min: vector(min), max: vector(max), page: i });
  });
  const split = (nodes: PageKdNode[]): PageKdNode | undefined => {
    if (nodes.length <= 1) return nodes[0];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const n of nodes) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], n.min[a]); max[a] = Math.max(max[a], n.max[a]); }
    let axis = 0; for (let a = 1; a < 3; a++) if (max[a] - min[a] > max[axis] - min[axis]) axis = a;
    nodes.sort((a, b) => (a.min[axis] / 2 + a.max[axis] / 2) - (b.min[axis] / 2 + b.max[axis] / 2) || a.page! - b.page!);
    const middle = Math.floor(nodes.length / 2);
    return Object.freeze({ min: vector(min), max: vector(max), left: split(nodes.slice(0, middle)), right: split(nodes.slice(middle)) });
  };
  return Object.freeze({ root: split(leaves), pageCount: pages.length, totalPoints });
}

export interface SpatialQueryOptions {
  readonly label?: number;
  readonly signal?: AbortSignal;
  readonly maxPages?: number;
  readonly maxMilliseconds?: number;
}
export interface SpatialPoint {
  readonly position: Vec3; readonly distanceMeters: number; readonly label: number;
  readonly source: { readonly sourceFileId: number; readonly sourceRow: number; readonly preparedRecordIndex: number };
  readonly artifactRevision: string; readonly frameId: 'toronto3d-local-v1'; readonly units: 'm';
}
export interface SpatialQueryStats { readonly checkedPages: number; readonly totalPages: number; readonly checkedPoints: number; readonly milliseconds: number }
interface SpatialResult { readonly complete: true; readonly binding: SpatialPageIndex['binding']; readonly statistics: SpatialQueryStats }
export interface SpatialNearestResult extends SpatialResult { readonly point: SpatialPoint | null }
export interface SpatialRadiusResult extends SpatialResult {
  /** Full exact match count; retained points are a deterministic capped subset, NOT the closest k. */
  readonly totalCount: number; readonly truncated: boolean; readonly maxResults: number; readonly points: readonly SpatialPoint[];
}
export type SpatialBoxPoint = Omit<SpatialPoint, 'distanceMeters'>;
export interface SpatialBoxResult extends SpatialResult {
  readonly bounds: CropBox; readonly totalCount: number; readonly countsByLabel: readonly number[];
  readonly supportingGroundCount: number; readonly obstructionCount: number;
  /** Capped obstruction witnesses only; counts always cover the full inclusive volume. */
  readonly points: readonly SpatialBoxPoint[]; readonly truncated: boolean;
}
export interface SpatialAoiResult extends SpatialResult {
  readonly totalCount: number; readonly countsByLabel: readonly number[];
  /** Original-source witnesses ordered by source key; counts cover the full XY footprint at every height. */
  readonly points: readonly SpatialBoxPoint[]; readonly truncated: boolean;
}
const lowerDistance = (q: Vec3, box: { min: Vec3; max: Vec3 }) => Math.hypot(...q.map((v, a) => Math.max(box.min[a] - v, v - box.max[a], 0)));
const sourceOrder = (a: SpatialBoxPoint, b: SpatialBoxPoint) => a.source.preparedRecordIndex - b.source.preparedRecordIndex ||
  a.source.sourceFileId - b.source.sourceFileId || a.source.sourceRow - b.source.sourceRow;

/** Read-only ORIGINAL-source queries. Not an override/effective-position index or independent verifier.
 * Every error, budget expiry, abort or identity change rejects: no partial nearest/clearance success.
 * Caller owns snapshot lifetime. Create once and reuse; no 78M-point in-memory KD-tree is allocated.
 */
export class SpatialPageIndex {
  readonly tree: PageKdTree;
  readonly binding: { readonly artifactRevision: string; readonly indexHash: string; readonly sourceHash: string;
    readonly frameId: 'toronto3d-local-v1'; readonly units: 'm'; readonly coordinates: SemanticArtifact['dataset']['coordinates'] };
  private constructor(private readonly snapshot: SemanticArtifact, private readonly disk: SemanticDiskIndex) {
    this.tree = buildPageKdTree(disk.pages, disk.totalPoints);
    this.binding = Object.freeze({ artifactRevision: snapshot.dataset.revision, indexHash: disk.hash, sourceHash: disk.sourceHash,
      frameId: 'toronto3d-local-v1', units: 'm', coordinates: snapshot.dataset.coordinates });
  }
  static async create(snapshot: SemanticArtifact, disk: SemanticDiskIndex, signal?: AbortSignal): Promise<SpatialPageIndex> {
    signal?.throwIfAborted();
    requireData(disk.revision === snapshot.dataset.revision && disk.totalPoints === snapshot.dataset.totalPoints &&
      (await getSemanticDiskIndex(snapshot, signal)).index.hash === disk.hash, 'Spatial index is not canonical for snapshot');
    await snapshot.check(signal); await disk.check(signal);
    const result = new SpatialPageIndex(snapshot, disk);
    await snapshot.check(signal); await disk.check(signal); Object.freeze(result); return result;
  }
  async nearest(position: Vec3, options: SpatialQueryOptions = {}): Promise<SpatialNearestResult> {
    return await this.query(position, undefined, 1, options) as SpatialNearestResult;
  }
  async radius(position: Vec3, radiusMeters: number, options: SpatialQueryOptions & { readonly maxResults?: number } = {}): Promise<SpatialRadiusResult> {
    if (!Number.isFinite(radiusMeters) || radiusMeters < 0) throw new RangeError('Invalid radius');
    const cap = options.maxResults ?? 1000;
    if (!Number.isSafeInteger(cap) || cap < 0 || cap > 10000) throw new RangeError('Radius result cap must be 0..10000');
    return await this.query(position, radiusMeters, cap, options) as SpatialRadiusResult;
  }
  /** Exact inclusive AABB occupancy, not a radius witness approximation or surface-clearance proof.
   * Ground labels 1/2 at/below supportMaxZ are counted separately, never discarded from totalCount.
   */
  async box(bounds: CropBox, options: SpatialQueryOptions & { readonly maxResults?: number; readonly supportMaxZ?: number } = {}): Promise<SpatialBoxResult> {
    assertCropBox(bounds);
    const box = { min: vector(bounds.min), max: vector(bounds.max) }, signal = options.signal;
    const maxPages = options.maxPages ?? this.disk.pages.length, maxMilliseconds = options.maxMilliseconds ?? 10000;
    const cap = options.maxResults ?? 12, supportMaxZ = options.supportMaxZ;
    if (!Number.isSafeInteger(maxPages) || maxPages < 0 || !Number.isSafeInteger(maxMilliseconds) || maxMilliseconds <= 0 ||
      !Number.isSafeInteger(cap) || cap < 0 || cap > 100 || options.label !== undefined ||
      (supportMaxZ !== undefined && !Number.isFinite(supportMaxZ))) throw new RangeError('Invalid box query budgets/options');
    const started = performance.now(); let checkedPages = 0, checkedPoints = 0, totalCount = 0, supportingGroundCount = 0;
    const countsByLabel = Array<number>(9).fill(0), points: SpatialBoxPoint[] = [];
    const checkpoint = () => { signal?.throwIfAborted(); if (performance.now() - started >= maxMilliseconds) throw new RangeError('Spatial time budget exceeded'); };
    const intersects = (node: PageKdNode) => box.min.every((n, a) => n <= node.max[a] && box.max[a] >= node.min[a]);
    checkpoint(); await this.snapshot.check(signal); await this.disk.check(signal);
    const visit = async (node: PageKdNode): Promise<void> => {
      checkpoint(); if (!intersects(node)) return;
      if (node.page === undefined) { await visit(node.left!); await visit(node.right!); return; }
      if (checkedPages >= maxPages) throw new RangeError('Spatial page budget exceeded');
      const page = this.disk.pages[node.page], bytes = await this.disk.readPage(page, signal); checkedPages++; checkpoint();
      for (let n = 0; n < page.count; n++) {
        checkedPoints++; const at = n * recordBytes;
        const xyz: Vec3 = [bytes.readDoubleLE(at), bytes.readDoubleLE(at + 8), bytes.readDoubleLE(at + 16)];
        if (!xyz.every((v, a) => v >= box.min[a] && v <= box.max[a])) continue;
        const label = bytes.readUInt32LE(at + 36); totalCount++; countsByLabel[label]++;
        if (supportMaxZ !== undefined && (label === 1 || label === 2) && xyz[2] <= supportMaxZ) { supportingGroundCount++; continue; }
        if (points.length < cap) points.push(Object.freeze({ position: vector(xyz), label,
          source: Object.freeze({ sourceFileId: bytes.readUInt32LE(at + 24), sourceRow: bytes.readUInt32LE(at + 28), preparedRecordIndex: bytes.readUInt32LE(at + 32) }),
          artifactRevision: this.binding.artifactRevision, frameId: 'toronto3d-local-v1', units: 'm' }));
      }
      await yieldTurn(); checkpoint();
    };
    if (this.tree.root) await visit(this.tree.root);
    await this.snapshot.check(signal); await this.disk.check(signal); checkpoint();
    const obstructionCount = totalCount - supportingGroundCount;
    return { complete: true, binding: this.binding, bounds: box, totalCount, countsByLabel, supportingGroundCount, obstructionCount,
      points: points.sort(sourceOrder), truncated: obstructionCount > points.length,
      statistics: { checkedPages, totalPages: this.disk.pages.length, checkedPoints, milliseconds: performance.now() - started } };
  }
  /** Exact inclusive rotated XY rectangle, extruded over ALL dataset heights (corners' Z is only a reference plane). */
  async aoi(corners: ModelAreaOfInterest['corners'], options: SpatialQueryOptions & { readonly maxResults?: number } = {}): Promise<SpatialAoiResult> {
    if (!Array.isArray(corners) || corners.length !== 4 || !corners.every(c =>
      Array.isArray(c) && c.length === 3 && c.every(Number.isFinite))) throw new RangeError('Invalid AOI rectangle corners');
    // Copy caller-owned values before the first await. Rectangle order may be clockwise or counterclockwise.
    const rectangle = corners.map(c => vector(c)), [origin, next, opposite, previous] = rectangle;
    const ux = next[0] - origin[0], uy = next[1] - origin[1];
    const vx = previous[0] - origin[0], vy = previous[1] - origin[1];
    const width = Math.hypot(ux, uy), height = Math.hypot(vx, vy);
    // A few dozen ulps of coordinate/subtraction error, with a sub-nanometre floor; not a scene-scale buffer.
    const tolerance = Math.max(1e-10, 64 * Number.EPSILON * Math.max(1, ...rectangle.flatMap(c => [Math.abs(c[0]), Math.abs(c[1])])));
    const planeTolerance = Math.max(1e-10, 64 * Number.EPSILON * Math.max(1, ...rectangle.map(c => Math.abs(c[2]))));
    if (![width, height, tolerance].every(Number.isFinite) || width <= 4 * tolerance || height <= 4 * tolerance ||
      rectangle.some(c => Math.abs(c[2] - origin[2]) > planeTolerance) ||
      Math.abs((opposite[0] - next[0]) - vx) > tolerance || Math.abs((opposite[1] - next[1]) - vy) > tolerance ||
      Math.abs((ux / width) * (vx / height) + (uy / width) * (vy / height)) > tolerance / width + tolerance / height) {
      throw new RangeError('AOI corners must form a nondegenerate ordered XY rectangle');
    }
    const label = options.label, signal = options.signal, cap = options.maxResults ?? 32;
    const maxPages = options.maxPages ?? this.disk.pages.length, maxMilliseconds = options.maxMilliseconds ?? 30000;
    if ((label !== undefined && (!Number.isInteger(label) || label < 0 || label > 8)) ||
      !Number.isSafeInteger(cap) || cap < 1 || cap > 64 ||
      !Number.isSafeInteger(maxPages) || maxPages < 0 || !Number.isSafeInteger(maxMilliseconds) || maxMilliseconds <= 0) {
      throw new RangeError('Invalid AOI query budgets/options');
    }
    const boundaryTolerance = 4 * tolerance;
    const minX = Math.min(...rectangle.map(c => c[0])) - boundaryTolerance, maxX = Math.max(...rectangle.map(c => c[0])) + boundaryTolerance;
    const minY = Math.min(...rectangle.map(c => c[1])) - boundaryTolerance, maxY = Math.max(...rectangle.map(c => c[1])) + boundaryTolerance;
    const intersects = (box: { readonly min: Vec3; readonly max: Vec3 }) =>
      minX <= box.max[0] && maxX >= box.min[0] && minY <= box.max[1] && maxY >= box.min[1];
    const started = performance.now(); let checkedPages = 0, checkedPoints = 0, totalCount = 0;
    const countsByLabel = Array<number>(9).fill(0), points: SpatialBoxPoint[] = [];
    const checkpoint = () => { signal?.throwIfAborted(); if (performance.now() - started >= maxMilliseconds) throw new RangeError('Spatial time budget exceeded'); };
    checkpoint(); await this.snapshot.check(signal); await this.disk.check(signal); checkpoint();
    const visit = async (node: PageKdNode): Promise<void> => {
      checkpoint(); if (!intersects(node)) return;
      if (node.page === undefined) { await visit(node.left!); await visit(node.right!); return; }
      const page = this.disk.pages[node.page];
      if (label !== undefined && (!page.labels[label] || !intersects(page.labels[label]!))) return;
      if (checkedPages >= maxPages) throw new RangeError('Spatial page budget exceeded');
      const bytes = await this.disk.readPage(page, signal); checkedPages++; checkpoint();
      for (let n = 0; n < page.count; n++) {
        checkedPoints++; const at = n * recordBytes, category = bytes.readUInt32LE(at + 36);
        if (label !== undefined && category !== label) continue;
        const x = bytes.readDoubleLE(at), y = bytes.readDoubleLE(at + 8);
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        const dx = x - origin[0], dy = y - origin[1];
        const along = dx * (ux / width) + dy * (uy / width), across = dx * (vx / height) + dy * (vy / height);
        if (!Number.isFinite(along) || !Number.isFinite(across)) throw new RangeError('Spatial AOI projection overflow');
        if (along < -boundaryTolerance || along > width + boundaryTolerance || across < -boundaryTolerance || across > height + boundaryTolerance) continue;
        totalCount++; countsByLabel[category]++;
        const preparedRecordIndex = bytes.readUInt32LE(at + 32), sourceFileId = bytes.readUInt32LE(at + 24), sourceRow = bytes.readUInt32LE(at + 28);
        const last = points.at(-1)?.source;
        // Keep the lowest source keys, independent of BVH traversal order, with only cap-sized storage.
        if (points.length === cap && last && (preparedRecordIndex - last.preparedRecordIndex || sourceFileId - last.sourceFileId || sourceRow - last.sourceRow) >= 0) continue;
        points.push(Object.freeze({ position: vector([x, y, bytes.readDoubleLE(at + 16)]), label: category,
          source: Object.freeze({ sourceFileId, sourceRow, preparedRecordIndex }),
          artifactRevision: this.binding.artifactRevision, frameId: 'toronto3d-local-v1', units: 'm' }));
        points.sort(sourceOrder); if (points.length > cap) points.pop();
      }
      await yieldTurn(); checkpoint();
    };
    if (this.tree.root) await visit(this.tree.root);
    await this.snapshot.check(signal); await this.disk.check(signal); checkpoint();
    return { complete: true, binding: this.binding, totalCount, countsByLabel: Object.freeze(countsByLabel),
      points: Object.freeze(points), truncated: totalCount > points.length,
      statistics: { checkedPages, totalPages: this.disk.pages.length, checkedPoints, milliseconds: performance.now() - started } };
  }
  /** Point-to-source-point clearance only: NOT a solid/surface/obstacle clearance proof. */
  async clearance(position: Vec3, options: SpatialQueryOptions = {}): Promise<SpatialNearestResult & { readonly distanceMeters: number | null; readonly domain: 'original-source-points' }> {
    const result = await this.nearest(position, options);
    return { ...result, distanceMeters: result.point?.distanceMeters ?? null, domain: 'original-source-points' };
  }
  private async query(position: Vec3, radius: number | undefined, cap: number, options: SpatialQueryOptions): Promise<SpatialNearestResult | SpatialRadiusResult> {
    if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite) ||
      (options.label !== undefined && (!Number.isInteger(options.label) || options.label < 0 || options.label > 8))) throw new RangeError('Invalid position/label');
    // Copy inputs across async boundaries; mutation of the caller's arrays/options cannot alter a query.
    const q = vector(position), label = options.label, signal = options.signal;
    const maxPages = options.maxPages ?? this.disk.pages.length, maxMilliseconds = options.maxMilliseconds ?? 30000;
    if (!Number.isSafeInteger(maxPages) || maxPages < 0 || !Number.isSafeInteger(maxMilliseconds) || maxMilliseconds <= 0) throw new RangeError('Invalid spatial query budgets');
    const started = performance.now(); let checkedPages = 0, checkedPoints = 0, count = 0, best: SpatialPoint | null = null;
    const points: SpatialPoint[] = [];
    const checkpoint = () => { signal?.throwIfAborted(); if (performance.now() - started >= maxMilliseconds) throw new RangeError('Spatial time budget exceeded'); };
    checkpoint(); await this.snapshot.check(signal); await this.disk.check(signal); checkpoint();
    const limit = () => radius ?? best?.distanceMeters ?? Infinity;
    const visit = async (node: PageKdNode): Promise<void> => {
      checkpoint();
      // Strict comparison retains equal-distance candidates for deterministic physical/source-key ties.
      if (lowerDistance(q, node) > limit()) return;
      if (node.page === undefined) {
        const left = node.left!, right = node.right!;
        if (lowerDistance(q, left) <= lowerDistance(q, right)) { await visit(left); await visit(right); }
        else { await visit(right); await visit(left); }
        return;
      }
      const page = this.disk.pages[node.page];
      if (label !== undefined && (!page.labels[label] || lowerDistance(q, page.labels[label]!) > limit())) return;
      if (checkedPages >= maxPages) throw new RangeError('Spatial page budget exceeded');
      const bytes = await this.disk.readPage(page, signal); checkedPages++; checkpoint();
      for (let n = 0; n < page.count; n++) {
        const at = n * recordBytes, category = bytes.readUInt32LE(at + 36); checkedPoints++;
        if (label !== undefined && category !== label) continue;
        const xyz: Vec3 = [bytes.readDoubleLE(at), bytes.readDoubleLE(at + 8), bytes.readDoubleLE(at + 16)];
        const distance = Math.hypot(xyz[0] - q[0], xyz[1] - q[1], xyz[2] - q[2]);
        // Finite source coordinates can still overflow an extreme query subtraction: fail, never return an infinite distance.
        if (!Number.isFinite(distance)) throw new RangeError('Spatial distance overflow');
        if (distance > limit()) continue;
        if (radius !== undefined) { count++; if (points.length >= cap) continue; }
        const point: SpatialPoint = Object.freeze({ position: vector(xyz), distanceMeters: distance, label: category,
          source: Object.freeze({ sourceFileId: bytes.readUInt32LE(at + 24), sourceRow: bytes.readUInt32LE(at + 28), preparedRecordIndex: bytes.readUInt32LE(at + 32) }),
          artifactRevision: this.binding.artifactRevision, frameId: 'toronto3d-local-v1', units: 'm' });
        if (radius !== undefined) points.push(point);
        else if (!best || distance < best.distanceMeters || (distance === best.distanceMeters && sourceOrder(point, best) < 0)) best = point;
      }
      // Bounded page work and an event-loop turn make cancellation/deadlines observable during full scans.
      await yieldTurn(); checkpoint();
    };
    if (this.tree.root) await visit(this.tree.root);
    await this.snapshot.check(signal); await this.disk.check(signal); checkpoint();
    const common = { complete: true as const, binding: this.binding,
      statistics: { checkedPages, totalPages: this.disk.pages.length, checkedPoints, milliseconds: performance.now() - started } };
    return radius === undefined ? { ...common, point: best } : { ...common, totalCount: count, truncated: count > cap, maxResults: cap, points: Object.freeze(points.sort(sourceOrder)) };
  }
}
