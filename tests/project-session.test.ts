import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { request as httpRequest, createServer, type Server } from 'node:http';
import { PROJECT_LIMITS, canonicalPersistentProject, canonicalSceneContextRequest, type ProjectSnapshot } from '@spatial/contracts';
import { createDemoProject } from '@spatial/project-state';
import { ProjectSession, ProjectError } from '../apps/server/src/project-session';
import { createDemoServer } from '../apps/server/src/index';
import { createChatRoutes } from '../apps/server/src/chat-routes';

const directory = () => mkdtempSync(join(tmpdir(), 'spatial-project-session-'));
const binding = (s: ProjectSnapshot) => ({ sessionId: s.sessionId, projectRevision: s.project.revision, frameId: s.frameId, units: 'm' });
async function listen(server: Server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); const a = server.address(); assert.ok(a && typeof a !== 'string'); return `http://127.0.0.1:${a.port}`; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
const code = (expected: string) => (error: unknown) => error instanceof ProjectError && error.code === expected;
function edit(s: ProjectSession) { const proposal = s.propose({ ...s.binding(), edit: { kind: 'update-box', entityId: 'proposal-box', center: [1, 2, 3], dimensions: [4, 5, 6] } }); return s.approve({ ...s.binding(), proposalId: proposal.proposalId, digest: proposal.digest, humanApproved: true }); }

test('fixed snapshot saves geometry only; restart/load preserve IDs/frame/revision but invalidate old sessions', () => {
  const root = directory(), path = join(root, 'project.json');
  try {
    const service = new ProjectSession(path), start = service.snapshot();
    // The JSON transport/canonical protocol normalize signed zero, not point precision.
    assert.deepEqual(start.project, JSON.parse(JSON.stringify(createDemoProject()))); assert.equal(service.info().dirty, true);
    const committed = edit(service); service.save(service.binding());
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(stored.schemaVersion, 'spatial-project-v1'); assert.equal(stored.frameId, 'demo-local-v1'); assert.equal(stored.project.selectedEntityId, null);
    assert.equal(stored.project.revision, 1); assert.ok(!JSON.stringify(stored).includes(start.sessionId));
    assert.deepEqual(readdirSync(root), ['project.json'], 'bounded atomic write leaves no lock/temp');
    const restarted = new ProjectSession(path); assert.deepEqual(restarted.snapshot().project, committed.snapshot.project);
    assert.notEqual(restarted.snapshot().sessionId, start.sessionId); assert.equal(restarted.info().nextUndoTransactionId, null); assert.equal(restarted.info().dirty, false);
    assert.throws(() => service.save(binding(start)), code('stale-project'));
    edit(service); const beforeLoad = service.snapshot(); const loaded = service.load(service.binding());
    assert.equal(loaded.snapshot.project.revision, 1); assert.notEqual(loaded.snapshot.sessionId, beforeLoad.sessionId);
    assert.deepEqual(loaded.snapshot.project, committed.snapshot.project); assert.equal(service.info().nextUndoTransactionId, null);
    assert.throws(() => service.save(binding(beforeLoad)), code('stale-project'));
    assert.throws(() => service.save({ ...service.binding(), path: '/tmp/attacker' }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('corrupt/missing/oversized/symlink snapshots and stale cross-instance writes fail explicitly without publication', () => {
  const root = directory(), path = join(root, 'project.json');
  try {
    const first = new ProjectSession(path), second = new ProjectSession(path);
    assert.throws(() => first.load(first.binding()), code('snapshot-missing'));
    edit(first); first.save(first.binding());
    assert.throws(() => second.save(second.binding()), code('stale-project'));
    second.load(second.binding()); second.save(second.binding());
    const snapshot = first.snapshot(), valid = readFileSync(path, 'utf8');
    const tampered = JSON.parse(valid); tampered.project.entities[1].center[0] += 1;
    writeFileSync(path, JSON.stringify(tampered)); assert.throws(() => first.load(first.binding()), code('snapshot-corrupt'));
    assert.deepEqual(first.snapshot(), snapshot, 'checksum mismatch does not publish');
    tampered.frameId = 'toronto3d-local-v1'; writeFileSync(path, JSON.stringify(tampered));
    assert.throws(() => first.load(first.binding()), code('snapshot-corrupt'));
    assert.deepEqual(first.snapshot(), snapshot, 'unmapped frame does not publish');
    writeFileSync(path, '{corrupt'); assert.throws(() => first.load(first.binding()), code('snapshot-corrupt'));
    assert.deepEqual(first.snapshot(), snapshot); assert.throws(() => new ProjectSession(path), code('snapshot-corrupt'));
    assert.throws(() => createDemoServer({ projectPath: path }), code('snapshot-corrupt'), 'production factory must not downgrade corrupt persistence to a demo');
    writeFileSync(path, ' '.repeat(PROJECT_LIMITS.snapshotBytes + 1)); assert.throws(() => new ProjectSession(path), code('snapshot-corrupt'));
    rmSync(path); symlinkSync(join(root, 'target'), path); assert.throws(() => first.save(first.binding()), code('snapshot-corrupt'));
    assert.deepEqual(first.snapshot(), snapshot);
    rmSync(path); writeFileSync(path + '.lock', 'operator lock'); assert.throws(() => first.save(first.binding()), code('storage-unavailable'));
    assert.deepEqual(first.snapshot(), snapshot);
    assert.throws(() => canonicalPersistentProject({ ...createDemoProject(), selectedEntityId: 'proposal-box' }));
    assert.throws(() => canonicalPersistentProject({ ...createDemoProject(), arbitrary: true }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('A/B context resolves exact original point indices and project IDs; selections never change geometry', () => {
  const root = directory();
  try {
    const s = new ProjectSession(join(root, 'project.json')), before = s.snapshot();
    const cloud = before.project.entities.find(e => e.kind === 'point-cloud')!; assert.equal(cloud.kind, 'point-cloud'); if (cloud.kind !== 'point-cloud') throw new Error('fixture');
    const call = { ...s.binding(), entityIds: ['proposal-box', cloud.id], points: [
      { name: 'A', entityId: cloud.id, pointIndex: 0, position: cloud.points[0] },
      { name: 'B', entityId: cloud.id, pointIndex: 440, position: cloud.points[440] },
    ] };
    const result = s.context(call); assert.equal(result.points[0].position, cloud.points[0]);
    assert.equal(result.units, 'm'); assert.equal(result.source, 'synthetic-project'); assert.deepEqual(result.coordinates, before.project.coordinates);
    assert.deepEqual(s.snapshot(), before);
    assert.throws(() => s.context({ ...call, entityIds: ['missing'] }), code('unknown-entity'));
    assert.throws(() => s.context({ ...call, points: [{ ...call.points[0], position: [-3, -3, 0] }] }), code('invalid-point'));
    assert.throws(() => s.context({ ...call, points: [{ ...call.points[0], pointIndex: 441 }] }), code('invalid-point'));
    assert.throws(() => s.context({ ...call, points: [{ ...call.points[0], entityId: 'proposal-box' }] }), code('unknown-entity'));
    assert.throws(() => s.context({ ...call, frameId: 'toronto3d-local-v1' }));
    assert.throws(() => s.context({ ...call, points: [{ ...call.points[0], datasetId: 'toronto3d', sourceRow: 0 }] }));
    assert.throws(() => canonicalSceneContextRequest({ ...call, points: [call.points[0], call.points[0]] }));
    edit(s); assert.throws(() => s.context(call), code('stale-project'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('project HTTP fail-closed local access, strict bodies, admission/rate bounds, corrupt load and live snapshot', async () => {
  const root = directory(), path = join(root, 'project.json'), server = createDemoServer({ projectPath: path }), base = await listen(server);
  const post = (route: string, body: unknown, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const info = (await (await fetch(base + '/project/session')).json()).result;
    const b = binding(info.snapshot);
    assert.equal((await post('/project/save', b, { Origin: 'https://evil.invalid' })).status, 403);
    const foreignHost = await new Promise<number | undefined>((resolve, reject) => { const req = httpRequest(base + '/project/save', { method: 'POST', headers: { Host: 'evil.invalid', 'Content-Type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(JSON.stringify(b)); });
    assert.equal(foreignHost, 403);
    assert.equal((await post('/project/save?path=/etc/passwd', b)).status, 400);
    assert.equal((await post('/project/save', { ...b, path: '/etc/passwd' })).status, 400);
    assert.equal((await post('/project/save', { ...b, extra: 'x'.repeat(PROJECT_LIMITS.requestBytes) })).status, 413);
    assert.equal((await fetch(base + '/project/save')).status, 400);
    assert.equal((await post('/project/context', { ...b, entityIds: [], points: [] })).status, 200);
    await new Promise<void>((resolve, reject) => {
      const slow = httpRequest(base + '/project/save', { method: 'POST', headers: { 'Content-Type': 'application/json' } }); slow.on('error', () => {}); slow.write('{');
      setTimeout(() => { void (async () => { try { assert.equal((await post('/project/save', b)).status, 429); assert.equal((await fetch(base + '/project')).status, 200); slow.destroy(); resolve(); } catch (error) { slow.destroy(); reject(error); } })(); }, 40);
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await post('/project/save', b)).status, 200);
    writeFileSync(path, '{corrupt'); const failed = await post('/project/load', b); assert.equal(failed.status, 422); assert.equal((await failed.json()).error.code, 'snapshot-corrupt');
    const after = await fetch(base + '/project'); assert.equal(after.headers.get('X-Spatial-Session'), b.sessionId); assert.deepEqual(await after.json(), info.snapshot.project);
    // Admission counts invalid but admitted requests as well; no unbounded resource allocation.
    let limited = false;
    for (let i = 0; i < PROJECT_LIMITS.requestsPerMinute; i++) if ((await post('/project/context', {})).status === 429) { limited = true; break; }
    assert.ok(limited);
  } finally { await close(server); rmSync(root, { recursive: true, force: true }); }
});

test('chat live binding recheck suppresses stale results after async preparation and execution', async () => {
  const root = directory(), s = new ProjectSession(join(root, 'project.json'));
  try {
    for (const stage of ['prepare', 'execute']) {
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>(r => enter = r), wait = new Promise<void>(r => release = r);
      const prepare: NonNullable<Parameters<typeof createChatRoutes>[3]> = (async () => {
        if (stage === 'prepare') { enter(); await wait; }
        return { binding: {}, createRuntime: () => ({ runId: 'runtime', configHash: 'a'.repeat(64), hash: () => 'b'.repeat(64), execute: async () => {
          enter(); await wait; return { outcome: { status: 'error', code: 'unavailable' } };
        } }) };
      }) as unknown as NonNullable<Parameters<typeof createChatRoutes>[3]>;
      const routes = createChatRoutes(() => s.snapshot(), s.snapshot().sessionId, '/trusted', prepare);
      const server = createServer(async (req, res) => { await routes(req, res); }), base = await listen(server);
      try {
        const b = s.binding(); const pending = fetch(base + '/chat/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: b.sessionId, projectRevision: b.projectRevision, generation: 1, requestId: 'request', command: 'metadata' }) });
        await entered; edit(s); release();
        const reply = await (await pending).json(); assert.equal(reply.state, 'rejected'); assert.equal(reply.code, 'stale-project'); assert.equal(reply.reply, undefined);
      } finally { release(); await close(server); }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
