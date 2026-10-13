import type { PointLod, PointObservation } from '@spatial/contracts';

/** Concrete read-only observation boundary; no renderer, camera, model or CAD types. */
export interface PointObservationSource {
  observe(lod: PointLod, signal?: AbortSignal): Promise<PointObservation>;
}

export const OBSERVATION_LIMITS = Object.freeze({ display: 100_000, harness: 4096, depth: 3 });

export function assertPointLod(lod: PointLod, purpose: 'display' | 'harness'): void {
  if (!Number.isSafeInteger(lod.budget) || lod.budget < 1 || lod.budget > OBSERVATION_LIMITS[purpose] ||
      !Number.isSafeInteger(lod.depth) || lod.depth < 0 || lod.depth > OBSERVATION_LIMITS.depth) {
    throw new RangeError('LOD exceeds bounded observation limits');
  }
}

/** Evenly spaced indexes in a fixed ordered candidate population; no random/camera state. */
export function sampleIndices(population: number, budget: number): number[] {
  if (!Number.isSafeInteger(population) || population < 0 || population > 1_000_000 ||
      !Number.isSafeInteger(budget) || budget < 1 || budget > OBSERVATION_LIMITS.display) {
    throw new RangeError('Invalid sampling limits');
  }
  const count = Math.min(population, budget);
  return Array.from({ length: count }, (_, index) => Math.floor(index * population / count));
}
