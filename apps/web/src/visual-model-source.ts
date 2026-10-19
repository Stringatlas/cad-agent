import type { ModelCaptureRequest, VisualObservation, VisualPixelResolution } from '@spatial/contracts';

/** Disposable live viewer adapter. Never geometry authority or a serialized server capability. */
export interface VisualModelSource {
  capture(request?: ModelCaptureRequest): Promise<VisualObservation>;
  isCurrent(id: string): boolean;
  resolvePixel(id: string, x: number, y: number): VisualPixelResolution;
}
