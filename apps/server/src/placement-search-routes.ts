import type { IncomingMessage, ServerResponse } from 'node:http';
import { TORONTO_CAD_LIMITS, type TorontoCadErrorCode } from '@spatial/contracts';
import { TorontoCadError } from './toronto-cad-session';
import { PlacementSearchSession } from './placement-search-session';
const ROOT = '/datasets/toronto3d/placement';
const STATUS: Record<TorontoCadErrorCode, number> = { 'invalid-request': 400, 'stale-session': 409, 'stale-revision': 409, 'stale-artifact': 409,
  'unknown-proposal': 404, 'nothing-to-undo': 409, 'resource-limit': 413, busy: 429, 'local-only': 403, unavailable: 503 };
function readBody(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const clean = () => { clearTimeout(timer); request.off('data', data); request.off('end', end); request.off('error', fail); request.off('aborted', fail); signal.removeEventListener('abort', fail); };
    const invalid = (code: TorontoCadErrorCode = 'invalid-request') => { clean(); request.pause(); reject(new TorontoCadError(code)); };
    const fail = () => invalid();
    const data = (chunk: Buffer) => { size += chunk.length; if (size > TORONTO_CAD_LIMITS.requestBytes) invalid('resource-limit'); else chunks.push(chunk); };
    const end = () => { clean(); try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new TorontoCadError('invalid-request')); } };
    const timer = setTimeout(() => invalid('resource-limit'), TORONTO_CAD_LIMITS.bodyTimeoutMs);
    request.on('data', data); request.once('end', end); request.once('error', fail); request.once('aborted', fail); signal.addEventListener('abort', fail, { once: true });
    if (signal.aborted) fail();
  });
}
/** Route admission includes bounded body reads; session also guards direct tool calls. */
export function createPlacementSearchRoutes(authority: PlacementSearchSession) {
  let active = false, closed = false, windowStart = Date.now(), calls = 0;
  const controllers = new Set<AbortController>();
  return {
    async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== ROOT && !url.pathname.startsWith(ROOT + '/')) return false;
      const send = (status: number, body: unknown) => { if (response.destroyed || response.writableEnded) return; response.statusCode = status; response.end(JSON.stringify(body)); };
      const error = (code: TorontoCadErrorCode) => { response.setHeader('Connection', 'close'); send(STATUS[code], { ok: false, error: { code, message: code } }); };
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '') ||
          (request.headers.origin !== undefined && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.origin))) { error('local-only'); return true; }
      const operation = url.pathname === ROOT + '/search' ? 'search' : url.pathname === ROOT + '/propose' ? 'propose' : undefined;
      if (!operation || url.search || request.method !== 'POST' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '') || request.headers['content-encoding']) { error('invalid-request'); return true; }
      if (Number(request.headers['content-length'] ?? 0) > TORONTO_CAD_LIMITS.requestBytes) { error('resource-limit'); return true; }
      const now = Date.now(); if (now - windowStart >= 60000) { windowStart = now; calls = 0; }
      if (closed) { error('unavailable'); return true; }
      if (active || calls >= TORONTO_CAD_LIMITS.requestsPerMinute) { error('busy'); return true; }
      active = true; calls++;
      const controller = new AbortController(); controllers.add(controller);
      const abort = () => controller.abort(); response.once('close', abort);
      try {
        const body = await readBody(request, controller.signal); controller.signal.throwIfAborted();
        const result = await authority[operation](body, controller.signal);
        send(200, { ok: true, result });
      } catch (failure) { if (!controller.signal.aborted) error(failure instanceof TorontoCadError ? failure.code : 'unavailable'); }
      finally { active = false; controllers.delete(controller); response.off('close', abort); }
      return true;
    },
    async close() { closed = true; for (const controller of controllers) controller.abort(); await authority.close(); },
  };
}
