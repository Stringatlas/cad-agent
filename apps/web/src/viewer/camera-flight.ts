import { Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Scene-local keyboard navigation; geometry and world-coordinate authority are untouched. */
export function createCameraFlight(canvas: HTMLCanvasElement, camera: PerspectiveCamera,
  controls: OrbitControls, speed: number, invalidate: () => void, available: () => boolean) {
  const doc = canvas.ownerDocument, win = doc.defaultView!;
  const keys = new Set<string>();
  const movement = new Vector3(), right = new Vector3(), forward = new Vector3();
  let previousTime: number | undefined, disposed = false;
  const originalTabIndex = canvas.getAttribute('tabindex');
  canvas.tabIndex = 0;
  const reset = () => { keys.clear(); previousTime = undefined; };
  const canMove = () => !disposed && doc.activeElement === canvas && !doc.hidden && controls.enabled && available();
  const modified = (event: KeyboardEvent) => event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' || modified(event) || event.isComposing || !canMove()) { reset(); return; }
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) return;
    event.preventDefault(); keys.add(event.code);
  };
  const keyUp = (event: KeyboardEvent) => {
    keys.delete(event.code);
    if (!keys.size) previousTime = undefined;
  };
  // Capture phase also focuses before Toronto's Shift/query gesture cancels propagation.
  const focus = () => { canvas.focus({ preventScroll: true }); };
  canvas.addEventListener('pointerdown', focus, true);
  canvas.addEventListener('keydown', keyDown);
  canvas.addEventListener('blur', reset);
  win.addEventListener('keyup', keyUp);
  win.addEventListener('blur', reset);
  doc.addEventListener('visibilitychange', reset);
  return {
    update(now = performance.now()): boolean {
      if (!canMove() || !keys.size) { reset(); return false; }
      const elapsed = previousTime === undefined ? 0 : Math.min(0.05, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      // Camera-right retains yaw even when looking straight down; discard pitch.
      right.set(1, 0, 0).applyQuaternion(camera.quaternion).setZ(0).normalize();
      forward.set(-right.y, right.x, 0);
      movement.copy(right).multiplyScalar(Number(keys.has('KeyD')) - Number(keys.has('KeyA')))
        .addScaledVector(forward, Number(keys.has('KeyW')) - Number(keys.has('KeyS')));
      if (!elapsed || !movement.lengthSq()) return false;
      movement.normalize().multiplyScalar(speed * elapsed);
      camera.position.add(movement); controls.target.add(movement);
      camera.updateMatrixWorld(true);
      invalidate();
      return true;
    },
    reset,
    dispose() {
      disposed = true; reset();
      canvas.removeEventListener('pointerdown', focus, true);
      canvas.removeEventListener('keydown', keyDown);
      canvas.removeEventListener('blur', reset);
      win.removeEventListener('keyup', keyUp);
      win.removeEventListener('blur', reset);
      doc.removeEventListener('visibilitychange', reset);
      if (originalTabIndex === null) canvas.removeAttribute('tabindex');
      else canvas.setAttribute('tabindex', originalTabIndex);
    },
  };
}
