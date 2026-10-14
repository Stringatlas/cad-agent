import { CROP_BATCH_POINTS, type DatasetInfo, type PointKey, type PointObservation, type Vec3 } from '@spatial/contracts';

export interface PoleSelection {
  readonly datasetId: 'toronto3d';
  readonly artifactRevision: string;
  readonly key: PointKey;
  readonly position: Vec3;
}

/** Original observation values, never a GPU float/index as authority. */
export function createPolePickCache(sample: PointObservation) {
  if (sample.count !== sample.positions.length / 3) throw new Error('Invalid pick count');
  return createProvenancePickCache(sample.dataset, sample.positions, sample.sourceIds, 100_000);
}

/** One bounded detail batch; no total selection cap. */
export function createDetailPickCache(dataset: DatasetInfo, positions: readonly number[], sourceIds: readonly number[]) {
  return createProvenancePickCache(dataset, positions, sourceIds, CROP_BATCH_POINTS);
}
function createProvenancePickCache(dataset: DatasetInfo, sourcePositions: readonly number[], ids: readonly number[], maximum: number) {
  const count = sourcePositions.length / 3;
  if (!Number.isSafeInteger(count) || count < 0 || count > maximum || dataset.id !== 'toronto3d' || !/^[a-f0-9]{64}$/.test(dataset.revision) ||
      dataset.coordinates.units !== 'm' || dataset.coordinates.upAxis !== 'Z' ||
      dataset.coordinates.handedness !== 'right' || JSON.stringify(dataset.coordinates.localOrigin) !== '[627285,4841948,0]' ||
      ids.length !== count * 2) throw new Error('Invalid pick provenance');
  const positions = sourcePositions.slice(), sourceIds = ids.slice();
  const artifactRevision = dataset.revision;
  let live = true;
  return {
    dispose() { live = false; },
    resolve(index: number): PoleSelection | undefined {
      if (!live || !Number.isSafeInteger(index) || index < 0 || index >= count) return;
      const sourceFileId = sourceIds[index * 2], sourceRow = sourceIds[index * 2 + 1];
      const position = positions.slice(index * 3, index * 3 + 3) as unknown as Vec3;
      if (!Number.isInteger(sourceFileId) || sourceFileId < 1 || sourceFileId > 4 ||
          !Number.isInteger(sourceRow) || sourceRow < 0 || sourceRow > 0xffffffff || !position.every(n => Number.isFinite(n) && Math.abs(n) < 1e7)) return;
      return { datasetId: 'toronto3d', artifactRevision, key: { sourceFileId, sourceRow }, position };
    },
  };
}

export function poleGestureKind(event: { button: number; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, queryEnabled: boolean) {
  if (event.button !== 0) return;
  if (event.shiftKey) return 'shift';
  if (queryEnabled && (event.metaKey || event.ctrlKey)) return 'query';
}

export function isPoleClick(maxTravel: number, cancelled: boolean, sameCache: boolean) {
  return !cancelled && sameCache && maxTravel <= 4;
}
