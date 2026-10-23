import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { canonicalSceneMarkSnapshot, type SceneMarkSnapshot, type Vec3 } from '@spatial/contracts';
import { createAreaCandidateRender } from '../toronto/placement/area-candidate-render';
import type { PreparedScene } from './prepared-cloud-client';

/** An annotation binding never translates frames or grants original-point identity. */
export function cloudSceneMarksMatch(snapshot: SceneMarkSnapshot, cloud: PreparedScene): boolean {
  const b = snapshot.binding, d = cloud.descriptor;
  return b.mode === 'cloud' && b.cloudId === d.id && b.artifactRevision === cloud.revision &&
    b.frameId === d.frameId && b.units === d.coordinates.units &&
    b.localOrigin.length === d.coordinates.localOrigin.length && b.localOrigin.every((n, axis) => n === d.coordinates.localOrigin[axis]);
}

/** Reuses numbered annotations; the viewer owns only this disposable projection. */
export function createPreparedSceneMarks(scene: THREE.Scene, camera: THREE.PerspectiveCamera,
  controls: Pick<OrbitControls, 'target' | 'update'>, cloud: PreparedScene, host: HTMLElement, changed: () => void) {
  const render = createAreaCandidateRender(scene);
  let disposed = false;
  return {
    set(snapshot?: SceneMarkSnapshot, selected?: string) {
      if (disposed) return;
      const checked = snapshot && canonicalSceneMarkSnapshot(snapshot);
      if (checked && !cloudSceneMarksMatch(checked, cloud)) throw new Error('Location annotations no longer match the scene. Explore again.');
      if (selected && !checked?.marks.some(mark => mark.id === selected)) throw new Error('Location annotation unavailable.');
      render.set(checked, selected);
      host.dataset.sceneMarks = JSON.stringify(checked?.marks.map(mark => ({ id: mark.id, rank: mark.rank, position: mark.position })) ?? []);
      changed();
    },
    update(width: number, height: number) {
      if (disposed) return;
      const panel = host.parentElement?.querySelector('.inspection')?.getBoundingClientRect();
      const bounds = host.getBoundingClientRect();
      render.update(camera, width, height, panel ? [{ x: panel.left - bounds.left, y: panel.top - bounds.top, width: panel.width, height: panel.height }] : []);
      host.dataset.sceneMarkLabels = JSON.stringify(render.layout);
    },
    focusPosition(position: Vec3) {
      if (disposed) return;
      if (position.length !== 3 || !position.every(Number.isFinite)) throw new Error('Location unavailable.');
      const offset = camera.position.clone().sub(controls.target);
      controls.target.set(...position); camera.position.copy(controls.target).add(offset); controls.update(); changed();
    },
    dispose() { if (!disposed) { disposed = true; render.dispose(); delete host.dataset.sceneMarks; delete host.dataset.sceneMarkLabels; } },
  };
}
