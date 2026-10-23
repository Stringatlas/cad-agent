import type { ModelScene } from '@spatial/contracts';
import type { BoundModelScene } from './provider-model';

/** Registration and dispatch use the same bound operations, independently of dataset names. */
export function sceneToolCapabilities(scene: ModelScene, bound: BoundModelScene, visual: boolean, marks: boolean) {
  const hasPoints = scene.toronto.length > 0 || !!scene.cloud?.points.length;
  const hasDataset = scene.mode === 'toronto' || scene.mode === 'cloud' && !!scene.cloud;
  return { always: true, marks, evidence: marks && scene.mode !== 'pole' && !!bound.captureCapabilities, query: bound.queryPoints, ground: bound.groundElevation,
    elevation: bound.queryElevation, terrain: bound.analyzeTerrain, aoi: bound.queryAoiPoints, objects: hasDataset && bound.listObjects && bound.getObject && bound.proposePointCreate,
    capture: bound.captureScene, select: bound.selectReference && (scene.mode === 'toronto' || !!bound.resolveReference), visual,
    nearest: hasDataset && hasPoints && bound.nearestLabel, moves: hasDataset && hasPoints && bound.proposePointMove,
    nearestMoves: hasDataset && hasPoints && bound.proposeNearestPointMove, cad: hasDataset && bound.proposeCad };
}
