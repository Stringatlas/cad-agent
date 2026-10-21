import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createAuthRoutes } from '../apps/server/src/auth-routes';
import { ProviderAuth } from '../apps/server/src/provider-auth';
import { createDemoServer } from '../apps/server/src/index';

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function fixture(t: TestContext, mode: 'disabled' | 'api-key' | 'chatgpt' = 'chatgpt') {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'spatial-auth-http-'));
  let routes: ReturnType<typeof createAuthRoutes>;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    void routes(request, response).then((handled) => { if (!handled) { response.statusCode = 404; response.end(); } });
  });
  const base = await listen(server);
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let nonce = '', exchanges = 0;
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ issuer: 'https://auth.openai.com', authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize', token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token', jwks_uri: 'https://auth.openai.com/.well-known/jwks.json', revocation_endpoint: 'https://auth.openai.com/revoke' });
    if (url.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'fake-key', alg: 'RS256' }] });
    if (url.endsWith('/revoke')) return new Response('', { status: 200 });
    assert.equal(url, 'https://auth.openai.com/api/accounts/oauth/token'); exchanges++;
    const params = new URLSearchParams(String(init?.body));
    assert.equal(params.get('redirect_uri'), `${base}/auth/callback`);
    const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const payload = `${encode({ alg: 'RS256', kid: 'fake-key' })}.${encode({ iss: 'https://auth.openai.com', sub: 'fake-person', aud: 'oaiapp_http', nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    const idToken = `${payload}.${sign('RSA-SHA256', Buffer.from(payload), pair.privateKey).toString('base64url')}`;
    return Response.json({ id_token: idToken, access_token: 'fake-access-secret', refresh_token: 'fake-refresh-secret', scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', token_type: 'Bearer', expires_in: 3600 });
  };
  const auth = new ProviderAuth({ mode, apiKey: mode === 'api-key' ? 'fake-api-key-secret' : undefined, credentialPath: join(root, 'credentials.json'), redirectUri: `${base}/auth/callback`, fetch: transport });
  routes = createAuthRoutes(auth, `${base}/auth/callback`);
  t.after(async () => { auth.close(); await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); });
  const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), redirect: 'manual' });
  const start = async () => {
    const response = await post('/auth/chatgpt/start'); assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')!; const result = await response.json();
    const url = new URL(result.result.authorizationUrl); nonce = url.searchParams.get('nonce')!;
    return { cookie: cookie.split(';')[0]!, state: url.searchParams.get('state')!, rawCookie: cookie, url };
  };
  return { base, post, start, auth, exchanges: () => exchanges };
}
test('backend OAuth browser cookie, callback redirect, status and logout contain no credentials', async (t) => {
  const f = await fixture(t); const started = await f.start();
  assert.match(started.rawCookie, /HttpOnly/); assert.match(started.rawCookie, /SameSite=Lax/); assert.match(started.rawCookie, /Path=\/auth/);
  assert.equal(started.url.hostname, 'auth.openai.com');
  const target = `${f.base}/auth/callback?code=fake-code-secret&state=${started.state}&client_id=oaiapp_http`;
  const callback = await fetch(target, { headers: { Cookie: started.cookie }, redirect: 'manual' });
  assert.equal(callback.status, 303); assert.equal(callback.headers.get('location'), '/auth'); assert.match(callback.headers.get('set-cookie')!, /Max-Age=0/);
  assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
  const status = await fetch(f.base + '/auth/status'); const text = await status.text();
  assert.equal(JSON.parse(text).result.ready, true); assert.doesNotMatch(text, /secret|fake-person|id_token|bearer/);
  const landing = await fetch(f.base + '/auth'); assert.match(await landing.text(), /Continue with ChatGPT/);
  assert.equal(landing.headers.get('referrer-policy'), 'same-origin');
  assert.match(landing.headers.get('content-security-policy')!, /form-action 'self' https:\/\/auth\.openai\.com;/u);
  const logout = await f.post('/auth/logout'); assert.equal(logout.status, 200);
  assert.equal((await logout.json()).result.remoteRevocationConfirmed, true); assert.equal(f.auth.status().ready, false);
  const replay = await fetch(target, { headers: { Cookie: started.cookie }, redirect: 'manual' }); assert.equal(replay.status, 400); assert.equal(f.exchanges(), 1);
});
test('callback rejects missing/foreign/duplicate cookie and wrong state before exchange', async (t) => {
  const f = await fixture(t); const started = await f.start();
  const target = `${f.base}/auth/callback?code=secret&state=${started.state}&client_id=oaiapp_http`;
  for (const cookie of ['', 'spatial_oauth=' + 'x'.repeat(43), `${started.cookie}; ${started.cookie}`]) {
    const response = await fetch(target, { headers: { Cookie: cookie }, redirect: 'manual' }); assert.equal(response.status, 400); assert.doesNotMatch(await response.text(), /secret|code_verifier/);
  }
  const wrong = await fetch(target.replace(started.state, 'wrong'), { headers: { Cookie: started.cookie } }); assert.equal(wrong.status, 400); assert.equal(f.exchanges(), 0);
});
test('mutations require local Host/Origin, reject cross-site and uncompressed bounded exact input', async (t) => {
  const f = await fixture(t);
  for (const headers of [{ Origin: 'https://attacker.example' }, { Host: 'attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }] as Record<string, string>[]) {
    // Raw HTTP: fetch may normalize/replace forbidden Host or Sec-Fetch-* headers.
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(f.base + '/auth/chatgpt/start', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (response) => { response.resume(); resolve(response.statusCode!); });
      request.on('error', reject); request.end('{}');
    });
    assert.equal(status, 403, JSON.stringify(headers));
  }
  for (const body of [{ apiKey: 'secret' }, { accountId: 1 }, [], null]) assert.equal((await f.post('/auth/chatgpt/start', body)).status, 400);
  assert.equal((await f.post('/auth/logout', { token: 'secret' })).status, 400);
  assert.equal((await f.post('/auth/logout', {}, { 'Content-Encoding': 'gzip' })).status, 400);
  assert.equal((await f.post('/auth/chatgpt/start', { accountId: 'x'.repeat(3000) })).status, 400);
  assert.equal((await f.post('/auth/chatgpt/start?next=https://attacker.example')).status, 400);
  assert.equal((await fetch(f.base + '/auth/chatgpt/start')).status, 400);
  assert.equal((await f.post('/auth/unknown')).status, 404);
});
test('native backend form sign-in redirects only to fixed provider; form parameter duplicates fail', async (t) => {
  const f = await fixture(t);
  const response = await fetch(f.base + '/auth/chatgpt/start', { method: 'POST', body: 'accountId=', headers: { Origin: f.base, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  assert.equal(response.status, 303); assert.equal(new URL(response.headers.get('location')!).origin, 'https://auth.openai.com');
  const duplicate = await fetch(f.base + '/auth/chatgpt/start', { method: 'POST', body: 'accountId=&accountId=', headers: { Origin: f.base, 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual' }); assert.equal(duplicate.status, 400);
});
test('disabled/API-key HTTP modes never start OAuth or expose key and support runtime logout', async (t) => {
  for (const mode of ['disabled', 'api-key'] as const) {
    const f = await fixture(t, mode); const status = await fetch(f.base + '/auth/status'); const text = await status.text();
    assert.equal(JSON.parse(text).result.ready, mode === 'api-key'); assert.doesNotMatch(text, /secret|bearer/);
    assert.equal((await f.post('/auth/chatgpt/start')).status, 503); assert.equal(f.exchanges(), 0);
    assert.equal((await f.post('/auth/logout')).status, 200); assert.equal(f.auth.status().ready, false);
  }
});
test('factory defaults auth disabled even when operator provider environment exists', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'spatial-auth-isolated-project-'));
  const previous = process.env.SPATIAL_PROVIDER_MODE, key = process.env.OPENAI_API_KEY;
  process.env.SPATIAL_PROVIDER_MODE = 'api-key'; process.env.OPENAI_API_KEY = 'operator-secret-test';
  const server = createDemoServer();
  try {
    const base = await listen(server); const status = await fetch(base + '/auth/status'); const text = await status.text();
    assert.equal(JSON.parse(text).result.mode, 'disabled'); assert.doesNotMatch(text, /operator/);
    assert.equal((await fetch(base + '/health')).status, 200);
  } finally {
    if (previous === undefined) delete process.env.SPATIAL_PROVIDER_MODE; else process.env.SPATIAL_PROVIDER_MODE = previous;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
    await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(root, { recursive: true, force: true });
  }
});

test('raw malformed JSON/UTF8 and chunked oversized bodies fail without provider calls', async (t) => {
  const f = await fixture(t);
  for (const body of [Buffer.from('{'), Buffer.from([0xff, 0xfe]), Buffer.alloc(2049, 0x20)]) {
    const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const request = httpRequest(f.base + '/auth/chatgpt/start', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode!, text: Buffer.concat(chunks).toString() }));
      });
      request.on('error', reject); request.end(body);
    });
    assert.equal(response.status, 400); assert.doesNotMatch(response.text, /token|secret|SyntaxError/u);
  }
  assert.equal(f.exchanges(), 0);
});

test('slow incomplete mutation is bounded, concurrent mutation rejected and status remains available', async (t) => {
  const f = await fixture(t);
  const started = Date.now();
  let slow!: ReturnType<typeof httpRequest>;
  const result = new Promise<number>((resolve, reject) => {
    slow = httpRequest(f.base + '/auth/chatgpt/start', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (response) => {
      response.resume(); response.on('end', () => resolve(response.statusCode!));
    });
    slow.on('error', reject); slow.write('{');
  });
  t.after(() => slow.destroy());
  // Poll through possible socket scheduling, stopping at the first busy response.
  let busy = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    busy = (await f.post('/auth/logout')).status;
    if (busy === 429) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(busy, 429);
  assert.equal((await fetch(f.base + '/auth/status')).status, 200);
  assert.equal(await result, 400);
  assert.ok(Date.now() - started >= 2500);
  assert.ok(Date.now() - started < 6000);
  assert.equal((await f.post('/auth/logout')).status, 200);
  assert.equal(f.exchanges(), 0);
});

test('auth admission rate is bounded independently of status reads', async (t) => {
  const f = await fixture(t, 'disabled');
  for (let index = 0; index < 30; index++) assert.equal((await f.post('/auth/logout')).status, 200);
  assert.equal((await f.post('/auth/logout')).status, 429);
  assert.equal((await fetch(f.base + '/auth/status')).status, 200);
});

test('integrated malformed network request targets are redacted and do not terminate server', async (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'spatial-auth-target-'));
  const server = createDemoServer();
  const base = await listen(server);
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); });
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(base, { path: '//' }, (response) => { response.resume(); resolve(response.statusCode!); });
    request.on('error', reject); request.end();
  });
  assert.equal(status, 400);
  assert.equal((await fetch(base + '/auth/status')).status, 200);
});

test('failed bind followed by server.close releases initialized auth storage lock', async (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'spatial-auth-bind-'));
  const credentialPath = join(root, 'credentials.json');
  const seed = new ProviderAuth({ mode: 'chatgpt', credentialPath });
  await seed.start('browser'); seed.close();
  const occupied = createServer(); const base = await listen(occupied);
  const port = Number(new URL(base).port);
  const server = createDemoServer({ provider: { mode: 'chatgpt', credentialPath } });
  t.after(async () => {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    server.close(); rmSync(root, { recursive: true, force: true });
  });
  const failed = new Promise<void>((resolve) => server.once('error', () => resolve()));
  server.listen(port, '127.0.0.1'); await failed;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const restarted = new ProviderAuth({ mode: 'chatgpt', credentialPath });
  assert.equal(restarted.status().authenticated, false); restarted.close();
});
