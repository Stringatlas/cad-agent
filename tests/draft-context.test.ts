import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatasetInfo, PointObservation } from '@spatial/contracts';
import { createDraftPointGate, replaceDraftPoint, localDraftFeedback } from '../apps/web/src/draft-context';
import { createPolePickCache, createDetailPickCache, isPoleClick, poleGestureKind, type PoleSelection } from '../apps/web/src/pole-picking';

const revision = 'a'.repeat(64), nextRevision = 'b'.repeat(64);
const dataset: DatasetInfo = {
  id: 'toronto3d', revision, totalPoints: 2,
  coordinates: { units: 'm', upAxis: 'Z', handedness: 'right', localOrigin: [627285, 4841948, 0] },
  bounds: { min: [-20, -20, 100], max: [20, 20, 140] },
};
const position = [0.123456789123, -0.987654321987, 120.000000001] as const;
const source: PoleSelection = { datasetId: 'toronto3d', artifactRevision: revision, key: { sourceFileId: 4, sourceRow: 0xffffffff }, position };

test('Toronto local draft overview and detail attachments retain original binary64/key/revision/frame', () => {
  const sample: PointObservation = { dataset, count: 1, positions: [...position], colors: [255, 80, 12], labels: [1], sourceIds: [4, 0xffffffff],
    purpose: 'display', lod: { budget: 1, depth: 0 }, algorithm: 'potree-bfs-even-v1', candidatePoints: 2, bytesRead: 0, nodes: ['r'], sampleHash: '0'.repeat(64) };
  const overview = createPolePickCache(sample), detail = createDetailPickCache(dataset, [...position], [4, 0xffffffff]);
  const gate = createDraftPointGate(); gate.bind(revision);
  for (const [cache, name] of [[overview, 'A'], [detail, 'B']] as const) {
    const point = gate.accept(cache.resolve(0)!, name)!;
    assert.deepEqual(point.position, position); assert.notEqual(point.position[0], Math.fround(position[0]));
    assert.deepEqual(point.key, source.key); assert.equal(point.artifactRevision, revision);
    assert.equal(point.name, name); assert.equal(point.datasetId, 'toronto3d'); assert.equal(point.frameId, 'toronto3d-local-v1');
    assert.equal(point.units, 'm'); assert.equal(point.upAxis, 'Z'); assert.equal(point.handedness, 'right'); assert.deepEqual(point.localOrigin, [627285, 4841948, 0]);
    assert.ok(!('sessionId' in point) && !('projectRevision' in point) && !('entityId' in point), 'No synthetic authority or mapping is invented');
    cache.dispose(); assert.equal(cache.resolve(0), undefined);
  }
  gate.dispose();
});

test('draft point gate rejects unbound/stale/disposed/source-switched picks and detaches original values', () => {
  const gate = createDraftPointGate(); assert.equal(gate.accept(source, 'A'), undefined);
  assert.equal(gate.bind(revision), false); assert.equal(gate.bind(revision), false);
  const mutable = { ...source, key: { ...source.key }, position: [...position] as [number, number, number] };
  const point = gate.accept(mutable, 'A')!;
  mutable.key.sourceRow = 10; mutable.position[0] = 99;
  assert.deepEqual(point.key, source.key); assert.deepEqual(point.position, position);
  assert.equal(gate.bind(nextRevision), true); assert.equal(gate.accept(source, 'B'), undefined);
  assert.equal(gate.accept({ ...source, artifactRevision: nextRevision }, 'B')?.artifactRevision, nextRevision);
  gate.dispose(); gate.bind(revision); assert.equal(gate.accept(source, 'A'), undefined);
  const switched = createDraftPointGate(); assert.equal(switched.accept(source, 'A'), undefined); switched.dispose();
});

test('named attachments replace deliberately, remain ordered and cannot mix artifact revisions', () => {
  const gate = createDraftPointGate(); gate.bind(revision);
  const a = gate.accept(source, 'A')!, b = gate.accept({ ...source, key: { sourceFileId: 1, sourceRow: 2 } }, 'B')!;
  const both = replaceDraftPoint(replaceDraftPoint([], b), a);
  assert.deepEqual(both.map(point => point.name), ['A', 'B']);
  const replacement = gate.accept({ ...source, key: { sourceFileId: 3, sourceRow: 7 } }, 'A')!;
  const replaced = replaceDraftPoint(both, replacement);
  assert.equal(replaced.length, 2); assert.equal(replaced[0].key.sourceRow, 7); assert.equal(both[0].key.sourceRow, 0xffffffff);
  const clearedA = replaced.filter(point => point.name !== 'A'); assert.deepEqual(clearedA.map(point => point.name), ['B']);
  gate.bind(nextRevision); const newPoint = gate.accept({ ...source, artifactRevision: nextRevision }, 'A')!;
  assert.deepEqual(replaceDraftPoint(both, newPoint), [newPoint]); gate.dispose();
});

test('local send honestly acknowledges unavailable model without network or draft/context mutation', () => {
  const gate = createDraftPointGate(); gate.bind(revision);
  const points = [gate.accept(source, 'A')!], draft = 'Build a channel from point A to point B';
  const before = JSON.stringify(points), originalFetch = globalThis.fetch;
  let requests = 0; globalThis.fetch = (() => { requests++; throw new Error('Local draft must not fetch'); }) as typeof fetch;
  try {
    const status = localDraftFeedback(draft, points);
    assert.match(status, /Not connected/); assert.match(status, /no AI\/model or edit request was sent/); assert.match(status, /remain here/);
    assert.equal(draft, 'Build a channel from point A to point B'); assert.equal(JSON.stringify(points), before); assert.equal(requests, 0);
    assert.match(localDraftFeedback('  ', points), /Write a request first/); assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; gate.dispose(); }
});

test('pin gesture admission leaves orbit/window behavior separate and rejects drag/cancel/LOD races', () => {
  const plain = { button: 0, shiftKey: false, metaKey: false, ctrlKey: false };
  assert.equal(poleGestureKind(plain, true), undefined);
  for (const modifier of ['metaKey', 'ctrlKey'] as const) {
    assert.equal(poleGestureKind({ ...plain, [modifier]: true }, true), 'query');
    assert.equal(poleGestureKind({ ...plain, [modifier]: true, shiftKey: true }, true), 'shift');
  }
  assert.equal(isPoleClick(0, false, true), true); assert.equal(isPoleClick(12, false, true), false);
  assert.equal(isPoleClick(0, true, true), false); assert.equal(isPoleClick(0, false, false), false);
});
