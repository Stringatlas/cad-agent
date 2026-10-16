import type { Vec3 } from './index';

/** JSON-only metadata: no renderer objects, binary buffers, or credential-bearing context. */
export type VisualJson = null | boolean | number | string | readonly VisualJson[] | { readonly [key: string]: VisualJson };
export interface VisualBinding {
  readonly sourceId: string;
  readonly sourceRevision: string | number;
  readonly frameId: string;
  readonly units: 'm';
  /** Translation-only local meter origin in the source/world frame. */
  readonly origin: Vec3;
  readonly [key: string]: VisualJson;
}
export interface VisualCoverage {
  readonly kind: string;
  /** Completion of the described displayed selection, NOT whole-dataset coverage. */
  readonly complete: boolean;
  readonly displayedPointCount: number;
  readonly [key: string]: VisualJson;
}
/** Original source provenance supplied by the authoritative pick cache, never a GPU offset. */
export interface VisualPointProvenance { readonly [key: string]: VisualJson }
export interface VisualObservation {
  readonly schemaVersion: 1;
  readonly observationId: string;
  readonly viewGeneration: number;
  readonly image: { readonly mimeType: 'image/png'; readonly dataUrl: string; readonly sha256: string; readonly byteLength: number };
  readonly viewport: { readonly width: number; readonly height: number; readonly pixelRatio: number; readonly pixelOrigin: 'top-left' };
  readonly camera: {
    readonly position: Vec3;
    readonly quaternion: readonly number[];
    readonly up: Vec3;
    readonly near: number;
    readonly far: number;
    readonly fov: number;
    readonly aspect: number;
    readonly zoom: number;
    readonly matrixWorld: readonly number[];
    readonly matrixWorldInverse: readonly number[];
    readonly projectionMatrix: readonly number[];
  };
  readonly binding: VisualBinding;
  readonly coverage: VisualCoverage;
}
export type VisualPixelResolution =
  | { readonly status: 'resolved'; readonly observationId: string; readonly x: number; readonly y: number; readonly provenance: VisualPointProvenance }
  | { readonly status: 'ambiguous' | 'no-hit' | 'stale' | 'invalid' | 'unavailable'; readonly observationId: string; readonly x: number; readonly y: number; readonly reason: string };
export const VISUAL_OBSERVATION_LIMITS = Object.freeze({ maxDimension: 4096, maxPngBytes: 12 * 1024 * 1024, pixelTolerance: 3 });
