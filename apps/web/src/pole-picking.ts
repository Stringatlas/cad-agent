import type { PointKey, PointObservation, Vec3 } from '@spatial/contracts';

export interface PoleSelection {
  readonly datasetId: 'toronto3d';
  readonly artifactRevision: string;
  readonly key: PointKey;
  readonly position: Vec3;
}

/** Original observation values, never a GPU float/index as authority. */
export function createPolePickCache(sample: PointObservation) {
  const count = sample.count;
  if (!Number.isSafeInteger(count) || count < 0 || count > 100_000 || sample.dataset.id !== 'toronto3d' || !/^[a-f0-9]{64}$/.test(sample.dataset.revision) ||
      sample.dataset.coordinates.units !== 'm' || sample.dataset.coordinates.upAxis !== 'Z' ||
      sample.dataset.coordinates.handedness !== 'right' || JSON.stringify(sample.dataset.coordinates.localOrigin) !== '[627285,4841948,0]' ||
      sample.sourceIds.length !== sample.count * 2 || sample.positions.length !== sample.count * 3) throw new Error('Invalid pick provenance');
  const positions = sample.positions.slice(), sourceIds = sample.sourceIds.slice();
  const artifactRevision = sample.dataset.revision;
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
