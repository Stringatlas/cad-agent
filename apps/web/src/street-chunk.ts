import { assertCropBox, type CropBox, type PointObservation, type Vec3 } from '@spatial/contracts';

/** Camera-independent, source-anchored 40 m street sample, not a whole-cloud crop. */
export function representativeStreetChunk(sample: PointObservation): CropBox | undefined {
  if (!sample.count) return;
  const candidates = Array.from({ length: sample.count }, (_, i) => i);
  const ground = candidates.filter(i => sample.labels[i] === 1 || sample.labels[i] === 2);
  const pool = ground.length ? ground : candidates;
  const median = (axis: number) => pool.map(i => sample.positions[i * 3 + axis]).sort((a, b) => a - b)[Math.floor(pool.length / 2)];
  const x = median(0), y = median(1);
  const anchor = pool.reduce((best, i) => {
    const distance = (n: number) => (sample.positions[n * 3] - x) ** 2 + (sample.positions[n * 3 + 1] - y) ** 2;
    return distance(i) < distance(best) ? i : best;
  }, pool[0]);
  const point = sample.positions.slice(anchor * 3, anchor * 3 + 3);
  const box: CropBox = {
    min: point.map((n, i) => Math.max(sample.dataset.bounds.min[i], n - (i === 2 ? 3 : 20))) as unknown as Vec3,
    max: point.map((n, i) => Math.min(sample.dataset.bounds.max[i], n + (i === 2 ? 25 : 20))) as unknown as Vec3,
  };
  assertCropBox(box); return box;
}
