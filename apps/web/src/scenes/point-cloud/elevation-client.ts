import type { ElevationGrid, ElevationInfo, ElevationLayer, ElevationQuery } from '@spatial/contracts';
import type { PreparedScene } from './prepared-cloud-client';

const base = (id: string) => `/datasets/prepared/${encodeURIComponent(id)}`;
function validInfo(info: ElevationInfo, cloud: PreparedScene) {
  if (!info || info.kind !== 'elevation-model' || info.cloudId !== cloud.descriptor.id || info.sourceRevision !== cloud.revision || !/^[a-f0-9]{64}$/.test(info.revision) || info.frameId !== cloud.descriptor.frameId || info.units !== 'm' || JSON.stringify(info.localOrigin) !== JSON.stringify(cloud.descriptor.coordinates.localOrigin) || !Number.isSafeInteger(info.grid?.width) || !Number.isSafeInteger(info.grid?.height) || info.grid.width < 1 || info.grid.height < 1 || info.grid.width * info.grid.height > 4000000 || !Number.isFinite(info.grid.resolution) || info.grid.resolution <= 0 || !Array.isArray(info.grid.origin) || info.grid.origin.length !== 2 || !info.grid.origin.every(Number.isFinite)) throw new Error('Invalid elevation binding');
}
export async function loadElevationInfo(cloud: PreparedScene, signal: AbortSignal): Promise<ElevationInfo | undefined> {
  const response = await fetch(`${base(cloud.descriptor.id)}/elevation?revision=${cloud.revision}`, { signal, cache: 'no-store' });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error('Elevation model unavailable. Retry loading.');
  const info = await response.json() as ElevationInfo; validInfo(info, cloud); return info;
}
export async function loadElevationGrid(cloud: PreparedScene, info: ElevationInfo, layer: ElevationLayer | 'slope', signal: AbortSignal): Promise<ElevationGrid> {
  const params = new URLSearchParams({ revision: cloud.revision, modelRevision: info.revision, layer, maxSize: '192' });
  if (layer === 'slope') { if (!info.terrain) throw new Error('Slope unavailable'); params.delete('layer'); params.set('terrainRevision', info.terrain.revision); }
  const response = await fetch(`${base(info.cloudId)}/${layer === 'slope' ? 'terrain-grid' : 'elevation-grid'}?${params}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Elevation layer unavailable. Retry layer.');
  const grid = await response.json() as ElevationGrid; validInfo(grid.info, cloud);
  if (grid.info.revision !== info.revision || grid.layer !== (layer === 'slope' ? 'dtm' : layer) || !Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 1 || grid.height < 1 || grid.width > 256 || grid.height > 256 || !Array.isArray(grid.values) || grid.values.length !== grid.width * grid.height || !grid.values.every(value => value === null || Number.isFinite(value)) || !Array.isArray(grid.origin) || grid.origin.length !== 2 || !grid.origin.every(Number.isFinite) || !Array.isArray(grid.cellSize) || grid.cellSize.length !== 2 || !grid.cellSize.every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid elevation display');
  if (layer === 'slope' && (grid.info.terrain?.revision !== info.terrain?.revision || !grid.color || grid.color.kind !== 'slope' || grid.color.units !== 'degrees' || grid.color.values.length !== grid.values.length || !grid.color.values.every(n => n === null || Number.isFinite(n) && n >= 0 && n <= 90))) throw new Error('Invalid slope display');
  return grid;
}
export async function queryElevation(cloud: PreparedScene, info: ElevationInfo, x: number, y: number, signal: AbortSignal): Promise<ElevationQuery> {
  const params = new URLSearchParams({ revision: cloud.revision, modelRevision: info.revision, x: String(x), y: String(y) });
  const response = await fetch(`${base(info.cloudId)}/elevation-query?${params}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Elevation inspection unavailable. Select a cell again.');
  const result = await response.json() as ElevationQuery;
  if (result.cloudId !== info.cloudId || result.sourceRevision !== cloud.revision || result.modelRevision !== info.revision || result.frameId !== cloud.descriptor.frameId || result.units !== 'm' || JSON.stringify(result.localOrigin) !== JSON.stringify(info.localOrigin) || ![result.dtm, result.dsm, result.heightAboveGround].every(value => value === null || Number.isFinite(value))) throw new Error('Stale elevation inspection');
  return result;
}
