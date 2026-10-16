import type { Vec3 } from '@spatial/contracts';
import type { PoleSelection } from './pole-picking';

export type PointName = 'A' | 'B';
export interface TorontoDraftPoint extends PoleSelection {
  readonly name: PointName;
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
  return [...points.filter(value => value.name !== point.name && value.artifactRevision === point.artifactRevision), point]
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Local acknowledgement only: deliberately has no transport/tool dependency. */
export function localDraftFeedback(text: string, points: readonly TorontoDraftPoint[]) {
  if (!text.trim()) return 'Write a request first. Your scene attachments remain here.';
  return `Not connected — no AI/model or edit request was sent. Your draft${points.length ? ` and ${points.length} Toronto3D attachment${points.length === 1 ? '' : 's'}` : ''} remain here. Model-driven geometry is not available yet.`;
}
