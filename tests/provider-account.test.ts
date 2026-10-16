import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ProviderAccountController, canonicalWorkspace, validateProviderStatus, accountDescription, PROVIDER_AUTH_URL, type AccountView } from '../apps/web/src/provider-account';

const disabled = { mode: 'disabled', authenticated: false, ready: false, planUsageEnabled: false };
const signedOut = { ...disabled, mode: 'chatgpt' };
const identity = { ...signedOut, authenticated: true };
const ready = { ...identity, ready: true, planUsageEnabled: true };
const key = { ...disabled, mode: 'api-key', authenticated: true, ready: true };
function response(result: unknown): Response { return new Response(JSON.stringify({ ok: true, result }), { headers: { 'Content-Type': 'application/json' } }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; }
function fixture(fetcher: typeof fetch, timeout = 1000) {
  const states: AccountView[] = [];
  const client = new ProviderAccountController(s => states.push(s), fetcher, timeout);
  return { client, states };
}

test('canonical sign-in is fixed and allowed only for HTTP 127.0.0.1 workspace', () => {
  assert.equal(PROVIDER_AUTH_URL, 'http://127.0.0.1:3001/auth');
  for (const origin of ['http://127.0.0.1:5173', 'http://127.0.0.1:4173']) assert.equal(canonicalWorkspace(origin), true);
  for (const origin of ['http://localhost:5173', 'https://127.0.0.1:5173', 'https://example.com', 'http://127.0.0.1.evil:5173', 'http://user@127.0.0.1:5173', 'null', '']) assert.equal(canonicalWorkspace(origin), false);
});

test('valid states copy only boolean/enum whitelist and have distinct honest descriptions', () => {
  const statuses = [disabled, signedOut, identity, ready, { ...ready, ready: false }, key, { ...key, authenticated: false, ready: false }];
  const descriptions = new Set<string>();
  for (const state of statuses) {
    const validated = validateProviderStatus({ ...state, accounts: [{ label: '<img SECRET>', id: 'SECRET' }], selectedAccount: 'SECRET', error: 'SECRET' });
    assert.deepEqual(validated, state);
    assert.ok(Object.isFrozen(validated));
    assert.ok(!JSON.stringify(validated).includes('SECRET'));
    descriptions.add(accountDescription(validated));
  }
  assert.equal(descriptions.size, statuses.length);
  assert.match(accountDescription(validateProviderStatus(key)), /Not validated/);
  assert.match(accountDescription(validateProviderStatus(identity)), /permission was not granted/);
});

test('invalid booleans, enums and contradictory readiness fail closed', () => {
  const invalid = [null, [], {}, { ...ready, mode: 'evil' }, { ...ready, ready: 'true' }, { ...ready, authenticated: 1 },
    { ...ready, planUsageEnabled: 'true' }, { ...ready, authenticated: false }, { ...ready, planUsageEnabled: false },
    { ...disabled, ready: true, authenticated: true }, { ...key, planUsageEnabled: true }, { ...key, ready: false },
    { ...signedOut, planUsageEnabled: true }];
  for (const value of invalid) assert.throws(() => validateProviderStatus(value), /Invalid account response/);
});

test('default fetch transport retains the global receiver required by browsers', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async function (this: unknown, input, _init) {
    assert.equal(this, globalThis, 'native Window.fetch rejects a controller receiver');
    calls.push(String(input));
    return response(input === '/auth/status' ? ready : { remoteRevocationConfirmed: true });
  };
  const client = new ProviderAccountController(() => {});
  try {
    await client.refresh();
    assert.equal(client.view.status?.ready, true);
    await client.logout();
    assert.equal(client.view.notice, 'chatgpt-revoked');
    assert.deepEqual(calls, ['/auth/status', '/auth/logout']);
  } finally { client.dispose(); globalThis.fetch = original; }
});

test('status/logout transport uses exact same-origin routes and secure options', async () => {
  const calls: [string, RequestInit | undefined][] = [];
  const f = fixture(async (input, init) => { calls.push([String(input), init]); return response(input === '/auth/status' ? key : { remoteRevocationConfirmed: true }); });
  await f.client.refresh(); await f.client.logout();
  assert.deepEqual(calls.map(c => c[0]), ['/auth/status', '/auth/logout']);
  for (const [, options] of calls) {
    assert.equal(options!.credentials, 'same-origin'); assert.equal(options!.cache, 'no-store'); assert.equal(options!.redirect, 'error');
    assert.ok(options!.signal instanceof AbortSignal);
  }
  assert.equal(calls[0]![1]!.method, 'GET'); assert.equal(calls[0]![1]!.body, undefined);
  assert.equal(calls[1]![1]!.method, 'POST'); assert.equal(calls[1]![1]!.body, '{}');
  assert.deepEqual(calls[1]![1]!.headers, { 'Content-Type': 'application/json' });
  assert.equal(f.client.view.notice, 'local-cleared'); assert.equal(f.client.view.status!.ready, false);
  f.client.dispose();
});

for (const [name, fetcher] of Object.entries({
  offline: async () => { throw new Error('SECRET provider failure'); },
  denied: async () => new Response('SECRET', { status: 403 }),
  brokenJson: async () => new Response('SECRET'),
  badEnvelope: async () => new Response(JSON.stringify({ ok: false, error: { message: 'SECRET' } })),
  badResult: async () => response({ ...ready, ready: 'SECRET' }),
})) test(`status ${name} is fixed/redacted and removes old ready state`, async () => {
  let fail = false;
  const f = fixture(async () => fail ? fetcher() : response(ready));
  await f.client.refresh(); assert.equal(f.client.view.status!.ready, true);
  fail = true; await f.client.refresh();
  assert.deepEqual(f.client.view, { phase: 'unavailable', notice: undefined });
  assert.ok(!JSON.stringify(f.states).includes('SECRET')); f.client.dispose();
});

test('failed HTTP response body is never consumed', async () => {
  const denied = { ok: false, json() { throw new Error('must not read'); } } as unknown as Response;
  const f = fixture(async () => denied); await f.client.refresh(); assert.equal(f.client.view.phase, 'unavailable'); f.client.dispose();
});

test('superseded read is aborted promptly even if fetch ignores abort; late ready cannot publish', async () => {
  const first = deferred<Response>(); let calls = 0; let signal: AbortSignal | undefined;
  const f = fixture(async (_, init) => { if (++calls === 1) { signal = init!.signal!; return first.promise; } return response(signedOut); });
  const old = f.client.refresh(); await f.client.refresh(); await old;
  assert.equal(signal!.aborted, true); assert.equal(f.client.view.status!.authenticated, false);
  const count = f.states.length; first.resolve(response(ready)); await new Promise(r => setImmediate(r));
  assert.equal(f.states.length, count); f.client.dispose();
});

test('logout invalidates in-flight read and blocks overlapping status/logout requests', async () => {
  const read = deferred<Response>(), logout = deferred<Response>(); let statusCalls = 0, logoutCalls = 0;
  const f = fixture(async input => input === '/auth/status' ? (++statusCalls === 1 ? response(ready) : read.promise) : (++logoutCalls, logout.promise));
  await f.client.refresh();
  // Start logout while ready, then simulate focus and double-click; no new request may overtake it.
  const mutation = f.client.logout(); assert.equal(f.client.view.status, undefined);
  await f.client.refresh(); await f.client.logout(); assert.equal(statusCalls, 1); assert.equal(logoutCalls, 1);
  logout.resolve(response({ remoteRevocationConfirmed: false })); await mutation;
  assert.equal(f.client.view.notice, 'chatgpt-unconfirmed'); assert.equal(f.client.view.status!.ready, false);
  f.client.dispose();
});

test('logout interrupts a pending refresh without allowing stale ready to publish', async () => {
  // During refresh no last-known status is exposed, so logout is disabled until status is current.
  const pending = deferred<Response>(); let reads = 0, mutations = 0;
  const f = fixture(async input => input === '/auth/status' ? (++reads === 1 ? response(ready) : pending.promise) : (++mutations, response({ remoteRevocationConfirmed: true })));
  await f.client.refresh(); const refreshing = f.client.refresh(); await f.client.logout();
  assert.equal(mutations, 0); f.client.dispose(); await refreshing;
  const count = f.states.length; pending.resolve(response(ready)); await new Promise(r => setImmediate(r)); assert.equal(f.states.length, count);
});

for (const confirmation of [true, false]) test(`ChatGPT logout confirmation ${confirmation} remains per-call and survives refresh`, async () => {
  let signedout = false;
  const f = fixture(async input => { if (input === '/auth/status') return response(signedout ? signedOut : ready); signedout = true; return response({ remoteRevocationConfirmed: confirmation, secret: 'SECRET' }); });
  await f.client.refresh(); await f.client.logout(); await f.client.refresh();
  assert.equal(f.client.view.notice, confirmation ? 'chatgpt-revoked' : 'chatgpt-unconfirmed'); assert.equal(f.client.view.status!.ready, false);
  assert.ok(!JSON.stringify(f.states).includes('SECRET')); f.client.dispose();
});

for (const failure of ['network', 'invalid', 'timeout']) test(`logout ${failure} never claims clearing/revocation or accepts late completion`, async () => {
  const pending = deferred<Response>(); let signal: AbortSignal | undefined;
  const f = fixture(async (input, init) => {
    if (input === '/auth/status') return response(ready);
    signal = init!.signal!;
    if (failure === 'network') throw new Error('SECRET');
    if (failure === 'invalid') return response({ remoteRevocationConfirmed: 'SECRET' });
    return pending.promise;
  }, 10);
  await f.client.refresh(); await f.client.logout();
  assert.equal(f.client.view.phase, 'unavailable'); assert.equal(f.client.view.notice, 'logout-unknown'); assert.equal(f.client.view.status, undefined);
  if (failure === 'timeout') assert.equal(signal!.aborted, true);
  const count = f.states.length; pending.resolve(response({ remoteRevocationConfirmed: true })); await new Promise(r => setImmediate(r));
  assert.equal(f.states.length, count); assert.ok(!JSON.stringify(f.states).includes('SECRET'));
  await f.client.refresh(); assert.equal(f.client.view.notice, 'logout-unknown', 'later snapshot cannot certify the uncertain logout'); f.client.dispose();
});

test('status deadline bounds a stalled body read as well as stalled fetch', async () => {
  const pending = deferred<unknown>(); let signal: AbortSignal | undefined;
  const f = fixture(async (_, init) => { signal = init!.signal!; return { ok: true, json: () => pending.promise } as unknown as Response; }, 10);
  await f.client.refresh(); assert.equal(signal!.aborted, true); assert.equal(f.client.view.phase, 'unavailable');
  const count = f.states.length; pending.resolve({ ok: true, result: ready }); await new Promise(r => setImmediate(r)); assert.equal(f.states.length, count); f.client.dispose();
});

test('dispose aborts pending requests immediately, suppresses callbacks and future actions', async () => {
  for (const logout of [false, true]) {
    const pending = deferred<Response>(); let calls = 0; let signal: AbortSignal | undefined;
    const f = fixture(async (_, init) => { ++calls; signal = init!.signal!; return logout && calls === 1 ? response(ready) : pending.promise; }, 60000);
    if (logout) await f.client.refresh();
    const work = logout ? f.client.logout() : f.client.refresh(); const count = f.states.length;
    f.client.dispose(); assert.equal(signal!.aborted, true); await work;
    pending.resolve(response(logout ? { remoteRevocationConfirmed: true } : ready)); await new Promise(r => setImmediate(r));
    await f.client.refresh(); await f.client.logout(); assert.equal(f.states.length, count); assert.equal(calls, logout ? 2 : 1);
  }
});

test('workspace markup keeps native sign-in separate and guides explicit model discovery with lifecycle invalidation', () => {
  const panel = readFileSync(new URL('../apps/web/src/ProviderAccount.svelte', import.meta.url), 'utf8');
  assert.match(panel, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(panel, /Model chat is not available/); assert.match(panel, /Refresh models and choose a model/);
  assert.match(panel, /Credential readiness alone does not prove model availability/);
  assert.match(panel, /value\.phase === 'logging-out'/); assert.match(panel, /status !== previousStatus/);
  assert.match(panel, /dispatchEvent\(new Event\('spatial-provider-change'\)\)/);
  assert.match(panel, /apps\/server\/\.env/);
  assert.match(panel, /addEventListener\('focus'/); assert.match(panel, /removeEventListener\('focus'/);
  assert.match(panel, /addEventListener\('visibilitychange'/); assert.match(panel, /removeEventListener\('visibilitychange'/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage|<input/);
  const config = readFileSync(new URL('../apps/web/vite.config.ts', import.meta.url), 'utf8');
  const authRules = [...config.matchAll(/'([^']*auth[^']*)':/g)].map(match => new RegExp(match[1]!));
  assert.equal(authRules.length, 2);
  for (const path of ['/auth/status', '/auth/logout']) assert.equal(authRules.filter(r => r.test(path)).length, 1);
  for (const path of ['/auth', '/auth/callback', '/auth/chatgpt/start', '/auth/status?query=x', '/auth/logout/extra']) assert.equal(authRules.some(r => r.test(path)), false);
});

test('browser fixtures use exact owned account routes with auth-only Host routing and no Origin rewrite', () => {
  const fixtures = [
    ['smoke', 3012], ['toronto-smoke', 3015], ['closest-pole-smoke', 3002],
    ['closest-label-window-smoke', 3002], ['shared-chat-smoke', 3013],
    ['interactive-edit-smoke', 3014], ['demo-workspace-smoke', 3071],
  ] as const;
  for (const [name, port] of fixtures) {
    const source = readFileSync(new URL(`../scripts/browser-${name}.mjs`, import.meta.url), 'utf8');
    const maps = [...source.matchAll(/Object\.fromEntries\(\[(.*?)\]\.map\(path\s*=>\s*\[path,\s*\{\s*target:\s*(['"])(http:\/\/127\.0\.0\.1:\d+)\2\s*,\s*changeOrigin:\s*path\.startsWith\((['"])\^\/auth\/\4\)\s*\}\s*\]\)\)/g)];
    assert.equal(maps.length, 1, name + ': one explicit owned proxy map');
    const paths = [...maps[0]![1]!.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
    assert.deepEqual(paths, ['/datasets/', '/project', '/chat/', '^/auth/status$', '^/auth/logout$'], name);
    assert.equal(maps[0]![3], `http://127.0.0.1:${port}`, name + ': no operator3001 target');
    const authRules = paths.filter(path => path!.includes('auth')).map(path => new RegExp(path!));
    for (const path of ['/auth/status', '/auth/logout']) assert.equal(authRules.filter(rule => rule.test(path)).length, 1, name);
    for (const path of ['/auth', '/auth/callback', '/auth/chatgpt/start', '/auth/status?query=x', '/auth/logout/extra']) assert.equal(authRules.some(rule => rule.test(path)), false, name);
  }
});
