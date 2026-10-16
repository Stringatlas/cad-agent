import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const snapshots = new WeakMap<OrbitControls, { position: Vector3; target: Vector3; quaternion: Quaternion }>();

/** Keep idle spherical/target round-trip noise out of the actual pose, not its signature. */
export function updateStableOrbitControls(camera: PerspectiveCamera, controls: OrbitControls): boolean {
  // OrbitControls' change event has a much larger tolerance than floating-point noise.
  // Never use that event (or a small displacement alone) to discard real input/damping.
  // These private fields are pinned to the installed Three implementation and tested with it.
  // Missing/changed internals fail closed: update normally, without stabilization.
  const pending = controls as OrbitControls & {
    _sphericalDelta?: { theta: number; phi: number };
    _panOffset?: Vector3;
    _scale?: number;
    _performCursorZoom?: boolean;
  };
  const idle = !controls.autoRotate && pending._sphericalDelta?.theta === 0 &&
    pending._sphericalDelta?.phi === 0 && pending._panOffset?.x === 0 &&
    pending._panOffset?.y === 0 && pending._panOffset?.z === 0 &&
    pending._scale === 1 && pending._performCursorZoom === false;
  if (!idle) return controls.update();

  let previous = snapshots.get(controls);
  if (!previous) {
    previous = { position: new Vector3(), target: new Vector3(), quaternion: new Quaternion() };
    snapshots.set(controls, previous);
  }
  previous.position.copy(camera.position);
  previous.target.copy(controls.target);
  previous.quaternion.copy(camera.quaternion);
  const changed = controls.update();
  const noise = Number.EPSILON * 32;
  if (!changed &&
      controls.target.distanceToSquared(previous.target) <= (noise * Math.max(1, previous.target.length())) ** 2 &&
      camera.position.distanceToSquared(previous.position) <= (noise * Math.max(1, previous.position.length())) ** 2 &&
      Math.max(Math.abs(camera.quaternion.x - previous.quaternion.x), Math.abs(camera.quaternion.y - previous.quaternion.y),
        Math.abs(camera.quaternion.z - previous.quaternion.z), Math.abs(camera.quaternion.w - previous.quaternion.w)) <= noise) {
    // Target.clampLength also round-trips on idle frames. Restore it as well as the camera.
    controls.target.copy(previous.target);
    camera.position.copy(previous.position);
    camera.quaternion.copy(previous.quaternion);
    camera.updateMatrixWorld(true);
  }
  return changed;
}
