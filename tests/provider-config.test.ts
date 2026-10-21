import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { loadServerConfiguration, SERVER_ENV_PATH } from '../apps/server/src/provider-config';

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'spatial-env-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, envPath: join(root, '.env'), home: join(root, 'home') };
}
test('server env location is fixed to apps/server, defaults require no file/key', (t) => {
  const f = fixture(t);
  assert.ok(SERVER_ENV_PATH.endsWith('/apps/server/.env'));
  assert.deepEqual(loadServerConfiguration({ ...f, env: {} }), { provider: { mode: 'disabled' } });
});
test('server env parser supports quoted tokens; process environment wins without mutation', (t) => {
  const f = fixture(t);
  writeFileSync(f.envPath, 'SPATIAL_PROVIDER_MODE=api-key\nOPENAI_API_KEY="file-secret"\nSPATIAL_PROJECT_PATH=/tmp/from-file.json\n');
  const env = { OPENAI_API_KEY: 'process-secret' };
  assert.deepEqual(loadServerConfiguration({ ...f, env }), {
    provider: { mode: 'api-key', apiKey: 'process-secret' },
  });
  assert.deepEqual(env, { OPENAI_API_KEY: 'process-secret' });
  assert.equal(loadServerConfiguration({ ...f, env: { SPATIAL_PROVIDER_MODE: 'disabled' } }).provider.apiKey, undefined);
});
test('ChatGPT mode ignores configured API key and uses separate protected auth path', (t) => {
  const f = fixture(t);
  const config = loadServerConfiguration({ ...f, env: { SPATIAL_PROVIDER_MODE: 'chatgpt', OPENAI_API_KEY: 'never-fallback' } });
  assert.deepEqual(config.provider, { mode: 'chatgpt', credentialPath: join(f.home, '.spatial-cad-harness/auth/credentials.json'), redirectUri: 'http://127.0.0.1:3001/auth/callback' });
});
test('invalid modes, missing/empty/unsafe keys and incorrect paths/callbacks fail sanitized', (t) => {
  const f = fixture(t);
  for (const env of [
    { SPATIAL_PROVIDER_MODE: 'automatic-secret' },
    { SPATIAL_PROVIDER_MODE: 'api-key' },
    { SPATIAL_PROVIDER_MODE: 'api-key', OPENAI_API_KEY: '' },
    { SPATIAL_PROVIDER_MODE: 'api-key', OPENAI_API_KEY: 'secret with whitespace' },
    { SPATIAL_PROVIDER_MODE: 'chatgpt', SPATIAL_AUTH_PATH: './secret-relative.json' },
    { SPATIAL_PROVIDER_MODE: 'chatgpt', SPATIAL_AUTH_REDIRECT_URI: 'https://attacker.example/secret' },
  ]) assert.throws(() => loadServerConfiguration({ ...f, env }), (error: unknown) => {
    assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /secret|attacker/); return true;
  });
  writeFileSync(f.envPath, 'SPATIAL_PROVIDER_MODE=api-key\nOPENAI_API_KEY=file-secret\n');
  assert.throws(() => loadServerConfiguration({ ...f, env: { OPENAI_API_KEY: '' } }));
});
test('env loading rejects symlinks, oversized and non-file inputs without content/path leak', (t) => {
  const f = fixture(t);
  const target = join(f.root, 'target'); writeFileSync(target, 'sensitive-contents'); symlinkSync(target, f.envPath);
  assert.throws(() => loadServerConfiguration({ ...f, env: {} }), /Unable to read server environment configuration/);
  rmSync(f.envPath); writeFileSync(f.envPath, 's'.repeat(65_537));
  assert.throws(() => loadServerConfiguration({ ...f, env: {} }));
  assert.throws(() => loadServerConfiguration({ ...f, env: {}, envPath: f.root }));
  chmodSync(f.envPath, 0o600);
});

test('FIFO env input fails promptly rather than blocking synchronous startup', { skip: process.platform === 'win32' }, (t) => {
  const f = fixture(t);
  execFileSync('mkfifo', ['-m', '600', f.envPath]);
  assert.throws(() => loadServerConfiguration({ ...f, env: {} }), /Unable to read server environment configuration/u);
});
