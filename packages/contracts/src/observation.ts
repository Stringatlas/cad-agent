import type { CoordinateMetadata, Vec3 } from './index';

/** A read-only dataset observation, not editable ProjectState or verified geometry. */
export interface PointLod {
  readonly budget: number;
  /** Include Potree levels 0..depth, independent of camera and display settings. */
  readonly depth: number;
}
export interface DatasetInfo {
  readonly id: 'toronto3d';
  /** Fingerprint of prepared metadata/manifest/root hierarchy and payload stat, not a full payload hash. */
  readonly revision: string;
  readonly coordinates: CoordinateMetadata;
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  readonly totalPoints: number;
}
export interface PointObservation {
  readonly dataset: DatasetInfo;
  readonly purpose: 'display' | 'harness';
  readonly lod: PointLod;
  readonly algorithm: 'potree-bfs-even-v1';
  readonly candidatePoints: number;
  readonly count: number;
  readonly bytesRead: number;
  readonly nodes: readonly string[];
  readonly sampleHash: string;
  /** Flat XYZ in local meters; RGB bytes; provenance pairs (source file ID, source row). */
  readonly positions: readonly number[];
  readonly colors: readonly number[];
  readonly sourceIds: readonly number[];
  /** Toronto semantic scalar_Label, not LAS classification. No other source attributes included. */
  readonly labels: readonly number[];
}
