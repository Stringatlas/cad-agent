import * as THREE from 'three';
import { MAX_ADAPTIVE_POINTS } from './adaptive-plan';
import type { PreparedNodePayload } from '@spatial/contracts';
import { cloudColors, semanticColor, type CloudColorMode } from './cloud-colors';

/** One bounded packed draw buffer; provenance stays in original Float64 native payloads. */
export function createNativeCloudRender(material: THREE.PointsMaterial, budget: number, unassigned = -100) {
  if (!Number.isSafeInteger(budget) || budget < 65536 || budget > MAX_ADAPTIVE_POINTS) throw new RangeError('Invalid display budget');
  let capacity = Math.min(budget, 131072);
  let positions = new Float32Array(capacity * 3), colors = new Uint8Array(capacity * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const points = new THREE.Points(geometry, material); points.visible = false;
  let entries: { payload: PreparedNodePayload; start: number }[] = [], count = 0, mode: CloudColorMode = 'rgb', disposed = false;
  let binding: string | undefined;
  const resize = (slots: number) => {
    const nextPositions = new Float32Array(slots * 3), nextColors = new Uint8Array(slots * 3);
    nextPositions.set(positions.subarray(0, count * 3)); nextColors.set(colors.subarray(0, count * 3));
    // Dispose the old GPU attributes before replacing them; geometry identity and
    // source spans remain stable. Three reinitializes it on the next render.
    geometry.dispose(); positions = nextPositions; colors = nextColors; capacity = slots;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true).setUsage(THREE.DynamicDrawUsage));
  };
  const palette = new Map<number, readonly number[]>();
  const classColor = (label: number | undefined): readonly number[] => {
    const key = label ?? -1;
    if (!palette.has(key)) palette.set(key, new THREE.Color(label === undefined ? '#ffffff' : semanticColor(label)).toArray());
    return palette.get(key)!;
  };
  const upload = (name: string, start: number, length: number) => {
    const attr = geometry.getAttribute(name) as THREE.BufferAttribute;
    // Several capture nodes can be packed before the next frame. Preserve every
    // pending upload; a later append must not erase an earlier compaction/recolor.
    attr.addUpdateRange(start, length); attr.needsUpdate = true;
  };
  const recolor = (payload: PreparedNodePayload, start: number) => {
    const native = cloudColors(payload.colors, payload.labels, payload.instances, mode, classColor, unassigned);
    for (let i = 0; i < native.length; i++) colors[start * 3 + i] = Math.round(native[i] * 255);
  };
  const bounds = () => {
    // Geometry attributes are capacity-sized: unused slots must never affect fitting or culling.
    const box = new THREE.Box3(), point = new THREE.Vector3();
    for (const entry of entries) {
      const xyz = entry.payload.positions;
      for (let i = 0; i < xyz.length; i += 3) box.expandByPoint(point.set(xyz[i], xyz[i + 1], xyz[i + 2]));
    }
    geometry.boundingBox = box; geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  };
  return {
    points,
    get count() { return count; },
    get capacity() { return capacity; },
    setBudget(next: number) {
      if (!Number.isSafeInteger(next) || next < 65536 || next > MAX_ADAPTIVE_POINTS || next < count) throw new RangeError('Invalid display budget');
      if (disposed) return;
      if (capacity > next) resize(next);
      budget = next;
    },
    get names() { return entries.map(entry => entry.payload.name); },
    copySource(start: number, length: number, originals: Float64Array, keys: Uint32Array) {
      if (disposed || start < 0 || length < 0 || start + length > count || originals.length !== length * 3 || keys.length !== length * 2) throw new Error('Invalid capture source range');
      for (const entry of entries) {
        const begin = Math.max(start, entry.start), end = Math.min(start + length, entry.start + entry.payload.count);
        if (end <= begin) continue;
        const source = begin - entry.start, target = begin - start;
        originals.set(entry.payload.positions.subarray(source * 3, (source + end - begin) * 3), target * 3);
        keys.set(entry.payload.sourceIds.subarray(source * 2, (source + end - begin) * 2), target * 2);
      }
    },
    add(payload: PreparedNodePayload) {
      if (disposed || entries.some(entry => entry.payload.name === payload.name) || count + payload.count > budget) throw new Error('Invalid native render admission');
      const nextBinding = JSON.stringify([payload.cloudId, payload.revision]);
      if (binding && binding !== nextBinding) throw new Error('Mismatched native render binding');
      const float = Float32Array.from(payload.positions);
      if (!float.every(Number.isFinite)) throw new Error('Native position exceeds render precision');
      if (count + payload.count > capacity) resize(Math.min(budget, Math.max(count + payload.count, capacity * 2)));
      recolor(payload, count); positions.set(float, count * 3);
      entries.push({ payload, start: count }); binding = nextBinding;
      const start = count; count += payload.count;
      upload('position', start * 3, payload.count * 3); upload('color', start * 3, payload.count * 3);
      geometry.setDrawRange(0, count); points.visible = count > 0;
      // Extend only by the arriving node, not by the whole resident population.
      const box = geometry.boundingBox ?? new THREE.Box3(), point = new THREE.Vector3();
      for (let i = 0; i < payload.count; i++) box.expandByPoint(point.fromArray(payload.positions, i * 3));
      geometry.boundingBox = box; geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    },
    remove(names: readonly string[]) {
      if (disposed || !names.length) return;
      const removed = new Set(names), keep = entries.filter(entry => !removed.has(entry.payload.name));
      if (keep.length === entries.length) return;
      let cursor = 0;
      for (const entry of keep) {
        positions.copyWithin(cursor * 3, entry.start * 3, (entry.start + entry.payload.count) * 3);
        colors.copyWithin(cursor * 3, entry.start * 3, (entry.start + entry.payload.count) * 3);
        entry.start = cursor; cursor += entry.payload.count;
      }
      entries = keep; count = cursor;
      if (count) { upload('position', 0, count * 3); upload('color', 0, count * 3); }
      geometry.setDrawRange(0, count); points.visible = count > 0; bounds();
    },
    resolve(index: number) {
      if (disposed || !Number.isSafeInteger(index) || index < 0 || index >= count) return;
      let low = 0, high = entries.length - 1;
      while (low <= high) {
        const at = (low + high) >> 1, entry = entries[at];
        if (index < entry.start) high = at - 1;
        else if (index >= entry.start + entry.payload.count) low = at + 1;
        else return { payload: entry.payload, index: index - entry.start };
      }
    },
    setColorMode(next: CloudColorMode) {
      mode = next;
      for (const entry of entries) recolor(entry.payload, entry.start);
      if (count) upload('color', 0, count * 3);
    },
    dispose() { if (disposed) return; disposed = true; entries = []; count = 0; points.visible = false; geometry.dispose(); },
  };
}
