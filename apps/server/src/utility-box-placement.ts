import { assertVec3, type Vec3, type CropBox } from '@spatial/contracts';
import { SemanticArtifact, requireData, digest } from './semantic-artifact';
import { loadPreparedSemanticDiskIndex } from './semantic-disk-index';
import { SpatialPageIndex } from './spatial-page-index';
import { readSourcePoint } from './source-point';
import { readPreprocessing } from './preprocessing-summary';
import { createGroundSurface } from './ground-surface';

export interface UtilityBoxArgs { readonly pointName: string; readonly dimensions: Vec3; readonly frontAccessMeters: number }
export const UTILITY_BOX_PRESET = { dimensions: [1.2, .6, 1.5], frontAccessMeters: 1,
  meaning: 'Illustrative dimensions only, not an equipment or regulatory standard; disclose and let the user change before Accept.', front: '+Y' } as const;
export function validateUtilityBoxArgs(args: UtilityBoxArgs): void {
  assertVec3(args.dimensions);
  if (args.dimensions.some(n => n < .1 || n > 5) || !Number.isFinite(args.frontAccessMeters) || args.frontAccessMeters < 0 || args.frontAccessMeters > 5) throw new RangeError('Utility box dimensions must be 0.1..5m; access depth 0..5m');
}
// Structural source reference keeps this adapter independent of UI/draft implementation.
export interface PlacementReference { readonly name: string; readonly artifactRevision: string; readonly key: { readonly sourceFileId: number; readonly sourceRow: number }; readonly position: Vec3 }
export async function assessUtilityBox(snapshot: SemanticArtifact, reference: PlacementReference, input: UtilityBoxArgs, signal: AbortSignal) {
  validateUtilityBoxArgs(input);
  const args = structuredClone(input);
  const index = await loadPreparedSemanticDiskIndex(snapshot, signal);
  requireData(index, 'Prepared spatial index unavailable');
  const source = await readSourcePoint(snapshot.root, { revision: reference.artifactRevision, key: reference.key }, signal);
  requireData(source.position.every((n, a) => n === reference.position[a]), 'Attached source position mismatch');
  const preprocessing = await readPreprocessing(snapshot.dataset, undefined, signal);
  requireData(preprocessing.binding.indexHash === index.hash && preprocessing.binding.sourceHash === index.sourceHash, 'Terrain/index binding mismatch');
  const preprocessingHash = digest(JSON.stringify(preprocessing));
  const surface = createGroundSurface(preprocessing.ground), [x, y] = source.position, [w, d, h] = args.dimensions;
  const bodyXY = [[x, y], [x - w / 2, y - d / 2], [x + w / 2, y - d / 2], [x - w / 2, y + d / 2], [x + w / 2, y + d / 2]];
  const accessXY = args.frontAccessMeters > 0 ? [[x - w / 2, y + d / 2 + args.frontAccessMeters], [x + w / 2, y + d / 2 + args.frontAccessMeters]] : [];
  const ground = [...bodyXY, ...accessXY].map(([x, y]) => ({ position: [x, y], result: surface.elevationAt(x, y) }));
  const binding = { ...indexBinding(snapshot, index.hash, index.sourceHash), preprocessingHash };
  const base = { pointName: reference.name, source, assumptions: { ...args, front: '+Y', supportBandMeters: .1 }, binding, ground,
    queryBudget: { maxPagesPerVolume: 20000, maxMillisecondsPerVolume: 10000, maxWitnessesPerVolume: 12, failure: 'reject-no-partial-success' } };
  if (ground.some(g => g.result.status !== 'available')) return { ...base, status: 'unavailable' as const, complete: false as const, reason: 'unsupported-ground' as const };
  const elevations = ground.map(g => g.result.status === 'available' ? g.result.elevation : NaN);
  const baseElevation = Math.max(...elevations.slice(0, bodyXY.length));
  const operation = { kind: 'box' as const, center: [x, y, baseElevation + h / 2] as Vec3, dimensions: args.dimensions };
  const bounds: CropBox = { min: [x - w / 2, y - d / 2, baseElevation], max: [x + w / 2, y + d / 2, baseElevation + h] };
  const spatial = await SpatialPageIndex.create(snapshot, index, signal);
  const options = { signal, maxPages: 20000, maxMilliseconds: 10000, maxResults: 12, supportMaxZ: baseElevation + .1 };
  const body = await spatial.box(bounds, options);
  const access = args.frontAccessMeters > 0 ? await spatial.box({ min: [bounds.min[0], bounds.max[1], baseElevation - .1],
    max: [bounds.max[0], bounds.max[1] + args.frontAccessMeters, bounds.max[2]] }, options) : null;
  await snapshot.check(signal);
  return { ...base, status: 'assessed' as const, complete: true as const, operation, baseElevation,
    sampledReliefMeters: Math.max(...elevations) - Math.min(...elevations),
    needsBasePreparation: Math.max(...elevations) - Math.min(...elevations) > .1,
    finding: body.obstructionCount || access?.obstructionCount ? 'observed-conflicts' as const : 'no-observed-conflicts' as const,
    body, access, limitations: [
      'Original source points only; empty scan volume does not prove free space, surface clearance or code compliance.',
      'Ground is sparse observed cell minima, outlier-sensitive; center/corner sampling is not a foundation or continuous-footprint certificate.',
      'Labels Ground/Road_markings within 0.10m of base are counted separately as supporting-ground-band; all other in-volume points are conflicts.',
      'Inclusive body/access boundaries may count a boundary witness in both volumes. Witness lists are capped; counts are exhaustive within declared volumes.',
      'Base preparation and equipment/access dimensions require human confirmation; no obstacle removal is proposed.'
    ] };
}
function indexBinding(snapshot: SemanticArtifact, indexHash: string, sourceHash: string) {
  return { datasetId: 'toronto3d', artifactRevision: snapshot.dataset.revision, indexHash, sourceHash,
    frameId: 'toronto3d-local-v1', units: 'm', coordinates: snapshot.dataset.coordinates, domain: 'original-source-points' } as const;
}
export type UtilityBoxAssessment = Awaited<ReturnType<typeof assessUtilityBox>>;
export async function checkPlacementTerrain(snapshot: SemanticArtifact, hash: string, signal: AbortSignal) {
  requireData(digest(JSON.stringify(await readPreprocessing(snapshot.dataset, undefined, signal))) === hash, 'Terrain changed; reassess');
}
