import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TORONTO_SEMANTIC_LABELS, type PointOverrideSnapshot, type PointMoveProposal, type TorontoCadSnapshot, type TorontoCadProposal } from '@spatial/contracts';
import { PointOverrideSession } from '../../apps/server/src/scene/point-overrides';
import { TorontoCadSession } from '../../apps/server/src/cad/toronto-cad-session';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'spatial-decision-receipts-'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 1, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [0, 0, 0], max: [20, 20, 20] }, scale: [0.001, 0.001, 0.001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [0, 0, 0], max: [20, 20, 20] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 },
    ] };
  const payload = Buffer.alloc(28); payload.writeInt32LE(1000, 0); payload.writeUInt16LE(1, 18); payload.writeFloatLE(6, 24);
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(1, 2); hierarchy.writeBigUInt64LE(28n, 14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale,
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS,
    sources: [1, 2, 3, 4].map(file => ({ source_file_id: file, file: `L00${file}.ply`, points: file === 1 ? 1 : 0 })) };
  await mkdir(join(root, 'octree')); await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata));
  await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  return { root, clean: () => rm(root, { recursive: true, force: true }) };
}

test('point receipts distinguish approval, decline, failure and invalidation; bounded and cleared at close/replacement', async () => {
  const f = await fixture(), points = new PointOverrideSession(f.root);
  try {
    let state = await points.execute('snapshot') as PointOverrideSnapshot;
    const propose = async () => await points.execute('propose', { sessionId: state.sessionId, revision: state.revision, artifactRevision: state.artifactRevision,
      points: [{ key: { sourceFileId: 1, sourceRow: 0 }, position: [1, 0, 0] }], translation: [0, 1, 0] }) as PointMoveProposal;
    const request = (proposalId: string) => ({ sessionId: state.sessionId, revision: state.revision, proposalId });
    const p = await propose(), peer = await propose();
    assert.equal(points.proposalDecision(p.proposalId), undefined);
    await assert.rejects(points.execute('approve', { ...request(p.proposalId), revision: 99 }));
    await assert.rejects(points.execute('decline', { ...request(p.proposalId), sessionId: 'wrong' }));
    assert.equal(points.proposalDecision(p.proposalId), undefined);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(points.execute('approve', request(p.proposalId), cancelled.signal));
    assert.equal(points.proposalDecision(p.proposalId), undefined);
    state = await points.execute('approve', request(p.proposalId)) as PointOverrideSnapshot;
    assert.equal(points.proposalDecision(p.proposalId), 'accepted');
    assert.equal(points.proposalDecision(peer.proposalId), undefined);
    await assert.rejects(points.execute('decline', request(p.proposalId)));
    assert.equal(points.proposalDecision(p.proposalId), 'accepted');
    state = await points.execute('undo', { sessionId: state.sessionId, revision: state.revision, transactionId: state.nextUndoTransactionId }) as PointOverrideSnapshot;
    assert.equal(points.proposalDecision(p.proposalId), 'accepted');
    const ids: string[] = [];
    for (let i = 0; i < 257; i++) {
      const pending = await propose(); ids.push(pending.proposalId);
      await points.execute('decline', request(pending.proposalId));
    }
    assert.equal(points.proposalDecision(ids[0]), undefined);
    for (const id of ids.slice(1)) assert.equal(points.proposalDecision(id), 'declined');
    await points.close();
    for (const id of ids) assert.equal(points.proposalDecision(id), undefined);
    const replacement = new PointOverrideSession(f.root);
    try { assert.equal(replacement.proposalDecision(ids.at(-1)!), undefined); }
    finally { await replacement.close(); }
  } finally { await points.close(); await f.clean(); }
});

test('native CAD receipts follow successful publication/deletion only, remain historical after Undo, and clear at close', async () => {
  const f = await fixture(), cad = new TorontoCadSession(f.root);
  try {
    let state = await cad.execute('snapshot') as TorontoCadSnapshot;
    const binding = () => ({ sessionId: state.sessionId, revision: state.revision, artifactRevision: state.artifactRevision });
    const propose = async (check?: () => Promise<void>) => await cad.execute('propose', { ...binding(), operation: { kind: 'box', center: [2, 3, 4], dimensions: [1, 2, 3] } }, undefined, check) as TorontoCadProposal;
    let rejectApproval = true;
    const p = await propose(async () => { if (rejectApproval) throw new Error('application-precondition'); });
    assert.equal(cad.proposalDecision(p.proposalId), undefined);
    await assert.rejects(cad.execute('approve', { ...binding(), proposalId: p.proposalId, revision: 99 }));
    assert.equal(cad.proposalDecision(p.proposalId), undefined);
    // Typed authority rejection preserves native session availability and never records acceptance.
    const { TorontoCadError } = await import('../../apps/server/src/cad/toronto-cad-session');
    const guarded = await propose(async () => { throw new TorontoCadError('stale-revision'); });
    await assert.rejects(cad.execute('approve', { ...binding(), proposalId: guarded.proposalId }));
    assert.equal(cad.proposalDecision(guarded.proposalId), undefined);
    await cad.execute('decline', { ...binding(), proposalId: guarded.proposalId });
    assert.equal(cad.proposalDecision(guarded.proposalId), 'declined');
    rejectApproval = false;
    const peer = await propose();
    state = await cad.execute('approve', { ...binding(), proposalId: p.proposalId }) as TorontoCadSnapshot;
    assert.equal(cad.proposalDecision(p.proposalId), 'accepted');
    assert.equal(cad.proposalDecision(peer.proposalId), undefined);
    await assert.rejects(cad.execute('decline', { ...binding(), proposalId: p.proposalId }));
    assert.equal(cad.proposalDecision(p.proposalId), 'accepted');
    state = await cad.execute('undo', { ...binding(), transactionId: state.nextUndoTransactionId }) as TorontoCadSnapshot;
    assert.equal(cad.proposalDecision(p.proposalId), 'accepted');
    const ids: string[] = [];
    for (let i = 0; i < 257; i++) {
      const pending = await propose(); ids.push(pending.proposalId);
      await cad.execute('decline', { ...binding(), proposalId: pending.proposalId });
    }
    assert.equal(cad.proposalDecision(ids[0]), undefined);
    for (const id of ids.slice(1)) assert.equal(cad.proposalDecision(id), 'declined');
    await cad.close();
    for (const id of ids) assert.equal(cad.proposalDecision(id), undefined);
    const replacement = new TorontoCadSession(f.root);
    try { assert.equal(replacement.proposalDecision(ids.at(-1)!), undefined); }
    finally { await replacement.close(); }
  } finally { await cad.close(); await f.clean(); }
});
