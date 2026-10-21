import type { GroundCell, GroundModel } from '../preprocessing/scene-preprocessing';

export interface GroundSurfaceOptions {
  /** Maximum |gradient| in m/m; default 1 (45 degrees). A safety cutoff, not terrain classification. */
  maxSlope?: number;
}
export type GroundSurfaceResult = {
  status: 'available'; units: 'm'; coordinates: 'original-source-local';
  elevation: number; method: 'observed-cell-center' | 'cell-center-triangulation-v1';
  /** One exact observation, or all four required corners (including the unused triangle corner). */
  supportingCells: readonly Readonly<GroundCell>[];
  /** Max observed elevation minus min observed elevation across supporting cells; not uncertainty. */
  spreadMeters: number;
} | {
  status: 'unavailable';
  reason: 'invalid-query' | 'outside-support' | 'insufficient-support' | 'slope-limit' | 'numeric-range';
};
export interface GroundSurface { elevationAt(x: number, y: number): GroundSurfaceResult }

/**
 * Sparse original-source Ground/Road_markings minima, NOT a robust terrain estimator.
 * Each minimum is assigned to its cell center, not its unknown observation XY.
 * Builds an immutable O(cells) lookup once; each query is O(1). No artifact changes.
 * Interpolates only four-supported-corner rectangles, split SW→NE (fixed diagonal).
 * Both triangles must satisfy maxSlope. Exact supported centers remain observations,
 * even if adjacent cells fail slope/support checks. No extrapolation or hole filling.
 * Low outliers remain in the minima; slope rejection does not certify terrain quality.
 * Invalid models/options throw RangeError; invalid queries return unavailable.
 */
export function createGroundSurface(ground: GroundModel, options: GroundSurfaceOptions = {}): GroundSurface {
  const h = ground.cellMeters, maxSlope = options.maxSlope ?? 1;
  const requireValid = (ok: boolean, message: string) => { if (!ok) throw new RangeError(message); };
  requireValid(Number.isFinite(h) && h > 0 && Number.isFinite(maxSlope) && maxSlope > 0,
    'Invalid ground cell size or slope limit');
  requireValid(ground.method === 'observed-cell-minimum-v1' && Array.isArray(ground.origin) &&
    ground.origin.length === 2 && ground.origin[0] === 0 && ground.origin[1] === 0 &&
    Array.isArray(ground.labels) && ground.labels.length === 2 && ground.labels[0] === 1 && ground.labels[1] === 2 &&
    Number.isSafeInteger(ground.minimumSupport) && ground.minimumSupport > 0 &&
    Number.isSafeInteger(ground.points) && ground.points >= 0 && Array.isArray(ground.cells), 'Invalid ground metadata/support');
  const minimumSupport = ground.minimumSupport;
  const cells = new Map<string, Readonly<GroundCell>>();
  const key = (x: number, y: number) => `${x},${y}`;
  // Keep half-integer centers exactly representable before multiplication.
  const validIndex = (n: number) => Number.isSafeInteger(n) && Math.abs(n) < 2 ** 51;
  const center = (n: number) => (n + .5) * h;
  let points = 0;
  for (const cell of ground.cells) {
    requireValid(!!cell && validIndex(cell.x) && validIndex(cell.y) &&
      Number.isSafeInteger(cell.points) && cell.points > 0 && Number.isFinite(cell.elevation) &&
      Number.isFinite(cell.maxElevation) && cell.maxElevation >= cell.elevation &&
      Number.isFinite(cell.maxElevation - cell.elevation), 'Invalid ground cell');
    for (const n of [cell.x, cell.y]) {
      requireValid(Number.isFinite(center(n)) && Number.isFinite(center(n - 1)) && Number.isFinite(center(n + 1)) &&
        center(n - 1) < center(n) && center(n) < center(n + 1), 'Unrepresentable ground cell center');
    }
    const id = key(cell.x, cell.y);
    requireValid(!cells.has(id), 'Duplicate ground cell');
    cells.set(id, Object.freeze({ ...cell })); points += cell.points;
    requireValid(Number.isSafeInteger(points), 'Ground support count overflow');
  }
  requireValid(points === ground.points, 'Ground support count mismatch');
  const unavailable = (reason: Extract<GroundSurfaceResult, { status: 'unavailable' }>['reason']): GroundSurfaceResult =>
    ({ status: 'unavailable', reason });
  const available = (elevation: number, supportingCells: readonly Readonly<GroundCell>[],
    method: Extract<GroundSurfaceResult, { status: 'available' }>['method']): GroundSurfaceResult => {
    const spreadMeters = Math.max(...supportingCells.map(c => c.maxElevation)) - Math.min(...supportingCells.map(c => c.elevation));
    return Number.isFinite(elevation) && Number.isFinite(spreadMeters) ? {
      status: 'available', units: 'm', coordinates: 'original-source-local', elevation, method,
      supportingCells: Object.freeze([...supportingCells]), spreadMeters,
    } : unavailable('numeric-range');
  };
  return Object.freeze({ elevationAt(x: number, y: number): GroundSurfaceResult {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return unavailable('invalid-query');
    const qx = x / h - .5, qy = y / h - .5;
    if (!Number.isFinite(qx) || !Number.isFinite(qy) || !validIndex(Math.floor(qx)) || !validIndex(Math.floor(qy))) return unavailable('numeric-range');
    const nx = Math.round(qx), ny = Math.round(qy);
    if (x === center(nx) && y === center(ny)) {
      const exact = cells.get(key(nx, ny));
      return !exact ? unavailable('outside-support') : exact.points < minimumSupport ? unavailable('insufficient-support') :
        available(exact.elevation, [exact], 'observed-cell-center');
    }
    // On grid lines consider both neighboring rectangles, so outer boundaries work
    // without making success depend on which side floor selects.
    const xs = x === center(nx) ? [nx, nx - 1] : [Math.floor(qx)];
    const ys = y === center(ny) ? [ny, ny - 1] : [Math.floor(qy)];
    let reason: Extract<GroundSurfaceResult, { status: 'unavailable' }>['reason'] = 'outside-support';
    for (const ix of xs) for (const iy of ys) {
      const corners = [cells.get(key(ix, iy)), cells.get(key(ix + 1, iy)), cells.get(key(ix, iy + 1)), cells.get(key(ix + 1, iy + 1))];
      if (corners.some(c => !c)) continue;
      const supported = corners as Readonly<GroundCell>[];
      if (supported.some(c => c.points < minimumSupport)) { reason = 'insufficient-support'; continue; }
      const [sw, se, nw, ne] = supported;
      const width = center(ix + 1) - center(ix), height = center(iy + 1) - center(iy);
      const u = (x - center(ix)) / width, v = (y - center(iy)) / height;
      if (![width, height, u, v].every(Number.isFinite) || width <= 0 || height <= 0 || u < 0 || u > 1 || v < 0 || v > 1) {
        reason = 'numeric-range'; continue;
      }
      const slopes = [Math.hypot((se.elevation - sw.elevation) / width, (ne.elevation - se.elevation) / height),
        Math.hypot((ne.elevation - nw.elevation) / width, (nw.elevation - sw.elevation) / height)];
      if (!slopes.every(Number.isFinite)) { reason = 'numeric-range'; continue; }
      if (slopes.some(s => s > maxSlope)) { reason = 'slope-limit'; continue; }
      // Convex barycentric sums avoid extrapolation and unnecessary subtraction overflow.
      const elevation = v <= u ? (1 - u) * sw.elevation + (u - v) * se.elevation + v * ne.elevation :
        (1 - v) * sw.elevation + (v - u) * nw.elevation + u * ne.elevation;
      return available(elevation, supported, 'cell-center-triangulation-v1');
    }
    return unavailable(reason);
  } });
}
