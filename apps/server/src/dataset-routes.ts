import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { PotreeDataset } from './potree';
import { once } from 'node:events';
import { assertCropSelection, canonicalPoleRequest, type NearestPoleRequest, type CropSelection } from '@spatial/contracts';
import { streamClosestPole } from './pole-transport';

export const DEFAULT_DATASET_ROOT = fileURLToPath(new URL('../../../data/processed/toronto3d/prepared/', import.meta.url));

export function createDatasetRoutes(directory = DEFAULT_DATASET_ROOT) {
  const dataset = new PotreeDataset(directory);
  let active = 0;
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const send = (status: number, body: unknown) => {
      if (response.destroyed) return;
      response.statusCode = status;
      response.end(JSON.stringify(body));
    };
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://127.0.0.1'); }
    catch { send(400, { error: 'Invalid request URL' }); return true; }
    if (!url.pathname.startsWith('/datasets/')) return false;
    // Loopback Host/Origin allowlists also reject browser DNS-rebinding access.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '') ||
        (request.headers.origin !== undefined && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.origin))) {
      send(403, { error: 'Local access only' }); return true;
    }
    // No CORS, file paths, write operations, or raw assets. Ranges are deliberately unsupported.
    if (request.method !== 'GET' || !['/datasets/toronto3d', '/datasets/toronto3d/observation', '/datasets/toronto3d/crop', '/datasets/toronto3d/closest-pole'].includes(url.pathname)) {
      send(404, { error: 'Not found' }); return true;
    }
    if (request.headers.range) { send(416, { error: 'Raw byte ranges are not exposed' }); return true; }
    if ((request.url?.length ?? 0) > 4096) { send(400, { error: 'Query too long' }); return true; }
    const metadata = url.pathname === '/datasets/toronto3d';
    const crop = url.pathname === '/datasets/toronto3d/crop';
    const pole = url.pathname === '/datasets/toronto3d/closest-pole';
    let poleRequest: NearestPoleRequest | undefined;
    if (pole) {
      try {
        if ([...url.searchParams.keys()].length !== 1 || !url.searchParams.has('request')) throw new TypeError();
        poleRequest = canonicalPoleRequest(JSON.parse(url.searchParams.get('request')!));
      } catch { send(400, { error: 'Invalid closest pole request' }); return true; }
    }
    let box: CropSelection | undefined;
    if (crop) {
      try {
        const names = ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'];
        const keys = [...url.searchParams.keys()];
        if ((keys.length !== 6 && keys.length !== 7) || new Set(keys).size !== keys.length || keys.some(key => ![...names, 'planes'].includes(key)) || names.some(key => !keys.includes(key))) throw new RangeError();
        const values = names.map(key => {
          const text = url.searchParams.get(key)!;
          if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) throw new RangeError();
          return Number(text);
        });
        box = { min: [values[0], values[1], values[2]], max: [values[3], values[4], values[5]], ...(url.searchParams.has('planes') ? { planes: JSON.parse(url.searchParams.get('planes')!) } : {}) };
        assertCropSelection(box);
      } catch { send(400, { error: 'Expected six finite local-meter bounds minX/minY/minZ/maxX/maxY/maxZ with min < max' }); return true; }
    }
    const keys = [...url.searchParams.keys()];
    const purpose = url.searchParams.get('purpose');
    const budget = url.searchParams.get('budget') ?? '', depth = url.searchParams.get('depth') ?? '';
    if ((metadata && keys.length) || (!metadata && !crop && !pole && (keys.length !== 3 || new Set(keys).size !== 3 || keys.some(key => !['purpose', 'budget', 'depth'].includes(key)) ||
      (purpose !== 'display' && purpose !== 'harness') || !/^[1-9]\d{0,5}$/.test(budget) || !/^[0-3]$/.test(depth)))) {
      send(400, { error: 'Expected purpose=display|harness, budget=positive integer, depth=0..3' }); return true;
    }
    if (active >= 2) { send(429, { error: 'Dataset busy; retry after current requests complete' }); return true; }
    active++;
    const controller = new AbortController();
    const abort = () => controller.abort();
    response.once('close', abort);
    try {
      if (poleRequest) {
        await streamClosestPole(directory, poleRequest, response, controller);
      } else if (box) {
        // Pull one bounded event at a time. Slow readers backpressure dataset reads.
        for await (const event of dataset.crop(box, controller.signal)) {
          controller.signal.throwIfAborted();
          if (!response.headersSent) response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
          if (!response.write(JSON.stringify(event) + '\n')) await once(response, 'drain', { signal: controller.signal });
        }
        response.end();
      } else {
        const result = metadata ? await dataset.info() : await dataset.sample({ budget: Number(budget), depth: Number(depth) }, purpose as 'display' | 'harness', controller.signal);
        send(200, result);
      }
    } catch (error) {
      // Do not reveal filesystem names or malformed prepared-file contents to the client.
      if (!controller.signal.aborted) {
        const message = error instanceof RangeError ? 'LOD or selection exceeds input limits (sample display 100000, harness 4096, depth 3)' : 'Prepared Toronto3D unavailable or unsupported; full resolution incomplete (no downsampling)';
        if (response.headersSent) response.end(JSON.stringify({ type: 'error', error: message }) + '\n');
        else send(error instanceof RangeError ? 400 : 503, { error: message });
      }
    } finally {
      active--;
      response.off('close', abort);
    }
    return true;
  };
}
