import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fromFile } from 'geotiff';
import { canonicalElevationCoordinates, type ElevationGrid, type ElevationInfo, type ElevationLayer, type ElevationQuery } from '@spatial/contracts';
import type { PreparedCloudInfo } from './prepared-cloud';

const files = ['dtm.tif', 'dsm.tif', 'support.tif', 'ground-range.tif'] as const;
type RasterName = typeof files[number];
const identity = (s: Awaited<ReturnType<typeof lstat>>) => JSON.stringify([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs]);
const cached = new Map<string, string>();
const checked = (ok: unknown, reason: string): void => { if (!ok) throw new Error(reason); };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7;
const nullable = (n: number) => Number.isFinite(n) ? n : null;

/** Standard GeoTIFF reader. Paths are derived exclusively from operator-owned registrations. */
export async function openPreparedElevation(directory: string, source: PreparedCloudInfo, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const root = join(await realpath(directory), 'elevation'), manifestPath = join(root, 'manifest.json');
  let initial;
  try { initial = await lstat(manifestPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  checked(initial.isFile() && !initial.isSymbolicLink() && initial.size <= 256 * 1024 && await realpath(manifestPath) === manifestPath, 'Invalid elevation manifest');
  const raw = await readFile(manifestPath), model = JSON.parse(raw.toString('utf8'));
  const d = source.descriptor, grid = model.grid, settings = model.settings;
  checked(model.version === 1 && model.kind === 'classified-dtm-observed-dsm-v1' && model.source?.revision === source.revision && model.source?.descriptor?.id === d.id && model.source?.descriptor?.frameId === d.frameId && JSON.stringify(model.source?.descriptor?.coordinates) === JSON.stringify(d.coordinates), 'Stale elevation source binding');
  checked(grid && Number.isSafeInteger(grid.width) && Number.isSafeInteger(grid.height) && grid.width > 0 && grid.height > 0 && grid.width * grid.height <= 4000000 && finite(grid.resolution) && grid.resolution >= .25 && grid.resolution <= 10 && Array.isArray(grid.origin) && grid.origin.length === 2 && grid.origin.every(finite) && grid.rowDirection === 'south' && grid.pixelInterpretation === 'area', 'Invalid elevation grid');
  checked(settings?.dtmMethod === 'classified-ground-mean' && settings.dsmMethod === 'all-point-maximum' && settings.interpolation === 'none' && settings.nodata === 'NaN' && Number.isSafeInteger(settings.minimumGroundSupport) && settings.minimumGroundSupport >= 1 && settings.minimumGroundSupport <= 10000 && Array.isArray(settings.groundLabels) && settings.groundLabels.length > 0 && settings.groundLabels.length <= 65536 && new Set(settings.groundLabels).size === settings.groundLabels.length && settings.groundLabels.every((label: number) => Number.isInteger(label) && Object.hasOwn(d.semantics?.classes ?? {}, String(label))), 'Invalid elevation method');
  checked(model.coverage?.sourcePoints === source.totalPoints && Number.isSafeInteger(model.coverage?.groundPoints) && model.coverage.groundPoints >= 0 && model.coverage.groundPoints <= source.totalPoints, 'Invalid elevation coverage');
  for (const layer of ['dtm', 'dsm', 'ndsm']) {
    const range = model.layers?.[layer];
    checked(range && Number.isSafeInteger(range.validCells) && range.validCells >= 0 && range.validCells <= grid.width * grid.height && (range.validCells ? finite(range.min) && finite(range.max) && range.min <= range.max : range.min === null && range.max === null), 'Invalid elevation range');
  }
  const revision = createHash('sha256').update(raw).digest('hex');
  const info: ElevationInfo = { kind: 'elevation-model', cloudId: d.id, sourceRevision: source.revision, revision, frameId: d.frameId, units: 'm', localOrigin: d.coordinates.localOrigin,
    grid, settings, layers: model.layers, coverage: model.coverage };
  const identities = new Map<string, string>([['manifest.json', identity(initial)]]);
  for (const file of files) {
    signal?.throwIfAborted();
    const path = join(root, file), s = await lstat(path), asset = model.assets?.[file];
    checked(s.isFile() && !s.isSymbolicLink() && s.size <= 128 * 1024 * 1024 && await realpath(path) === path && asset?.bytes === s.size && /^[a-f0-9]{64}$/.test(asset.sha256), 'Invalid elevation asset');
    const key = path + identity(s), signature = `${revision}:${asset.sha256}`;
    if (cached.get(key) !== signature) {
      const hash = createHash('sha256');
      for await (const bytes of createReadStream(path, { signal })) hash.update(bytes);
      checked(hash.digest('hex') === asset.sha256, 'Elevation asset checksum mismatch');
      if (cached.size >= 256) cached.clear(); cached.set(key, signature);
    }
    identities.set(file, identity(s));
  }
  const check = async (querySignal?: AbortSignal) => {
    signal?.throwIfAborted(); querySignal?.throwIfAborted();
    for (const [file, expected] of identities) checked(await realpath(join(root, file)) === join(root, file) && identity(await lstat(join(root, file))) === expected, 'Elevation artifact changed');
    signal?.throwIfAborted(); querySignal?.throwIfAborted();
  };
  await check();
  const read = async (name: RasterName, window: number[], width: number, height: number, querySignal?: AbortSignal): Promise<Float64Array[]> => {
    const combined = AbortSignal.any([signal, querySignal].filter((s): s is AbortSignal => !!s)); combined.throwIfAborted();
    const tiff = await fromFile(join(root, name), combined);
    try {
      const image = await tiff.getImage(), origin = image.getOrigin(), resolution = image.getResolution();
      checked(image.getWidth() === grid.width && image.getHeight() === grid.height && image.getSamplesPerPixel() === (name === 'support.tif' || name === 'ground-range.tif' ? 2 : 1) && origin[0] === grid.origin[0] && origin[1] === grid.origin[1] && resolution[0] === grid.resolution && resolution[1] === -grid.resolution, 'GeoTIFF geometry mismatch');
      const values = await image.readRasters({ window, width, height, resampleMethod: 'nearest', signal: combined });
      combined.throwIfAborted(); return Array.from(values, band => Float64Array.from(band));
    } finally { await tiff.close(); }
  };
  return {
    info,
    async query(input: unknown, querySignal?: AbortSignal): Promise<ElevationQuery> {
      const { x, y } = canonicalElevationCoordinates(input); await check(querySignal);
      const column = Math.floor((x - grid.origin[0]) / grid.resolution), row = Math.floor((grid.origin[1] - y) / grid.resolution);
      const base = { kind: 'elevation-query' as const, cloudId: d.id, sourceRevision: source.revision, modelRevision: revision, frameId: d.frameId, units: 'm' as const, localOrigin: d.coordinates.localOrigin,
        position: [x, y] as const, methods: info.settings,
        evidenceScope: 'Original prepared source raster summaries; excludes accepted edits and pending geometry. NoData is not evidence of empty space.' as const };
      if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) return { ...base, status: 'outside-grid', cell: null, dtm: null, dsm: null, heightAboveGround: null, support: { groundPoints: 0, surfacePoints: 0, groundMin: null, groundMax: null } };
      const window = [column, row, column + 1, row + 1];
      // Separate reads keep memory bounded to GeoTIFF blocks; the library owns decompression/window indexing.
      const dtm = nullable((await read('dtm.tif', window, 1, 1, querySignal))[0][0]);
      const dsm = nullable((await read('dsm.tif', window, 1, 1, querySignal))[0][0]);
      const counts = await read('support.tif', window, 1, 1, querySignal), range = await read('ground-range.tif', window, 1, 1, querySignal);
      const groundPoints = counts[0][0], surfacePoints = counts[1][0];
      checked(Number.isSafeInteger(groundPoints) && Number.isSafeInteger(surfacePoints) && groundPoints >= 0 && groundPoints <= surfacePoints && surfacePoints <= source.totalPoints && (dtm === null || groundPoints >= settings.minimumGroundSupport) && (dsm === null || surfacePoints > 0) && (dtm === null || dsm !== null && dtm <= dsm + 1e-9), 'Invalid raster support');
      await check(querySignal);
      return { ...base, status: dtm === null && dsm === null ? 'no-data' : 'available', cell: { column, row, center: [grid.origin[0] + (column + .5) * grid.resolution, grid.origin[1] - (row + .5) * grid.resolution], resolution: grid.resolution },
        dtm, dsm, heightAboveGround: dtm === null || dsm === null ? null : dsm - dtm,
        support: { groundPoints, surfacePoints, groundMin: nullable(range[0][0]), groundMax: nullable(range[1][0]) } };
    },
    async grid(layer: ElevationLayer, maxSize: number, querySignal?: AbortSignal): Promise<ElevationGrid> {
      checked(['dtm', 'dsm', 'ndsm'].includes(layer) && Number.isInteger(maxSize) && maxSize >= 16 && maxSize <= 256, 'Invalid raster display request');
      await check(querySignal);
      const ratio = Math.min(1, maxSize / Math.max(grid.width, grid.height));
      const width = Math.max(1, Math.floor(grid.width * ratio)), height = Math.max(1, Math.floor(grid.height * ratio));
      const window = [0, 0, grid.width, grid.height];
      const values = (await read(layer === 'dtm' ? 'dtm.tif' : 'dsm.tif', window, width, height, querySignal))[0];
      if (layer === 'ndsm') {
        const dtm = (await read('dtm.tif', window, width, height, querySignal))[0];
        for (let i = 0; i < values.length; i++) values[i] -= dtm[i];
      }
      await check(querySignal);
      return { info, layer, width, height, origin: grid.origin, cellSize: [grid.resolution * grid.width / width, grid.resolution * grid.height / height], values: Array.from(values, nullable), resampling: 'nearest' };
    },
    check,
  };
}
