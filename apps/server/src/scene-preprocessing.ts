import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { open, lstat, realpath, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
import { SemanticArtifact, SEMANTIC_LIMITS, digest, requireData } from './semantic-artifact';
import { getSemanticDiskIndex, recordBytes } from './semantic-disk-index';
import type { InstanceManifest, SemanticInstance } from './semantic-instances';

type XYZ = [number, number, number];
export interface Bounds { min: XYZ; max: XYZ }
export interface PointStatistics { points: number; mean: XYZ; xx: number; xy: number; yy: number; bounds: Bounds }
export function pointStatistics(): PointStatistics {
  return { points: 0, mean: [0, 0, 0], xx: 0, xy: 0, yy: 0,
    bounds: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] } };
}
/** Stable Welford sufficient statistics: no source point arrays are retained. */
export function accumulatePoint(s: PointStatistics, p: readonly number[]) {
  if (p.length !== 3 || p.some(n => !Number.isFinite(n))) throw new RangeError('Invalid local-meter point');
  const dx = p[0] - s.mean[0], dy = p[1] - s.mean[1]; s.points++;
  for (let a = 0; a < 3; a++) {
    s.mean[a] += (p[a] - s.mean[a]) / s.points;
    s.bounds.min[a] = Math.min(s.bounds.min[a], p[a]); s.bounds.max[a] = Math.max(s.bounds.max[a], p[a]);
  }
  s.xx += dx * (p[0] - s.mean[0]); s.xy += dx * (p[1] - s.mean[1]); s.yy += dy * (p[1] - s.mean[1]);
}
export interface PrimitiveFit {
  kind: 'vertical-cylinder' | 'pca-xy-box' | 'footprint-height-extrusion';
  status: 'fitted' | 'insufficient' | 'degenerate';
  center: XYZ; yawRadians: number; dimensions: XYZ; radius?: number;
  rmseMeters: number | null; coverage: number | null; toleranceMeters: number; evaluatedPoints: number;
  qualityScore: number | null; qualityMeaning: 'coverage-times-exp-negative-normalized-rmse; heuristic-not-CAD-validity';
}
export function initialPrimitiveFit(s: PointStatistics, label: number, toleranceMeters = .2): PrimitiveFit | undefined {
  if (![4, 6, 7].includes(label)) return;
  const height = s.bounds.max[2] - s.bounds.min[2], radius = Math.sqrt(Math.max(0, (s.xx + s.yy) / s.points));
  const yaw = label === 6 ? 0 : .5 * Math.atan2(2 * s.xy, s.xx - s.yy);
  return { kind: label === 6 ? 'vertical-cylinder' : label === 4 ? 'footprint-height-extrusion' : 'pca-xy-box',
    status: s.points < 6 ? 'insufficient' : height <= 1e-6 || radius <= 1e-6 ? 'degenerate' : 'fitted',
    center: [s.mean[0], s.mean[1], (s.bounds.min[2] + s.bounds.max[2]) / 2], yawRadians: yaw,
    dimensions: [radius * 2, radius * 2, height], ...(label === 6 ? { radius } : {}),
    rmseMeters: null, coverage: null, toleranceMeters, evaluatedPoints: 0, qualityScore: null,
    qualityMeaning: 'coverage-times-exp-negative-normalized-rmse; heuristic-not-CAD-validity' };
}
/** Euclidean distance to finite primitive surface (not volume containment). */
export function primitiveResidual(f: PrimitiveFit, p: readonly number[]): number {
  const dx = p[0] - f.center[0], dy = p[1] - f.center[1];
  if (f.kind === 'vertical-cylinder') {
    const r = Math.hypot(dx, dy) - f.radius!, z = Math.abs(p[2] - f.center[2]) - f.dimensions[2] / 2;
    return r <= 0 && z <= 0 ? Math.min(-r, -z) : Math.hypot(Math.max(0, r), Math.max(0, z));
  }
  const c = Math.cos(f.yawRadians), s = Math.sin(f.yawRadians);
  const q = [Math.abs(c * dx + s * dy) - f.dimensions[0] / 2,
    Math.abs(-s * dx + c * dy) - f.dimensions[1] / 2, Math.abs(p[2] - f.center[2]) - f.dimensions[2] / 2];
  return q.every(n => n <= 0) ? -Math.max(...q) : Math.hypot(...q.map(n => Math.max(0, n)));
}
export interface GroundCell { x: number; y: number; elevation: number; points: number; maxElevation: number }
export interface GroundModel {
  cellMeters: number; origin: [0, 0]; labels: readonly [1, 2]; method: 'observed-cell-minimum-v1';
  minimumSupport: number; points: number; cells: GroundCell[];
  limitation: 'Lower envelope of Ground/Road_markings only; sensitive to low outliers; no interpolation or extrapolation';
}
/** Query only an observed supported cell. Missing/unsupported cells have no elevation. */
export function groundElevation(ground: GroundModel, x: number, y: number): number | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Invalid ground query');
  const ix = Math.floor(x / ground.cellMeters), iy = Math.floor(y / ground.cellMeters);
  const cell = ground.cells.find(c => c.x === ix && c.y === iy);
  return cell && cell.points >= ground.minimumSupport ? cell.elevation : undefined;
}
export interface ScenePreprocessing {
  version: 'scene-preprocessing-v1'; complete: true;
  binding: InstanceManifest['binding'] & { instanceManifestHash: string; membershipHash: string };
  settings: { algorithm: 'streaming-ground-primitives-v1'; residual: 'distance-to-finite-surface'; toleranceMeters: number };
  instances: (SemanticInstance & { bounds: Bounds; fit?: PrimitiveFit })[];
  ground: GroundModel;
  statistics: { totalSourcePoints: number; memberships: number; indexPasses: 3; fitted: number; insufficient: number; degenerate: number };
  limitation: 'Derived original-source observations, not edited effective coordinates, physical-instance certification or CAD solids';
}
export const PREPROCESSING_LIMITS = Object.freeze({ maxInstances: 100_000, maxGroundCells: 250_000,
  maxManifestBytes: 64 * 1024 * 1024, maxOutputBytes: 128 * 1024 * 1024,
  maxMembershipBytes: 512 * 1024 * 1024, maxMilliseconds: 10 * 60 * 1000 });
export interface PreprocessingOptions {
  signal?: AbortSignal; limits?: Partial<Record<keyof typeof PREPROCESSING_LIMITS, number>>;
  cellMeters?: number; toleranceMeters?: number;
}
const sameStat = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/** Complete-only offline derivation. Three checked page scans; O(instances + occupied ground cells) memory. */
export async function prepareScenePreprocessing(datasetRoot: string, instanceDir: string, output: string,
  options: PreprocessingOptions = {}): Promise<ScenePreprocessing> {
  const limits = { ...PREPROCESSING_LIMITS, ...options.limits }, cellMeters = options.cellMeters ?? 2, toleranceMeters = options.toleranceMeters ?? .2;
  if (Object.entries(limits).some(([k, n]) => !Number.isSafeInteger(n) || n <= 0 || n > PREPROCESSING_LIMITS[k as keyof typeof limits]) ||
    !Number.isFinite(cellMeters) || cellMeters < .1 || cellMeters > 100 || !Number.isFinite(toleranceMeters) || toleranceMeters <= 0 || toleranceMeters > 10) throw new RangeError('Invalid preprocessing settings/budgets');
  const started = performance.now();
  // Include cold disk-index preparation in the same deadline, not only our page scans.
  const signal = AbortSignal.any([AbortSignal.timeout(limits.maxMilliseconds), ...(options.signal ? [options.signal] : [])]);
  const checkpoint = () => { signal.throwIfAborted(); if (performance.now() - started > limits.maxMilliseconds) throw new RangeError('Preprocessing time budget exceeded'); };
  checkpoint(); instanceDir = await realpath(instanceDir);
  const secureOpen = async (name: string, max: number) => {
    const path = join(instanceDir, name); requireData(await realpath(path) === path, 'Symlinked instance asset');
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const stat = await file.stat(); requireData(stat.isFile() && stat.size <= max, 'Instance asset budget exceeded'); return { file, stat, path }; }
    catch (e) { await file.close(); throw e; }
  };
  const manifestAsset = await secureOpen('manifest.json', limits.maxManifestBytes);
  let membershipAsset: Awaited<ReturnType<typeof secureOpen>> | undefined, snapshot: SemanticArtifact | undefined;
  let staging: string | undefined;
  try {
    const manifestBytes = Buffer.alloc(manifestAsset.stat.size);
    requireData((await manifestAsset.file.read(manifestBytes, 0, manifestBytes.length, 0)).bytesRead === manifestBytes.length, 'Truncated instance manifest'); checkpoint();
    const m: InstanceManifest = JSON.parse(manifestBytes.toString());
    requireData(m?.version === 'semantic-instances-v1' && m.complete === true && Array.isArray(m.instances) &&
      m.instances.length <= limits.maxInstances && m.membership?.file === 'memberships.bin' && m.membership.recordBytes === 16 &&
      Number.isSafeInteger(m.membership.points) && m.membership.points >= 0 && m.membership.bytes === m.membership.points * 16 &&
      /^[a-f0-9]{64}$/.test(m.membership.sha256) && Array.isArray(m.settings?.classes), 'Invalid instance manifest');
    const selected = new Set(m.settings.classes.map(c => c.label));
    requireData(selected.size === m.settings.classes.length && selected.size > 0 && [...selected].every(l => [4, 6, 7, 8].includes(l)), 'Invalid instance classes');
    const ids = new Set<string>();
    for (const i of m.instances) {
      requireData(i && typeof i.id === 'string' && /^instance-[a-f0-9]{64}$/.test(i.id) && !ids.has(i.id) && selected.has(i.label) &&
        i.name === TORONTO_SEMANTIC_LABELS[i.label as SemanticInstance['label']] && Number.isSafeInteger(i.points) && i.points > 0, 'Invalid instance metadata'); ids.add(i.id);
    }
    membershipAsset = await secureOpen('memberships.bin', limits.maxMembershipBytes);
    requireData(membershipAsset.stat.size === m.membership.bytes, 'Invalid membership bytes');
    snapshot = await SemanticArtifact.open(datasetRoot, signal);
    const { index } = await getSemanticDiskIndex(snapshot, signal); checkpoint();
    requireData(m.binding?.datasetId === snapshot.dataset.id && m.binding.artifactRevision === snapshot.dataset.revision &&
      m.binding.indexHash === index.hash && m.binding.sourceHash === index.sourceHash && m.binding.frameId === 'toronto3d-local-v1' &&
      m.binding.units === 'm' && JSON.stringify(m.binding.coordinates) === JSON.stringify(snapshot.dataset.coordinates) &&
      m.statistics?.totalSourcePoints === index.totalPoints && m.statistics.selectedPoints === m.membership.points &&
      [...selected].reduce((n, l) => n + index.counts[l], 0) === m.membership.points, 'Instance source/index binding mismatch');
    // Independently hash the complete original payload once; checked pages then supply all coordinates.
    const sourceHash = createHash('sha256');
    for (let at = 0; at < snapshot.payloadSize; at += SEMANTIC_LIMITS.readBytes) {
      checkpoint(); sourceHash.update(await snapshot.read('payload', at, Math.min(SEMANTIC_LIMITS.readBytes, snapshot.payloadSize - at), signal)); await yieldTurn();
    }
    requireData(sourceHash.digest('hex') === index.sourceHash, 'Original source checksum mismatch');
    const stats = m.instances.map(() => pointStatistics()), groundCells = new Map<string, GroundCell>();
    const fits: (PrimitiveFit | undefined)[] = [], projected = m.instances.map(() => ({ min: [Infinity, Infinity], max: [-Infinity, -Infinity] }));
    const residualSquares = new Float64Array(m.instances.length), covered = new Uint32Array(m.instances.length);
    let groundPoints = 0;
    const checkAssets = async () => {
      for (const asset of [manifestAsset, membershipAsset!]) requireData(sameStat(asset.stat, await asset.file.stat()) &&
        sameStat(asset.stat, await lstat(asset.path)) && await realpath(asset.path) === asset.path, 'Instance asset changed');
      await snapshot!.check(signal); await index.check(signal); checkpoint();
    };
    const buffer = Buffer.alloc(64 * 1024);
    for (let pass = 0; pass < 3; pass++) {
      let consumed = 0, used = 0, loaded = 0; const hash = createHash('sha256');
      const counts: Uint32Array = new Uint32Array(m.instances.length);
      await checkAssets();
      for (const page of index.pages) {
        checkpoint();
        const bytes = await index.readPage(page, signal);
        for (let at = 0; at < bytes.length; at += recordBytes) {
          const label = bytes.readUInt32LE(at + 36);
          if (!selected.has(label as 4 | 6 | 7 | 8) && !(pass === 0 && (label === 1 || label === 2))) continue;
          const p: XYZ = [bytes.readDoubleLE(at), bytes.readDoubleLE(at + 8), bytes.readDoubleLE(at + 16)];
          requireData(p.every(Number.isFinite), 'Invalid indexed point');
          if (pass === 0 && (label === 1 || label === 2)) {
            const x = Math.floor(p[0] / cellMeters), y = Math.floor(p[1] / cellMeters);
            requireData(Number.isSafeInteger(x) && Number.isSafeInteger(y), 'Invalid ground cell');
            const key = `${x},${y}`, cell = groundCells.get(key);
            if (cell) { cell.points++; cell.elevation = Math.min(cell.elevation, p[2]); cell.maxElevation = Math.max(cell.maxElevation, p[2]); }
            else { if (groundCells.size >= limits.maxGroundCells) throw new RangeError('Ground cell budget exceeded'); groundCells.set(key, { x, y, elevation: p[2], maxElevation: p[2], points: 1 }); }
            groundPoints++; continue;
          }
          if (used === loaded) {
            const wanted = Math.min(buffer.length, m.membership.bytes - consumed); requireData(wanted >= 16, 'Missing membership');
            requireData((await membershipAsset.file.read(buffer, 0, wanted, consumed)).bytesRead === wanted, 'Truncated membership');
            loaded = wanted; used = 0; hash.update(buffer.subarray(0, loaded));
          }
          const ordinal = buffer.readUInt32LE(used);
          requireData(ordinal < m.instances.length && m.instances[ordinal].label === label &&
            buffer.readUInt32LE(used + 4) === bytes.readUInt32LE(at + 24) && buffer.readUInt32LE(used + 8) === bytes.readUInt32LE(at + 28) &&
            buffer.readUInt32LE(used + 12) === bytes.readUInt32LE(at + 32), 'Membership/source mismatch');
          used += 16; consumed += 16; counts[ordinal]++;
          if (pass === 0) accumulatePoint(stats[ordinal], p);
          else if (pass === 1) {
            const f = fits[ordinal]; if (!f || f.kind === 'vertical-cylinder') continue;
            const dx = p[0] - stats[ordinal].mean[0], dy = p[1] - stats[ordinal].mean[1], c = Math.cos(f.yawRadians), s = Math.sin(f.yawRadians);
            const xy = [c * dx + s * dy, -s * dx + c * dy], b = projected[ordinal];
            for (let a = 0; a < 2; a++) { b.min[a] = Math.min(b.min[a], xy[a]); b.max[a] = Math.max(b.max[a], xy[a]); }
          } else {
            const f = fits[ordinal]; if (!f || f.status !== 'fitted') continue;
            const r = primitiveResidual(f, p); residualSquares[ordinal] += r * r; if (r <= toleranceMeters) covered[ordinal]++;
          }
        }
        await yieldTurn();
      }
      requireData(consumed === m.membership.bytes && hash.digest('hex') === m.membership.sha256 &&
        m.instances.every((i, n) => i.points === counts[n]), 'Membership checksum/count mismatch');
      if (pass === 0) stats.forEach((s, i) => { fits[i] = initialPrimitiveFit(s, m.instances[i].label, toleranceMeters); });
      if (pass === 1) fits.forEach((f, i) => {
        if (!f || f.kind === 'vertical-cylinder') return;
        const b = projected[i], u = (b.min[0] + b.max[0]) / 2, v = (b.min[1] + b.max[1]) / 2, c = Math.cos(f.yawRadians), s = Math.sin(f.yawRadians);
        f.center[0] = stats[i].mean[0] + c * u - s * v; f.center[1] = stats[i].mean[1] + s * u + c * v;
        f.dimensions[0] = b.max[0] - b.min[0]; f.dimensions[1] = b.max[1] - b.min[1];
        if (f.status === 'fitted' && f.dimensions.some(n => n <= 1e-6)) f.status = 'degenerate';
      });
      await checkAssets();
    }
    fits.forEach((f, i) => { if (f?.status === 'fitted') {
      f.evaluatedPoints = stats[i].points; f.rmseMeters = Math.sqrt(residualSquares[i] / stats[i].points);
      f.coverage = covered[i] / stats[i].points; f.qualityScore = f.coverage * Math.exp(-f.rmseMeters / toleranceMeters);
    } });
    const artifact: ScenePreprocessing = { version: 'scene-preprocessing-v1', complete: true,
      binding: { ...m.binding, instanceManifestHash: digest(manifestBytes), membershipHash: m.membership.sha256 },
      settings: { algorithm: 'streaming-ground-primitives-v1', residual: 'distance-to-finite-surface', toleranceMeters },
      instances: m.instances.map((i, n) => ({ ...i, bounds: stats[n].bounds, ...(fits[n] ? { fit: fits[n] } : {}) })),
      ground: { cellMeters, origin: [0, 0], labels: [1, 2], method: 'observed-cell-minimum-v1', minimumSupport: 3,
        points: groundPoints, cells: [...groundCells.values()].sort((a, b) => a.x - b.x || a.y - b.y),
        limitation: 'Lower envelope of Ground/Road_markings only; sensitive to low outliers; no interpolation or extrapolation' },
      statistics: { totalSourcePoints: index.totalPoints, memberships: m.membership.points, indexPasses: 3,
        fitted: fits.filter(f => f?.status === 'fitted').length, insufficient: fits.filter(f => f?.status === 'insufficient').length,
        degenerate: fits.filter(f => f?.status === 'degenerate').length },
      limitation: 'Derived original-source observations, not edited effective coordinates, physical-instance certification or CAD solids' };
    // Conservative pre-encoding bound plus actual encoded bound keep JSON allocation bounded.
    if (artifact.instances.length * 2048 + groundCells.size * 256 + 8192 > limits.maxOutputBytes) throw new RangeError('Preprocessing output budget exceeded');
    const encoded = JSON.stringify(artifact); if (Buffer.byteLength(encoded) > limits.maxOutputBytes) throw new RangeError('Preprocessing output budget exceeded');
    output = resolve(output); await mkdir(dirname(output), { recursive: true }); output = join(await realpath(dirname(output)), basename(output));
    const absent = async () => { try { await lstat(output); throw new Error('Preprocessing output already exists'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } };
    await absent(); staging = await mkdtemp(join(dirname(output), '.preprocessing-building-'));
    await writeFile(join(staging, 'manifest.json'), encoded + '\n', { flag: 'wx', mode: 0o600 });
    await checkAssets(); await absent(); await rename(staging, output); return artifact;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await manifestAsset.file.close(); await membershipAsset?.file.close(); await snapshot?.close();
  }
}
