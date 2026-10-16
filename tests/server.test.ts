import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { connect } from 'node:net';
import { request as httpRequest, type Server } from 'node:http';
import { ProjectSession } from '../apps/server/src/project-session';
import { createIsolatedDemoServer as createDemoServer } from '../scripts/isolated-demo-server';
import { assertProjectState, type ProjectBinding } from '@spatial/contracts';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { port: address.port, base: `http://127.0.0.1:${address.port}` };
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
function rawRequest(port: number, target: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1'); let text = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('Raw request timed out')));
    socket.once('connect', () => socket.end(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    socket.on('data', chunk => { text += chunk.toString(); if (text.length > 8192) socket.destroy(new Error('Unbounded error response')); });
    socket.once('error', reject); socket.once('end', () => resolve(text));
  });
}

test('read-only server health, project contract and unsupported routes', async () => {
  const server = createDemoServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(base + '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    const snapshot = await fetch(base + '/project');
    assert.equal(snapshot.status, 200);
    assertProjectState(await snapshot.json());
    assert.equal((await fetch(base + '/missing')).status, 404);
    assert.equal((await fetch(base + '/project', { method: 'POST' })).status, 404);
  } finally {
    await close(server);
  }
});

test('malformed raw HTTP targets and unexpected async route failures preserve unsaved authority and server liveness', async () => {
  const server = createDemoServer(), { port, base } = await listen(server);
  const originalInfo = ProjectSession.prototype.info;
  try {
    const first = (await (await fetch(base + '/project/session')).json()).result;
    const binding: ProjectBinding = { sessionId: first.snapshot.sessionId, projectRevision: first.snapshot.project.revision, frameId: first.snapshot.frameId, units: 'm' };
    const post = async (route: string, body: unknown) => {
      const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 200); return (await response.json()).result;
    };
    const proposal = await post('/project/proposals', { ...binding, edit: { kind: 'update-box', entityId: 'proposal-box', center: [71, 82, 93], dimensions: [2, 3, 4] } });
    const committed = await post('/project/approve', { ...binding, proposalId: proposal.proposalId, digest: proposal.digest, humanApproved: true });
    const expectedInfo = (await (await fetch(base + '/project/session')).json()).result;
    assert.equal(expectedInfo.dirty, true); assert.equal(expectedInfo.savedRevision, null); assert.equal(committed.persisted, false);
    assert.equal(expectedInfo.snapshot.project.revision, 1); assert.equal(expectedInfo.nextUndoTransactionId, committed.transactionId);
    for (const target of ['//', 'http://[']) {
      const response = await rawRequest(port, target);
      assert.match(response, /^HTTP\/1\.1 400 /); assert.match(response, /Connection: close/i);
      assert.match(response, /Invalid request target/); assert.ok(!response.includes('ERR_INVALID_URL'));
      assert.equal((await fetch(base + '/health')).status, 200);
      assert.deepEqual((await (await fetch(base + '/project/session')).json()).result, expectedInfo);
    }
    // This GET path has no route-level catch: simulate an unexpected rejected
    // async dispatch without adding a production fault-injection option.
    ProjectSession.prototype.info = () => { throw new Error('/private/operator-path must not leak'); };
    const failed = await fetch(base + '/project/session'); assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: 'Internal server error' });
    ProjectSession.prototype.info = originalInfo;
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.deepEqual((await (await fetch(base + '/project/session')).json()).result, expectedInfo);
    const raw = await fetch(base + '/project'); assert.equal(raw.headers.get('X-Spatial-Session'), binding.sessionId);
    assert.deepEqual(await raw.json(), committed.snapshot.project);
  } finally { ProjectSession.prototype.info = originalInfo; await close(server); }
});

test('raw project bootstrap shares local Host/Origin policy with project APIs', async () => {
  const server = createDemoServer(), { base } = await listen(server);
  const get = (path: string, headers: Record<string, string | undefined>) => new Promise<{ status: number | undefined; text: string }>((resolve, reject) => {
    const request = httpRequest(base + path, { headers }, response => {
      let text = ''; response.on('data', chunk => text += chunk); response.once('end', () => resolve({ status: response.statusCode, text }));
    });
    request.once('error', reject); request.end();
  });
  try {
    const before = await (await fetch(base + '/project')).json();
    for (const path of ['/project', '/project/session']) {
      for (const headers of [{ Host: 'evil.invalid' }, { Origin: 'http://evil.invalid' }, { Host: 'evil.invalid', Origin: 'http://evil.invalid' }, { Origin: 'null' }, { Origin: 'https://localhost' }]) {
        const response = await get(path, headers); assert.equal(response.status, 403);
        assert.equal(JSON.parse(response.text).error.code, 'local-only'); assert.ok(!response.text.includes('entities'));
      }
      assert.equal((await get(path, { Host: 'localhost', Origin: 'http://localhost' })).status, 200);
    }
    assert.equal((await fetch(base + '/project?ignored=1')).status, 400);
    assert.deepEqual(await (await fetch(base + '/project')).json(), before);
  } finally { await close(server); }
});
