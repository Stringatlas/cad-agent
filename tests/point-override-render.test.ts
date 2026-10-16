import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { DatasetInfo, PointMoveProposal, PointOverrideSnapshot } from '@spatial/contracts';
import { createPointOverrideRender } from '../apps/web/src/point-override-render';
import { createDetailPickCache } from '../apps/web/src/pole-picking';

const revision = 'a'.repeat(64);
const dataset: DatasetInfo = { id: 'toronto3d', revision, totalPoints: 2,
  coordinates: { units: 'm', upAxis: 'Z', handedness: 'right', localOrigin: [627285, 4841948, 0] },
  bounds: { min: [0, 0, 0], max: [100, 100, 100] } };
const original = [1.123456789123, 2, 3] as const;
const entry = { key: { sourceFileId: 1, sourceRow: 4294967295 }, originalPosition: original, position: [20, 30, 40] as const };
const snapshot: PointOverrideSnapshot = { datasetId: 'toronto3d', frameId: 'toronto3d-local-v1', units: 'm', artifactRevision: revision,
  sessionId: 'session', revision: 1, entries: [entry], nextUndoTransactionId: 'undo' };
const proposal: PointMoveProposal = { ...snapshot, proposalId: 'proposal', moves: [{ key: entry.key, originalPosition: original, before: entry.position, after: [25, 35, 45] }] };
function cloud(positions: readonly number[] = original) {
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial());
}
const positions = (object: THREE.Points | THREE.LineSegments) => Array.from(object.geometry.getAttribute('position').array);
const ids = [1, 4294967295];

test('record overrides move every displayed occurrence, recompute bounds, replace and undo exact GPU originals', () => {
  const render = createPointOverrideRender(new THREE.Scene()), overview = cloud([...original, 7, 8, 9]), detail = cloud();
  render.setArtifactRevision(revision); render.register(overview, [...ids, 2, 5]); render.register(detail, ids);
  const originals = positions(overview);
  render.setPointOverrides(snapshot);
  assert.deepEqual(positions(overview), [20, 30, 40, 7, 8, 9]); assert.deepEqual(positions(detail), [20, 30, 40]);
  assert.equal(render.fallback.geometry.getAttribute('position').count, 0); assert.equal(render.captureBlocked, true);
  assert.equal(detail.geometry.boundingBox?.max.x, 20); assert.ok(detail.geometry.boundingSphere);
  render.setPointOverrides({ ...snapshot, revision: 2, entries: [{ ...entry, position: [-5, -6, -7] }] });
  assert.deepEqual(positions(detail), [-5, -6, -7]);
  render.setPointOverrides({ ...snapshot, revision: 3, entries: [] });
  assert.deepEqual(positions(overview), originals); assert.deepEqual(positions(detail), originals.slice(0, 3));
  assert.equal(render.captureBlocked, false); render.dispose();
});

test('missing record is a real Points object; loading/unloading overview/detail avoids extra fallback duplicates', () => {
  const scene = new THREE.Scene(), render = createPointOverrideRender(scene), overview = cloud(), detail = cloud();
  render.setArtifactRevision(revision); render.setPointOverrides(snapshot);
  assert.ok(render.fallback instanceof THREE.Points); assert.ok(scene.children.includes(render.fallback));
  assert.deepEqual(positions(render.fallback), [20, 30, 40]);
  assert.deepEqual(render.resolveFallback(0), { datasetId: 'toronto3d', artifactRevision: revision, key: entry.key, position: original });
  render.register(overview, ids); assert.equal(render.fallback.visible, false); assert.deepEqual(positions(overview), [20, 30, 40]);
  render.register(detail, ids); render.unregister(overview); assert.equal(render.fallback.visible, false);
  render.unregister(detail); assert.deepEqual(positions(render.fallback), [20, 30, 40]);
  const replacement = cloud(); render.register(replacement, ids); assert.deepEqual(positions(replacement), [20, 30, 40]);
  render.setPointOverrides(); assert.deepEqual(positions(replacement), original.map(Math.fround)); render.dispose();
});

test('moving GPU coordinates never changes binary64 source pick cache, including a raycast at moved position', () => {
  const render = createPointOverrideRender(new THREE.Scene()), object = cloud();
  const source = createDetailPickCache(dataset, original, ids);
  render.setArtifactRevision(revision); render.register(object, ids); render.setPointOverrides(snapshot);
  object.updateMatrixWorld();
  const ray = new THREE.Raycaster(new THREE.Vector3(20, 30, 50), new THREE.Vector3(0, 0, -1)); ray.params.Points.threshold = .1;
  const hit = ray.intersectObject(object)[0]; assert.equal(hit.index, 0);
  assert.deepEqual(source.resolve(hit.index!)?.position, original);
  assert.deepEqual(source.resolve(hit.index!)?.key, entry.key); source.dispose(); render.dispose();
});

test('preview is separate amber ghost/line, not committed geometry; stale session/revision previews are ignored', () => {
  const scene = new THREE.Scene(), render = createPointOverrideRender(scene), object = cloud();
  render.setArtifactRevision(revision); render.register(object, ids); assert.equal(render.captureBlocked, false);
  render.setPointMovePreview(proposal); assert.equal(render.captureBlocked, true);
  assert.deepEqual(positions(object), original.map(Math.fround));
  const lines = scene.children.find(child => child instanceof THREE.LineSegments) as THREE.LineSegments;
  assert.deepEqual(positions(lines), [20, 30, 40, 25, 35, 45]);
  render.setPointOverrides(snapshot); assert.deepEqual(positions(object), [20, 30, 40]);
  render.setPointOverrides({ ...snapshot, revision: 2, entries: [] }); assert.equal(lines.visible, false); assert.equal(render.captureBlocked, false);
  render.setPointMovePreview({ ...proposal, revision: 2, sessionId: 'other' }); assert.equal(lines.visible, false);
  render.setPointMovePreview(); render.dispose();
});

test('artifact replacement clears edits/preview and rejects late mismatched snapshots/proposals', () => {
  const render = createPointOverrideRender(new THREE.Scene()), object = cloud();
  render.setArtifactRevision(revision); render.register(object, ids); render.setPointOverrides(snapshot); render.setPointMovePreview(proposal);
  render.setArtifactRevision('b'.repeat(64)); assert.deepEqual(positions(object), original.map(Math.fround)); assert.equal(render.captureBlocked, false);
  render.setPointOverrides(snapshot); render.setPointMovePreview(proposal); assert.equal(render.captureBlocked, false);
  render.setArtifactRevision(revision); assert.equal(render.captureBlocked, false); render.dispose();
});

test('snapshots are detached; pre-dataset overrides apply on load; all helper GPU resources dispose', () => {
  const scene = new THREE.Scene(), render = createPointOverrideRender(scene);
  const mutable = structuredClone(snapshot);
  render.setPointOverrides(mutable); (mutable.entries[0].position as unknown as number[])[0] = 999;
  render.setArtifactRevision(revision); assert.deepEqual(positions(render.fallback), [20, 30, 40]);
  const resources = scene.children as (THREE.Points | THREE.LineSegments)[];
  let geometries = 0, materials = 0;
  for (const resource of [...resources]) { resource.geometry.addEventListener('dispose', () => geometries++); (resource.material as THREE.Material).addEventListener('dispose', () => materials++); }
  render.dispose(); assert.equal(scene.children.length, 0); assert.equal(geometries, 3); assert.equal(materials, 3);
});
