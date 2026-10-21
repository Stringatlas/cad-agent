import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { connect } from 'node:net';
import type { Server } from 'node:http';
import { createIsolatedDemoServer as createDemoServer } from '../../scripts/isolated-demo-server';

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

test('read-only server health and unsupported routes', async () => {
  const server = createDemoServer(), { base } = await listen(server);
  try {
    const health = await fetch(base + '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    assert.equal((await fetch(base + '/missing')).status, 404);
    assert.equal((await fetch(base + '/project')).status, 404);
    assert.equal((await fetch(base + '/project', { method: 'POST' })).status, 404);
  } finally { await close(server); }
});

test('malformed raw HTTP targets preserve server liveness', async () => {
  const server = createDemoServer(), { port, base } = await listen(server);
  try {
    for (const target of ['//', 'http://[']) {
      const response = await rawRequest(port, target);
      assert.match(response, /^HTTP\/1\.1 400 /); assert.match(response, /Connection: close/i);
      assert.match(response, /Invalid request target/); assert.ok(!response.includes('ERR_INVALID_URL'));
      assert.equal((await fetch(base + '/health')).status, 200);
    }
  } finally { await close(server); }
});
