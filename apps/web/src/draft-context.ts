import { canonicalScenePointName, SCENE_POINT_LIMIT, type ScenePointName, type Vec3 } from '@spatial/contracts';
import type { PoleSelection } from './pole-picking';

export type PointName = ScenePointName;

/** Owned by the mounted workspace, never by a scene/list that can be reset. */
export function createPointSequence() {
  let next = 1;
  return {
    allocate(): ScenePointName {
      if (!Number.isSafeInteger(next)) throw new Error('Point numbering exhausted; reload to start a new workspace.');
      return `Point ${next++}`;
    },
  };
}
export interface TorontoDraftPoint extends PoleSelection {
  readonly name: PointName;
  /** Full verified original-dataset query lineage; never an override-adjusted search. */
  readonly evidence?: import('./point-override-client').NearestSelectionEvidence;
  readonly frameId: 'toronto3d-local-v1';
  readonly units: 'm';
  readonly handedness: 'right';
  readonly upAxis: 'Z';
  readonly localOrigin: Vec3;
}

/** Frontend-only admission. Never converts Toronto references into project context. */
export function createDraftPointGate() {
  let revision: string | undefined, live = true;
  return {
    bind(next: string) { const changed = revision !== undefined && revision !== next; revision = next; return changed; },
    accept(point: PoleSelection, name: PointName): TorontoDraftPoint | undefined {
      canonicalScenePointName(name);
      if (!live || !revision || point.artifactRevision !== revision || !/^[a-f0-9]{64}$/.test(revision) ||
          point.datasetId !== 'toronto3d' || !Number.isInteger(point.key.sourceFileId) || point.key.sourceFileId < 1 || point.key.sourceFileId > 4 ||
          !Number.isInteger(point.key.sourceRow) || point.key.sourceRow < 0 || point.key.sourceRow > 0xffffffff ||
          point.position.length !== 3 || !point.position.every(Number.isFinite)) return;
      // Copy original binary64 values, not rendered Float32 positions or rounded labels.
      return { ...point, key: { ...point.key }, position: [...point.position], name,
        frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] };
    },
    dispose() { live = false; revision = undefined; },
  };
}

export function replaceDraftPoint(points: readonly TorontoDraftPoint[], point: TorontoDraftPoint): readonly TorontoDraftPoint[] {
  if (points.length >= SCENE_POINT_LIMIT) throw new Error(`Point limit reached (${SCENE_POINT_LIMIT}); remove a point before adding another.`);
  if (points.some(value => value.name === point.name || value.artifactRevision !== point.artifactRevision)) throw new Error('Conflicting point reference');
  return [...points, point];
}

/** Local acknowledgement only: deliberately has no transport/tool dependency. */
export function localDraftFeedback(text: string, points: readonly TorontoDraftPoint[]) {
  if (!text.trim()) return 'Write a request first. Your scene attachments remain here.';
  return `Not connected — no AI/model or edit request was sent. Your draft${points.length ? ` and ${points.length} Toronto3D attachment${points.length === 1 ? '' : 's'}` : ''} remain here. Model-driven geometry is not available yet.`;
}
