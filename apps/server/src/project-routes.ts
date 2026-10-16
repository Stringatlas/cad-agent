import type { IncomingMessage, ServerResponse } from 'node:http';
import { PROJECT_LIMITS, type ProjectErrorCode } from '@spatial/contracts';
import { ProjectSession, ProjectError } from './project-session';

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const clean = () => { clearTimeout(timer); request.off('data', data); request.off('end', end); request.off('error', fail); request.off('aborted', fail); };
    const invalid = (code: ProjectErrorCode = 'invalid-request') => { clean(); request.pause(); reject(new ProjectError(code, 'Invalid bounded project request')); };
    const fail = () => invalid();
    const data = (chunk: Buffer) => { size += chunk.length; if (size > PROJECT_LIMITS.requestBytes) invalid('resource-limit'); else chunks.push(chunk); };
    const end = () => { clean(); try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new ProjectError('invalid-request', 'Expected JSON')); } };
    const timer = setTimeout(() => invalid('resource-limit'), PROJECT_LIMITS.bodyTimeoutMs);
    request.on('data', data); request.once('end', end); request.once('error', fail); request.once('aborted', fail);
  });
}
const ROUTES = ['/project', '/project/session', '/project/context', '/project/save', '/project/load', '/project/proposals', '/project/approve', '/project/undo'];
const STATUS: Record<ProjectErrorCode, number> = { 'invalid-request': 400, 'stale-project': 409, 'unknown-entity': 404, 'invalid-point': 422,
  'unknown-proposal': 404, 'approval-mismatch': 409, 'expired-proposal': 409, 'nothing-to-undo': 409, 'resource-limit': 413,
  busy: 429, 'local-only': 403, 'snapshot-missing': 404, 'snapshot-corrupt': 422, 'storage-unavailable': 503, 'postcondition-failed': 422 };
/** Single-user local surface. Admission covers body reading; there is no queue. */
export function createProjectRoutes(authority: ProjectSession) {
  let active = false, windowStart = Date.now(), calls = 0;
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!ROUTES.includes(url.pathname) || (url.pathname === '/project' && request.method !== 'GET')) return false;
    const send = (status: number, body: unknown) => {
      if (response.destroyed) return;
      response.statusCode = status;
      const snapshot = authority.snapshot();
      response.setHeader('X-Spatial-Session', snapshot.sessionId); response.setHeader('X-Spatial-Frame', snapshot.frameId);
      response.end(JSON.stringify(body));
    };
    const error = (code: ProjectErrorCode, message: string) => { response.setHeader('Connection', 'close'); send(STATUS[code], { ok: false, error: { code, message } }); };
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '') ||
      (request.headers.origin !== undefined && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.origin))) {
      error('local-only', 'Project APIs require local access'); return true;
    }
    const expectedMethod = url.pathname === '/project' || url.pathname === '/project/session' ? 'GET' : 'POST';
    if (request.method !== expectedMethod || url.search) { error('invalid-request', `Expected ${expectedMethod} without query parameters`); return true; }
    if (expectedMethod === 'GET') {
      if (Number(request.headers['content-length'] ?? 0) !== 0 || request.headers['transfer-encoding']) error('invalid-request', 'Project reads do not accept a body');
      else if (url.pathname === '/project') send(200, authority.snapshot().project);
      else send(200, { ok: true, result: authority.info() });
      return true;
    }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '') || request.headers['content-encoding']) { error('invalid-request', 'Expected uncompressed JSON'); return true; }
    if (Number(request.headers['content-length'] ?? 0) > PROJECT_LIMITS.requestBytes) { error('resource-limit', 'Project request body limit'); return true; }
    const now = Date.now(); if (now - windowStart >= 60000) { windowStart = now; calls = 0; }
    if (active || calls >= PROJECT_LIMITS.requestsPerMinute) { error('busy', 'Project admission or rate limit'); return true; }
    active = true; calls++;
    try {
      const call = await readBody(request);
      if (request.aborted || response.destroyed) return true;
      let result: unknown;
      switch (url.pathname) {
        case '/project/context': result = authority.context(call); break;
        case '/project/save': result = authority.save(call); break;
        case '/project/load': result = authority.load(call); break;
        case '/project/proposals': result = authority.propose(call); break;
        case '/project/approve': result = authority.approve(call); break;
        case '/project/undo': result = authority.undo(call); break;
        default: throw new ProjectError('invalid-request', 'Unknown project operation');
      }
      send(200, { ok: true, result });
    } catch (failure) {
      if (failure instanceof ProjectError) error(failure.code, failure.message);
      else error('invalid-request', 'Invalid project parameters or bounded snapshot');
    } finally { active = false; }
    return true;
  };
}
