import { setImmediate as yieldTurn } from 'node:timers/promises';
import { canonicalResolvedPlacementSpecification, type CropBox, type ResolvedPlacementSpecification, type Vec3 } from '@spatial/contracts';
import { digest, requireData, type SemanticArtifact } from '../spatial/semantic-artifact';
import { loadPreparedSemanticDiskIndex, recordBytes, type SemanticDiskIndex } from '../spatial/semantic-disk-index';
import { SpatialPageIndex, type SpatialBoxResult } from '../spatial/spatial-page-index';
import { readPreprocessing } from '../preprocessing/preprocessing-summary';
import { createGroundSurface } from '../spatial/ground-surface';

export interface PlacementSearchCandidate {
  readonly id: string; readonly rank: number;
  readonly operation: { readonly kind: 'box'; readonly center: Vec3; readonly dimensions: Vec3 };
  readonly yawDegrees: number; readonly groundSlopeDegrees: number; readonly groundRelief: number;
  /** null means the complete source contains no Pole observations (not unknown). */
  readonly poleSeparationMeters: number | null;
  readonly body: SpatialBoxResult; readonly access: SpatialBoxResult | null;
}
export interface PlacementSearchResult {
  readonly status: 'complete' | 'incomplete'; readonly candidates: PlacementSearchCandidate[];
  readonly evaluated: number; readonly generated: number; readonly reason?: string;
  readonly binding: { readonly preprocessingHash: string; readonly indexHash: string; readonly sourceHash: string };
  readonly limitations: readonly string[];
}
export interface PlacementSearchOptions {
  readonly signal: AbortSignal; readonly spacingMeters: number; readonly maxPoses: number;
  readonly limit: number; readonly diversityMeters: number;
}
const TIME_MS = 15000, MAX_PAGES = 20000;
const limitations = [
  'Best evaluated on an AOI-local lattice at the requested spacing, with cardinal yaws only; not a global optimum.',
  'Original-source observed points only. Empty volumes do not certify physical clearance, safety or code compliance; edited scenes must be rejected by the authority caller.',
  'Ground uses footprint center/corners, LS plane slope and sampled height range; no continuous support or foundation certificate. Base is the maximum sampled elevation.',
  'Ground/Road_markings at or below base + 0.10m are support; all other inclusive body/access observations are conflicts. Counts are exhaustive; witnesses are capped at 12.',
  'Pole distance is the exact horizontal distance to original observed Pole points, not fitted physical poles. Null means no Pole observations exist.',
  'Search is bounded to 15 seconds, 20,000 pages per volume/pole reduction and 100,000 generated poses; failures return no usable partial shortlist.'
] as const;

/** Exact horizontal reduction over complete physical pages; never reduce capped query witnesses.
 * Label bounds prune only when their distance to the closed footprint exceeds the current best.
 * The first relevant page establishes a finite bound; ties are harmless since only distance is retained.
 */
async function poleDistance(disk: SemanticDiskIndex, bounds: CropBox, center: Vec3, from: 'box-center' | 'box-boundary', signal: AbortSignal, checkpoint: () => void): Promise<number | null> {
  const target = from === 'box-center' ? { min: center, max: center } : bounds;
  let best = Infinity, pages = 0;
  for (const page of disk.pages) {
    checkpoint(); const label = page.labels[6]; if (!label) continue;
    const lower = Math.hypot(...[0, 1].map(a => Math.max(target.min[a] - label.max[a], label.min[a] - target.max[a], 0)));
    if (lower > best) continue;
    if (++pages > MAX_PAGES) throw new RangeError('pole-page-budget');
    const bytes = await disk.readPage(page, signal); checkpoint();
    for (let n = 0; n < page.count; n++) {
      const at = n * recordBytes; if (bytes.readUInt32LE(at + 36) !== 6) continue;
      const x = bytes.readDoubleLE(at), y = bytes.readDoubleLE(at + 8);
      best = Math.min(best, Math.hypot(Math.max(target.min[0] - x, x - target.max[0], 0), Math.max(target.min[1] - y, y - target.max[1], 0)));
    }
    await yieldTurn(); checkpoint();
  }
  return best === Infinity ? null : best;
}
const footprint = (b: CropBox): readonly Vec3[] => [b.min, [b.max[0], b.min[1], b.min[2]], b.max, [b.min[0], b.max[1], b.min[2]]];

/** No mutation, proposal retention, authority rebasing or inference. Caller must check both live
 * authorities and reject effective edits before invocation and again before retaining results.
 * Invalid/unsupported requests throw; data/budget/cancellation failures return incomplete, [] .
 */
export async function searchPlacement(snapshot: SemanticArtifact, input: ResolvedPlacementSpecification, options: PlacementSearchOptions): Promise<PlacementSearchResult> {
  const spec = canonicalResolvedPlacementSpecification(input), p = spec.parameters;
  const { spacingMeters, maxPoses, limit, diversityMeters } = options;
  if (!Number.isFinite(spacingMeters) || spacingMeters <= 0 || !Number.isSafeInteger(maxPoses) || maxPoses < 1 || maxPoses > 100000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isFinite(diversityMeters) || diversityMeters < 0) throw new RangeError('Invalid placement search budgets');
  if (p.allowedYawDegrees.some(y => ![0, 90, 180, 270].includes(y))) throw new RangeError('Unsupported placement yaw: only 0, 90, 180, 270 degrees are executable');
  if (p.poleDistance.metric !== 'horizontal') throw new RangeError('Unsupported pole metric: placement search supports horizontal distance only');
  requireData(p.binding.artifactRevision === snapshot.dataset.revision && p.binding.units === snapshot.dataset.coordinates.units &&
    p.binding.localOrigin.every((n, a) => n === snapshot.dataset.coordinates.localOrigin[a]), 'Placement artifact/frame binding mismatch');
  const started = performance.now(), deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('placement-time-budget')), TIME_MS); timer.unref();
  const signal = AbortSignal.any([options.signal, deadline.signal]);
  const checkpoint = () => { signal.throwIfAborted(); if (performance.now() - started >= TIME_MS) throw new RangeError('placement-time-budget'); };
  let generated = 0, evaluated = 0;
  let binding = { preprocessingHash: '', indexHash: '', sourceHash: '' };
  try {
    checkpoint(); const disk = await loadPreparedSemanticDiskIndex(snapshot, signal); requireData(disk, 'Prepared placement index unavailable');
    binding = { ...binding, indexHash: disk.hash, sourceHash: disk.sourceHash };
    const terrain = await readPreprocessing(snapshot.dataset, undefined, signal);
    binding = { ...binding, preprocessingHash: digest(JSON.stringify(terrain)) };
    requireData(terrain.binding.indexHash === disk.hash && terrain.binding.sourceHash === disk.sourceHash && p.binding.terrainRevision === binding.preprocessingHash, 'Placement terrain/index binding mismatch');
    // Construct these once, not once per pose. Ground surface keeps its conservative 45-degree interpolation cutoff.
    const surface = createGroundSurface(terrain.ground), spatial = await SpatialPageIndex.create(snapshot, disk, signal);
    const [origin, next, , previous] = p.area.corners;
    const u = [next[0] - origin[0], next[1] - origin[1]], v = [previous[0] - origin[0], previous[1] - origin[1]];
    const width = Math.hypot(...u), depth = Math.hypot(...v), ux = u[0] / width, uy = u[1] / width, vx = v[0] / depth, vy = v[1] / depth;
    const tolerance = Math.max(1e-10, 64 * Number.EPSILON * Math.max(1, ...p.area.corners.flatMap(c => [Math.abs(c[0]), Math.abs(c[1])])));
    const inside = (box: CropBox) => footprint(box).every(c => {
      const dx = c[0] - origin[0], dy = c[1] - origin[1], a = dx * ux + dy * uy, b = dx * vx + dy * vy;
      return a >= -tolerance && a <= width + tolerance && b >= -tolerance && b <= depth + tolerance;
    });
    const nx = Math.floor(width / spacingMeters), ny = Math.floor(depth / spacingMeters);
    requireData(Number.isSafeInteger(nx) && Number.isSafeInteger(ny) && nx < Number.MAX_SAFE_INTEGER && ny < Number.MAX_SAFE_INTEGER, 'Unrepresentable placement lattice');
    const feasible: PlacementSearchCandidate[] = [];
    // Lattice anchored at AOI corner 0, following edges 0→1 and 0→3. No source sampling.
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) for (const yaw of p.allowedYawDegrees) {
      checkpoint(); if (generated >= maxPoses) throw new RangeError('placement-pose-budget'); generated++;
      if (generated % 32 === 0) { await yieldTurn(); checkpoint(); }
      const x = origin[0] + i * spacingMeters * ux + j * spacingMeters * vx, y = origin[1] + i * spacingMeters * uy + j * spacingMeters * vy;
      const [w, d, h] = yaw % 180 === 0 ? p.dimensions : [p.dimensions[1], p.dimensions[0], p.dimensions[2]];
      const bounds: CropBox = { min: [x - w / 2, y - d / 2, 0], max: [x + w / 2, y + d / 2, h] };
      const accessBounds: CropBox | null = p.frontAccessDepth === 0 ? null : yaw === 0 ?
        { min: [bounds.min[0], bounds.max[1], 0], max: [bounds.max[0], bounds.max[1] + p.frontAccessDepth, p.frontAccessHeight] } : yaw === 180 ?
        { min: [bounds.min[0], bounds.min[1] - p.frontAccessDepth, 0], max: [bounds.max[0], bounds.min[1], p.frontAccessHeight] } : yaw === 90 ?
        { min: [bounds.min[0] - p.frontAccessDepth, bounds.min[1], 0], max: [bounds.min[0], bounds.max[1], p.frontAccessHeight] } :
        { min: [bounds.max[0], bounds.min[1], 0], max: [bounds.max[0] + p.frontAccessDepth, bounds.max[1], p.frontAccessHeight] };
      if (!inside(bounds) || (p.containment === 'footprint-and-access' && accessBounds && !inside(accessBounds))) continue;
      evaluated++;
      const samples: readonly Vec3[] = [[x, y, 0], ...footprint(bounds)];
      const ground = samples.map(q => surface.elevationAt(q[0], q[1]));
      if (ground.some(g => g.status !== 'available')) continue;
      const heights = ground.map(g => g.status === 'available' ? g.elevation : NaN), base = Math.max(...heights);
      // Symmetric footprint center + four corners makes the centered LS normal matrix diagonal.
      const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
      const gx = samples.reduce((sum, q, n) => sum + (q[0] - x) * (heights[n] - mean), 0) / (w * w);
      const gy = samples.reduce((sum, q, n) => sum + (q[1] - y) * (heights[n] - mean), 0) / (d * d);
      const groundSlopeDegrees = Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI, groundRelief = base - Math.min(...heights);
      if (![base, groundSlopeDegrees, groundRelief].every(Number.isFinite)) throw new RangeError('placement-ground-numeric-range');
      if (groundSlopeDegrees > p.maxGroundSlopeDegrees || groundRelief > p.maxGroundRelief) continue;
      const lift = (b: CropBox): CropBox => ({ min: [b.min[0], b.min[1], base], max: [b.max[0], b.max[1], b.max[2] + base] });
      const bodyBounds = lift(bounds), center: Vec3 = [x, y, base + h / 2];
      const queryOptions = { signal, maxPages: MAX_PAGES, maxMilliseconds: Math.max(1, Math.ceil(TIME_MS - (performance.now() - started))), maxResults: 12, supportMaxZ: base + .1 };
      const body = await spatial.box(bodyBounds, queryOptions); checkpoint();
      if (body.obstructionCount > p.maxBodyConflicts) continue;
      const access = accessBounds ? await spatial.box(lift(accessBounds), queryOptions) : null; checkpoint();
      if (access && access.obstructionCount > p.maxAccessConflicts) continue;
      const poleSeparationMeters = await poleDistance(disk, bodyBounds, center, p.poleDistance.from, signal, checkpoint);
      if (poleSeparationMeters !== null && poleSeparationMeters < p.poleSeparation) continue;
      const operation = { kind: 'box' as const, center, dimensions: [w, d, h] as Vec3 };
      feasible.push({ id: `placement-${digest(JSON.stringify({ spec, binding, operation, yaw }))}`, rank: 0, operation, yawDegrees: yaw, groundSlopeDegrees, groundRelief, poleSeparationMeters, body, access });
    }
    checkpoint(); await snapshot.check(signal); await disk.check(signal);
    requireData(digest(JSON.stringify(await readPreprocessing(snapshot.dataset, undefined, signal))) === binding.preprocessingHash, 'Placement terrain changed during search'); checkpoint();
    const metric = (c: PlacementSearchCandidate, name: typeof p.ranking[number]['metric']): number => name === 'pole-separation' ? c.poleSeparationMeters ?? Infinity :
      name === 'ground-slope' ? c.groundSlopeDegrees : name === 'ground-relief' ? c.groundRelief : name === 'body-conflicts' ? c.body.obstructionCount : c.access?.obstructionCount ?? 0;
    feasible.sort((a, b) => {
      for (const preference of p.ranking) { const av = metric(a, preference.metric), bv = metric(b, preference.metric); if (av !== bv) return (av < bv ? -1 : 1) * (preference.direction === 'minimize' ? 1 : -1); }
      return a.operation.center[0] - b.operation.center[0] || a.operation.center[1] - b.operation.center[1] || a.yawDegrees - b.yawDegrees || a.id.localeCompare(b.id);
    });
    const candidates: PlacementSearchCandidate[] = [];
    for (const c of feasible) {
      checkpoint(); if (candidates.every(other => Math.hypot(c.operation.center[0] - other.operation.center[0], c.operation.center[1] - other.operation.center[1]) >= diversityMeters)) candidates.push({ ...c, rank: candidates.length + 1 });
      if (candidates.length === limit) break;
    }
    return { status: 'complete', candidates, generated, evaluated, binding, limitations };
  } catch (error) {
    return { status: 'incomplete', candidates: [], generated, evaluated, binding, limitations,
      reason: options.signal.aborted ? 'cancelled' : deadline.signal.aborted ? 'placement-time-budget' : error instanceof Error ? error.message : 'placement-query-failed' };
  } finally { clearTimeout(timer); }
}
