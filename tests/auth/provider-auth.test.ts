import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { chmodSync, existsSync, linkSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProviderAuth, ProviderAuthError } from '../../apps/server/src/auth/provider-auth.js';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(payload: Record<string, unknown>, wrongKey = false) {
  const input = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode(payload)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), wrongKey ? otherPair.privateKey : pair.privateKey).toString('base64url')}`;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
class Fixture {
  readonly directory = mkdtempSync(join(realpathSync(tmpdir()), 'spatial-provider-auth-'));
  readonly path = join(this.directory, 'credentials.json');
  readonly redirectUri = 'http://127.0.0.1:3001/auth/callback';
  time = 1_800_000_000_000;
  nonce = '';
  clientId = 'oaiapp_first';
  subject = 'verified-subject';
  scope = SCOPES;
  expiresIn = 3600;
  earliestRefreshAt: number | undefined;
  claims: Record<string, unknown> = {};
  wrongKey = false;
  providerError?: { status: number; error: string };
  revocationStatus = 200;
  failedRevocationToken?: string;
  discoveryOverride: Record<string, unknown> = {};
  requests: { url: string; init: RequestInit; fields: URLSearchParams }[] = [];
  refreshGate?: ReturnType<typeof deferred<void>>;
  refreshEntered = deferred<void>();
  codeGate?: ReturnType<typeof deferred<void>>;
  codeEntered = deferred<void>();
  auths: ProviderAuth[] = [];
  fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const fields = new URLSearchParams(String(init.body ?? ''));
    this.requests.push({ url, init, fields });
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    if (url === `${ISSUER}/.well-known/openid-configuration`) return Response.json({
      issuer: ISSUER, authorization_endpoint: `${ISSUER}/api/accounts/authorize`,
      token_endpoint: `${ISSUER}/api/accounts/oauth/token`, jwks_uri: `${ISSUER}/.well-known/jwks.json`,
      revocation_endpoint: `${ISSUER}/oauth/revoke`, ...this.discoveryOverride,
    });
    if (url === `${ISSUER}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    if (url === `${ISSUER}/oauth/revoke`) return new Response('', {
      status: fields.get('token') === this.failedRevocationToken ? 503 : this.revocationStatus,
    });
    assert.equal(url, `${ISSUER}/api/accounts/oauth/token`, 'Only documented public endpoints may be used');
    if (fields.get('grant_type') === 'refresh_token') {
      this.refreshEntered.resolve();
      await this.refreshGate?.promise;
    } else {
      this.codeEntered.resolve();
      await this.codeGate?.promise;
    }
    if (this.providerError) return Response.json({ error: this.providerError.error, error_description: 'secret-provider-detail' }, { status: this.providerError.status });
    const refresh = fields.get('grant_type') === 'refresh_token';
    assert.equal(fields.get('resource'), RESOURCE);
    assert.equal(fields.get('client_id'), this.clientId);
    const idToken = jwt({
      iss: ISSUER, aud: this.clientId, sub: this.subject,
      exp: this.time / 1000 + 3600, iat: this.time / 1000,
      ...(!refresh ? { nonce: this.nonce } : {}), ...this.claims,
    }, this.wrongKey);
    return Response.json({
      access_token: refresh ? 'rotated-access-secret' : 'access-secret',
      refresh_token: refresh ? 'rotated-refresh-secret' : 'refresh-secret',
      id_token: idToken, scope: this.scope, token_type: 'Bearer', expires_in: this.expiresIn,
      ...(this.earliestRefreshAt === undefined ? {} : { earliest_refresh_at: this.earliestRefreshAt }),
    });
  };
  auth() {
    const auth = new ProviderAuth({ mode: 'chatgpt', credentialPath: this.path,
      redirectUri: this.redirectUri, fetch: this.fetch, now: () => this.time });
    this.auths.push(auth);
    return auth;
  }
  async begin(auth: ProviderAuth, browser = 'browser', accountId?: string) {
    const url = new URL(await auth.start(browser, accountId));
    this.nonce = url.searchParams.get('nonce')!;
    return url;
  }
  callback(url: URL, clientId: string | undefined = this.clientId) {
    const callback = new URL(this.redirectUri);
    callback.search = new URLSearchParams({ code: 'code-secret', state: url.searchParams.get('state')!,
      ...(clientId ? { client_id: clientId } : {}) }).toString();
    return callback;
  }
  async signIn(auth: ProviderAuth, accountId?: string) {
    const url = await this.begin(auth, 'browser', accountId);
    await auth.callback('browser', this.callback(url));
    return url;
  }
  cleanup() {
    for (const auth of this.auths) auth.close();
    rmSync(this.directory, { recursive: true, force: true });
  }
}
function fixture(t: { after: (fn: () => void) => void }) {
  const result = new Fixture();
  t.after(() => result.cleanup());
  return result;
}
function safeError(error: unknown, code?: string) {
  assert.ok(error instanceof ProviderAuthError);
  if (code) assert.equal(error.code, code);
  assert.match(error.message, /^Provider authentication failed \([a-z]+\)\.$/u);
  assert.ok(!error.message.includes('secret'));
  return true;
}

test('disabled and API key modes are explicit and never touch disk/network or silently fall back', async (t) => {
  const f = fixture(t);
  const path = join(f.directory, 'missing', 'credentials.json');
  const fetch: typeof globalThis.fetch = async () => { throw new Error('network must not run'); };
  const disabled = new ProviderAuth({ mode: 'disabled', apiKey: 'secret-key', credentialPath: path, fetch });
  assert.equal(disabled.status().ready, false);
  await assert.rejects(disabled.credential(), (error) => safeError(error, 'unavailable'));
  await assert.rejects(disabled.start('browser'), safeError);
  const key = new ProviderAuth({ mode: 'api-key', apiKey: 'secret-key', credentialPath: path, fetch });
  assert.equal(key.status().ready, true);
  assert.deepEqual(await key.credential(), { mode: 'api-key', bearer: 'secret-key', baseUrl: RESOURCE,
    constraints: { billing: 'api-key', responsesOnly: false } });
  assert.ok(!JSON.stringify(key.status()).includes('secret'));
  await key.logout();
  assert.equal(key.status().ready, false);
  await assert.rejects(key.credential(), safeError);
  key.close();
  await assert.rejects(key.credential(), safeError);
  assert.equal(existsSync(join(f.directory, 'missing')), false);
  const noKey = new ProviderAuth({ mode: 'api-key', fetch });
  assert.equal(noKey.status().ready, false);
  await assert.rejects(noKey.credential(), safeError);
});

test('PKCE, protected persistence, discovery and signed JWT; status is sanitized and restart retains host/client', async (t) => {
  const f = fixture(t);
  const auth = f.auth();
  const url = await f.signIn(auth);
  assert.equal(url.origin + url.pathname, `${ISSUER}/api/accounts/authorize`);
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('agent_name_hint'), 'Spatial CAD Harness');
  assert.equal(url.searchParams.get('resource'), RESOURCE);
  assert.equal(url.searchParams.get('scope'), SCOPES);
  assert.match(url.searchParams.get('ext_agent_host_id')!, /^urn:uuid:/u);
  assert.equal(url.searchParams.has('id_token_hint'), false);
  assert.equal(url.searchParams.has('login_hint'), false);
  const exchange = f.requests.find((request) => request.fields.get('grant_type') === 'authorization_code')!;
  const verifier = exchange.fields.get('code_verifier')!;
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), url.searchParams.get('code_challenge'));
  assert.equal(exchange.fields.get('redirect_uri'), f.redirectUri);
  assert.equal(lstatSync(f.path).mode & 0o777, 0o600);
  assert.equal(lstatSync(f.directory).mode & 0o777, 0o700);
  assert.equal(auth.status().ready, true);
  assert.equal(auth.status().authenticated, true);
  assert.equal(auth.status().selectedAccount, f.clientId);
  const status = JSON.stringify(auth.status());
  for (const secret of ['secret', f.subject, 'id_token', 'nonce', verifier]) assert.ok(!status.includes(secret));
  const credential = await auth.credential();
  assert.equal(credential.bearer, 'access-secret');
  assert.equal(credential.mode, 'chatgpt');
  assert.deepEqual(credential.constraints, { billing: 'chatgpt-plan', responsesOnly: true,
    stream: true, store: false, accountModelCatalog: true });
  auth.close();
  const restarted = f.auth();
  assert.equal(restarted.status().ready, true);
  const returning = await f.begin(restarted, 'browser', f.clientId);
  assert.equal(returning.searchParams.get('client_id'), f.clientId);
  assert.equal(returning.searchParams.has('agent_name_hint'), false);
  assert.equal(returning.searchParams.has('id_token_hint'), false);
  assert.equal(returning.searchParams.get('ext_agent_host_id'), url.searchParams.get('ext_agent_host_id'));
  const callback = f.callback(returning);
  callback.searchParams.delete('client_id');
  await restarted.callback('browser', callback);
});

test('state/browser/TTL/duplicate fields and callbacks are one-use and never exchange unverified codes', async (t) => {
  const f = fixture(t);
  const auth = f.auth();
  let url = await f.begin(auth);
  await assert.rejects(auth.callback('wrong-browser', f.callback(url)), safeError);
  let callback = f.callback(url);
  callback.searchParams.set('state', 'wrong');
  await assert.rejects(auth.callback('browser', callback), safeError);
  await assert.rejects(auth.callback('browser', f.callback(url)), safeError);
  url = await f.begin(auth);
  callback = f.callback(url);
  callback.searchParams.append('state', url.searchParams.get('state')!);
  await assert.rejects(auth.callback('browser', callback), safeError);
  url = await f.begin(auth);
  callback = f.callback(url);
  callback.searchParams.set('error', 'access_denied');
  await assert.rejects(auth.callback('browser', callback), safeError);
  url = await f.begin(auth);
  f.time += 10 * 60_000;
  await assert.rejects(auth.callback('browser', f.callback(url)), safeError);
  url = await f.begin(auth);
  callback = f.callback(url); callback.pathname = '/callback';
  await assert.rejects(auth.callback('browser', callback), safeError);
  assert.equal(f.requests.length, 0);
  url = await f.begin(auth);
  const results = await Promise.allSettled([auth.callback('browser', f.callback(url)), auth.callback('browser', f.callback(url))]);
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected']);
  assert.equal(f.requests.filter((request) => request.fields.get('grant_type') === 'authorization_code').length, 1);
});

test('pending attempts are bounded, expired attempts reclaimed, and replacement has fresh secrets', async (t) => {
  const f = fixture(t); const auth = f.auth();
  const first = await f.begin(auth);
  const second = await f.begin(auth);
  for (const name of ['state', 'nonce', 'code_challenge']) assert.notEqual(first.searchParams.get(name), second.searchParams.get(name));
  for (let index = 1; index < 16; index++) await f.begin(auth, `browser-${index}`);
  await assert.rejects(auth.start('excess'), safeError);
  f.time += 10 * 60_000;
  await auth.start('reclaimed');
});

for (const [name, claims, wrongKey] of [
  ['signature', {}, true], ['issuer', { iss: 'https://attacker.example' }, false],
  ['audience', { aud: 'oaiapp_other' }, false], ['expiry', { exp: 1_799_999_990 }, false],
  ['nonce', { nonce: 'wrong' }, false], ['subject', { sub: '' }, false],
  ['future iat', { iat: 1_800_000_100 }, false], ['missing iat', { iat: undefined }, false],
] as const) {
  test(`rejects signed identity with invalid ${name}`, async (t) => {
    const f = fixture(t); const auth = f.auth();
    f.claims = claims; f.wrongKey = wrongKey;
    await assert.rejects(f.signIn(auth), safeError);
    assert.equal(auth.status().authenticated, false);
    assert.equal(auth.status().accounts.length, 0);
  });
}

test('new registration requires an issued client; returning identity/client mismatches preserve active account', async (t) => {
  const f = fixture(t); const auth = f.auth();
  let url = await f.begin(auth);
  await assert.rejects(auth.callback('browser', f.callback(url, 'dynamic_agent_client')), safeError);
  url = await f.begin(auth);
  const missing = f.callback(url); missing.searchParams.delete('client_id');
  await assert.rejects(auth.callback('browser', missing), safeError);
  await f.signIn(auth);
  url = await f.begin(auth, 'browser', f.clientId);
  await assert.rejects(auth.callback('browser', f.callback(url, 'oaiapp_different')), safeError);
  f.subject = 'different-subject';
  await assert.rejects(f.signIn(auth, f.clientId), safeError);
  assert.equal(auth.status().ready, true);
  assert.equal((await auth.credential()).bearer, 'access-secret');
});

test('separate account registrations remain separate; failed add does not switch active account', async (t) => {
  const f = fixture(t); const auth = f.auth();
  await f.signIn(auth);
  f.clientId = 'oaiapp_second'; f.subject = 'second-subject';
  f.claims = { nonce: 'bad' };
  await assert.rejects(f.signIn(auth), safeError);
  assert.equal(auth.status().selectedAccount, 'oaiapp_first');
  f.claims = {};
  await f.signIn(auth);
  assert.equal(auth.status().selectedAccount, 'oaiapp_second');
  assert.equal(auth.status().accounts.length, 2);
  f.clientId = 'oaiapp_first'; f.subject = 'verified-subject';
  await f.signIn(auth, f.clientId);
  assert.equal(auth.status().selectedAccount, 'oaiapp_first');
  assert.equal(auth.status().accounts.length, 2);
  assert.deepEqual(auth.status().accounts.map((account) => account.id), ['oaiapp_first', 'oaiapp_second']);
});

test('failed code exchange retains an incomplete issued client for a fresh attempt without publishing an account', async (t) => {
  const f = fixture(t); const auth = f.auth();
  f.providerError = { status: 400, error: 'invalid_grant' };
  await assert.rejects(f.signIn(auth), safeError);
  assert.equal(auth.status().accounts.length, 0);
  const retry = await f.begin(auth);
  assert.equal(retry.searchParams.get('client_id'), f.clientId);
  assert.equal(retry.searchParams.has('agent_name_hint'), false);
  f.providerError = undefined;
  const callback = f.callback(retry); callback.searchParams.delete('client_id');
  await auth.callback('browser', callback);
  assert.equal(auth.status().ready, true);
});

test('identity-only grants remain authenticated but cannot use plan or API-key fallback', async (t) => {
  const f = fixture(t); const auth = new ProviderAuth({ mode: 'chatgpt', apiKey: 'must-not-fallback',
    credentialPath: f.path, fetch: f.fetch, now: () => f.time });
  f.auths.push(auth); f.scope = 'openid email profile';
  await f.signIn(auth);
  assert.equal(auth.status().authenticated, true);
  assert.equal(auth.status().planUsageEnabled, false);
  assert.equal(auth.status().ready, false);
  await assert.rejects(auth.credential(), (error) => safeError(error, 'unavailable'));
});

test('discovery issuer and endpoints are validated before token/JWKS calls (no SSRF)', async (t) => {
  for (const override of [
    { issuer: 'https://evil.example' }, { jwks_uri: 'http://127.0.0.1:1/private' },
    { jwks_uri: 'https://auth.openai.com@evil.example/keys' },
    { token_endpoint: 'https://evil.example/tokens' },
    { authorization_endpoint: 'https://evil.example/authorize' },
    { revocation_endpoint: 'https://evil.example/revoke' },
  ]) {
    const f = fixture(t); const auth = f.auth(); f.discoveryOverride = override;
    await assert.rejects(f.signIn(auth), safeError);
    assert.equal(f.requests.length, 1);
  }
});

test('refresh rotation is serialized, atomic, persists restart, and respects earliest_refresh_at', async (t) => {
  const f = fixture(t); const auth = f.auth();
  f.expiresIn = 120; f.earliestRefreshAt = f.time / 1000 + 100;
  await f.signIn(auth);
  f.time += 61_000;
  assert.equal((await auth.credential()).bearer, 'access-secret');
  assert.equal(f.requests.filter((request) => request.fields.get('grant_type') === 'refresh_token').length, 0);
  f.time += 40_000; f.expiresIn = 3600;
  const credentials = await Promise.all([auth.credential(), auth.credential(), auth.credential()]);
  assert.ok(credentials.every((credential) => credential.bearer === 'rotated-access-secret'));
  const refreshes = f.requests.filter((request) => request.fields.get('grant_type') === 'refresh_token');
  assert.equal(refreshes.length, 1);
  assert.equal(refreshes[0]!.fields.get('refresh_token'), 'refresh-secret');
  assert.equal(refreshes[0]!.fields.has('scope'), false);
  const disk = JSON.parse(readFileSync(f.path, 'utf8'));
  assert.equal(disk.accounts[0].tokens.refresh, 'rotated-refresh-secret');
  auth.close();
  assert.equal((await f.auth().credential()).bearer, 'rotated-access-secret');
});

test('transient refresh errors preserve tokens, terminal refresh errors clear only tokens and require reauthorization', async (t) => {
  const f = fixture(t); const auth = f.auth();
  f.expiresIn = 120; await f.signIn(auth); f.time += 121_000;
  f.providerError = { status: 503, error: 'sensitive-provider-secret' };
  await assert.rejects(auth.credential(), (error) => safeError(error, 'retryable'));
  assert.equal(auth.status().authenticated, true);
  f.providerError = { status: 400, error: 'invalid_grant' };
  await assert.rejects(auth.credential(), (error) => safeError(error, 'reauthorize'));
  assert.equal(auth.status().authenticated, false);
  assert.equal(auth.status().accounts[0]!.id, f.clientId);
  assert.ok(!readFileSync(f.path, 'utf8').includes('secret'));
});

test('logout retains host/account mappings, clears all tokens, and reports failed remote revocation honestly', async (t) => {
  const f = fixture(t); const auth = f.auth();
  const initial = await f.signIn(auth);
  f.clientId = 'oaiapp_second'; f.subject = 'second'; await f.signIn(auth);
  f.revocationStatus = 503;
  assert.deepEqual(await auth.logout(), { remoteRevocationConfirmed: false });
  assert.equal(auth.status().ready, false);
  assert.equal(auth.status().authenticated, false);
  assert.equal(auth.status().accounts.length, 2);
  assert.ok(!readFileSync(f.path, 'utf8').includes('secret'));
  const revocations = f.requests.filter((request) => request.url.endsWith('/oauth/revoke'));
  assert.equal(revocations.length, 2);
  assert.equal(revocations[0]!.fields.get('token_type_hint'), 'refresh_token');
  const returning = await f.begin(auth, 'browser', f.clientId);
  assert.equal(returning.searchParams.get('ext_agent_host_id'), initial.searchParams.get('ext_agent_host_id'));
  assert.equal(returning.searchParams.has('id_token_hint'), false);
  f.revocationStatus = 200;
  await auth.callback('browser', f.callback(returning));
  assert.deepEqual(await auth.logout(), { remoteRevocationConfirmed: true });
});

for (const revocationStatus of [200, 503]) {
  test(`logout confirmation is not inferred from cleared state after provider ${revocationStatus} or restart`, async (t) => {
    const f = fixture(t); const auth = f.auth();
    await f.signIn(auth); f.revocationStatus = revocationStatus;
    assert.deepEqual(await auth.logout(), { remoteRevocationConfirmed: revocationStatus === 200 });
    assert.deepEqual(await auth.logout(), { remoteRevocationConfirmed: false });
    assert.equal(auth.status().ready, false);
    assert.ok(!readFileSync(f.path, 'utf8').includes('secret'));
    auth.close();
    const restarted = f.auth();
    assert.deepEqual(await restarted.logout(), { remoteRevocationConfirmed: false });
    assert.equal(restarted.status().authenticated, false);
    assert.equal(f.requests.filter((request) => request.url.endsWith('/oauth/revoke')).length, 1);
  });
}

test('logout during refresh prevents resurrection; late rotating credential is remotely revoked', async (t) => {
  const f = fixture(t); const auth = f.auth();
  f.expiresIn = 120; await f.signIn(auth); f.time += 121_000;
  f.refreshGate = deferred<void>();
  const credential = auth.credential();
  const rejection = assert.rejects(credential, (error) => safeError(error, 'unavailable'));
  await f.refreshEntered.promise;
  const logout = auth.logout();
  assert.equal(auth.status().authenticated, false);
  f.refreshGate.resolve();
  await rejection;
  await logout;
  assert.ok(!readFileSync(f.path, 'utf8').includes('secret'));
  assert.ok(f.requests.some((request) => request.fields.get('token') === 'rotated-refresh-secret'));
  await assert.rejects(auth.credential(), safeError);
});

test('failed revocation of a late rotating token cannot be masked by successful revocation of the old token', async (t) => {
  const f = fixture(t); const auth = f.auth();
  f.expiresIn = 120; await f.signIn(auth); f.time += 121_000;
  f.refreshGate = deferred<void>();
  f.failedRevocationToken = 'rotated-refresh-secret';
  const rejected = assert.rejects(auth.credential(), safeError);
  await f.refreshEntered.promise;
  const logout = auth.logout();
  f.refreshGate.resolve(); await rejected;
  assert.deepEqual(await logout, { remoteRevocationConfirmed: false });
  assert.equal(auth.status().authenticated, false);
  assert.ok(!readFileSync(f.path, 'utf8').includes('secret'));
});

test('logout/close invalidate pending callbacks and prevent subsequent writes', async (t) => {
  const f = fixture(t); const auth = f.auth();
  const url = await f.begin(auth);
  await auth.logout();
  await assert.rejects(auth.callback('browser', f.callback(url)), safeError);
  const second = await f.begin(auth);
  const disk = readFileSync(f.path, 'utf8');
  auth.close();
  await assert.rejects(auth.callback('browser', f.callback(second)), safeError);
  assert.equal(readFileSync(f.path, 'utf8'), disk);
});

test('credential files reject permissive modes, corrupt contents, symlinks and simultaneous runtimes', async (t) => {
  const f = fixture(t); const auth = f.auth();
  await f.begin(auth);
  assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
  auth.close();
  chmodSync(f.path, 0o644);
  assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
  chmodSync(f.path, 0o600);
  writeFileSync(f.path, '{corrupt');
  assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
  rmSync(f.path);
  const outside = join(f.directory, 'outside.json');
  writeFileSync(outside, '{}', { mode: 0o600 });
  symlinkSync(outside, f.path);
  assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
  rmSync(f.path); chmodSync(f.directory, 0o755);
  const fresh = f.auth();
  await assert.rejects(fresh.start('browser'), (error) => safeError(error, 'storage'));
});

test('dead-process auth lock is recovered without changing credentials or making provider calls', async (t) => {
  const f = fixture(t); const auth = f.auth();
  await f.signIn(auth); auth.close();
  const original = readFileSync(f.path, 'utf8');
  const calls = f.requests.length;
  const deadPid = execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  const lock = `${f.path}.lock`;
  writeFileSync(lock, `${deadPid}\n`, { mode: 0o600 });
  const replacement = f.auth();
  assert.equal(replacement.status().ready, true);
  assert.equal(readFileSync(f.path, 'utf8'), original);
  assert.equal(readFileSync(lock, 'utf8'), `${process.pid}\n`);
  assert.equal(f.requests.length, calls);
  assert.equal(existsSync(`${lock}.recover`), false);
  assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
  replacement.close();
  assert.equal(existsSync(lock), false);
});

test('unsafe or ambiguous auth lock files are never recovered', async (t) => {
  const f = fixture(t); const auth = f.auth(); await f.begin(auth); auth.close();
  const lock = `${f.path}.lock`;
  const original = readFileSync(f.path, 'utf8');
  for (const contents of ['', 'garbage', '0\n', '-1\n', '1.5\n', '999999999999999999\n', '123\n456\n', `${process.pid}\n`]) {
    writeFileSync(lock, contents, { mode: 0o600 });
    assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
    assert.equal(readFileSync(lock, 'utf8'), contents);
    unlinkSync(lock);
  }
  writeFileSync(lock, '123\n', { mode: 0o644 });
  assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
  unlinkSync(lock);
  const target = join(f.directory, 'lock-target');
  writeFileSync(target, '123\n', { mode: 0o600 });
  symlinkSync(target, lock);
  assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
  assert.ok(lstatSync(lock).isSymbolicLink());
  unlinkSync(lock);
  linkSync(target, lock);
  assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
  assert.equal(readFileSync(target, 'utf8'), '123\n');
  unlinkSync(lock);
  if (process.platform !== 'win32') {
    execFileSync('mkfifo', ['-m', '600', lock]);
    assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
    assert.ok(lstatSync(lock).isFIFO());
    unlinkSync(lock);
  }
  assert.equal(readFileSync(f.path, 'utf8'), original);
  assert.equal(existsSync(`${lock}.recover`), false);
});

test('uncertain process ownership and interrupted recovery fail closed', async (t) => {
  const f = fixture(t); const auth = f.auth(); await f.begin(auth); auth.close();
  const lock = `${f.path}.lock`;
  writeFileSync(lock, '123\n', { mode: 0o600 });
  const kill = t.mock.method(process, 'kill', () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
  assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
  assert.equal(readFileSync(lock, 'utf8'), '123\n');
  kill.mock.restore();
  writeFileSync(`${lock}.recover`, '', { mode: 0o600 });
  assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
  assert.equal(readFileSync(lock, 'utf8'), '123\n');
  assert.ok(existsSync(`${lock}.recover`));
});

test('closing an old runtime cannot unlink a replaced lock', async (t) => {
  const f = fixture(t); const auth = f.auth(); await f.begin(auth);
  const lock = `${f.path}.lock`;
  unlinkSync(lock);
  writeFileSync(lock, 'replacement\n', { mode: 0o600 });
  auth.close();
  assert.equal(readFileSync(lock, 'utf8'), 'replacement\n');
});

test('concurrent processes recovering a dead lock retain exactly one live owner', { timeout: 15_000 }, async (t) => {
  const f = fixture(t); const auth = f.auth(); await f.begin(auth); auth.close();
  const original = readFileSync(f.path, 'utf8');
  const deadPid = execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  writeFileSync(`${f.path}.lock`, `${deadPid}\n`, { mode: 0o600 });
  const source = `
    import { ProviderAuth } from './apps/server/src/auth/provider-auth.ts';
    let auth;
    process.on('message', () => {
      try { auth = new ProviderAuth({ mode: 'chatgpt', credentialPath: process.argv[1] }); process.send('acquired'); }
      catch { process.send('rejected'); }
    });
    process.send('ready');
  `;
  const children = Array.from({ length: 4 }, () => spawn(process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', source, f.path], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }));
  t.after(() => { for (const child of children) child.kill('SIGKILL'); });
  await Promise.all(children.map((child) => new Promise<void>((resolve, reject) => {
    child.once('message', (message) => { assert.equal(message, 'ready'); resolve(); });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('child exited before readiness')));
  })));
  const results = children.map((child) => new Promise<unknown>((resolve) => child.once('message', resolve)));
  for (const child of children) child.send('go');
  const outcomes = await Promise.all(results);
  assert.equal(outcomes.filter((result) => result === 'acquired').length, 1);
  assert.equal(outcomes.filter((result) => result === 'rejected').length, 3);
  const winner = children[outcomes.indexOf('acquired')]!;
  assert.equal(readFileSync(`${f.path}.lock`, 'utf8'), `${winner.pid}\n`);
  assert.equal(readFileSync(f.path, 'utf8'), original);
  assert.equal(existsSync(`${f.path}.lock.recover`), false);
});

test('logout during a callback rejects late credentials, clears disk and revokes the returned session', async (t) => {
  const f = fixture(t); const auth = f.auth();
  const url = await f.begin(auth);
  f.codeGate = deferred<void>();
  const callback = auth.callback('browser', f.callback(url));
  const rejected = assert.rejects(callback, (error) => safeError(error, 'unavailable'));
  await f.codeEntered.promise;
  const logout = auth.logout();
  f.codeGate.resolve();
  await rejected; await logout;
  assert.equal(auth.status().authenticated, false);
  assert.equal(auth.status().accounts.length, 0);
  assert.ok(!readFileSync(f.path, 'utf8').includes('secret'));
  assert.ok(f.requests.some((request) => request.fields.get('token') === 'refresh-secret'));
});

test('close during a callback retains the lock until late-session cleanup drains', async (t) => {
  const f = fixture(t); const auth = f.auth();
  const url = await f.begin(auth); f.codeGate = deferred<void>();
  const callback = auth.callback('browser', f.callback(url));
  const rejected = assert.rejects(callback, safeError);
  await f.codeEntered.promise;
  const disk = readFileSync(f.path, 'utf8');
  auth.close();
  assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
  f.codeGate.resolve(); await rejected;
  const replacement = f.auth();
  assert.equal(readFileSync(f.path, 'utf8'), disk);
  assert.equal(replacement.status().authenticated, false);
  assert.ok(f.requests.some((request) => request.fields.get('token') === 'refresh-secret'));
});

test('provider transport failures are generic and do not erase the active registration', async (t) => {
  const f = fixture(t); const auth = f.auth();
  await f.signIn(auth);
  f.providerError = { status: 500, error: 'access-secret' };
  await assert.rejects(f.signIn(auth, f.clientId), (error) => safeError(error, 'retryable'));
  assert.equal(auth.status().ready, true);
  const networkAuth = new ProviderAuth({ mode: 'chatgpt', credentialPath: join(f.directory, 'network.json'),
    fetch: async () => { throw new Error('sensitive-provider-secret'); } });
  f.auths.push(networkAuth);
  const url = new URL(await networkAuth.start('browser'));
  await assert.rejects(networkAuth.callback('browser', f.callback(url)), (error) => safeError(error, 'retryable'));
});

test('expired access cannot bypass an earliest refresh restriction', async (t) => {
  const f = fixture(t); const auth = f.auth();
  f.expiresIn = 120; f.earliestRefreshAt = f.time / 1000 + 180;
  await f.signIn(auth); f.time += 121_000;
  await assert.rejects(auth.credential(), (error) => safeError(error, 'retryable'));
  assert.equal(f.requests.filter((request) => request.fields.get('grant_type') === 'refresh_token').length, 0);
});

test('reject non-loopback or changed callback URLs and unsafe store paths', () => {
  for (const redirectUri of ['http://localhost:3001/auth/callback', 'https://127.0.0.1/auth/callback',
    'http://127.0.0.1/callback', 'http://127.0.0.1/auth/callback?x=1']) {
    assert.throws(() => new ProviderAuth({ mode: 'chatgpt', credentialPath: `/nonexistent/${randomUUID()}/auth.json`, redirectUri }), safeError);
  }
  assert.throws(() => new ProviderAuth({ mode: 'chatgpt', credentialPath: 'relative.json' }), safeError);
});

for (const kind of ['malformed-token-set', 'changed-subject', 'storage-failure'] as const) {
  test(`callback revokes rejected renewable session on ${kind}`, async (t) => {
    const f = fixture(t);
    if (kind === 'malformed-token-set') {
      const transport = f.fetch;
      f.fetch = async (input, init) => {
        const response = await transport(input, init);
        if (!String(input).endsWith('/oauth/token')) return response;
        return Response.json({ ...await response.json(), token_type: 'invalid' });
      };
    }
    const auth = f.auth();
    if (kind === 'changed-subject') { await f.signIn(auth); f.subject = 'different-subject'; }
    const url = await f.begin(auth, 'browser', kind === 'changed-subject' ? f.clientId : undefined);
    if (kind === 'storage-failure') chmodSync(f.directory, 0o755);
    await assert.rejects(auth.callback('browser', f.callback(url)), safeError);
    assert.ok(f.requests.some((request) => request.fields.get('token') === 'refresh-secret'));
    assert.equal(auth.status().accounts.length, kind === 'changed-subject' ? 1 : 0);
    if (kind === 'storage-failure') chmodSync(f.directory, 0o700);
  });
}

test('refresh may omit unchanged scopes but explicit reduced scopes never inherit plan permission', async (t) => {
  const f = fixture(t); const transport = f.fetch;
  let omit = true;
  f.fetch = async (input, init) => {
    const response = await transport(input, init);
    if (!String(input).endsWith('/oauth/token') || !String(init?.body).includes('grant_type=refresh_token')) return response;
    const body = await response.json();
    if (omit) delete body.scope; else body.scope = 'openid profile email';
    return Response.json(body);
  };
  const auth = f.auth(); f.expiresIn = 120;
  await f.signIn(auth); f.time += 121_000;
  assert.equal((await auth.credential()).bearer, 'rotated-access-secret');
  assert.equal(auth.status().planUsageEnabled, true);
  omit = false; f.time += 121_000;
  await assert.rejects(auth.credential(), (error) => safeError(error, 'unavailable'));
  assert.equal(auth.status().planUsageEnabled, false);
});

for (const kind of ['malformed-token-set', 'changed-subject'] as const) {
  test(`refresh rejection on ${kind} revokes replacement and clears spent rotating token`, async (t) => {
    const f = fixture(t); const transport = f.fetch;
    f.fetch = async (input, init) => {
      const response = await transport(input, init);
      if (kind !== 'malformed-token-set' || !String(input).endsWith('/oauth/token') ||
        !String(init?.body).includes('grant_type=refresh_token')) return response;
      return Response.json({ ...await response.json(), token_type: 'invalid' });
    };
    const auth = f.auth(); f.expiresIn = 120;
    await f.signIn(auth); f.time += 121_000;
    if (kind === 'changed-subject') f.subject = 'different-subject';
    await assert.rejects(auth.credential(), safeError);
    assert.ok(f.requests.some((request) => request.fields.get('token') === 'rotated-refresh-secret'));
    assert.equal(auth.status().authenticated, false);
    assert.ok(!readFileSync(f.path, 'utf8').includes('secret'));
    const refreshes = f.requests.filter((request) => request.fields.get('grant_type') === 'refresh_token').length;
    await assert.rejects(auth.credential(), (error) => safeError(error, 'reauthorize'));
    assert.equal(f.requests.filter((request) => request.fields.get('grant_type') === 'refresh_token').length, refreshes);
  });
}

test('logout immediately clears persisted credentials even behind a blocked refresh and close', async (t) => {
  const f = fixture(t); const auth = f.auth(); f.expiresIn = 120;
  await f.signIn(auth); f.time += 121_000; f.refreshGate = deferred<void>();
  const refreshRejected = assert.rejects(auth.credential(), safeError);
  await f.refreshEntered.promise;
  const logout = auth.logout();
  const logoutRejected = assert.rejects(logout, (error) => safeError(error, 'unavailable'));
  assert.ok(!readFileSync(f.path, 'utf8').includes('secret'));
  auth.close();
  assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
  f.refreshGate.resolve(); await refreshRejected; await logoutRejected;
  const restarted = f.auth();
  assert.equal(restarted.status().authenticated, false);
  assert.ok(!readFileSync(f.path, 'utf8').includes('secret'));
});

for (const [name, claims] of [
  ['wrong authorized party', { azp: 'oaiapp_other' }],
  ['missing multi-audience authorized party', { aud: ['oaiapp_first', 'oaiapp_other'] }],
  ['malformed audience array', { aud: ['oaiapp_first', 1], azp: 'oaiapp_first' }],
  ['missing expiration', { exp: undefined }],
  ['not-before in future', { nbf: 1_800_000_100 }],
] as const) {
  test(`rejects signed ID token with ${name}`, async (t) => {
    const f = fixture(t); const auth = f.auth(); f.claims = claims;
    await assert.rejects(f.signIn(auth), safeError);
    assert.equal(auth.status().authenticated, false);
    assert.ok(f.requests.some((request) => request.fields.get('token') === 'refresh-secret'));
  });
}

test('signed multi-audience ID token remains valid when this client is the authorized party', async (t) => {
  const f = fixture(t); const auth = f.auth();
  f.claims = { aud: ['oaiapp_first', 'oaiapp_other'], azp: 'oaiapp_first' };
  await f.signIn(auth);
  assert.equal(auth.status().authenticated, true);
});

test('FIFO credential input fails promptly and does not strand its process lock', { skip: process.platform === 'win32' }, (t) => {
  const f = fixture(t);
  execFileSync('mkfifo', ['-m', '600', f.path]);
  assert.throws(() => f.auth(), (error) => safeError(error, 'storage'));
  assert.equal(existsSync(`${f.path}.lock`), false);
  rmSync(f.path);
  const auth = f.auth(); auth.close();
});
