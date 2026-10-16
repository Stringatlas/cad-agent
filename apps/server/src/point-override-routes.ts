import type { IncomingMessage, ServerResponse } from 'node:http';
import { POINT_OVERRIDE_LIMITS, type PointOverrideErrorCode } from '@spatial/contracts';
import { PointOverrideSession, PointOverrideError } from './point-overrides';

const ROOT = '/datasets/toronto3d/overrides';
const STATUS: Record<PointOverrideErrorCode, number> = { 'invalid-request': 400, 'stale-session': 409, 'stale-revision': 409, 'stale-artifact': 409,
  'unknown-point': 404, 'position-mismatch': 409, 'unknown-proposal': 404, 'nothing-to-undo': 409, 'resource-limit': 413, busy: 429, 'local-only': 403, unavailable: 503 };
function readBody(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const clean = () => { clearTimeout(timer); request.off('data', data); request.off('end', end); request.off('error', fail); request.off('aborted', fail); signal.removeEventListener('abort', fail); };
    const invalid = (code: PointOverrideErrorCode = 'invalid-request') => { clean(); request.pause(); reject(new PointOverrideError(code)); };
    const fail = () => invalid();
    const data = (chunk: Buffer) => { size += chunk.length; if (size > POINT_OVERRIDE_LIMITS.requestBytes) invalid('resource-limit'); else chunks.push(chunk); };
    const end = () => { clean(); try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new PointOverrideError('invalid-request')); } };
    const timer = setTimeout(() => invalid('resource-limit'), POINT_OVERRIDE_LIMITS.bodyTimeoutMs);
    request.on('data', data); request.once('end', end); request.once('error', fail); request.once('aborted', fail); signal.addEventListener('abort', fail, { once: true });
    if (signal.aborted) fail();
  });
}
/** Local single-user admission includes body reading, source checks and atomic publication. */
export function createPointOverrideRoutes(directory: string) {
  const authority = new PointOverrideSession(directory);
  let active = false, closed = false, windowStart = Date.now(), calls = 0;
  const controllers = new Set<AbortController>();
  return {
    async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== ROOT && !url.pathname.startsWith(ROOT + '/')) return false;
      const send = (status: number, body: unknown) => { if (response.destroyed || response.writableEnded) return; response.statusCode = status; response.end(JSON.stringify(body)); };
      const error = (code: PointOverrideErrorCode) => { response.setHeader('Connection', 'close'); send(STATUS[code], { ok: false, error: { code, message: code } }); };
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '') ||
        (request.headers.origin !== undefined && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.origin))) { error('local-only'); return true; }
      const operation = url.pathname === ROOT ? 'snapshot' : url.pathname === ROOT + '/propose' ? 'propose' : url.pathname === ROOT + '/approve' ? 'approve' : url.pathname === ROOT + '/undo' ? 'undo' : undefined;
      if (!operation || url.search || request.method !== (operation === 'snapshot' ? 'GET' : 'POST')) { error('invalid-request'); return true; }
      if (operation === 'snapshot') {
        if (Number(request.headers['content-length'] ?? 0) !== 0 || request.headers['transfer-encoding']) { error('invalid-request'); return true; }
      } else {
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '') || request.headers['content-encoding']) { error('invalid-request'); return true; }
        if (Number(request.headers['content-length'] ?? 0) > POINT_OVERRIDE_LIMITS.requestBytes) { error('resource-limit'); return true; }
      }
      const now = Date.now(); if (now - windowStart >= 60000) { windowStart = now; calls = 0; }
      if (closed) { error('unavailable'); return true; }
      if (active || calls >= POINT_OVERRIDE_LIMITS.requestsPerMinute) { error('busy'); return true; }
      active = true; calls++;
      const controller = new AbortController(); controllers.add(controller);
      const abort = () => controller.abort(); response.once('close', abort);
      try {
        const body = operation === 'snapshot' ? undefined : await readBody(request, controller.signal);
        controller.signal.throwIfAborted();
        const result = await authority.execute(operation, body, controller.signal);
        send(200, { ok: true, result });
      } catch (failure) { if (!controller.signal.aborted) error(failure instanceof PointOverrideError ? failure.code : 'unavailable'); }
      finally { active = false; controllers.delete(controller); response.off('close', abort); }
      return true;
    },
    async close() { closed = true; for (const controller of controllers) controller.abort(); await authority.close(); },
  };
}
