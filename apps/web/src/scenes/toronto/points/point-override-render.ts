import * as THREE from 'three';
import type { PointKey, PointMoveProposal, PointOverrideSnapshot, Vec3 } from '@spatial/contracts';
import type { PoleSelection } from '../inspection/pole-picking';

// Four uint32 source-row domains fit exactly within binary64's safe integer range.
const keyId = (key: PointKey) => key.sourceFileId * 0x100000000 + key.sourceRow;

/** Disposable projection only: original records and committed overrides remain external authority. */
export function createPointOverrideRender(scene: THREE.Scene) {
  // Keep provenance compact for uncapped detail; never allocate a Map/array per source point.
  const layers = new Map<THREE.Points, { sourceIds: Uint32Array; indexes: Map<number, number[]>; keySignature: string; originals: Map<number, Vec3> }>();
  let artifactRevision: string | undefined;
  let snapshot: PointOverrideSnapshot | undefined;
  let proposals: readonly PointMoveProposal[] = [];
  let fallbackEntries: PointOverrideSnapshot['entries'] = [];
  const fallback = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false }));
  const ghost = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffb84d, size: 10, sizeAttenuation: false, transparent: true, opacity: .65, depthWrite: false }));
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffb84d, transparent: true, opacity: .8, depthWrite: false }));
  scene.add(fallback, ghost, lines);
  fallback.visible = ghost.visible = lines.visible = false;
  function replaceGeometry(object: THREE.Points | THREE.LineSegments, positions: readonly number[]) {
    const previous = object.geometry;
    object.geometry = new THREE.BufferGeometry();
    object.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere();
    object.visible = positions.length > 0;
    previous.dispose();
  }
  function refresh() {
    const entries = snapshot && snapshot.artifactRevision === artifactRevision ? snapshot.entries : [];
    const overrides = new Map(entries.map(entry => [keyId(entry.key), entry]));
    const keySignature = [...overrides.keys()].join(',');
    const loaded = new Set<number>();
    for (const [object, layer] of layers) {
      const attribute = object.geometry.getAttribute('position') as THREE.BufferAttribute;
      let changed = layer.originals.size > 0;
      for (const [index, original] of layer.originals) attribute.setXYZ(index, ...original);
      layer.originals.clear();
      if (layer.keySignature !== keySignature) {
        layer.indexes.clear(); layer.keySignature = keySignature;
        if (overrides.size) for (let index = 0; index < attribute.count; index++) {
          const id = layer.sourceIds[index * 2] * 0x100000000 + layer.sourceIds[index * 2 + 1];
          if (!overrides.has(id)) continue;
          const list = layer.indexes.get(id) ?? []; list.push(index); layer.indexes.set(id, list);
        }
      }
      for (const [id, entry] of overrides) {
        const indexes = layer.indexes.get(id);
        if (!indexes) continue;
        loaded.add(id);
        for (const index of indexes) {
          layer.originals.set(index, [attribute.getX(index), attribute.getY(index), attribute.getZ(index)]);
          attribute.setXYZ(index, ...entry.position); changed = true;
        }
      }
      if (changed) { attribute.needsUpdate = true; object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere(); }
    }
    fallbackEntries = entries.filter(entry => !loaded.has(keyId(entry.key)));
    replaceGeometry(fallback, fallbackEntries.flatMap(entry => [...entry.position]));
    const moves = proposals.filter(proposal => proposal.artifactRevision === artifactRevision && (!snapshot || (proposal.sessionId === snapshot.sessionId && proposal.revision === snapshot.revision))).flatMap(proposal => proposal.moves);
    replaceGeometry(ghost, moves.flatMap(move => [...move.after]));
    replaceGeometry(lines, moves.flatMap(move => [...move.before, ...move.after]));
  }
  return {
    fallback,
    get captureBlocked() { return fallbackEntries.length > 0 || [...layers.values()].some(layer => layer.originals.size > 0) || ghost.visible; },
    setArtifactRevision(revision: string) {
      artifactRevision = revision;
      if (snapshot && snapshot.artifactRevision !== revision) snapshot = undefined;
      proposals = proposals.filter(proposal => proposal.artifactRevision === revision);
      refresh();
    },
    register(object: THREE.Points, sourceIds: ArrayLike<number>) {
      const attribute = object.geometry.getAttribute('position');
      if (sourceIds.length !== attribute.count * 2) throw new Error('Missing override render provenance');
      layers.set(object, { sourceIds: Uint32Array.from(sourceIds), indexes: new Map(), keySignature: '', originals: new Map() }); refresh();
    },
    unregister(object: THREE.Points) { layers.delete(object); refresh(); },
    setPointOverrides(value?: PointOverrideSnapshot) {
      snapshot = value && (!artifactRevision || value.artifactRevision === artifactRevision) ? structuredClone(value) : undefined;
      refresh();
    },
    setPointMovePreview(value?: PointMoveProposal | readonly PointMoveProposal[]) {
      const values = value ? (Array.isArray(value) ? value : [value]) as readonly PointMoveProposal[] : [];
      proposals = structuredClone(values.filter(proposal => !artifactRevision || proposal.artifactRevision === artifactRevision));
      refresh();
    },
    resolveFallback(index: number): PoleSelection | undefined {
      const entry = fallbackEntries[index];
      if (!entry || !artifactRevision) return;
      return { datasetId: 'toronto3d', artifactRevision, key: { ...entry.key }, position: [...entry.originalPosition] as unknown as Vec3 };
    },
    dispose() {
      layers.clear(); snapshot = undefined; proposals = []; fallbackEntries = [];
      for (const object of [fallback, ghost, lines]) { scene.remove(object); object.geometry.dispose(); object.material.dispose(); }
    },
  };
}
