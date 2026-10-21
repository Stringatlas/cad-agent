import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import type { NearestPoleRequest, NearestPoleToolOutcome, PointMoveProposal, PointOverrideSnapshot, Vec3 } from '@spatial/contracts';
import type { TorontoDraftPoint } from '../../apps/web/src/chat/draft-context';
import { PointOverrideController, effectivePosition, validateMoveProposal, validateOverrideSnapshot,
  verifiedNearestSelection, overrideTransport, type OverrideTransport, type PointEditView } from '../../apps/web/src/scenes/toronto/points/point-override-client';
import { canonicalPointMoveProposalRequest } from '@spatial/contracts';
const revision = 'a'.repeat(64), hash = 'b'.repeat(64);
const source: TorontoDraftPoint = { name: 'Point 1', datasetId: 'toronto3d', artifactRevision: revision, key: { sourceFileId: 1, sourceRow: 0 }, position: [1, 2, 3], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] };
const snapshot = (extra: Partial<PointOverrideSnapshot> = {}): PointOverrideSnapshot => ({ sessionId: 'session1', revision: 0, artifactRevision: revision, datasetId: 'toronto3d', frameId: 'toronto3d-local-v1', units: 'm', entries: [], nextUndoTransactionId: null, ...extra });
const proposal = (s: PointOverrideSnapshot, before: Vec3 = source.position, delta: Vec3 = [0, 0, 1]): PointMoveProposal => ({ sessionId: s.sessionId, revision: s.revision, artifactRevision: s.artifactRevision, datasetId: 'toronto3d', frameId: 'toronto3d-local-v1', units: 'm', proposalId: 'proposal1', moves: [{ key: source.key, originalPosition: source.position, before, after: before.map((n, i) => n + delta[i]) as unknown as Vec3 }] });
const moved = (p: PointMoveProposal): PointOverrideSnapshot => snapshot({ revision: p.revision + 1, entries: p.moves.filter(m => JSON.stringify(m.after) !== JSON.stringify(m.originalPosition)).map(m => ({ key: m.key, originalPosition: m.originalPosition, position: m.after })), nextUndoTransactionId: 'transaction1' });
function deferred() { let resolve!: (v: unknown) => void, reject!: (e: Error) => void; const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function nearest() {
  const request: NearestPoleRequest = { requestId: 'query1', datasetId: 'toronto3d', expectedArtifactRevision: revision, units: 'm', frameId: 'toronto3d-local-v1', input: { kind: 'point-ref', key: source.key }, filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: 6 }, metric: 'euclidean-3d', domain: { kind: 'whole-dataset' } };
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const stats = { scannedPoints: 2, matchingPoints: 1, hierarchyChunks: 1, payloadNodes: 1, hierarchyBytes: 22, payloadBytes: 56, metadataBytes: 100, maxReadBytes: 100, resolutionPoints: 2, resolutionPayloadBytes: 56, artifactRevision: revision, requestHash };
  const outcome: NearestPoleToolOutcome = { status: 'verified-found', complete: true, request, dataset: { id: 'toronto3d', revision, totalPoints: 2, bounds: { min: [0, 0, 0], max: [10, 10, 10] }, coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] } }, queryPosition: source.position, nearest: { key: { sourceFileId: 1, sourceRow: 1 }, position: [2, 2, 3], label: 6, distanceSquared: 1, distanceMeters: 1 }, search: { ...stats, algorithm: 'potree-semantic-full-scan-v1', arithmetic: 'xyz-binary64-v1', configHash: hash, traversalHash: hash, completion: 'exhausted' }, verification: { ...stats, verifier: 'linear-record-oracle-v1', transcriptHash: hash } };
  return { searchGeometry: 'original-prepared-dataset' as const, pointName: source.name, request, outcome };
}

test('strict override snapshots reject malformed, duplicate and wrong-frame authority', () => {
  assert.deepEqual(validateOverrideSnapshot(snapshot()), snapshot());
  const entry = { key: source.key, originalPosition: source.position, position: [2, 2, 3] };
  for (const v of [{ ...snapshot(), extra: true }, { ...snapshot(), frameId: 'project' }, { ...snapshot(), revision: -1 }, { ...snapshot(), artifactRevision: 'bad' }, { ...snapshot(), entries: [entry, entry] }, { ...snapshot(), entries: [{ ...entry, position: [NaN, 1, 2] }] }, { ...snapshot(), nextUndoTransactionId: 1 }]) assert.throws(() => validateOverrideSnapshot(v));
  const value = snapshot({ entries: [entry as unknown as PointOverrideSnapshot['entries'][number]] });
  const copy = validateOverrideSnapshot(value); (entry.position as number[])[0] = 99; assert.equal(copy.entries[0].position[0], 2);
});

test('verified original result admission retains full lineage and rejects stale references/hash/none', async () => {
  const context = nearest(), result = await verifiedNearestSelection(context, [source]);
  assert.deepEqual(result.point.position, [2, 2, 3]); assert.deepEqual(result.evidence, context); assert.deepEqual(result.point.evidence, context);
  assert.equal(result.point.key.sourceRow, 1); assert.equal(result.point.frameId, 'toronto3d-local-v1');
  await assert.rejects(verifiedNearestSelection(context, []));
  await assert.rejects(verifiedNearestSelection(context, [{ ...source, artifactRevision: 'c'.repeat(64) }]));
  await assert.rejects(verifiedNearestSelection(context, [{ ...source, position: [2, 2, 3] }]));
  await assert.rejects(verifiedNearestSelection({ ...context, searchGeometry: 'effective-overrides' }, [source]));
  const forged = nearest(); if (forged.outcome.status === 'verified-found') {
    const outcome = { ...forged.outcome, search: { ...forged.outcome.search, requestHash: hash }, verification: { ...forged.outcome.verification, requestHash: hash } };
    await assert.rejects(verifiedNearestSelection({ ...forged, outcome }, [source]), /hash mismatch/);
  }
  await assert.rejects(verifiedNearestSelection({ ...context, outcome: { status: 'incomplete', complete: false, reason: 'transport' } }, [source]));
  if (context.outcome.status === 'verified-found') (context.outcome.nearest!.position as unknown as number[])[0] = 88;
  assert.deepEqual(result.point.evidence?.outcome, result.evidence.outcome); assert.equal((result.evidence.outcome as unknown as { nearest: { position: number[] } }).nearest.position[0], 2);
});

test('proposal validation requires exact selected keys, original/before/after and current effective position', () => {
  const s = snapshot(), p = proposal(s), request = canonicalPointMoveProposalRequest({ sessionId: s.sessionId, revision: s.revision, artifactRevision: revision, points: [{ key: source.key, position: source.position }], translation: [0, 0, 1] });
  assert.deepEqual(validateMoveProposal(p, request, s, [source]), p);
  for (const value of [{ ...p, sessionId: 'stale' }, { ...p, moves: [] }, { ...p, moves: [{ ...p.moves[0], after: [2, 2, 4] }] }, { ...p, moves: [{ ...p.moves[0], originalPosition: [1, 2, 0] }] }]) assert.throws(() => validateMoveProposal(value, request, s, [source]));
  const committed = moved(p); assert.deepEqual(effectivePosition(source, committed), [1, 2, 4]);
  assert.throws(() => effectivePosition({ ...source, position: [0, 0, 0] }, committed));
});

test('preview is nonmutating; exact id-only approval, repeated moves and latest undo use effective coordinates', async () => {
  let s = snapshot(), retained: PointMoveProposal | undefined;
  const calls: { action: string; body: unknown }[] = [], states: PointEditView[] = [];
  const transport: OverrideTransport = async (action, body) => {
    calls.push({ action, body });
    if (action === 'refresh') return s;
    if (action === 'propose') {
      const r = canonicalPointMoveProposalRequest(body); retained = proposal(s, r.points[0].position, r.translation); return retained;
    }
    if (action === 'approve') { s = moved(retained!); return s; }
    s = snapshot({ revision: s.revision + 1 }); return s;
  };
  const c = new PointOverrideController(v => states.push(v), transport); c.bind([source], revision); await c.refresh();
  await c.propose([source.name], [0, 0, 1]); assert.equal(states.at(-1)?.snapshot?.revision, 0); assert.ok(states.at(-1)?.proposal);
  await c.approve(); assert.deepEqual(calls.at(-1), { action: 'approve', body: { sessionId: 'session1', revision: 0, proposalId: 'proposal1' } });
  assert.equal(states.at(-1)?.snapshot?.revision, 1); assert.equal(states.at(-1)?.needsRefresh, false);
  await c.propose([source.name], [0, 0, 1]);
  const request = calls.at(-1)!.body as { points: { position: Vec3 }[] }; assert.deepEqual(request.points[0].position, [1, 2, 4]);
  c.cancel(); assert.equal(states.at(-1)?.proposal, undefined); const count = calls.length; await c.approve(); assert.equal(calls.length, count);
  await c.undo(); assert.deepEqual(calls.at(-1), { action: 'undo', body: { sessionId: 'session1', revision: 1, transactionId: 'transaction1' } }); assert.deepEqual(states.at(-1)?.snapshot?.entries, []);
});

test('busy, failed, malformed and ambiguous operations block writes until explicit valid Refresh; no retries', async () => {
  const states: PointEditView[] = []; let count = 0, mode: 'valid' | 'fail' | 'malformed' = 'valid';
  const c = new PointOverrideController(v => states.push(v), async action => { count++; if (mode === 'fail') throw new Error('busy'); if (mode === 'malformed') return { ok: true }; return action === 'propose' ? proposal(snapshot()) : snapshot(); });
  c.bind([source], revision); await c.refresh(); mode = 'fail'; await c.propose([source.name], [0, 0, 1]);
  assert.equal(states.at(-1)?.needsRefresh, true); const failed = count; await c.propose([source.name], [0, 0, 1]); await c.approve(); await c.undo(); assert.equal(count, failed);
  mode = 'malformed'; await c.refresh(); assert.equal(states.at(-1)?.needsRefresh, true);
  mode = 'valid'; await c.refresh(); assert.equal(states.at(-1)?.needsRefresh, false);
  await c.propose([source.name], [0, 0, 1]); mode = 'fail'; await c.approve(); assert.equal(states.at(-1)?.proposal, undefined); assert.equal(states.at(-1)?.needsRefresh, true);
});

test('selection/artifact changes suppress late proposals and ambiguous approval; disposal cannot publish', async () => {
  const states: PointEditView[] = [], pending = deferred(); let delayed = false;
  const c = new PointOverrideController(v => states.push(v), async action => action === 'refresh' ? snapshot() : delayed ? pending.promise : proposal(snapshot()));
  c.bind([source], revision); await c.refresh(); delayed = true;
  const work = c.propose([source.name], [0, 0, 1]); assert.equal(states.at(-1)?.busy, true);
  c.bind([], revision); pending.resolve(proposal(snapshot())); await work;
  assert.equal(states.at(-1)?.proposal, undefined); assert.equal(states.at(-1)?.needsRefresh, true);
  await c.refresh(); c.bind([source], 'c'.repeat(64)); assert.equal(states.at(-1)?.snapshot, undefined); assert.equal(states.at(-1)?.needsRefresh, true);
  const late = deferred(), other: PointEditView[] = [];
  const d = new PointOverrideController(v => other.push(v), async () => late.promise); const loading = d.refresh(); d.dispose(); const length = other.length; late.resolve(snapshot()); await loading; assert.equal(other.length, length);
});

test('changing references during approval fails closed even if server later committed; Refresh recovers', async () => {
  const pending = deferred(), states: PointEditView[] = []; let committed = false;
  const c = new PointOverrideController(v => states.push(v), async action => action === 'refresh' ? committed ? moved(proposal(snapshot())) : snapshot() : action === 'propose' ? proposal(snapshot()) : pending.promise);
  c.bind([source], revision); await c.refresh(); await c.propose([source.name], [0, 0, 1]); const approval = c.approve(); c.bind([], revision);
  committed = true; pending.resolve(moved(proposal(snapshot()))); await approval;
  assert.equal(states.at(-1)?.snapshot?.revision, 0); assert.equal(states.at(-1)?.needsRefresh, true); assert.equal(states.at(-1)?.proposal, undefined);
  await c.refresh(); assert.equal(states.at(-1)?.snapshot?.revision, 1); assert.equal(states.at(-1)?.needsRefresh, false);
});

test('wrong mutation revision and changed unrelated entries never become authoritative client state', async () => {
  for (const bad of [moved(proposal(snapshot({ revision: 3 }))), { ...moved(proposal(snapshot())), entries: [] }]) {
    const states: PointEditView[] = []; const c = new PointOverrideController(v => states.push(v), async action => action === 'refresh' ? snapshot() : action === 'propose' ? proposal(snapshot()) : bad);
    c.bind([source], revision); await c.refresh(); await c.propose([source.name], [0, 0, 1]); await c.approve();
    assert.equal(states.at(-1)?.needsRefresh, true); assert.equal(states.at(-1)?.snapshot?.revision, 0);
  }
});

test('translation back to original removes override entry and remains a valid exact approval', async () => {
  const first = moved(proposal(snapshot())), p = proposal(first, [1, 2, 4], [0, 0, -1]), states: PointEditView[] = [];
  const c = new PointOverrideController(v => states.push(v), async action => action === 'refresh' ? first : action === 'propose' ? p : moved(p));
  c.bind([source], revision); await c.refresh(); await c.propose([source.name], [0, 0, -1]); await c.approve();
  assert.equal(states.at(-1)?.needsRefresh, false); assert.deepEqual(states.at(-1)?.snapshot?.entries, []);
});


test('multi-reference preview validates every selected move and blocks parallel approval attempts', async () => {
  const second: TorontoDraftPoint = { ...source, name: 'Point 2', key: { sourceFileId: 2, sourceRow: 7 }, position: [7, 8, 9] };
  const pending = deferred(), states: PointEditView[] = []; let approvals = 0;
  const p: PointMoveProposal = { ...proposal(snapshot()), moves: [...proposal(snapshot()).moves, { key: second.key, originalPosition: second.position, before: second.position, after: [7, 8, 10] }] };
  const c = new PointOverrideController(v => states.push(v), async (action, body) => {
    if (action === 'refresh') return snapshot();
    if (action === 'propose') { assert.equal(canonicalPointMoveProposalRequest(body).points.length, 2); return p; }
    approvals++; return pending.promise;
  });
  c.bind([source, second], revision); await c.refresh(); await c.propose([source.name, second.name], [0, 0, 1]);
  assert.equal(states.at(-1)?.proposal?.moves.length, 2);
  const a = c.approve(); await c.approve(); await c.propose([source.name], [0, 0, 1]); assert.equal(approvals, 1);
  pending.resolve(moved(p)); await a; assert.equal(states.at(-1)?.snapshot?.entries.length, 2); assert.equal(states.at(-1)?.needsRefresh, false);
});

test('transport uses only fixed routes and id-only JSON mutations; mutation errors are never automatically retried', async () => {
  const original = globalThis.fetch, calls: { url: string; options?: RequestInit }[] = [];
  let error = false;
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return new Response(JSON.stringify(error ? { ok: false, error: { code: 'busy', message: 'busy' } } : { ok: true, result: snapshot() }), { status: error ? 429 : 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    assert.deepEqual(await overrideTransport('refresh'), snapshot());
    assert.equal(calls[0].url, '/datasets/toronto3d/overrides'); assert.equal(calls[0].options?.method, 'GET'); assert.equal(calls[0].options?.body, undefined);
    const body = { sessionId: 'session1', revision: 0, proposalId: 'proposal1' };
    await overrideTransport('approve', body); assert.equal(calls[1].url, '/datasets/toronto3d/overrides/approve'); assert.deepEqual(JSON.parse(calls[1].options?.body as string), body);
    error = true; await assert.rejects(overrideTransport('approve', body), /busy/); assert.equal(calls.length, 3);
  } finally { globalThis.fetch = original; }
});
