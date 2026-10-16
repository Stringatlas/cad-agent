import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { CAD_LIMITS, PROJECT_FRAME_ID, type CadBodyResult, type CadSource } from '@spatial/contracts';
import { createIsolatedDemoServer as createDemoServer } from '../scripts/isolated-demo-server';

// Independent acceptance exercises the public transport; it never calls a kernel implementation.
test('CAD HTTP sandbox workflow is kernel-backed and cannot mutate the shared project', async t => {
  const server = createDemoServer({ datasetRoot: '/nonexistent-cad-http-fixture' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const beforeResponse = await fetch(`${base}/project`), before = await beforeResponse.json();
  const capabilities = await (await fetch(`${base}/cad/capabilities`)).json();
  assert.equal(capabilities.ok, true);
  const source = capabilities.result.source as CadSource;
  assert.deepEqual(source, { sessionId: beforeResponse.headers.get('x-spatial-session'), projectRevision: before.revision, frameId: PROJECT_FRAME_ID });
  assert.equal(capabilities.result.publishesProject, false); assert.equal(capabilities.result.resetInvalidatesBodies, true);
  assert.deepEqual(capabilities.result.operations, ['box', 'cylinder', 'boolean', 'inspect', 'tessellate', 'export-step', 'delete']);
  async function post(operation: unknown, binding: unknown = source) {
    const response = await fetch(`${base}/cad/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...binding as object, operation }) });
    return { status: response.status, json: await response.json() };
  }
  async function success(operation: unknown) {
    const reply = await post(operation); assert.equal(reply.status, 200, JSON.stringify(reply.json)); assert.equal(reply.json.ok, true); return reply.json.result;
  }
  async function failure(operation: unknown, status: number, code: string, binding: unknown = source) {
    const reply = await post(operation, binding); assert.equal(reply.status, status); assert.equal(reply.json.ok, false); assert.equal(reply.json.error.code, code);
  }
  const primitive = { kind: 'box', center: [2, -3, 4], dimensions: [2, 3, 4] };
  const box = await success(primitive) as CadBodyResult;
  assert.deepEqual(box.source, source); assert.equal(box.valid, true); assert.equal(box.body.bodyRevision, 1);
  assert.equal(box.kernel.validation, 'BRepCheck_Analyzer'); assert.equal(box.kernel.name, 'OpenCascade');
  assert.ok(Math.abs(box.volume - 24) < 1e-8); assert.deepEqual(box.bounds, { min: [1, -4.5, 2], max: [3, -1.5, 6] });
  assert.deepEqual(box.topology, { solids: 1, faces: 6, edges: 12, vertices: 8 });
  const cylinder = await success({ kind: 'cylinder', center: [2, -3, 4], radius: 0.5, height: 4 });
  assert.ok(Math.abs(cylinder.volume - Math.PI) < 1e-8);
  const cut = await success({ kind: 'boolean', operator: 'subtract', left: box.body, right: cylinder.body });
  assert.ok(Math.abs(cut.volume - (24 - Math.PI)) < 1e-8); assert.equal(cut.topology.solids, 1);
  assert.deepEqual(await success({ kind: 'inspect', body: box.body }), box);
  const mesh = await success({ kind: 'tessellate', body: cut.body });
  assert.equal(mesh.units, 'm'); assert.equal(mesh.normals.length, mesh.vertices.length); assert.ok(mesh.triangles.length > 0);
  assert.ok(mesh.triangles.every((index: number) => Number.isSafeInteger(index) && index >= 0 && index < mesh.vertices.length / 3));
  const step = await success({ kind: 'export-step', body: cut.body });
  assert.equal(step.units, 'm'); assert.ok(step.step.startsWith('ISO-10303-21;')); assert.ok(step.step.includes('SI_UNIT($,.METRE.)'));
  await failure(primitive, 409, 'stale-source', { ...source, sessionId: 'other-session' });
  await failure(primitive, 409, 'stale-source', { ...source, projectRevision: source.projectRevision + 1 });
  await failure(primitive, 409, 'stale-source', { ...source, frameId: 'other-frame' });
  await failure({ kind: 'inspect', body: { ...box.body, bodyRevision: 2 } }, 409, 'stale-body');
  await failure({ kind: 'inspect', body: { bodyId: 'missing', bodyRevision: 1 } }, 404, 'unknown-body');
  for (const operation of [
    { ...primitive, extra: true }, { ...primitive, dimensions: [1, 2] }, { ...primitive, center: [null, 0, 0] },
    { kind: 'import-step', step: 'arbitrary' }, { kind: 'inspect', body: { ...box.body, extra: true } },
  ]) await failure(operation, 400, 'invalid-request');
  await failure({ ...primitive, dimensions: [0, 1, 1] }, 422, 'resource-limit');
  await failure({ ...primitive, center: [1001, 0, 0] }, 422, 'resource-limit');
  await failure({ kind: 'boolean', operator: 'subtract', left: box.body, right: box.body }, 422, 'invalid-solid');
  assert.deepEqual(await success({ kind: 'inspect', body: box.body }), box);
  assert.deepEqual(await success({ kind: 'delete', body: cylinder.body }), { deleted: true });
  await failure({ kind: 'inspect', body: cylinder.body }, 404, 'unknown-body');
  // Result owns its shape; releasing input bodies does not destroy it.
  assert.deepEqual(await success({ kind: 'inspect', body: cut.body }), cut);

  for (const [path, method, headers, body, status, code] of [
    ['/cad/execute', 'GET', {}, undefined, 405, 'method-not-allowed'],
    ['/cad/capabilities', 'POST', {}, undefined, 405, 'method-not-allowed'],
    ['/cad/execute', 'POST', { 'Content-Type': 'text/plain' }, '{}', 415, 'unsupported-media-type'],
    ['/cad/execute', 'POST', { 'Content-Type': 'application/json' }, '{', 400, 'invalid-request'],
    ['/cad/execute?ignored=1', 'POST', { 'Content-Type': 'application/json' }, '{}', 400, 'invalid-request'],
    ['/cad/execute', 'POST', { 'Content-Type': 'application/json', Origin: 'https://attacker.invalid' }, '{}', 403, 'local-only'],
    ['/cad/execute', 'POST', { 'Content-Type': 'application/json' }, ' '.repeat(CAD_LIMITS.maxRequestBytes + 1), 413, 'resource-limit'],
  ] as const) {
    const reply = await fetch(base + path, { method, headers, body });
    assert.equal(reply.status, status); assert.equal((await reply.json()).error.code, code);
  }
  // Admission includes slow body reads; health/project remain responsive during an occupied slot.
  await new Promise<void>((resolve, reject) => {
    const slow = httpRequest(`${base}/cad/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    slow.on('error', () => {}); slow.write('{');
    setTimeout(() => { void (async () => {
      try {
        await failure(primitive, 409, 'busy');
        assert.equal((await fetch(`${base}/health`)).status, 200);
        assert.deepEqual(await (await fetch(`${base}/project`)).json(), before);
        slow.destroy(); resolve();
      } catch (error) { slow.destroy(); reject(error); }
    })(); }, 100);
  });
  assert.deepEqual(await (await fetch(`${base}/project`)).json(), before);
});

test('CAD handles cannot cross server instances', async t => {
  const servers = [createDemoServer(), createDemoServer()];
  const urls: string[] = [];
  for (const server of servers) {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
    const address = server.address(); assert.ok(address && typeof address !== 'string'); urls.push(`http://127.0.0.1:${address.port}`);
  }
  const sources = await Promise.all(urls.map(async url => (await (await fetch(url + '/cad/capabilities')).json()).result.source));
  const response = await fetch(urls[0] + '/cad/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...sources[0], operation: { kind: 'box', center: [0, 0, 0], dimensions: [1, 1, 1] } }) });
  const body = (await response.json()).result.body;
  for (const [binding, status, code] of [[sources[0], 409, 'stale-source'], [sources[1], 404, 'unknown-body']] as const) {
    const reply = await fetch(urls[1] + '/cad/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...binding, operation: { kind: 'inspect', body } }) });
    assert.equal(reply.status, status); assert.equal((await reply.json()).error.code, code);
  }
});
