export { assertPointLod, sampleIndices, OBSERVATION_LIMITS } from './observation';
export type { PointObservationSource } from './observation';
export { executeNearestPole } from './semantic-query';
export type { SemanticSpatialQuerySource, NearestQueryVerifier } from './semantic-query';
import type { ProjectState } from '@spatial/contracts';
import type { GeometryAdapter } from '@spatial/geometry';

/** Product-agent input. The viewer and any concrete CAD kernel remain outside it. */
export interface AgentContext {
  readonly project: ProjectState;
  readonly geometry: GeometryAdapter;
}

export interface InspectionResult {
  readonly projectRevision: number;
  readonly summary: string;
  readonly referencedEntityIds: readonly string[];
}

/** Interface scaffold only: no model integration, tools, or verified CAD edits yet. */
export interface InspectionAgent {
  inspect(context: AgentContext): Promise<InspectionResult>;
}
