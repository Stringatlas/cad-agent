export type TerrainXY = readonly [number, number];
export type TerrainPolygon = readonly TerrainXY[];
export type TerrainLayer = 'dtm' | 'dsm' | 'ndsm' | 'slope';
export type TerrainOperation = 'query_terrain_region' | 'terrain_profile' | 'filter_terrain_regions' | 'terrain_image';
export interface TerrainRegionArgs { readonly polygon: TerrainPolygon }
export interface TerrainProfileArgs { readonly start: TerrainXY; readonly end: TerrainXY; readonly samples: number }
export interface TerrainFilterArgs extends TerrainRegionArgs { readonly maxSlopeDegrees: number; readonly minArea: number; readonly maxHeightAboveGround: number | null; readonly maxRegions: number }
export interface TerrainImageArgs extends TerrainRegionArgs { readonly layer: TerrainLayer; readonly maxSize: number }
export type TerrainArgs = TerrainRegionArgs | TerrainProfileArgs | TerrainFilterArgs | TerrainImageArgs;
export interface TerrainInfo {
  readonly revision: string; readonly elevationRevision: string;
  readonly method: { readonly algorithm: 'GDAL-Horn'; readonly unit: 'degree'; readonly neighborhood: 3; readonly scale: number; readonly horizontalVerticalRatio: 1; readonly edges: 'nodata'; readonly interpolation: 'none' };
  readonly slope: { readonly min: number | null; readonly max: number | null; readonly validCells: number };
}
export interface TerrainImage {
  readonly dataUrl: string; readonly mimeType: 'image/png'; readonly sha256: string; readonly byteLength: number;
}
export interface TerrainResult {
  readonly kind: 'terrain-analysis'; readonly operation: TerrainOperation;
  readonly queryId: string;
  readonly cloudId: string; readonly frameId: string; readonly units: 'm'; readonly localOrigin: readonly number[];
  readonly sourceRevision: string; readonly modelRevision: string; readonly terrainRevision: string;
  readonly resolution: number; readonly slopeMethod: TerrainInfo['method']; readonly evidenceScope: string;
  readonly result: Readonly<Record<string, unknown>>;
  readonly image?: TerrainImage;
}

/** Common provider/runtime boundary; polygon topology is also checked by Shapely. */
export function canonicalTerrainArgs(operation: TerrainOperation, value: unknown): TerrainArgs {
  const fail = (): never => { throw new RangeError('Invalid terrain query'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const a = value as Record<string, unknown>;
  const finite = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  const xy = (p: unknown): p is TerrainXY => Array.isArray(p) && p.length === 2 && p.every(n => finite(n, -1e7, 1e7));
  const keys = operation === 'terrain_profile' ? ['start', 'end', 'samples'] : operation === 'terrain_image' ? ['polygon', 'layer', 'maxSize'] : operation === 'filter_terrain_regions' ? ['polygon', 'maxSlopeDegrees', 'minArea', 'maxHeightAboveGround', 'maxRegions'] : operation === 'query_terrain_region' ? ['polygon'] : [];
  if (!keys.length || Object.keys(a).sort().join(',') !== keys.sort().join(',')) return fail();
  if (operation === 'terrain_profile') {
    if (!xy(a.start) || !xy(a.end) || a.start[0] === a.end[0] && a.start[1] === a.end[1] || !Number.isInteger(a.samples) || !finite(a.samples, 2, 256)) return fail();
    return { start: [...a.start] as [number, number], end: [...a.end] as [number, number], samples: a.samples };
  }
  if (!Array.isArray(a.polygon) || a.polygon.length < 3 || a.polygon.length > 64 || !a.polygon.every(xy)) return fail();
  const polygon: TerrainPolygon = a.polygon.map(p => [...p] as [number, number]);
  if (operation === 'query_terrain_region') return { polygon };
  if (operation === 'terrain_image') {
    if (typeof a.layer !== 'string' || !['dtm', 'dsm', 'ndsm', 'slope'].includes(a.layer) || !Number.isInteger(a.maxSize) || !finite(a.maxSize, 128, 512)) return fail();
    return { polygon, layer: a.layer as TerrainLayer, maxSize: a.maxSize };
  }
  if (!finite(a.maxSlopeDegrees, 0, 90) || !finite(a.minArea, .0625, 1e8) || a.maxHeightAboveGround !== null && !finite(a.maxHeightAboveGround, 0, 1e7) || !Number.isInteger(a.maxRegions) || !finite(a.maxRegions, 1, 16)) return fail();
  return { polygon, maxSlopeDegrees: a.maxSlopeDegrees, minArea: a.minArea, maxHeightAboveGround: a.maxHeightAboveGround as number | null, maxRegions: a.maxRegions };
}
