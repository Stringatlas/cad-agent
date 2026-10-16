import type { IncomingMessage, ServerResponse } from 'node:http';
import { CAD_OPERATIONS, CAD_LIMITS, CadError, canonicalCadRequest, type CadCapabilities, type CadErrorCode, type CadSource } from '@spatial/contracts';
import { CadWorkerClient } from './cad-client';

class BodyLimitError extends CadError {
  constructor() { super('resource-limit', 'CAD request body limit exceeded'); }
}
function body(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const clean = () => { clearTimeout(timer); request.off('data', data); request.off('end', end); request.off('error', fail); request.off('aborted', fail); };
    const rejectBody = (error: CadError) => { clean(); request.pause(); reject(error); };
    const fail = () => rejectBody(new CadError('invalid-request', 'Incomplete CAD request body'));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > CAD_LIMITS.maxRequestBytes) rejectBody(new BodyLimitError());
      else chunks.push(chunk);
    };
    const end = () => {
      clean();
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { reject(new CadError('invalid-request', 'Expected valid JSON')); }
    };
    const timer = setTimeout(() => rejectBody(new CadError('timeout', 'CAD request body timed out')), CAD_LIMITS.requestTimeoutMs);
    request.on('data', data); request.once('end', end); request.once('error', fail); request.once('aborted', fail);
  });
}
const STATUSES: Record<CadErrorCode, number> = {
  'invalid-request': 400, 'stale-source': 409, 'unknown-body': 404, 'stale-body': 409, 'invalid-solid': 422,
  'resource-limit': 422, busy: 409, timeout: 504, 'kernel-failure': 503, closed: 503,
  'method-not-allowed': 405, 'unsupported-media-type': 415, 'local-only': 403,
};
export function createCadRoutes(source: CadSource, currentSource: () => CadSource = () => source) {
  const binding = Object.freeze({ ...source });
  const client = new CadWorkerClient(binding);
  let active = false;
  const capabilities: CadCapabilities = { source: binding, units: 'm', handedness: 'right', upAxis: 'Z', operations: CAD_OPERATIONS,
    limits: CAD_LIMITS, sandbox: 'ephemeral', publishesProject: false, resetInvalidatesBodies: true };
  return {
    close: () => client.close(),
    async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/cad/capabilities' && url.pathname !== '/cad/execute') return false;
      const send = (status: number, value: unknown) => {
        if (response.destroyed) return;
        response.statusCode = status;
        const text = JSON.stringify(value);
        if (Buffer.byteLength(text) > CAD_LIMITS.maxResponseBytes) {
          response.statusCode = 422; response.end(JSON.stringify({ ok: false, error: { code: 'resource-limit', message: 'CAD response limit exceeded' } }));
        } else response.end(text);
      };
      const error = (code: CadErrorCode, message: string, status = STATUSES[code]) => send(status, { ok: false, error: { code, message } });
      // Mutating sandbox endpoints are local operator APIs, never a public cross-origin write surface.
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '') ||
          (request.headers.origin !== undefined && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.origin))) {
        response.setHeader('Connection', 'close'); error('local-only', 'CAD endpoints require local access'); return true;
      }
      const expectedMethod = url.pathname === '/cad/capabilities' ? 'GET' : 'POST';
      if (request.method !== expectedMethod) {
        response.setHeader('Allow', expectedMethod); response.setHeader('Connection', 'close'); error('method-not-allowed', `Expected ${expectedMethod}`); return true;
      }
      if (url.search) { response.setHeader('Connection', 'close'); error('invalid-request', 'CAD endpoints do not accept query parameters'); return true; }
      const current = () => { const live = currentSource(); return live.sessionId === binding.sessionId && live.projectRevision === binding.projectRevision && live.frameId === binding.frameId; };
      if (!current()) { error('stale-source', 'Sandbox source is stale after project edit/load; restart server for a fresh sandbox'); return true; }
      if (expectedMethod === 'GET') {
        if (Number(request.headers['content-length'] ?? 0) !== 0 || request.headers['transfer-encoding']) { response.setHeader('Connection', 'close'); error('invalid-request', 'Capabilities does not accept a body'); }
        else send(200, { ok: true, result: capabilities });
        return true;
      }
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '') || request.headers['content-encoding']) {
        response.setHeader('Connection', 'close'); error('unsupported-media-type', 'Expected uncompressed application/json'); return true;
      }
      if (Number(request.headers['content-length'] ?? 0) > CAD_LIMITS.maxRequestBytes) {
        response.setHeader('Connection', 'close'); error('resource-limit', 'CAD request body limit exceeded', 413); return true;
      }
      if (active) { response.setHeader('Connection', 'close'); error('busy', 'One CAD request is already in flight'); return true; }
      active = true;
      const controller = new AbortController();
      const abort = () => { if (!response.writableEnded) controller.abort(); };
      response.once('close', abort); request.once('aborted', abort);
      try {
        const call = canonicalCadRequest(await body(request));
        if (!current() || call.sessionId !== binding.sessionId || call.projectRevision !== binding.projectRevision || call.frameId !== binding.frameId) throw new CadError('stale-source', 'CAD source binding is stale or belongs to another session/frame');
        const result = await client.execute(call.operation, controller.signal);
        if (!current()) throw new CadError('stale-source', 'Project changed during CAD operation; sandbox output not published');
        send(200, { ok: true, result });
      } catch (failure) {
        response.setHeader('Connection', 'close');
        if (failure instanceof CadError) error(failure.code, failure.message, failure instanceof BodyLimitError ? 413 : STATUSES[failure.code]);
        else error('kernel-failure', 'CAD sandbox unavailable');
      } finally { active = false; response.off('close', abort); request.off('aborted', abort); }
      return true;
    },
  };
}
