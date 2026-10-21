import { constants, type Stats } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCropBox, TORONTO_SEMANTIC_LABELS, type CropBox, type DatasetInfo } from '@spatial/contracts';
import type { PrimitiveFit, ScenePreprocessing } from './scene-preprocessing';

export const DEFAULT_PREPROCESSING_PATH = fileURLToPath(new URL('../../../../data/processed/toronto3d/preprocessing/manifest.json', import.meta.url));
export const SUMMARY_LIMITS = { fileBytes: 64 * 1024 * 1024, responseBytes: 1024 * 1024, instances: 2000, cells: 10000 } as const;
const vector = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const sameStat = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
function requireValid(v: unknown): asserts v { if (!v) throw new Error('Invalid preprocessing artifact'); }
export function validSummaryFit(f: PrimitiveFit, points: number, label?: number): boolean {
  const expectedKind = label === 6 ? 'vertical-cylinder' : label === 4 ? 'footprint-height-extrusion' : label === 7 ? 'pca-xy-box' : undefined;
  // Small serialization/roundoff tolerance, not a minimum acceptable fit quality.
  const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  return !!f && ['vertical-cylinder', 'pca-xy-box', 'footprint-height-extrusion'].includes(f.kind) &&
    (expectedKind === undefined || f.kind === expectedKind) &&
    ['fitted', 'insufficient', 'degenerate'].includes(f.status) && vector(f.center) && vector(f.dimensions) &&
    f.dimensions.every(n => n >= 0 && (f.status !== 'fitted' || n > 0)) && Number.isFinite(f.yawRadians) &&
    (f.kind !== 'vertical-cylinder' || (Number.isFinite(f.radius) && f.radius! >= 0 && (f.status !== 'fitted' || f.radius! > 0) &&
      f.dimensions.slice(0, 2).every(n => close(n, 2 * f.radius!)))) &&
    Number.isFinite(f.toleranceMeters) && f.toleranceMeters > 0 && Number.isSafeInteger(f.evaluatedPoints) && f.evaluatedPoints >= 0 && f.evaluatedPoints <= points &&
    (f.status !== 'fitted' || (f.evaluatedPoints === points && f.rmseMeters !== null && f.coverage !== null && f.qualityScore !== null &&
      close(f.qualityScore, f.coverage * Math.exp(-f.rmseMeters / f.toleranceMeters)))) &&
    (f.rmseMeters === null || (Number.isFinite(f.rmseMeters) && f.rmseMeters >= 0)) &&
    [f.coverage, f.qualityScore].every(n => n === null || (Number.isFinite(n) && n >= 0 && n <= 1)) &&
    f.qualityMeaning === 'coverage-times-exp-negative-normalized-rmse; heuristic-not-CAD-validity';
}
/** Full fixed-path artifact for queries; never use the capped display summary as a terrain model.
 * Validates recorded binding, not a fresh original-payload hash audit. Never generates artifacts.
 */
export async function readPreprocessing(dataset: DatasetInfo, path = process.env.SPATIAL_PREPROCESSING_PATH ?? DEFAULT_PREPROCESSING_PATH, signal?: AbortSignal): Promise<ScenePreprocessing> {
    signal?.throwIfAborted();
    path = resolve(path); path = join(await realpath(dirname(path)), basename(path));
    requireValid(await realpath(path) === path);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let m: ScenePreprocessing;
    try {
      const stat = await file.stat(); requireValid(stat.isFile() && stat.size > 0 && stat.size <= SUMMARY_LIMITS.fileBytes);
      const bytes = Buffer.alloc(stat.size); let at = 0;
      while (at < bytes.length) { signal?.throwIfAborted(); const r = await file.read(bytes, at, Math.min(65536, bytes.length - at), at); requireValid(r.bytesRead > 0); at += r.bytesRead; }
      requireValid(sameStat(stat, await file.stat()) && sameStat(stat, await lstat(path)) && await realpath(path) === path);
      m = JSON.parse(bytes.toString());
    } finally { await file.close(); }
    requireValid(m?.version === 'scene-preprocessing-v1' && m.complete === true && m.binding?.datasetId === dataset.id &&
      m.binding.artifactRevision === dataset.revision && m.binding.frameId === 'toronto3d-local-v1' && m.binding.units === 'm' &&
      JSON.stringify(m.binding.coordinates) === JSON.stringify(dataset.coordinates) &&
      [m.binding.indexHash, m.binding.sourceHash, m.binding.instanceManifestHash, m.binding.membershipHash].every(hash) &&
      Array.isArray(m.instances) && m.instances.length <= 100000);
    const ids = new Set<string>();
    for (const o of m.instances) {
      requireValid(o && typeof o.id === 'string' && /^instance-[a-f0-9]{64}$/.test(o.id) && !ids.has(o.id) &&
        [4, 6, 7, 8].includes(o.label) && o.name === TORONTO_SEMANTIC_LABELS[o.label] && positive(o.points) &&
        o.bounds && vector(o.bounds.min) && vector(o.bounds.max) && o.bounds.min.every((n, i) => n <= o.bounds.max[i]) &&
        (o.fit === undefined || validSummaryFit(o.fit, o.points, o.label))); ids.add(o.id);
    }
    const g = m.ground;
    requireValid(g && Number.isFinite(g.cellMeters) && g.cellMeters >= .1 && g.cellMeters <= 100 &&
      JSON.stringify(g.origin) === '[0,0]' && JSON.stringify(g.labels) === '[1,2]' && g.method === 'observed-cell-minimum-v1' &&
      g.minimumSupport === 3 && Array.isArray(g.cells) && g.cells.length <= 250000);
    const cellsSeen = new Set<string>();
    for (const c of g.cells) {
      const key = `${c?.x},${c?.y}`;
      requireValid(c && Number.isSafeInteger(c.x) && Number.isSafeInteger(c.y) && Number.isFinite(c.x * g.cellMeters) && Number.isFinite(c.y * g.cellMeters) &&
        Number.isFinite(c.elevation) && Number.isFinite(c.maxElevation) && c.elevation <= c.maxElevation && positive(c.points) && !cellsSeen.has(key)); cellsSeen.add(key);
    }
    signal?.throwIfAborted();
    return m;
}

/** Read only a fixed operator path; never build an index or preprocess on an eye click. */
export async function preprocessingSummary(dataset: DatasetInfo, bounds?: CropBox, path = process.env.SPATIAL_PREPROCESSING_PATH ?? DEFAULT_PREPROCESSING_PATH, signal?: AbortSignal) {
  const base = { version: 'toronto-preprocessing-v1' as const, datasetId: 'toronto3d' as const, artifactRevision: dataset.revision,
    frameId: 'toronto3d-local-v1' as const, units: 'm' as const };
  try {
    if (bounds) assertCropBox(bounds);
    const m = await readPreprocessing(dataset, path, signal), g = m.ground;
    const intersects = (b: CropBox) => !bounds || b.min.every((n, i) => n <= bounds.max[i] && b.max[i] >= bounds.min[i]);
    const candidates = m.instances.filter(o => intersects(o.bounds));
    const groundCandidates = g.cells.filter(c => c.points >= g.minimumSupport && intersects({ min: [c.x * g.cellMeters, c.y * g.cellMeters, c.elevation], max: [(c.x + 1) * g.cellMeters, (c.y + 1) * g.cellMeters, c.elevation] }));
    const overlays = candidates.slice(0, SUMMARY_LIMITS.instances).map(({ id, label, name, points, bounds, fit }) => ({ id, label, name, points, bounds, ...(fit ? { fit } : {}) }));
    const cells = groundCandidates.slice(0, SUMMARY_LIMITS.cells);
    const result = { ...base, status: (overlays.length || cells.length ? 'ready' : 'empty') as 'ready' | 'empty',
      message: 'Original-source derived observations: purple instance bounds, amber approximate fits, green supported observed-cell minima (no interpolation). Not edited geometry or verified CAD.',
      overlays, ground: { cellMeters: g.cellMeters, origin: g.origin, minimumSupport: 3, method: g.method, cells },
      truncated: candidates.length > overlays.length || groundCandidates.length > cells.length };
    // Preserve explicit truncation even when high-precision fit payloads hit the byte cap first.
    while (Buffer.byteLength(JSON.stringify(result)) > SUMMARY_LIMITS.responseBytes) {
      result.truncated = true;
      if (cells.length) cells.splice(Math.floor(cells.length * .8));
      else if (overlays.length) overlays.splice(Math.floor(overlays.length * .8));
      else throw new Error('Summary budget');
    }
    return result;
  } catch (e) {
    signal?.throwIfAborted();
    return { ...base, status: 'unavailable' as const, message: 'Preprocessing unavailable: offline artifact missing, malformed, stale or over budget. Run offline preparation; no work was started by this request.', overlays: [], truncated: false };
  }
}
