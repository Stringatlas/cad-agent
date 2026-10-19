import type * as THREE from 'three';

/** Keep the drawing buffer and projection in sync even before ResizeObserver runs. */
export function createViewportSizer(host: Pick<HTMLElement, 'getBoundingClientRect'>,
  renderer: Pick<THREE.WebGLRenderer, 'setSize'>, camera: THREE.PerspectiveCamera, invalidate: () => void) {
  let previousWidth = 0, previousHeight = 0, available = false;
  return {
    sync(): boolean {
      const { width, height } = host.getBoundingClientRect();
      const nextAvailable = Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1;
      if (!nextAvailable) {
        if (available) invalidate();
        available = false;
        return false;
      }
      if (!available || width !== previousWidth || height !== previousHeight) {
        invalidate();
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        previousWidth = width; previousHeight = height;
      }
      available = true;
      return true;
    },
  };
}
