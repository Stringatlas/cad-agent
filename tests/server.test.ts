import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createDemoServer } from '../apps/server/src/index';
import { assertProjectState } from '@spatial/contracts';

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
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
