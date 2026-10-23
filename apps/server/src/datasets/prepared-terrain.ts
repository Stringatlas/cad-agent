import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readFile, realpath, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalTerrainArgs, type ElevationGrid, type TerrainInfo, type TerrainOperation, type TerrainResult } from '@spatial/contracts';
import type { openPreparedElevation } from './prepared-elevation';

const worker = fileURLToPath(new URL('../../../../scripts/terrain-worker.py', import.meta.url));
const python = process.env.SPATIAL_TERRAIN_PYTHON ?? fileURLToPath(new URL('../../../../data/processed/toronto3d/tooling/venv/bin/python', import.meta.url));
const signature = (s: Awaited<ReturnType<typeof lstat>>) => JSON.stringify([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs]);
let active = 0, runtimeReady: Promise<boolean> | undefined;
const verified = new Map<string, string>();

function execute(request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  signal?.throwIfAborted();
  if (active >= 2) throw new Error('Terrain analysis busy; retry shortly');
  active++;
  return new Promise((resolve, reject) => {
    const child = execFile(python, ['-B', worker], { signal, timeout: 8000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', GDAL_CACHEMAX: '32', PYTHONDONTWRITEBYTECODE: '1' } }, (error, stdout) => {
      active--;
      if (error) { reject(new Error(signal?.aborted ? 'Terrain analysis cancelled' : 'Terrain analysis unavailable or request exceeds bounds')); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid terrain analysis result')); }
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify(request));
  });
}

/** Optional adapter: Python scientific wheels are an explicit operator dependency. */
export async function openPreparedTerrain(directory: string, elevation: NonNullable<Awaited<ReturnType<typeof openPreparedElevation>>>, signal?: AbortSignal) {
  await elevation.check(signal);
  const base = join(await realpath(directory), 'elevation'), root = join(base, 'terrain');
  const manifestPath = join(root, 'manifest.json');
  let initial;
  try { initial = await lstat(manifestPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  if (!initial.isFile() || initial.size > 16384 || await realpath(manifestPath) !== manifestPath) throw new Error('Invalid terrain manifest');
  const raw = await readFile(manifestPath), model = JSON.parse(raw.toString());
  const { info } = elevation, method = model.method, range = model.slope;
  if (model.version !== 1 || model.elevationRevision !== info.revision || model.sourceRevision !== info.sourceRevision || method?.algorithm !== 'GDAL-Horn' || method.unit !== 'degree' || method.neighborhood !== 3 || method.scale !== info.grid.resolution || method.horizontalVerticalRatio !== 1 || method.edges !== 'nodata' || method.interpolation !== 'none' || !Number.isSafeInteger(range?.validCells) || range.validCells < 0 || range.validCells > info.grid.width * info.grid.height || (range.validCells ? ![range.min, range.max].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 90) || range.min > range.max : range.min !== null || range.max !== null)) throw new Error('Stale or invalid terrain model');
  const path = join(root, 'slope.tif'), stat = await lstat(path);
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024 || model.asset?.bytes !== stat.size || !/^[a-f0-9]{64}$/.test(model.asset.sha256) || await realpath(path) !== path) throw new Error('Invalid terrain raster');
  const key = path + signature(stat), expected = model.asset.sha256;
  if (verified.get(key) !== expected) {
    if (createHash('sha256').update(await readFile(path)).digest('hex') !== expected) throw new Error('Terrain raster checksum mismatch');
    if (verified.size >= 128) verified.clear(); verified.set(key, expected);
  }
  // Runtime readiness is cached for this process. Restart after installing/changing wheels.
  runtimeReady ??= (async () => {
    try { await access(python); return await new Promise<boolean>(resolve => execFile(python, ['-B', '-c', 'import rasterio, numpy, scipy, shapely, PIL'], { timeout: 5000 }, error => resolve(!error))); }
    catch { return false; }
  })();
  if (!await runtimeReady) return undefined;
  const terrainInfo: TerrainInfo = { revision: createHash('sha256').update(raw).digest('hex'), elevationRevision: info.revision, method, slope: range };
  const check = async (querySignal?: AbortSignal) => {
    signal?.throwIfAborted(); querySignal?.throwIfAborted(); await elevation.check(querySignal);
    for (const [file, expectedStat] of [[manifestPath, initial], [path, stat]] as const) {
      if (await realpath(file) !== file || signature(await lstat(file)) !== signature(expectedStat)) throw new Error('Terrain model changed');
    }
    signal?.throwIfAborted(); querySignal?.throwIfAborted();
  };
  await check();
  return {
    info: terrainInfo, check,
    async analyze(operation: TerrainOperation, input: unknown, querySignal: AbortSignal): Promise<TerrainResult> {
      const args = canonicalTerrainArgs(operation, input), combined = AbortSignal.any([signal, querySignal].filter((s): s is AbortSignal => !!s));
      await check(combined);
      const result = await execute({ root: base, grid: info.grid, operation, args }, combined); await check(combined);
      const image = result.image as TerrainResult['image']; delete result.image;
      if (image) {
        const bytes = Buffer.from(image.dataUrl?.replace(/^data:image\/png;base64,/, '') ?? '', 'base64');
        if (operation !== 'terrain_image' || image.mimeType !== 'image/png' || !image.dataUrl.startsWith('data:image/png;base64,') || bytes.length !== image.byteLength || bytes.length > 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new Error('Invalid terrain image');
      }
      return { kind: 'terrain-analysis', operation, queryId: createHash('sha256').update(JSON.stringify([terrainInfo.revision, operation, args])).digest('hex'), cloudId: info.cloudId, frameId: info.frameId, units: 'm', localOrigin: info.localOrigin,
        sourceRevision: info.sourceRevision, modelRevision: info.revision, terrainRevision: terrainInfo.revision, resolution: info.grid.resolution,
        slopeMethod: method, evidenceScope: 'Original raster cell summaries; no accepted edits, source-point provenance, clearance or suitability certification. NoData is unknown.', result, ...(image ? { image } : {}) };
    },
    async grid(maxSize: number, querySignal: AbortSignal): Promise<ElevationGrid> {
      if (!Number.isInteger(maxSize) || maxSize < 16 || maxSize > 192) throw new Error('Invalid terrain preview size');
      const combined = AbortSignal.any([signal, querySignal].filter((s): s is AbortSignal => !!s));
      await check(combined);
      const result = await execute({ root: base, grid: info.grid, operation: 'grid', args: { maxSize } }, combined); await check(combined);
      const width = result.width as number, height = result.height as number;
      return { info: { ...info, terrain: terrainInfo }, layer: 'dtm', width, height, origin: info.grid.origin, cellSize: [info.grid.width * info.grid.resolution / width, info.grid.height * info.grid.resolution / height],
        values: result.values as (number | null)[], resampling: 'nearest', color: { kind: 'slope', units: 'degrees', values: result.colors as (number | null)[], min: range.min, max: range.max } };
    },
  };
}
