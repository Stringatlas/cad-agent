import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createPreparedCloudRegistry } from './prepared-cloud';

/** Operator-owned inventory. Tiles have independent local frames; never merge by filename. */
export const DALES_TILES = Object.freeze([
  '5080_54435', '5085_54320', '5095_54440', '5095_54455', '5100_54495', '5105_54405',
  '5105_54460', '5110_54320', '5110_54460', '5110_54475', '5110_54495', '5115_54480',
  '5130_54355', '5135_54495', '5140_54445', '5145_54340', '5145_54405', '5145_54460',
  '5145_54470', '5145_54480', '5150_54340', '5160_54330', '5165_54390', '5165_54395',
  '5180_54435', '5180_54485', '5185_54390', '5185_54485', '5190_54400',
]);
export const DEFAULT_PREPARED_ROOT = fileURLToPath(new URL('../../../../data/processed/dales2/', import.meta.url));
export function dalesRegistrations(root = DEFAULT_PREPARED_ROOT): Readonly<Record<string, string>> {
  return Object.fromEntries(DALES_TILES.map(tile => [`dales2-${tile.replace('_', '-')}`, join(root, tile)]));
}

/** Read-only bounded sampling only. No Toronto routes, edit/session authority or client-supplied paths. */
export function createPreparedCloudRoutes(registrations = dalesRegistrations()) {
  const registry = createPreparedCloudRegistry(registrations);
  const ids = new Set(Object.keys(registrations));
  let active = 0;
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/datasets/prepared')) return false;
    const send = (status: number, body: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify(body));
    };
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '') ||
      (request.headers.origin !== undefined && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.origin))) {
      send(403, { error: 'Local access only' }); return true;
    }
    if (request.method !== 'GET') { send(405, { error: 'Read-only scene' }); return true; }
    if (request.headers.range) { send(416, { error: 'Raw ranges are not exposed' }); return true; }
    if ((request.url?.length ?? 0) > 1024) { send(400, { error: 'Query too long' }); return true; }
    if (url.pathname === '/datasets/prepared' && !url.search) {
      send(200, { scenes: [...ids].map(id => ({ id, name: id.startsWith('dales2-') ? `DALES-2 · ${id.slice(7).replace('-', '_')}` : id })) });
      return true;
    }
    const match = /^\/datasets\/prepared\/([a-zA-Z0-9][a-zA-Z0-9._:-]{0,127})(\/sample)?$/.exec(url.pathname);
    if (!match || !ids.has(match[1])) { send(404, { error: 'Unknown scene' }); return true; }
    const sample = !!match[2], keys = [...url.searchParams.keys()];
    const revision = url.searchParams.get('revision') ?? '', budget = url.searchParams.get('budget') ?? '', depth = url.searchParams.get('depth') ?? '';
    if ((!sample && keys.length) || (sample && (keys.length !== 3 || new Set(keys).size !== 3 || keys.some(k => !['revision', 'budget', 'depth'].includes(k)) ||
      !/^[a-f0-9]{64}$/.test(revision) || !/^[1-9]\d{0,5}$/.test(budget) || Number(budget) > 100000 || !/^[01]$/.test(depth)))) {
      send(400, { error: 'Expected revision, budget=1..100000 and depth=0..1' }); return true;
    }
    if (active >= 2) { send(429, { error: 'Scene busy; retry shortly' }); return true; }
    active++;
    const controller = new AbortController(), abort = () => controller.abort();
    response.once('close', abort);
    const deadline = setTimeout(abort, 10000); deadline.unref();
    try {
      const reader = registry.open(match[1]);
      const result = sample ? await reader.sample(revision, { budget: Number(budget), depth: Number(depth) }, controller.signal, 'display') : await reader.info(controller.signal);
      controller.signal.throwIfAborted();
      send(200, result);
    } catch {
      send(503, { error: 'Prepared scene unavailable or changed; reload scene' });
    } finally { clearTimeout(deadline); response.off('close', abort); active--; }
    return true;
  };
}
