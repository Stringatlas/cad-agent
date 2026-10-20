import type { ModelAreaOfInterest } from './model-chat';
import type { Vec3 } from './index';

/** Search preferences, not equipment geometry or a safety standard. */
export interface AreaCandidateSettings {
  /** Model-selected shortlist bound, 1–20; omitted only by legacy callers (default 5). */
  readonly maxCandidates?: number;
  readonly spacingMeters: number;
  readonly clearanceRadiusMeters: number;
  readonly maxGroundReliefMeters: number;
  readonly minPoleDistanceMeters: number;
  readonly ranking: 'flat-ground' | 'near-poles' | 'far-from-poles';
}
export interface AreaCandidate {
  readonly id: string;
  readonly rank: number;
  readonly position: Vec3;
  readonly groundPoints: number;
  readonly groundReliefMeters: number;
  readonly observedObstacleCells: number;
  readonly poleDistanceMeters: number | null;
  /** Model judgement, never a deterministic suitability score. */
  readonly rationale?: string;
  readonly uncertainty?: string;
}
export interface AreaCandidateResult {
  readonly status: 'complete' | 'incomplete';
  readonly assessment?: { readonly kind: 'provisional' | 'model-assessed'; readonly scanId: string;
    readonly captureId?: string; readonly imageSha256?: string; readonly message?: string };
  readonly candidates: readonly AreaCandidate[];
  readonly reason?: string;
  readonly area: ModelAreaOfInterest;
  readonly settings: AreaCandidateSettings;
  readonly binding: {
    readonly artifactRevision: string;
    readonly indexHash: string;
    readonly sourceHash: string;
    readonly pointAuthority: { readonly sessionId: string; readonly revision: number };
    readonly cadAuthority: { readonly sessionId: string; readonly revision: number };
  };
  readonly evidence: {
    readonly pagesRead: number;
    readonly sourcePointsExamined: number;
    readonly areaPoints: number;
    readonly cellsEvaluated: number;
    readonly elapsedMilliseconds: number;
    readonly cellMeters: number;
  };
  readonly limitations: readonly string[];
}
