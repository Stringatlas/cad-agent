import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderAuth } from '../../apps/server/src/auth/provider-auth';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'model-lifecycle-test', alg: 'RS256', use: 'sig' };
const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const jwt = (claims: unknown) => { const input = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode(claims)}`; return `${input}.${sign('RSA-SHA256', Buffer.from(input), pair.privateKey).toString('base64url')}`; };
const issuer = 'https://auth.openai.com', resource = 'https://api.openai.com/v1';
test('real ProviderAuth lifecycle generation changes on successful grants/logout/close but NOT normal token refresh', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'spatial-model-auth-lifecycle-')));
  let now = 1800000000000, nonce = '', refreshes = 0;
  const auth = new ProviderAuth({ mode: 'chatgpt', credentialPath: join(root, 'credentials.json'), now: () => now,
    fetch: async (input, init) => {
      const url = String(input); assert.equal(init?.redirect, 'error');
      if (url === `${issuer}/.well-known/openid-configuration`) return Response.json({ issuer, authorization_endpoint: `${issuer}/api/accounts/authorize`, token_endpoint: `${issuer}/api/accounts/oauth/token`, jwks_uri: `${issuer}/.well-known/jwks.json`, revocation_endpoint: `${issuer}/oauth/revoke` });
      if (url === `${issuer}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
      if (url === `${issuer}/oauth/revoke`) return new Response('');
      assert.equal(url, `${issuer}/api/accounts/oauth/token`);
      const fields = new URLSearchParams(String(init?.body)); assert.equal(fields.get('resource'), resource);
      const refresh = fields.get('grant_type') === 'refresh_token'; if (refresh) refreshes++;
      return Response.json({ access_token: `fake-access-${refreshes}`, refresh_token: `fake-refresh-${refreshes}`, token_type: 'Bearer',
        scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', expires_in: 120,
        id_token: jwt({ iss: issuer, aud: 'oaiapp_lifecycle', sub: 'fake-subject', exp: now / 1000 + 3600, iat: now / 1000, ...(!refresh ? { nonce } : {}) }) });
    } });
  t.after(async () => { auth.close(); await rm(root, { recursive: true, force: true }); });
  const initial = auth.credentialGeneration(); let changed = 0; const off = auth.onCredentialChange(() => { changed++; });
  async function grant(existing = false) {
    const start = new URL(await auth.start('fake-browser', existing ? 'oaiapp_lifecycle' : undefined)); nonce = start.searchParams.get('nonce')!;
    assert.equal(auth.credentialGeneration(), existing ? afterGrant : initial, 'OAuth start is not an account replacement');
    const callback = new URL('http://127.0.0.1:3001/auth/callback'); callback.search = new URLSearchParams({ code: 'fake-code', state: start.searchParams.get('state')!, client_id: 'oaiapp_lifecycle' }).toString();
    await auth.callback('fake-browser', callback);
  }
  let afterGrant = '';
  await grant(); afterGrant = auth.credentialGeneration(); assert.notEqual(initial, afterGrant); assert.equal(changed, 1);
  await auth.credential(); assert.equal(auth.credentialGeneration(), afterGrant); assert.equal(refreshes, 0);
  now += 61000; await auth.credential(); assert.equal(refreshes, 1); assert.equal(auth.credentialGeneration(), afterGrant); assert.equal(changed, 1);
  await grant(true); assert.notEqual(auth.credentialGeneration(), afterGrant); assert.equal(changed, 2);
  const signedIn = auth.credentialGeneration(); await auth.logout(); assert.notEqual(auth.credentialGeneration(), signedIn); assert.equal(changed, 3);
  const loggedOut = auth.credentialGeneration(); auth.close(); assert.notEqual(auth.credentialGeneration(), loggedOut); assert.equal(changed, 4); off();
});
