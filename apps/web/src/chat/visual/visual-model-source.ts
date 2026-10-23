import type { BrowserCaptureRequest, VisualObservation, VisualPixelResolution } from '@spatial/contracts';

/** Disposable live viewer adapter. Never geometry authority or a serialized server capability. */
export interface VisualModelSource {
  capture(request?: BrowserCaptureRequest, signal?: AbortSignal): Promise<VisualObservation>;
  captureSnapshot?(request: BrowserCaptureRequest, signal?: AbortSignal): Promise<VisualObservation>;
  releaseGrounding?(): void;
  isCurrent(id: string): boolean;
  resolvePixel(id: string, x: number, y: number): VisualPixelResolution;
}
