import { setImmediate as yieldTurn } from 'node:timers/promises';
import type { AreaCandidate, AreaCandidateResult, AreaCandidateSettings, ModelAreaOfInterest, Vec3 } from '@spatial/contracts';
import { digest, requireData, type SemanticArtifact } from './semantic-artifact';
import { getSemanticDiskIndex, recordBytes } from './semantic-disk-index';

/** Request-local memory and work bounds; no partial shortlist survives a failure. */
const MAX_CELLS = 250_000, MAX_POLE_CELLS = 250_000, MAX_PAGES = 100_000, TIME_MS = 120_000;
const limitations = [
  'Complete relevant original-source physical pages reduced once; no witness cap, per-candidate page query, terrain preparation or CAD prerequisite.',
  'Observed-only evidence, not physical clearance, continuous ground support, foundation suitability or safety certification. Every intersecting support cell needs at least three Ground/Road_markings observations; missing cells are rejected.',
  'All non-Ground/Road_markings observations at any elevation are obstacles. Clearance uses conservative intersecting grid cells in a horizontal disk, not an equipment box.',
  'Ground relief is the full observed min/max range of intersecting cells. Candidate elevation is their maximum observed ground height; AOI reference-plane elevation is not terrain.',
  'Pole distance is a conservative lower bound to ALL original observed Pole points, including outside the area: nearest quantized cell-center distance minus half the cell diagonal, floored at zero. True nearest observed-point distance is between that bound and the bound plus a full cell diagonal. Null means no Pole observations exist.',
  'Search positions are cell centers on an AOI-aligned lattice. Resolution, clearance-cell overreach (up to a cell diagonal) and pole uncertainty are reported; this is not a continuous optimum. Up to the requested maxCandidates spatially diverse points are returned (1–20; legacy callers default to 5); fewer means fewer supported locations.',
  'Source-only: caller must reject point/CAD edits and recheck both live authorities before publishing. Budgets: 120 seconds including index preparation, 100000 physical pages, 250000 area cells and 250000 occupied pole cells; exhaustion/cancellation/staleness returns no partial candidates.'
] as const;

export function validateAreaCandidateSettings(value: unknown): AreaCandidateSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid area candidate settings');
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some(k => !['maxCandidates', 'spacingMeters', 'clearanceRadiusMeters', 'maxGroundReliefMeters', 'minPoleDistanceMeters', 'ranking'].includes(k))) throw new Error('Unknown area candidate setting');
  if (p.maxCandidates !== undefined && (!Number.isSafeInteger(p.maxCandidates) || (p.maxCandidates as number) < 1 || (p.maxCandidates as number) > 20)) throw new Error('Invalid maxCandidates');
  for (const [key, min, max] of [['spacingMeters', .5, 100], ['clearanceRadiusMeters', 0, 25], ['maxGroundReliefMeters', 0, 10], ['minPoleDistanceMeters', 0, 1000]] as const) {
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new Error(`Invalid ${key}`);
  }
  if (!['flat-ground', 'near-poles', 'far-from-poles'].includes(p.ranking as string)) throw new Error('Invalid candidate ranking');
  return { maxCandidates: p.maxCandidates as number | undefined ?? 5, spacingMeters: p.spacingMeters as number, clearanceRadiusMeters: p.clearanceRadiusMeters as number,
    maxGroundReliefMeters: p.maxGroundReliefMeters as number, minPoleDistanceMeters: p.minPoleDistanceMeters as number, ranking: p.ranking as AreaCandidateSettings['ranking'] };
}
type Authority = { readonly sessionId: string; readonly revision: number };
type Pole = readonly [number, number];
interface Node { readonly point: Pole; readonly axis: number; readonly left: Node | null; readonly right: Node | null }
function tree(points: Pole[], depth = 0): Node | null {
  if (!points.length) return null;
  const axis = depth % 2; points.sort((a, b) => a[axis] - b[axis] || a[1 - axis] - b[1 - axis]);
  const mid = Math.floor(points.length / 2);
  return { point: points[mid], axis, left: tree(points.slice(0, mid), depth + 1), right: tree(points.slice(mid + 1), depth + 1) };
}
function nearest(node: Node | null, x: number, y: number, best = Infinity): number {
  if (!node) return best;
  best = Math.min(best, (node.point[0] - x) ** 2 + (node.point[1] - y) ** 2);
  const delta = (node.axis === 0 ? x : y) - node.point[node.axis];
  best = nearest(delta < 0 ? node.left : node.right, x, y, best);
  if (delta * delta <= best) best = nearest(delta < 0 ? node.right : node.left, x, y, best);
  return best;
}

/** Read-only source reduction. Invalid request/binding throws; runtime failures fail closed. */
export async function searchAreaCandidates(snapshot: SemanticArtifact, inputArea: ModelAreaOfInterest, inputSettings: AreaCandidateSettings,
  authorities: { pointAuthority: Authority; cadAuthority: Authority }, inputSignal: AbortSignal): Promise<AreaCandidateResult> {
  const settings = validateAreaCandidateSettings(inputSettings), area = structuredClone(inputArea);
  requireData(area.datasetId === 'toronto3d' && area.artifactRevision === snapshot.dataset.revision && area.frameId === 'toronto3d-local-v1' && area.units === 'm' &&
    JSON.stringify(area.localOrigin) === JSON.stringify(snapshot.dataset.coordinates.localOrigin), 'Area artifact/frame mismatch');
  requireData(Array.isArray(area.corners) && area.corners.length === 4 && area.corners.every(c => Array.isArray(c) && c.length === 3 && c.every(Number.isFinite)), 'Invalid area corners');
  for (const a of [authorities.pointAuthority, authorities.cadAuthority]) requireData(a && typeof a.sessionId === 'string' && a.sessionId.length > 0 && Number.isSafeInteger(a.revision) && a.revision >= 0, 'Invalid area authority');
  const [origin, p1, p2, p3] = area.corners, u = [p1[0] - origin[0], p1[1] - origin[1]], v = [p3[0] - origin[0], p3[1] - origin[1]];
  const width = Math.hypot(...u), height = Math.hypot(...v), ux = u[0] / width, uy = u[1] / width, vx = v[0] / height, vy = v[1] / height;
  requireData(Number.isFinite(width + height) && width > 0 && height > 0 && Math.abs(ux * vx + uy * vy) < 1e-8 &&
    Math.hypot(p2[0] - p1[0] - p3[0] + origin[0], p2[1] - p1[1] - p3[1] + origin[1]) < 1e-7 && area.corners.every(c => c[2] === origin[2]), 'Area must be a planar XY rectangle');
  const cell = Math.max(.5, Math.min(2, settings.spacingMeters / 2), settings.clearanceRadiusMeters / 16);
  const nx = Math.ceil(width / cell), ny = Math.ceil(height / cell), total = nx * ny;
  const started = performance.now(), deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), TIME_MS); timer.unref();
  const signal = AbortSignal.any([inputSignal, deadline.signal]);
  const check = () => { signal.throwIfAborted(); if (performance.now() - started >= TIME_MS) throw new Error('area-time-budget'); };
  let pagesRead = 0, sourcePointsExamined = 0, areaPoints = 0, cellsEvaluated = 0;
  let binding = { artifactRevision: snapshot.dataset.revision, indexHash: '', sourceHash: '', ...structuredClone(authorities) };
  const result = (status: 'complete' | 'incomplete', candidates: AreaCandidate[], reason?: string): AreaCandidateResult => ({ status, candidates, ...(reason ? { reason } : {}), area, settings, binding,
    evidence: { pagesRead, sourcePointsExamined, areaPoints, cellsEvaluated, elapsedMilliseconds: performance.now() - started, cellMeters: cell }, limitations });
  try {
    check(); if (!Number.isSafeInteger(total) || total > MAX_CELLS) throw new Error('area-cell-budget');
    const count = new Uint32Array(total), low = new Float64Array(total).fill(Infinity), high = new Float64Array(total).fill(-Infinity), obstacle = new Uint8Array(total);
    const { index } = await getSemanticDiskIndex(snapshot, signal); check(); binding = { ...binding, indexHash: index.hash, sourceHash: index.sourceHash };
    const poles = new Map<string, Pole>();
    const minX = Math.min(...area.corners.map(p => p[0])), maxX = Math.max(...area.corners.map(p => p[0])), minY = Math.min(...area.corners.map(p => p[1])), maxY = Math.max(...area.corners.map(p => p[1]));
    // Metadata bounds only exclude pages that provably have neither AOI observations nor poles.
    for (const page of index.pages) {
      check();
      if (!page.labels[6] && !page.labels.some(l => l && l.min[0] <= maxX && l.max[0] >= minX && l.min[1] <= maxY && l.max[1] >= minY)) continue;
      if (++pagesRead > MAX_PAGES) throw new Error('area-page-budget');
      const bytes = await index.readPage(page, signal); check();
      for (let n = 0; n < page.count; n++) {
        const at = n * recordBytes, x = bytes.readDoubleLE(at), y = bytes.readDoubleLE(at + 8), z = bytes.readDoubleLE(at + 16), label = bytes.readUInt32LE(at + 36);
        sourcePointsExamined++;
        if (label === 6) {
          const px = Math.floor(x / cell), py = Math.floor(y / cell), key = `${px},${py}`;
          if (!poles.has(key)) { if (poles.size >= MAX_POLE_CELLS) throw new Error('area-pole-cell-budget'); poles.set(key, [(px + .5) * cell, (py + .5) * cell]); }
        }
        const dx = x - origin[0], dy = y - origin[1], a = dx * ux + dy * uy, b = dx * vx + dy * vy;
        if (a < 0 || a > width || b < 0 || b > height) continue;
        areaPoints++;
        const i = Math.min(nx - 1, Math.floor(a / cell)), j = Math.min(ny - 1, Math.floor(b / cell)), pos = j * nx + i;
        if (label === 1 || label === 2) { count[pos]++; low[pos] = Math.min(low[pos], z); high[pos] = Math.max(high[pos], z); } else obstacle[pos] = 1;
      }
      await yieldTurn(); check();
    }
    const poleTree = tree([...poles.values()]); check();
    const stride = Math.max(1, Math.ceil(settings.spacingMeters / cell)), radius = settings.clearanceRadiusMeters, reach = Math.ceil(radius / cell + .5), offsets: [number, number][] = [];
    // Include every cell whose closed square intersects the requested disk, including touching edges.
    for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      if (Math.hypot(Math.max(0, Math.abs(di) * cell - cell / 2), Math.max(0, Math.abs(dj) * cell - cell / 2)) <= radius) offsets.push([di, dj]);
    }
    const feasible: AreaCandidate[] = [];
    for (let j = 0; j < ny; j += stride) for (let i = 0; i < nx; i += stride) {
      check(); cellsEvaluated++;
      if (cellsEvaluated % 128 === 0) { await yieldTurn(); check(); }
      const a = (i + .5) * cell, b = (j + .5) * cell;
      if (a - radius < 0 || a + radius > width || b - radius < 0 || b + radius > height) continue;
      let groundPoints = 0, min = Infinity, max = -Infinity, observedObstacleCells = 0, supported = true;
      for (const [di, dj] of offsets) {
        const x = i + di, y = j + dj;
        // Conservative full support-cell coverage: even boundary slivers cannot be inferred.
        if (x < 0 || y < 0 || x >= nx || y >= ny || (x + 1) * cell > width || (y + 1) * cell > height) { supported = false; break; }
        const k = y * nx + x;
        if (count[k] < 3) { supported = false; break; }
        groundPoints += count[k]; min = Math.min(min, low[k]); max = Math.max(max, high[k]); observedObstacleCells += obstacle[k];
      }
      if (!supported || observedObstacleCells || max - min > settings.maxGroundReliefMeters) continue;
      const x = origin[0] + a * ux + b * vx, y = origin[1] + a * uy + b * vy;
      const poleDistanceMeters = poleTree ? Math.max(0, Math.sqrt(nearest(poleTree, x, y)) - cell / Math.SQRT2) : null;
      if (poleDistanceMeters !== null && poleDistanceMeters < settings.minPoleDistanceMeters) continue;
      const position: Vec3 = [x, y, max];
      feasible.push({ id: `area-${digest(JSON.stringify({ area, settings, binding, position }))}`, rank: 0, position, groundPoints, groundReliefMeters: max - min, observedObstacleCells, poleDistanceMeters });
    }
    const poleRank = (c: AreaCandidate) => c.poleDistanceMeters ?? Infinity;
    feasible.sort((a, b) => {
      if (settings.ranking !== 'flat-ground' && poleRank(a) !== poleRank(b)) return (poleRank(a) < poleRank(b) ? -1 : 1) * (settings.ranking === 'near-poles' ? 1 : -1);
      return a.groundReliefMeters - b.groundReliefMeters || b.groundPoints - a.groundPoints || a.position[0] - b.position[0] || a.position[1] - b.position[1];
    });
    const candidates: AreaCandidate[] = [], diversity = Math.max(settings.spacingMeters, 2 * radius);
    for (const c of feasible) {
      if (candidates.every(other => Math.hypot(c.position[0] - other.position[0], c.position[1] - other.position[1]) >= diversity)) candidates.push({ ...c, rank: candidates.length + 1 });
      if (candidates.length === settings.maxCandidates) break;
    }
    check(); await index.check(signal); await snapshot.check(signal); check();
    return result('complete', candidates);
  } catch (error) {
    return result('incomplete', [], inputSignal.aborted ? 'cancelled' : deadline.signal.aborted ? 'area-time-budget' : error instanceof Error ? error.message : 'area-search-failed');
  } finally { clearTimeout(timer); }
}
