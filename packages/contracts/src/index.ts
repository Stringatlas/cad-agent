export { ADAPTIVE_BINARY_MIME, ADAPTIVE_BINARY_LIMITS, encodeAdaptiveBinary, decodeAdaptiveBinary } from './adaptive-binary';
export type { AdaptiveBinaryIdentity, AdaptiveBinaryInput, AdaptiveBinaryPayload } from './adaptive-binary';
export { TORONTO_CAD_LIMITS } from './toronto-cad';
export type { TorontoCadPrimitive, TorontoCadMesh, TorontoCadBody, TorontoCadBinding, TorontoCadProposal, TorontoCadSnapshot, TorontoCadErrorCode } from './toronto-cad';
export { POINT_OVERRIDE_LIMITS, canonicalPointMoveProposalRequest, canonicalPointMoveApprovalRequest, canonicalPointMoveUndoRequest } from './point-overrides';
export type { PointOverrideBinding, PointOverrideEntry, PointOverrideSnapshot, PointMove, PointMoveProposal, PointMoveProposalRequest, PointMoveApprovalRequest, PointMoveUndoRequest, PointOverrideErrorCode, PointOverrideReply } from './point-overrides';
export { MODEL_VISUAL_LIMITS, canonicalModelVisualObservation, canonicalModelVisualToolResult, modelVisualImageSize, modelVisualSourcePixel } from './model-visual';
export type { ModelVisualObservation } from './model-visual';
export type { ModelVisualToolResult } from './model-visual';
export { VISUAL_OBSERVATION_LIMITS } from './visual-observation';
export type { VisualJson, VisualBinding, VisualCoverage, VisualPointProvenance, VisualObservation, VisualPixelResolution } from './visual-observation';
export { canonicalModelCaptureRequest, canonicalModelReferenceSelection, canonicalModelBrowserAction, MODEL_CHAT_LIMITS, MODEL_INSPECTION_LIMITS, canonicalModelScene, canonicalModelTurnRequest, canonicalModelCatalog, canonicalModelChatEvent } from './model-chat';
export type { ModelCaptureRequest, ModelReferenceSelection, ModelBrowserAction, ModelProposalAuthority, ModelAreaOfInterest, ModelTorontoPoint, ModelScene, ModelCatalog, ModelTurnRequest, ModelChatEvent, ModelRequestInspection, ModelRequestPhase, ModelInspectionOmission } from './model-chat';
export { PROJECT_LIMITS, SCENE_POINT_LIMIT, canonicalScenePointName, canonicalProjectBinding, canonicalBoxProposalRequest, canonicalBoxApprovalRequest, canonicalProjectUndoRequest, canonicalSceneContextRequest, canonicalPersistentProject } from './project-edit';
export type { ProjectBinding, ScenePointName, ScenePointReference, SceneContextRequest, SceneContext, BoxEdit, BoxProposalRequest, BoxProposal, BoxApprovalRequest, ProjectUndoRequest, ProjectCommitResult, ProjectSessionInfo, ProjectSaveResult, ProjectLoadResult, ProjectErrorCode, ProjectReply } from './project-edit';
export { CAD_OPERATIONS, CAD_LIMITS, CadError, canonicalCadBodyRef, canonicalCadOperation, canonicalCadRequest } from './cad';
export type { CadSource, CadBodyRef, CadOperation, CadRequest, CadValidation, CadBodyResult, CadResult, CadErrorCode, CadReply, CadCapabilities } from './cad';
export { PROJECT_FRAME_ID, CHAT_BODY_BYTES, CHAT_REPLY_BYTES, inspectionCommand, canonicalChatRequest, chatOutcomeState } from './chat';
export type { ChatState, ProjectSnapshot, ChatRequest, ChatResponse } from './chat';
export { TOOL_SCHEMA_VERSION, TOOL_VERSION, PREPARED_ASSETS, canonicalToolRequest, nearestRequestForTool, canonicalProtocolJson,
  detachedProtocolValue, freezeProtocolValue, assertToolBinding, assertPreparedArtifactIdentity,
  protocolRecord, protocolKeys, protocolToken, protocolHash, protocolInteger } from './tool-protocol';
export type { ToolName, ToolBinding, PreparedArtifactIdentity, ToolArguments, ToolRequest, ProtocolFailure, ToolOutcome, ToolReply } from './tool-protocol';
export type { DatasetInfo, PointLod, PointObservation } from './observation';
export { assertCropBox, assertCropSelection, containsCropPoint, intersectsCropNode, CROP_BATCH_POINTS, CROP_LINE_BYTES, CROP_PLANE_EPSILON } from './crop';
export type { CropBox, CropSelection, CropPlane, CropStats, CropEvent } from './crop';
export { assertNearestPoleRequest, canonicalPoleRequest, TORONTO_SEMANTIC_LABELS } from './semantic-query';
export type { TorontoSemanticLabel, PointKey, QueryInput, SearchDomain, NearestPoleRequest, PointWitness, ScanStats, DiskCoverageEvidence, SearchEvidence,
  QueryErrorCode, QueryFailure, CompleteQuery, QueryOutcome, VerificationEvidence, VerificationOutcome, NearestPoleToolOutcome, ArtifactReadStats } from './semantic-query';

/** All entity geometry is expressed in the project's local coordinate frame. */
export type Vec3 = readonly [number, number, number];

export interface CoordinateMetadata {
  readonly units: 'm';
  readonly handedness: 'right';
  readonly upAxis: 'Z';
  readonly localOrigin: Vec3;
}

export interface PointCloudEntity {
  readonly id: string;
  readonly kind: 'point-cloud';
  readonly points: readonly Vec3[];
}

/** A declarative, axis-aligned box proposal, not a kernel CAD body. */
export interface BoxEntity {
  readonly id: string;
  readonly kind: 'box';
  readonly center: Vec3;
  readonly dimensions: Vec3;
}

export type Entity = PointCloudEntity | BoxEntity;

export interface ProjectState {
  /** Geometry revision only: changing selection does not increment this value. */
  readonly revision: number;
  readonly coordinates: CoordinateMetadata;
  readonly entities: readonly Entity[];
  readonly selectedEntityId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 &&
    value.every((component: unknown) => typeof component === 'number' && Number.isFinite(component));
}

export function assertVec3(value: unknown): asserts value is Vec3 {
  if (!isVec3(value)) throw new TypeError('Expected three finite numeric coordinates');
}

export function assertCoordinateMetadata(value: unknown): asserts value is CoordinateMetadata {
  if (!isRecord(value) || value.units !== 'm' || value.handedness !== 'right' || value.upAxis !== 'Z') {
    throw new TypeError('Expected right-handed Z-up coordinates in meters');
  }
  assertVec3(value.localOrigin);
}

export function assertBoxEntity(value: unknown): asserts value is BoxEntity {
  if (!isRecord(value) || value.kind !== 'box' || typeof value.id !== 'string' || value.id.length === 0) {
    throw new TypeError('Expected a box entity with a nonempty ID');
  }
  assertVec3(value.center);
  assertVec3(value.dimensions);
  if (value.dimensions.some((dimension) => dimension <= 0)) {
    throw new RangeError('Box dimensions must be strictly positive');
  }
}

export function assertEntity(value: unknown): asserts value is Entity {
  if (!isRecord(value)) throw new TypeError('Expected an entity');
  if (value.kind === 'box') {
    assertBoxEntity(value);
    return;
  }
  if (value.kind !== 'point-cloud' || typeof value.id !== 'string' || value.id.length === 0 || !Array.isArray(value.points)) {
    throw new TypeError('Expected a point-cloud entity with a nonempty ID and points');
  }
  for (const point of value.points) assertVec3(point);
}

export function assertProjectState(value: unknown): asserts value is ProjectState {
  if (!isRecord(value) || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.entities)) {
    throw new TypeError('Expected a project with a nonnegative integer revision and entities');
  }
  assertCoordinateMetadata(value.coordinates);
  const ids = new Set<string>();
  for (const entity of value.entities) {
    assertEntity(entity);
    if (ids.has(entity.id)) throw new TypeError(`Duplicate entity ID: ${entity.id}`);
    ids.add(entity.id);
  }
  if (value.selectedEntityId !== null && (typeof value.selectedEntityId !== 'string' || !ids.has(value.selectedEntityId))) {
    throw new TypeError('Selection must be null or reference an existing entity');
  }
}
