import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ProviderAuth, ProviderAuthError } from './provider-auth';

const COOKIE = 'spatial_oauth';
const MAX_BODY = 2048;
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const clean = () => { clearTimeout(timer); request.off('data', data); request.off('end', end); request.off('error', fail); request.off('aborted', fail); };
    const fail = () => { clean(); request.pause(); reject(new ProviderAuthError('invalid')); };
    const data = (chunk: Buffer) => { size += chunk.length; if (size > MAX_BODY) fail(); else chunks.push(chunk); };
    const end = () => { clean(); try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { reject(new ProviderAuthError('invalid')); } };
    const timer = setTimeout(fail, 3000);
    request.on('data', data); request.once('end', end); request.once('error', fail); request.once('aborted', fail);
  });
}
function browserId(request: IncomingMessage): string | undefined {
  const values = (request.headers.cookie ?? '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE}=`));
  if (values.length !== 1) return undefined;
  const value = values[0]!.slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : undefined;
}
/** Local single-user auth only: this does not authorize public access to project APIs. */
export function createAuthRoutes(auth: ProviderAuth, redirectUri = 'http://127.0.0.1:3001/auth/callback') {
  let active = false, windowStart = Date.now(), calls = 0;
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/auth' && !url.pathname.startsWith('/auth/')) return false;
    const send = (status: number, body: unknown) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    const clearCookie = () => response.setHeader('Set-Cookie', `${COOKIE}=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0`);
    const failure = (status: number, code: string) => { response.setHeader('Connection', 'close'); send(status, { ok: false, error: { code, message: 'Authentication request could not be completed' } }); };
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self' https://auth.openai.com; frame-ancestors 'none'; base-uri 'none'");
    const backendOrigin = `http://127.0.0.1:${request.socket.localPort}`;
    const allowedOrigins = new Set([backendOrigin, 'http://127.0.0.1:5173']);
    if (!allowedOrigins.has(`http://${request.headers.host ?? ''}`)) { failure(403, 'local-only'); return true; }
    const callback = url.pathname === '/auth/callback';
    if (!callback && request.headers.origin !== undefined && !allowedOrigins.has(request.headers.origin)) { failure(403, 'local-only'); return true; }
    const expected = ['/auth', '/auth/status', '/auth/callback'].includes(url.pathname) ? 'GET' : 'POST';
    if (!['/auth', '/auth/status', '/auth/chatgpt/start', '/auth/callback', '/auth/logout'].includes(url.pathname)) { failure(404, 'not-found'); return true; }
    if (request.method !== expected || (!callback && url.search) || (request.url?.length ?? 0) > 8192) { failure(400, 'invalid'); return true; }
    if (expected === 'GET' && (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) !== 0)) { failure(400, 'invalid'); return true; }
    if (url.pathname === '/auth/status') { send(200, { ok: true, result: auth.status() }); return true; }
    if (url.pathname === '/auth') {
      // Chrome uses Origin:null for form POSTs from a no-referrer document.
      // Preserve same-origin form Origin while suppressing cross-origin Referer.
      response.setHeader('Referrer-Policy', 'same-origin');
      const status = auth.status();
      // Labels and IDs originate from the checked store, not provider profile/user strings.
      const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      const options = status.accounts.map((account) => `<option value="${escape(account.id)}">${escape(account.label)}</option>`).join('');
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Provider authentication</title><h1>Spatial CAD Harness — provider authentication</h1><p>Mode: ${status.mode}. Credentials ready: ${status.ready}. No model requests are made here.</p>${status.mode === 'chatgpt' ? `<form method="post" action="/auth/chatgpt/start"><select name="accountId"><option value="">Add a ChatGPT account</option>${options}</select><button>Continue with ChatGPT</button></form><p>Eligible ChatGPT Plus/Pro plan usage, not API-key billing. <a href="https://chatgpt.com/settings/usage" rel="noreferrer">Manage usage in ChatGPT</a>.</p>` : '<p>Choose a provider mode in apps/server/.env and restart the server.</p>'}<form method="post" action="/auth/logout"><button>Sign out / clear runtime credentials</button></form><p>This is a local backend utility, not product-agent chat or public-server authentication.</p></html>`);
      return true;
    }
    if (!callback && ((request.headers['sec-fetch-site'] && !['same-origin', 'same-site', 'none'].includes(String(request.headers['sec-fetch-site']))) ||
      (request.headers['sec-fetch-site'] && !request.headers.origin))) { failure(403, 'local-only'); return true; }
    const now = Date.now(); if (now - windowStart >= 60_000) { windowStart = now; calls = 0; }
    if (active || calls >= 30) { failure(429, 'busy'); return true; }
    active = true; calls++;
    try {
      if (callback) {
        const configured = new URL(redirectUri);
        if (`http://${request.headers.host}` !== configured.origin || backendOrigin !== configured.origin) throw new ProviderAuthError('invalid');
        const id = browserId(request); clearCookie();
        if (!id) throw new ProviderAuthError('invalid');
        const actual = new URL(request.url!, backendOrigin);
        await auth.callback(id, actual);
        response.statusCode = 303; response.setHeader('Location', '/auth'); response.end();
        return true;
      }
      const type = request.headers['content-type'] ?? '';
      const json = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(type);
      const form = /^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/iu.test(type);
      if ((!json && !form) || request.headers['content-encoding'] || Number(request.headers['content-length'] ?? 0) > MAX_BODY) throw new ProviderAuthError('invalid');
      const raw = await readBody(request);
      if (request.aborted || response.destroyed) return true;
      let body: unknown;
      if (json) body = JSON.parse(raw);
      else {
        const fields = new URLSearchParams(raw);
        if ([...fields.keys()].some((key) => fields.getAll(key).length !== 1)) throw new ProviderAuthError('invalid');
        body = Object.fromEntries(fields);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProviderAuthError('invalid');
      const parameters = body as Record<string, unknown>;
      if (url.pathname === '/auth/logout') {
        if (Object.keys(parameters).length) throw new ProviderAuthError('invalid');
        clearCookie(); const result = await auth.logout();
        send(200, { ok: true, result }); return true;
      }
      if (Object.keys(parameters).some((key) => key !== 'accountId') ||
        (parameters.accountId !== undefined && typeof parameters.accountId !== 'string')) throw new ProviderAuthError('invalid');
      const id = browserId(request) ?? randomBytes(32).toString('base64url');
      const authorizationUrl = await auth.start(id, (parameters.accountId as string | undefined) || undefined);
      // HTTP loopback cookie intentionally omits Secure; callback is mandated HTTP by OSS SIWC.
      response.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600`);
      if (form) { response.statusCode = 303; response.setHeader('Location', authorizationUrl); response.end(); }
      else send(200, { ok: true, result: { authorizationUrl } });
    } catch (error) {
      if (callback) clearCookie();
      const code = error instanceof ProviderAuthError ? error.code : 'invalid';
      failure(code === 'invalid' ? 400 : code === 'storage' || code === 'unavailable' ? 503 : 502, code);
    } finally { active = false; }
    return true;
  };
}
