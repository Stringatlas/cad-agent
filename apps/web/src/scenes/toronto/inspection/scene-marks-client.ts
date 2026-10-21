import type { PointOverrideSnapshot, SceneMarkSnapshot, SceneObjectSnapshot, TorontoCadSnapshot } from '@spatial/contracts';

/** Matches optional explicit authorities; marks do not assert geometry or observed clearance. */
export function sceneMarksMatchScene(snapshot: SceneMarkSnapshot, artifactRevision?: string, points?: PointOverrideSnapshot, cad?: TorontoCadSnapshot, objects?: SceneObjectSnapshot): boolean {
  const b = snapshot.binding;
  if (!artifactRevision || b.artifactRevision !== artifactRevision) return false;
  if (b.points && (!points || points.artifactRevision !== artifactRevision || b.points.sessionId !== points.sessionId || b.points.revision !== points.revision)) return false;
  if (b.cad && (!cad || cad.artifactRevision !== artifactRevision || b.cad.sessionId !== cad.sessionId || b.cad.revision !== cad.revision)) return false;
  if (b.objects && (!objects || objects.artifactRevision !== artifactRevision || b.objects.sessionId !== objects.sessionId || b.objects.revision !== objects.revision)) return false;
  return true;
}
