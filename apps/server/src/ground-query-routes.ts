import type { IncomingMessage, ServerResponse } from 'node:http';
import { PotreeDataset } from './potree';
import { DEFAULT_PREPROCESSING_PATH, readPreprocessing } from './preprocessing-summary';
import { createGroundSurface } from './ground-surface';

/** Read-only original-source elevation. The artifact path is operator-owned, never a query parameter. */
export function createGroundQueryRoutes(directory: string, manifestPath = process.env.SPATIAL_PREPROCESSING_PATH ?? DEFAULT_PREPROCESSING_PATH) {
  const dataset = new PotreeDataset(directory);
  let active = false;
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://127.0.0.1'); }
    catch { return false; }
    if (url.pathname !== '/datasets/toronto3d/ground-elevation') return false;
    const send = (status: number, body: unknown) => {
      if (response.destroyed) return;
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify(body));
    };
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '') ||
      (request.headers.origin !== undefined && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.origin))) {
      send(403, { error: 'Local access only' }); return true;
    }
    if (request.method !== 'GET') { send(404, { error: 'Not found' }); return true; }
    if (request.headers.range !== undefined) { send(416, { error: 'Raw byte ranges are not exposed' }); return true; }
    if ((request.url?.length ?? 0) > 4096) { send(400, { error: 'Query too long' }); return true; }
    const keys = [...url.searchParams.keys()], revision = url.searchParams.get('revision') ?? '';
    const numeric = (text: string | null) => text !== null && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text) && Number.isFinite(Number(text));
    if (keys.length !== 3 || new Set(keys).size !== 3 || keys.some(key => !['revision', 'x', 'y'].includes(key)) ||
      !revision.trim() || revision.length > 128 || !numeric(url.searchParams.get('x')) || !numeric(url.searchParams.get('y'))) {
      send(400, { error: 'Expected revision and finite local-meter x/y' }); return true;
    }
    if (active) { send(429, { error: 'Ground query busy; retry later' }); return true; }
    active = true;
    const controller = new AbortController(), started = performance.now();
    const abort = () => controller.abort();
    response.once('close', abort);
    const deadline = setTimeout(abort, 5000); deadline.unref();
    // info() has no signal parameter. Bound its wait too, without changing its adapter API.
    const info = async () => {
      controller.signal.throwIfAborted();
      let onAbort!: () => void;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      try { return await Promise.race([dataset.info(), aborted]); }
      finally { controller.signal.removeEventListener('abort', onAbort); }
    };
    let stale = false;
    try {
      const metadata = await info();
      if (metadata.revision !== revision) { stale = true; throw new Error('Stale revision'); }
      const artifact = await readPreprocessing(metadata, manifestPath, controller.signal);
      const x = Number(url.searchParams.get('x')), y = Number(url.searchParams.get('y'));
      const ground = createGroundSurface(artifact.ground).elevationAt(x, y);
      const current = await info();
      if (current.revision !== metadata.revision || JSON.stringify(current.coordinates) !== JSON.stringify(metadata.coordinates)) {
        stale = true; throw new Error('Dataset changed');
      }
      controller.signal.throwIfAborted();
      if (performance.now() - started >= 5000) throw new Error('Ground deadline exceeded');
      send(200, { binding: artifact.binding, position: [x, y], ground, domain: 'original-source-ground',
        independentVerification: false, cadVerification: false,
        limitations: 'Ground/Road_markings observed cell minima assigned to cell centers; low-outlier sensitive. Interpolation uses four supported corners with a fixed diagonal and slope cutoff; no extrapolation or hole filling. Spread is observed elevation range, not uncertainty. Recorded source/index hashes are binding, not a fresh source audit. Excludes edits; not verified terrain, CAD geometry or clearance.' });
    } catch {
      send(stale ? 409 : 503, { complete: false, error: stale ? 'Stale artifact revision; refresh dataset' : 'Ground query unavailable or exceeds limits; no result' });
    } finally {
      clearTimeout(deadline);
      response.off('close', abort);
      active = false;
    }
    return true;
  };
}
