import { CROP_BATCH_POINTS, type DatasetInfo, type PointKey, type PointObservation, type TorontoSemanticLabel, type Vec3 } from '@spatial/contracts';

export interface PoleSelection {
  readonly datasetId: 'toronto3d';
  readonly artifactRevision: string;
  readonly key: PointKey;
  readonly position: Vec3;
  /** Exact native source label, bound to this cache's point provenance and revision. */
  readonly semanticLabel?: TorontoSemanticLabel;
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
/** Native octree payloads have their own bound, independent of crop batch size. */
export function createNativePickCache(dataset: DatasetInfo, positions: ArrayLike<number>, sourceIds: ArrayLike<number>, labels?: ArrayLike<number>) {
  const base = createProvenancePickCache(dataset, positions, sourceIds, 65_536);
  if (labels === undefined) return base;
  if (labels.length !== positions.length / 3) throw new Error('Invalid native pick labels');
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (!Number.isInteger(label) || label < 0 || label > 8) throw new Error('Invalid native pick labels');
  }
  const semanticLabels = Uint8Array.from(labels);
  return {
    ...base,
    resolve(index: number): PoleSelection | undefined {
      const point = base.resolve(index);
      return point ? { ...point, semanticLabel: semanticLabels[index] as TorontoSemanticLabel } : undefined;
    },
  };
}
function createProvenancePickCache(dataset: DatasetInfo, sourcePositions: ArrayLike<number>, ids: ArrayLike<number>, maximum: number) {
  const count = sourcePositions.length / 3;
  if (!Number.isSafeInteger(count) || count < 0 || count > maximum || dataset.id !== 'toronto3d' || !/^[a-f0-9]{64}$/.test(dataset.revision) ||
      dataset.coordinates.units !== 'm' || dataset.coordinates.upAxis !== 'Z' ||
      dataset.coordinates.handedness !== 'right' || JSON.stringify(dataset.coordinates.localOrigin) !== '[627285,4841948,0]' ||
      ids.length !== count * 2) throw new Error('Invalid pick provenance');
  const positions = Float64Array.from(sourcePositions), sourceIds = Float64Array.from(ids);
  const artifactRevision = dataset.revision;
  let live = true;
  return {
    dispose() { live = false; },
    get count() { return count; },
    copySource(start: number, length: number, originals: Float64Array, keys: Uint32Array) {
      if (!live || !Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > count || originals.length !== length * 3 || keys.length !== length * 2) throw new Error('Invalid capture source range');
      originals.set(positions.subarray(start * 3, (start + length) * 3));
      for (let i = 0; i < length * 2; i++) {
        const key = sourceIds[start * 2 + i];
        if (!Number.isSafeInteger(key) || key < 0 || key > 0xffffffff) throw new Error('Invalid capture source key');
        keys[i] = key;
      }
    },
    resolve(index: number): PoleSelection | undefined {
      if (!live || !Number.isSafeInteger(index) || index < 0 || index >= count) return;
      const sourceFileId = sourceIds[index * 2], sourceRow = sourceIds[index * 2 + 1];
      const position: Vec3 = [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
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
