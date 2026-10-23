import { openPreparedElevation } from './prepared-elevation';
import { openPreparedTerrain } from './prepared-terrain';
import { canonicalElevationCoordinates, type ElevationLayer } from '@spatial/contracts';
import { encodePreparedNode, PREPARED_NODE_MIME } from '@spatial/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPreparedCloudRegistry } from './prepared-cloud';
import { preparedCloudRegistrations, preparedCloudName } from './scene-registry';

/** Read-only bounded sampling only. No Toronto routes, edit/session authority or client-supplied paths. */
export function createPreparedCloudRoutes(registrations = preparedCloudRegistrations()) {
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
      send(200, { scenes: [...ids].map(id => ({ id, name: preparedCloudName(id) })) });
      return true;
    }
    const match = /^\/datasets\/prepared\/([a-zA-Z0-9][a-zA-Z0-9._:-]{0,127})(\/(?:sample|point|display-hierarchy|display-node|elevation|elevation-grid|elevation-query|terrain-grid))?$/.exec(url.pathname);
    if (!match || !ids.has(match[1])) { send(404, { error: 'Unknown scene' }); return true; }
    const sample = match[2] === '/sample', point = match[2] === '/point', keys = [...url.searchParams.keys()];
    const terrainGrid = match[2] === '/terrain-grid';
    const elevation = match[2] === '/elevation' || match[2] === '/elevation-grid' || match[2] === '/elevation-query' || terrainGrid;
    const elevationGrid = match[2] === '/elevation-grid', elevationQuery = match[2] === '/elevation-query';
    const hierarchy = match[2] === '/display-hierarchy', native = match[2] === '/display-node';
    const revision = url.searchParams.get('revision') ?? '', budget = url.searchParams.get('budget') ?? '', depth = url.searchParams.get('depth') ?? '';
    const fileId = url.searchParams.get('sourceFileId') ?? '', row = url.searchParams.get('sourceRow') ?? '';
    if (elevation) {
      const required = ['revision', ...(terrainGrid ? ['modelRevision', 'terrainRevision', 'maxSize'] : elevationGrid ? ['modelRevision', 'layer', 'maxSize'] : elevationQuery ? ['modelRevision', 'x', 'y'] : [])];
      let valid = keys.length === required.length && new Set(keys).size === keys.length && keys.every(k => required.includes(k)) && /^[a-f0-9]{64}$/.test(revision);
      if (elevationGrid || elevationQuery || terrainGrid) valid &&= /^[a-f0-9]{64}$/.test(url.searchParams.get('modelRevision') ?? '');
      if (terrainGrid) valid &&= /^[a-f0-9]{64}$/.test(url.searchParams.get('terrainRevision') ?? '') && /^(1[6-9]|[2-9]\d|1[0-8]\d|19[0-2])$/.test(url.searchParams.get('maxSize') ?? '');
      if (elevationGrid) valid &&= ['dtm', 'dsm', 'ndsm'].includes(url.searchParams.get('layer') ?? '') && /^(1[6-9]|[2-9]\d|1\d{2}|2[0-4]\d|25[0-6])$/.test(url.searchParams.get('maxSize') ?? '');
      if (elevationQuery) { try { canonicalElevationCoordinates({ x: Number(url.searchParams.get('x')), y: Number(url.searchParams.get('y')) }); valid &&= ['x', 'y'].every(k => !!url.searchParams.get(k)?.trim()); } catch { valid = false; } }
      if (!valid) { send(400, { error: 'Invalid elevation query' }); return true; }
    }
    if (point && (keys.length !== 3 || new Set(keys).size !== 3 || keys.some(k => !['revision', 'sourceFileId', 'sourceRow'].includes(k)) ||
      !/^[a-f0-9]{64}$/.test(revision) || !/^(0|[1-9]\d{0,4})$/.test(fileId) || Number(fileId) > 65535 || !/^(0|[1-9]\d{0,9})$/.test(row) || Number(row) > 0xffffffff)) {
      send(400, { error: 'Expected revision and original source key' }); return true;
    }
    if ((hierarchy || native) && (keys.length !== (native ? 2 : 1) || new Set(keys).size !== keys.length || keys.some(k => !['revision', ...(native ? ['name'] : [])].includes(k)) || !/^[a-f0-9]{64}$/.test(revision) || (native && !/^r[0-7]{0,24}$/.test(url.searchParams.get('name') ?? '')))) {
      send(400, { error: 'Expected bound native display request' }); return true;
    }
    if ((!sample && !point && !hierarchy && !native && !elevation && keys.length) || (sample && (keys.length !== 3 || new Set(keys).size !== 3 || keys.some(k => !['revision', 'budget', 'depth'].includes(k)) ||
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
      if (elevation) {
        const source = await reader.info(controller.signal);
        if (source.revision !== revision) throw new Error('Stale source revision');
        const model = await openPreparedElevation(registrations[match[1]], source, controller.signal);
        if (!model) { send(404, { error: 'Elevation model not prepared' }); return true; }
        if ((elevationGrid || elevationQuery || terrainGrid) && model.info.revision !== url.searchParams.get('modelRevision')) throw new Error('Stale model revision');
        let terrain: Awaited<ReturnType<typeof openPreparedTerrain>>;
        if (!elevationGrid && !elevationQuery) {
          try { terrain = await openPreparedTerrain(registrations[match[1]], model, controller.signal); }
          catch (error) { if (terrainGrid) throw error; controller.signal.throwIfAborted(); }
        }
        if (terrainGrid) {
          if (!terrain || terrain.info.revision !== url.searchParams.get('terrainRevision')) throw new Error('Terrain unavailable or changed');
          const grid = await terrain.grid(Number(url.searchParams.get('maxSize')), controller.signal);
          if ((await reader.info(controller.signal)).revision !== revision) throw new Error('Source changed');
          send(200, grid); return true;
        }
        const result = elevationGrid ? await model.grid(url.searchParams.get('layer') as ElevationLayer, Number(url.searchParams.get('maxSize')), controller.signal)
          : elevationQuery ? await model.query({ x: Number(url.searchParams.get('x')), y: Number(url.searchParams.get('y')) }, controller.signal) : { ...model.info, ...(terrain ? { terrain: terrain.info } : {}) };
        if ((await reader.info(controller.signal)).revision !== revision) throw new Error('Source changed');
        send(200, result); return true;
      }
      if (hierarchy) { send(200, await reader.displayHierarchy(revision, controller.signal)); return true; }
      if (native) {
        const bytes = encodePreparedNode(await reader.displayNode(revision, url.searchParams.get('name')!, controller.signal));
        controller.signal.throwIfAborted();
        if (!response.destroyed && !response.writableEnded) {
          response.statusCode = 200; response.setHeader('Content-Type', PREPARED_NODE_MIME); response.setHeader('Cache-Control', 'no-store');
          response.setHeader('Content-Length', bytes.byteLength); response.end(bytes);
        }
        return true;
      }
      if (point) {
        const result = await reader.queryOriginal(revision, { operation: 'key', key: { sourceFileId: Number(fileId), sourceRow: Number(row) }, maxResults: 1 }, controller.signal);
        const cloud = await reader.info(controller.signal);
        if (cloud.revision !== revision || result.count !== 1) throw new Error('Unknown or stale source point');
        controller.signal.throwIfAborted(); send(200, { cloud, point: result.points[0] }); return true;
      }
      const result = sample ? await reader.sample(revision, { budget: Number(budget), depth: Number(depth) }, controller.signal, 'display') : await reader.info(controller.signal);
      controller.signal.throwIfAborted();
      send(200, result);
    } catch {
      send(503, { error: 'Prepared scene unavailable or changed; reload scene' });
    } finally { clearTimeout(deadline); response.off('close', abort); active--; }
    return true;
  };
}
