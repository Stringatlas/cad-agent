import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { TORONTO_SEMANTIC_LABELS, type TorontoCadSnapshot, type TorontoCadProposal, type PointOverrideSnapshot, type PointMoveProposal } from '@spatial/contracts';
import { TorontoCadSession, TorontoCadError } from '../../apps/server/src/cad/toronto-cad-session';
import { createTorontoCadRoutes } from '../../apps/server/src/cad/toronto-cad-routes';
import { PointOverrideSession } from '../../apps/server/src/scene/point-overrides';
import { createPointOverrideRoutes } from '../../apps/server/src/scene/point-override-routes';
import { CadWorkerClient } from '../../apps/server/src/cad/cad-client';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'toronto-cad-'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 1, hierarchy: { firstChunkSize: 22 }, boundingBox: { min: [0, 0, 0], max: [20, 20, 20] }, scale: [0.001, 0.001, 0.001], offset: [0, 0, 0], attributes: [
    { name: 'position', type: 'int32', size: 12, min: [0, 0, 0], max: [20, 20, 20] }, { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 }, { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(28); payload.writeInt32LE(1000, 0); payload.writeUInt16LE(1, 18); payload.writeFloatLE(6, 24);
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(1, 2); hierarchy.writeBigUInt64LE(28n, 14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale, semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1, 2, 3, 4].map(file => ({ source_file_id: file, file: `L00${file}.ply`, points: file === 1 ? 1 : 0 })) };
  await mkdir(join(root, 'octree')); await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest)); await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  return { root, payload, clean: () => rm(root, { recursive: true, force: true }) };
}
const box = { kind: 'box', center: [5, -3, 2], dimensions: [2, 4, 3] };
const binding = (s: TorontoCadSnapshot) => ({ sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision });
const code = (expected: string) => (error: unknown) => error instanceof TorontoCadError && error.code === expected;

test('Toronto native candidates retain exact solid and mesh, explicit decline/accept and latest Undo', async () => {
  const f = await fixture(), cad = new TorontoCadSession(f.root);
  try {
    const s = await cad.execute('snapshot') as TorontoCadSnapshot;
    assert.equal(s.frameId, 'toronto3d-local-v1'); assert.equal(s.units, 'm'); assert.equal(s.revision, 0);
    const p = await cad.execute('propose', { ...binding(s), operation: box }) as TorontoCadProposal;
    assert.equal(p.validation.kernel.name, 'OpenCascade'); assert.equal(p.validation.source.frameId, s.frameId);
    assert.ok(Math.abs(p.validation.volume - 24) < 1e-7); assert.deepEqual(p.validation.bounds, { min: [4, -5, 0.5], max: [6, -1, 3.5] });
    assert.ok(p.mesh.triangles.length > 0); assert.deepEqual(p.mesh.body, p.validation.body);
    const exact = structuredClone(p); (p.operation.center as unknown as number[])[0] = 999; (p.mesh.vertices as number[])[0] = 999;
    const p2 = await cad.execute('propose', { ...binding(s), operation: { kind: 'cylinder', center: [-2, 3, 5], radius: 0.5, height: 2 } }) as TorontoCadProposal;
    assert.ok(Math.abs(p2.validation.volume - Math.PI * 0.5) < 1e-7);
    assert.equal((await cad.execute('snapshot') as TorontoCadSnapshot).bodies.length, 0);
    const declined = await cad.execute('decline', { ...binding(s), proposalId: p2.proposalId }) as TorontoCadSnapshot;
    assert.equal(declined.revision, 0); assert.equal(declined.proposals.length, 1);
    const stale = await cad.execute('propose', { ...binding(s), operation: box }) as TorontoCadProposal;
    const accepted = await cad.execute('approve', { ...binding(s), proposalId: p.proposalId }) as TorontoCadSnapshot;
    assert.equal(accepted.revision, 1); assert.equal(accepted.proposals.length, 0); assert.equal(accepted.bodies[0].bodyId, exact.bodyId);
    assert.deepEqual(accepted.bodies[0].operation, exact.operation); assert.deepEqual(accepted.bodies[0].mesh, exact.mesh);
    await assert.rejects(cad.execute('approve', { ...binding(s), proposalId: stale.proposalId }), code('stale-revision'));
    await assert.rejects(cad.execute('approve', { ...binding(accepted), proposalId: stale.proposalId }), code('unknown-proposal'));
    await assert.rejects(cad.execute('undo', { ...binding(accepted), transactionId: 'wrong' }), code('nothing-to-undo'));
    const again = await cad.execute('propose', { ...binding(accepted), operation: { kind: 'cylinder', center: [1, 1, 1], radius: 1, height: 1 } }) as TorontoCadProposal;
    const accepted2 = await cad.execute('approve', { ...binding(accepted), proposalId: again.proposalId }) as TorontoCadSnapshot;
    await assert.rejects(cad.execute('undo', { ...binding(accepted2), transactionId: accepted.nextUndoTransactionId }), code('nothing-to-undo'));
    const undo2 = await cad.execute('undo', { ...binding(accepted2), transactionId: accepted2.nextUndoTransactionId }) as TorontoCadSnapshot;
    assert.equal(undo2.bodies.length, 1); assert.equal(undo2.nextUndoTransactionId, accepted.nextUndoTransactionId);
    const undone = await cad.execute('undo', { ...binding(undo2), transactionId: undo2.nextUndoTransactionId }) as TorontoCadSnapshot;
    assert.equal(undone.revision, 4); assert.deepEqual(undone.bodies, []); assert.equal(undone.nextUndoTransactionId, null);
    assert.deepEqual(await readFile(join(f.root, 'octree/octree.bin')), f.payload);
  } finally { await cad.close(); await f.clean(); }
});

test('Toronto authority rejects stale/malformed/cross-frame and bounded candidates; artifact replacement fails closed', async () => {
  const f = await fixture(), cad = new TorontoCadSession(f.root);
  try {
    const s = await cad.execute('snapshot') as TorontoCadSnapshot;
    await assert.rejects(cad.execute('propose', { ...binding(s), sessionId: 'other', operation: box }), code('stale-session'));
    await assert.rejects(cad.execute('propose', { ...binding(s), artifactRevision: 'other', operation: box }), code('stale-artifact'));
    for (const operation of [{ ...box, center: [NaN, 0, 0] }, { ...box, frameId: 'demo-local-v1' }, { kind: 'delete', body: { bodyId: 'x', bodyRevision: 1 } }]) await assert.rejects(cad.execute('propose', { ...binding(s), operation }), code('invalid-request'));
    await assert.rejects(cad.execute('propose', { ...binding(s), operation: { ...box, dimensions: [101, 1, 1] } }), code('resource-limit'));
    for (let i = 0; i < 8; i++) await cad.execute('propose', { ...binding(s), operation: box });
    await assert.rejects(cad.execute('propose', { ...binding(s), operation: box }), code('resource-limit'));
    await writeFile(join(f.root, 'octree/octree.bin'), f.payload);
    await assert.rejects(cad.execute('snapshot'), code('stale-artifact'));
    await assert.rejects(cad.execute('snapshot'), code('unavailable'));
  } finally { await cad.close(); await f.clean(); }
});

test('Toronto snapshot/approval inspect live native handles and fail closed following kernel reset', async () => {
  const f = await fixture(), cad = new TorontoCadSession(f.root);
  try {
    const s = await cad.execute('snapshot') as TorontoCadSnapshot;
    const p = await cad.execute('propose', { ...binding(s), operation: box }) as TorontoCadProposal;
    await cad.execute('approve', { ...binding(s), proposalId: p.proposalId });
    // Simulates the worker being terminated between requests; cached mesh must not suffice.
    const kernel = (cad as unknown as { kernel: CadWorkerClient }).kernel;
    await kernel.close();
    await assert.rejects(cad.execute('snapshot'), code('unavailable'));
    await assert.rejects(cad.execute('snapshot'), code('unavailable'));
  } finally { await cad.close(); await f.clean(); }
});

test('Toronto measured application postconditions reject a valid native solid with wrong requested dimensions', async () => {
  const f = await fixture(), cad = new TorontoCadSession(f.root);
  try {
    const s = await cad.execute('snapshot') as TorontoCadSnapshot;
    const kernel = (cad as unknown as { kernel: CadWorkerClient }).kernel;
    const original = kernel.execute.bind(kernel);
    kernel.execute = async (operation, signal) => original(operation.kind === 'box' ? { ...operation, dimensions: [1, 1, 1] } : operation, signal);
    await assert.rejects(cad.execute('propose', { ...binding(s), operation: box }), code('unavailable'));
    await assert.rejects(cad.execute('snapshot'), code('unavailable'));
  } finally { await cad.close(); await f.clean(); }
});

test('Toronto cancelled native work invalidates prior handles rather than permitting cached approval', async () => {
  const f = await fixture(), cad = new TorontoCadSession(f.root);
  try {
    const s = await cad.execute('snapshot') as TorontoCadSnapshot;
    const p = await cad.execute('propose', { ...binding(s), operation: box }) as TorontoCadProposal;
    const kernel = (cad as unknown as { kernel: CadWorkerClient }).kernel;
    const controller = new AbortController();
    const work = kernel.execute({ kind: 'export-step', body: p.validation.body }, controller.signal);
    setTimeout(() => controller.abort(), 0); await assert.rejects(work);
    await assert.rejects(cad.execute('approve', { ...binding(s), proposalId: p.proposalId }), code('unavailable'));
  } finally { await cad.close(); await f.clean(); }
});

test('Toronto HTTP admission, retained approval and shared point pending/decline', async () => {
  const f = await fixture(), cad = new TorontoCadSession(f.root), points = new PointOverrideSession(f.root);
  const routes = createTorontoCadRoutes(f.root, cad), pointRoutes = createPointOverrideRoutes(f.root, points);
  const server = createServer((req, res) => { void routes.handle(req, res).then(async found => { if (!found && !await pointRoutes.handle(req, res)) { res.statusCode = 404; res.end(); } }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/datasets/toronto3d`, root = base + '/cad';
  const post = (path: string, body: unknown) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const s = (await (await fetch(root)).json()).result as TorontoCadSnapshot;
    assert.equal((await fetch(root, { headers: { Origin: 'https://evil.example' } })).status, 403);
    const badHost = await new Promise(resolve => { const req = httpRequest(root, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', e => { throw e; }); req.end(); });
    assert.equal(badHost, 403); assert.equal((await fetch(root + '?x')).status, 400);
    assert.equal((await post(root + '/propose', { pad: 'x'.repeat(9000) })).status, 413);
    assert.equal((await fetch(root + '/propose', { method: 'POST', body: '{}' })).status, 400);
    const p = (await (await post(root + '/propose', { ...binding(s), operation: box })).json()).result as TorontoCadProposal;
    assert.equal((await post(root + '/approve', { ...binding(s), proposalId: p.proposalId, mesh: p.mesh })).status, 400);
    const accepted = (await (await post(root + '/approve', { ...binding(s), proposalId: p.proposalId })).json()).result as TorontoCadSnapshot;
    assert.equal(accepted.bodies[0].bodyId, p.bodyId);
    assert.equal((await post(root + '/approve', { ...binding(s), proposalId: p.proposalId })).status, 409);
    const undone = (await (await post(root + '/undo', { ...binding(accepted), transactionId: accepted.nextUndoTransactionId })).json()).result as TorontoCadSnapshot;
    assert.equal(undone.bodies.length, 0);
    const ps = await points.execute('snapshot') as PointOverrideSnapshot;
    const pp = await points.execute('propose', { sessionId: ps.sessionId, revision: ps.revision, artifactRevision: ps.artifactRevision, points: [{ key: { sourceFileId: 1, sourceRow: 0 }, position: [1, 0, 0] }], translation: [0, 1, 0] }) as PointMoveProposal;
    const pending = (await (await fetch(base + '/overrides/pending')).json()).result;
    assert.deepEqual(pending, [pp]); (pending[0].moves[0].after as unknown as number[])[0] = 999;
    const declined = await post(base + '/overrides/decline', { sessionId: ps.sessionId, revision: ps.revision, proposalId: pp.proposalId });
    assert.equal(declined.status, 200); assert.equal((await declined.json()).result.revision, 0);
    assert.deepEqual(await points.execute('pending'), []);
    const slow = httpRequest(root + '/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' } }); slow.on('error', () => {}); slow.write('{');
    await new Promise(resolve => setTimeout(resolve, 30)); assert.equal((await fetch(root)).status, 429); slow.destroy();
  } finally { await routes.close(); await pointRoutes.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await f.clean(); }
});
