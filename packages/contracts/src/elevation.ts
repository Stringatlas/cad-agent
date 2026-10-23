export type ElevationLayer = 'dtm' | 'dsm' | 'ndsm';
export interface ElevationInfo {
  readonly kind: 'elevation-model'; readonly cloudId: string; readonly sourceRevision: string; readonly revision: string;
  readonly frameId: string; readonly units: 'm'; readonly localOrigin: readonly number[];
  readonly grid: { readonly width: number; readonly height: number; readonly origin: readonly [number, number]; readonly resolution: number; readonly rowDirection: 'south'; readonly pixelInterpretation: 'area' };
  readonly settings: { readonly groundLabels: readonly number[]; readonly minimumGroundSupport: number; readonly dtmMethod: 'classified-ground-mean'; readonly dsmMethod: 'all-point-maximum'; readonly interpolation: 'none'; readonly nodata: 'NaN' };
  readonly layers: Readonly<Record<ElevationLayer, { readonly min: number | null; readonly max: number | null; readonly validCells: number }>>;
  readonly coverage: { readonly sourcePoints: number; readonly groundPoints: number };
  readonly terrain?: import('./terrain').TerrainInfo;
}
export interface ElevationQuery {
  readonly kind: 'elevation-query'; readonly cloudId: string; readonly sourceRevision: string; readonly modelRevision: string;
  readonly frameId: string; readonly units: 'm'; readonly localOrigin: readonly number[]; readonly position: readonly [number, number];
  readonly status: 'available' | 'no-data' | 'outside-grid';
  readonly cell: { readonly column: number; readonly row: number; readonly center: readonly [number, number]; readonly resolution: number } | null;
  readonly dtm: number | null; readonly dsm: number | null; readonly heightAboveGround: number | null;
  readonly support: { readonly groundPoints: number; readonly surfacePoints: number; readonly groundMin: number | null; readonly groundMax: number | null };
  readonly methods: ElevationInfo['settings'];
  readonly evidenceScope: 'Original prepared source raster summaries; excludes accepted edits and pending geometry. NoData is not evidence of empty space.';
}
export interface ElevationGrid {
  readonly info: ElevationInfo; readonly layer: ElevationLayer; readonly width: number; readonly height: number;
  readonly origin: readonly [number, number]; readonly cellSize: readonly [number, number]; readonly values: readonly (number | null)[];
  readonly resampling: 'nearest';
  readonly color?: { readonly kind: 'slope'; readonly units: 'degrees'; readonly values: readonly (number | null)[]; readonly min: number | null; readonly max: number | null };
}
export function canonicalElevationCoordinates(value: unknown): { x: number; y: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RangeError('Invalid elevation query');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'x,y' || [v.x, v.y].some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e7)) throw new RangeError('Expected local-meter x/y coordinates');
  return { x: v.x as number, y: v.y as number };
}
