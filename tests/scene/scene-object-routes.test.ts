import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createSceneObjectRoutes } from '../../apps/server/src/scene/scene-object-routes';
import { SceneObjectError, type SceneObjectSession } from '../../apps/server/src/scene/scene-object-session';
import type { PointOverrideSession } from '../../apps/server/src/scene/point-overrides';
import { SCENE_OBJECT_LIMITS, type SceneObjectSnapshot } from '../../packages/contracts/src/scene-objects';

const snapshot: SceneObjectSnapshot = { schemaVersion: 1, sessionId: 'session', revision: 0, artifactRevision: 'artifact', datasetId: 'toronto3d', frameId: 'toronto3d-local-v1', units: 'm', objects: [], proposals: [], nextUndoTransactionId: null };
test('scene object routes match local-only security, strict HTTP envelopes and authority errors', async () => {
  const seen: unknown[] = [];
  let closed = false;
  const authority = { async execute(operation: string, value: unknown) { seen.push({ operation, value }); if (operation === 'approve') throw new SceneObjectError('stale-reference'); return snapshot; }, async close() { closed = true; } } as unknown as SceneObjectSession;
  const routes = createSceneObjectRoutes('/unused', {} as PointOverrideSession, authority);
  const server = createServer((req, res) => { void routes.handle(req, res).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const send = (path = '/datasets/toronto3d/objects', method = 'GET', headers: Record<string, string> = {}, body?: string | Buffer) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => { let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode!, body: text })); }); req.on('error', reject); req.end(body);
  });
  try {
    assert.equal((await send()).status, 200); assert.deepEqual(seen, [{ operation: 'snapshot', value: undefined }]);
    assert.equal((await send('/elsewhere')).status, 404);
    assert.equal((await send(undefined, 'GET', { host: 'evil.test' })).status, 403);
    assert.equal((await send(undefined, 'GET', { origin: 'https://localhost' })).status, 403);
    assert.equal((await send('/datasets/toronto3d/objects?x=1')).status, 400);
    assert.equal((await send('/datasets/toronto3d/objects/propose', 'GET')).status, 400);
    assert.equal((await send('/datasets/toronto3d/objects/propose', 'POST', { 'content-type': 'text/plain' }, '{}')).status, 400);
    assert.equal((await send('/datasets/toronto3d/objects/propose', 'POST', { 'content-type': 'application/json', 'content-encoding': 'gzip' }, '{}')).status, 400);
    assert.equal((await send('/datasets/toronto3d/objects/propose', 'POST', { 'content-type': 'application/json' }, '{')).status, 400);
    assert.equal((await send('/datasets/toronto3d/objects/propose', 'POST', { 'content-type': 'application/json' }, Buffer.from([0xff]))).status, 400);
    assert.equal((await send('/datasets/toronto3d/objects/propose', 'POST', { 'content-type': 'application/json', 'content-length': String(SCENE_OBJECT_LIMITS.requestBytes + 1) })).status, 413);
    const result = await send('/datasets/toronto3d/objects/approve', 'POST', { 'content-type': 'application/json' }, '{}');
    assert.equal(result.status, 409); assert.equal(JSON.parse(result.body).error.code, 'stale-reference');
    await routes.close(); assert.equal(closed, true); assert.equal((await send()).status, 503);
  } finally { await routes.close(); server.close(); await once(server, 'close'); }
});

test('scene object route admission includes unfinished body reading', async () => {
  const authority = { async execute() { return snapshot; }, async close() {} } as unknown as SceneObjectSession;
  const routes = createSceneObjectRoutes('/unused', {} as PointOverrideSession, authority);
  const server = createServer((req, res) => { void routes.handle(req, res); }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const held = httpRequest({ hostname: '127.0.0.1', port, path: '/datasets/toronto3d/objects/propose', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '10' } }); held.on('error', () => {}); held.write('{');
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    const result = await fetch(`http://127.0.0.1:${port}/datasets/toronto3d/objects`); assert.equal(result.status, 429); await result.text();
  } finally { held.destroy(); await routes.close(); server.closeAllConnections(); server.close(); await once(server, 'close'); }
});
