import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Vec3 } from '@spatial/contracts';
import { SemanticArtifact, SemanticFailure } from './semantic-artifact';
import { getSemanticDiskIndex } from './semantic-disk-index';
import { SpatialPageIndex } from './spatial-page-index';

interface SpatialRequest {
  revision: string;
  operation: 'nearest' | 'radius' | 'point-distance';
  position: Vec3;
  label?: number;
  radiusMeters?: number;
  maxResults?: number;
}

function parseRequest(params: URLSearchParams): SpatialRequest {
  if ([...params.keys()].length !== 1 || !params.has('request')) throw new TypeError();
  const text = params.get('request')!;
  const value = JSON.parse(text) as SpatialRequest;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  // JSON.parse alone silently discards duplicate keys (including escaped spellings).
  // Scan valid JSON string tokens at the root object level before trusting its fields.
  const keys = new Set<string>();
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const start = i++;
      while (text[i] !== '"') { if (text[i] === '\\') i++; i++; }
      if (depth === 1 && /^\s*:/.test(text.slice(i + 1))) {
        const key: string = JSON.parse(text.slice(start, i + 1));
        if (keys.has(key)) throw new TypeError();
        keys.add(key);
      }
    } else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  if ([...keys].some(key => !['revision', 'operation', 'position', 'label', 'radiusMeters', 'maxResults'].includes(key)) ||
    typeof value.revision !== 'string' || !value.revision.trim() || value.revision.length > 128 ||
    !['nearest', 'radius', 'point-distance'].includes(value.operation) ||
    !Array.isArray(value.position) || value.position.length !== 3 || !value.position.every(n => typeof n === 'number' && Number.isFinite(n)) ||
    (keys.has('label') && (!Number.isInteger(value.label) || value.label! < 0 || value.label! > 8)) ||
    (keys.has('radiusMeters') && (typeof value.radiusMeters !== 'number' || !Number.isFinite(value.radiusMeters) || value.radiusMeters < 0)) ||
    (keys.has('maxResults') && (!Number.isInteger(value.maxResults) || value.maxResults! < 0 || value.maxResults! > 1000)) ||
    (value.operation === 'radius' ? !keys.has('radiusMeters') : keys.has('radiusMeters') || keys.has('maxResults'))) throw new TypeError();
  return value;
}

/** Separate admission and lifetime for read-only ORIGINAL-source point queries. */
export function createSpatialQueryRoutes(directory: string) {
  let active = false;
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://127.0.0.1'); }
    catch { return false; }
    if (url.pathname !== '/datasets/toronto3d/spatial-query') return false;
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
    if (request.headers.range) { send(416, { error: 'Raw byte ranges are not exposed' }); return true; }
    if ((request.url?.length ?? 0) > 4096) { send(400, { error: 'Query too long' }); return true; }
    let query: SpatialRequest;
    try { query = parseRequest(url.searchParams); }
    catch { send(400, { error: 'Invalid spatial query request' }); return true; }
    if (active) { send(429, { error: 'Spatial query busy; retry later' }); return true; }
    active = true;
    const controller = new AbortController(), started = performance.now();
    const abort = () => controller.abort();
    response.once('close', abort);
    const deadline = setTimeout(abort, 30000); deadline.unref();
    let snapshot: SemanticArtifact | undefined;
    try {
      snapshot = await SemanticArtifact.open(directory, controller.signal);
      if (snapshot.dataset.revision !== query.revision) throw new SemanticFailure('stale-revision', 'Stale spatial request');
      const { index } = await getSemanticDiskIndex(snapshot, controller.signal);
      const spatial = await SpatialPageIndex.create(snapshot, index, controller.signal);
      const remaining = Math.floor(30000 - (performance.now() - started));
      if (remaining <= 0) throw new RangeError('Spatial deadline exceeded');
      const options = { label: query.label, signal: controller.signal, maxMilliseconds: remaining };
      const result = query.operation === 'radius' ? await spatial.radius(query.position, query.radiusMeters!, { ...options, maxResults: query.maxResults ?? 1000 }) :
        query.operation === 'point-distance' ? await spatial.clearance(query.position, options) : await spatial.nearest(query.position, options);
      controller.signal.throwIfAborted();
      if (performance.now() - started >= 30000) throw new RangeError('Spatial deadline exceeded');
      send(200, { ...result, operation: query.operation, domain: 'original-source-points',
        independentVerification: false, cadVerification: false,
        limitations: 'Original source point positions only; excludes edits. Point distance is not solid, surface or obstacle clearance.' });
    } catch (error) {
      send(error instanceof SemanticFailure && error.code === 'stale-revision' ? 409 : 503,
        { complete: false, error: error instanceof SemanticFailure && error.code === 'stale-revision' ? 'Stale artifact revision; refresh dataset' : 'Spatial query unavailable or exceeds limits; no complete result' });
    } finally {
      clearTimeout(deadline);
      response.off('close', abort);
      try { await snapshot?.close(); } finally { active = false; }
    }
    return true;
  };
}
