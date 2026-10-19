import * as THREE from 'three';
import type { AdaptivePayload } from './adaptive-display';
import { createNativePickCache, type PoleSelection } from './pole-picking';
import { pointTypeColor, type PointColorMode } from './point-colors';

export const ADAPTIVE_BATCH_CAPACITY = 131_072;
export const ADAPTIVE_RESIDENT_LIMIT = 3_000_000;

export interface AdaptiveRenderOptions {
  /** Must be paired. These project committed overrides, never proposals, onto GPU buffers. */
  register?(object: THREE.Points, sourceIds: Uint32Array): void;
  unregister?(object: THREE.Points): void;
  capacity?: 65_536 | 131_072;
  pointBudget?: number;
}

type NativeCache = ReturnType<typeof createNativePickCache>;
interface Node {
  payload: AdaptivePayload;
  cache: NativeCache;
}
interface Span { node: Node; start: number; count: number }
interface Batch {
  object: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  positions: Float32Array;
  colors: Uint8Array;
  sourceIds: Uint32Array;
  spans: Span[];
  count: number;
}

// The material consumes linear vertex colors, just like THREE.Color.setRGB(..., SRGBColorSpace).
const linearColors = Uint8Array.from({ length: 256 }, (_, value) => {
  const s = value / 255;
  return Math.round(255 * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
});

/** Disposable bounded native-node projection. Nodes may span multiple GPU batches.
 * All batches except the last are full: draw calls stay ceil(resident/capacity),
 * including after arbitrary eviction/append cycles. Only changed batches rebuild.
 * Original binary64 node caches, not packed float32 indexes, resolve provenance.
 * Material ownership stays with the caller.
 */
export function createAdaptiveRender(material: THREE.PointsMaterial, options: AdaptiveRenderOptions = {}) {
  const capacity = options.capacity ?? ADAPTIVE_BATCH_CAPACITY;
  const budget = options.pointBudget ?? ADAPTIVE_RESIDENT_LIMIT;
  if (![65_536, 131_072].includes(capacity) || !Number.isSafeInteger(budget) || budget < 1 || budget > ADAPTIVE_RESIDENT_LIMIT || !!options.register !== !!options.unregister) throw new RangeError('Invalid adaptive render options');
  const group = new THREE.Group();
  const nodes = new Map<string, Node>();
  let batches: Batch[] = [], count = 0, disposed = false;
  let datasetSignature: string | undefined;
  let colorMode: PointColorMode = 'rgb';

  function allocate(): Batch {
    // The final allocation is capped too: total GPU slots never exceed the point budget.
    const slots = Math.min(capacity, budget - batches.length * capacity);
    const positions = new Float32Array(slots * 3), colors = new Uint8Array(slots * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const object = new THREE.Points(geometry, material);
    object.name = 'adaptive-native-batch';
    return { object, positions, colors, sourceIds: new Uint32Array(slots * 2), spans: [], count: 0 };
  }

  // Recolor from immutable source spans without disturbing committed position overrides.
  function recolor(batch: Batch) {
    let offset = 0;
    for (const span of batch.spans) {
      const payload = span.node.payload;
      for (let i = 0; i < span.count; i++) {
        const source = span.start + i, target = offset + i;
        const typeColor = colorMode === 'type' ? pointTypeColor(payload.labels[source]) : undefined;
        for (let axis = 0; axis < 3; axis++) {
          batch.colors[target * 3 + axis] = typeColor
            ? Math.round(255 * typeColor[axis])
            : linearColors[payload.colors[source * 3 + axis]];
        }
      }
      offset += span.count;
    }
    batch.object.geometry.getAttribute('color').needsUpdate = true;
  }

  function rebuild(batch: Batch) {
    // unregister does not restore old override positions. Never copy GPU values;
    // reconstruct the touched packed batch from its original source-node arrays.
    batch.positions.fill(0); batch.colors.fill(0); batch.sourceIds.fill(0);
    let offset = 0;
    for (const span of batch.spans) {
      const payload = span.node.payload;
      for (let i = 0; i < span.count; i++) {
        const source = span.start + i, target = offset + i;
        for (let axis = 0; axis < 3; axis++) {
          batch.positions[target * 3 + axis] = payload.positions[source * 3 + axis];
        }
        batch.sourceIds[target * 2] = payload.sourceIds[source * 2];
        batch.sourceIds[target * 2 + 1] = payload.sourceIds[source * 2 + 1];
      }
      offset += span.count;
    }
    batch.count = offset;
    batch.object.geometry.setDrawRange(0, offset);
    batch.object.geometry.getAttribute('position').needsUpdate = true;
    recolor(batch);
    batch.object.geometry.computeBoundingBox(); batch.object.geometry.computeBoundingSphere();
  }

  /** Metadata is staged first. Original arrays also permit rollback without GPU buffer copies. */
  function transaction(change: (touch: (batch: Batch) => void) => void) {
    const before = batches.slice();
    const saved = new Map<Batch, { spans: Span[]; count: number }>();
    const touch = (batch: Batch) => { if (!saved.has(batch)) saved.set(batch, { spans: batch.spans.map(span => ({ ...span })), count: batch.count }); };
    const attempted = new Set<Batch>();
    try {
      change(touch);
      // Remove old registrations before any attributes or their indexes change.
      for (const batch of saved.keys()) if (before.includes(batch)) options.unregister?.(batch.object);
      for (const batch of saved.keys()) {
        if (!batches.includes(batch)) continue;
        rebuild(batch);
        attempted.add(batch); options.register?.(batch.object, batch.sourceIds);
      }
    } catch (failure) {
      const recovery: unknown[] = [];
      for (const batch of attempted) { try { options.unregister?.(batch.object); } catch (error) { recovery.push(error); } }
      const added = [...saved.keys()].filter(batch => !before.includes(batch));
      batches = before;
      for (const [batch, state] of saved) {
        batch.spans = state.spans; batch.count = state.count;
        if (!before.includes(batch)) continue;
        try { options.unregister?.(batch.object); rebuild(batch); options.register?.(batch.object, batch.sourceIds); } catch (error) { recovery.push(error); }
      }
      for (const batch of added) batch.object.geometry.dispose();
      if (recovery.length) throw new AggregateError([failure, ...recovery], 'Adaptive render rollback callback failed');
      throw failure;
    }
    for (const batch of before) if (!batches.includes(batch)) { group.remove(batch.object); batch.object.geometry.dispose(); }
    for (const batch of batches) if (!before.includes(batch)) group.add(batch.object);
  }

  function clear() {
    const errors: unknown[] = [];
    for (const batch of batches) {
      try { options.unregister?.(batch.object); } catch (error) { errors.push(error); }
      group.remove(batch.object); batch.object.geometry.dispose();
    }
    for (const node of nodes.values()) node.cache.dispose();
    batches = []; nodes.clear(); count = 0; datasetSignature = undefined;
    if (errors.length) throw new AggregateError(errors, 'Adaptive render cleanup callback failed');
  }

  return {
    group,
    get objects(): readonly THREE.Points[] { return batches.map(batch => batch.object); },
    get count() { return count; },
    get chunks() { return batches.length; },
    get names(): readonly string[] { return [...nodes.keys()]; },
    setColorMode(mode: PointColorMode) {
      if (disposed) throw new Error('Adaptive render is disposed');
      if (mode === colorMode) return;
      colorMode = mode;
      for (const batch of batches) recolor(batch);
    },
    add(payload: AdaptivePayload) {
      if (disposed) throw new Error('Adaptive render is disposed');
      if (nodes.has(payload.name)) throw new Error('Duplicate adaptive render node');
      if (!/^r[0-7]{0,24}$/.test(payload.name) || !Number.isSafeInteger(payload.count) || payload.count < 0 || payload.count > 65_536 || payload.positions.length !== payload.count * 3 || payload.colors.length !== payload.count * 3 || payload.sourceIds.length !== payload.count * 2 || payload.labels.length !== payload.count) throw new Error('Invalid adaptive render payload');
      if (count + payload.count > budget) throw new RangeError('Adaptive resident point budget exceeded');
      const signature = JSON.stringify(payload.dataset);
      if (datasetSignature !== undefined && signature !== datasetSignature) throw new Error('Mixed adaptive render datasets');
      for (let i = 0; i < payload.positions.length; i++) if (!Number.isFinite(payload.positions[i]) || Math.abs(payload.positions[i]) >= 1e7) throw new Error('Invalid adaptive render position');
      for (let i = 0; i < payload.colors.length; i++) if (!Number.isInteger(payload.colors[i]) || payload.colors[i] < 0 || payload.colors[i] > 255) throw new Error('Invalid adaptive render color');
      for (let i = 0; i < payload.sourceIds.length; i++) if (!Number.isInteger(payload.sourceIds[i]) || payload.sourceIds[i] < 0 || payload.sourceIds[i] > (i % 2 ? 0xffffffff : 65535)) throw new Error('Invalid adaptive render source key');
      // Own immutable compact originals; callers can release/reuse their transport arrays.
      const owned: AdaptivePayload = { ...payload, positions: Float64Array.from(payload.positions), colors: Uint8Array.from(payload.colors), sourceIds: Uint32Array.from(payload.sourceIds), labels: Uint8Array.from(payload.labels) };
      const cache = createNativePickCache(payload.dataset, owned.positions as readonly number[], owned.sourceIds as readonly number[], payload.labels as readonly number[]);
      const node: Node = { payload: owned, cache };
      try {
        transaction(touch => {
          let start = 0;
          while (start < payload.count) {
            let batch = batches.at(-1);
            if (!batch || batch.count === batch.positions.length / 3) { batch = allocate(); batches.push(batch); }
            touch(batch);
            const size = Math.min(payload.count - start, batch.positions.length / 3 - batch.count);
            batch.spans.push({ node, start, count: size }); batch.count += size; start += size;
          }
        });
      } catch (error) { cache.dispose(); throw error; }
      nodes.set(payload.name, node); count += payload.count; datasetSignature = signature;
    },
    remove(names: string | readonly string[]) {
      const removed = new Set<Node>();
      for (const name of typeof names === 'string' ? [names] : names) {
        const node = nodes.get(name); if (node) removed.add(node);
      }
      if (!removed.size) return;
      // With no external registrations clear cannot fail halfway through a callback.
      // Otherwise keep even full eviction transactional so rollback restores all picks.
      if (removed.size === nodes.size && !options.unregister) { clear(); return; }
      transaction(touch => {
        for (const batch of batches) {
          if (!batch.spans.some(span => removed.has(span.node))) continue;
          touch(batch); batch.spans = batch.spans.filter(span => !removed.has(span.node));
          batch.count = batch.spans.reduce((sum, span) => sum + span.count, 0);
        }
        // Fill each hole from the tail, touching only the hole and donor batches.
        for (let index = 0; index < batches.length; index++) {
          const batch = batches[index];
          while (batch.count < batch.positions.length / 3 && index < batches.length - 1) {
            const tail = batches.at(-1)!;
            touch(tail);
            if (!tail.count) { batches.pop(); continue; }
            touch(batch);
            const last = tail.spans.at(-1)!;
            const size = Math.min(batch.positions.length / 3 - batch.count, last.count);
            batch.spans.push({ node: last.node, start: last.start + last.count - size, count: size });
            batch.count += size; tail.count -= size; last.count -= size;
            if (!last.count) tail.spans.pop();
            if (!tail.count) batches.pop();
          }
        }
        if (batches.at(-1)?.count === 0) { touch(batches.at(-1)!); batches.pop(); }
      });
      for (const node of removed) {
        nodes.delete(node.payload.name); count -= node.payload.count; node.cache.dispose();
      }
      if (!nodes.size) datasetSignature = undefined;
    },
    resolve(object: THREE.Object3D, index: number): PoleSelection | undefined {
      if (disposed || !Number.isSafeInteger(index) || index < 0) return;
      const batch = batches.find(candidate => candidate.object === object);
      if (!batch || index >= batch.count) return;
      let offset = 0;
      for (const span of batch.spans) {
        if (index < offset + span.count) return span.node.cache.resolve(span.start + index - offset);
        offset += span.count;
      }
    },
    clear,
    dispose() { if (disposed) return; disposed = true; clear(); },
  };
}
