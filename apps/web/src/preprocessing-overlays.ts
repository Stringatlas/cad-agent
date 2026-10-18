import * as THREE from 'three';
import type { CropBox } from '@spatial/contracts';

export interface ObservedFit {
  kind: 'vertical-cylinder' | 'pca-xy-box' | 'footprint-height-extrusion'; status: 'fitted' | 'insufficient' | 'degenerate';
  center: [number, number, number]; dimensions: [number, number, number]; yawRadians: number; radius?: number;
  rmseMeters: number | null; coverage: number | null; qualityScore: number | null; toleranceMeters: number; evaluatedPoints: number;
  qualityMeaning: string;
}
export interface PreprocessingSummary {
  version: 'toronto-preprocessing-v1'; datasetId: 'toronto3d'; artifactRevision: string;
  frameId: 'toronto3d-local-v1'; units: 'm'; status: 'ready' | 'empty' | 'unavailable';
  message: string; truncated: boolean;
  overlays: readonly { id: string; label: number; name: string; bounds: CropBox; points: number; fit?: ObservedFit }[];
  ground?: { cellMeters: number; origin: [number, number]; minimumSupport: number; method: 'observed-cell-minimum-v1'; cells: { x: number; y: number; elevation: number; maxElevation: number; points: number }[] };
}
export function validatePreprocessing(value: unknown, revision: string): PreprocessingSummary {
  const v = value as PreprocessingSummary;
  const vector = (a: unknown): a is number[] => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
  if (!v || v.version !== 'toronto-preprocessing-v1' || v.datasetId !== 'toronto3d' || v.artifactRevision !== revision ||
      v.frameId !== 'toronto3d-local-v1' || v.units !== 'm' || !['ready', 'empty', 'unavailable'].includes(v.status) ||
      typeof v.message !== 'string' || v.message.length > 2000 || typeof v.truncated !== 'boolean' ||
      !Array.isArray(v.overlays) || v.overlays.length > 2000 || (v.status !== 'ready' && (v.overlays.length || v.ground?.cells.length)) ||
      (v.status === 'ready' && !v.overlays.length && !v.ground?.cells.length)) throw new Error('Invalid or stale preprocessing summary');
  const ids = new Set<string>();
  for (const o of v.overlays) {
    if (!o || typeof o.id !== 'string' || !o.id.length || o.id.length > 256 || ids.has(o.id) ||
        !Number.isInteger(o.label) || o.label < 0 || o.label > 8 || typeof o.name !== 'string' || o.name.length > 256 ||
        !Number.isSafeInteger(o.points) || o.points < 1 || !o.bounds || !vector(o.bounds.min) || !vector(o.bounds.max) ||
        o.bounds.min.some((n: number, i: number) => n > o.bounds.max[i])) throw new Error('Invalid derived instance bounds');
    ids.add(o.id);
    const f = o.fit;
    const expectedKind = o.label === 6 ? 'vertical-cylinder' : o.label === 4 ? 'footprint-height-extrusion' : o.label === 7 ? 'pca-xy-box' : undefined;
    // Match the artifact validator's numerical tolerance; poor quality remains a valid observation.
    const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    if (f !== undefined && (!f || !['vertical-cylinder', 'pca-xy-box', 'footprint-height-extrusion'].includes(f.kind) ||
      (expectedKind !== undefined && f.kind !== expectedKind) ||
      !['fitted', 'insufficient', 'degenerate'].includes(f.status) || !vector(f.center) || !vector(f.dimensions) ||
      f.dimensions.some((n: number) => n < 0 || (f.status === 'fitted' && n === 0)) || !Number.isFinite(f.yawRadians) ||
      (f.kind === 'vertical-cylinder' && (!Number.isFinite(f.radius) || f.radius! < 0 || (f.status === 'fitted' && f.radius === 0) ||
        f.dimensions.slice(0, 2).some((n: number) => !close(n, 2 * f.radius!)))) ||
      !Number.isFinite(f.toleranceMeters) || f.toleranceMeters <= 0 || !Number.isSafeInteger(f.evaluatedPoints) || f.evaluatedPoints < 0 || f.evaluatedPoints > o.points ||
      (f.status === 'fitted' && (f.evaluatedPoints !== o.points || f.rmseMeters === null || f.coverage === null || f.qualityScore === null ||
        !close(f.qualityScore, f.coverage * Math.exp(-f.rmseMeters / f.toleranceMeters)))) ||
      (f.rmseMeters !== null && (!Number.isFinite(f.rmseMeters) || f.rmseMeters < 0)) ||
      [f.coverage, f.qualityScore].some(n => n !== null && (!Number.isFinite(n) || n < 0 || n > 1)) ||
      f.qualityMeaning !== 'coverage-times-exp-negative-normalized-rmse; heuristic-not-CAD-validity')) throw new Error('Invalid observed fit');
  }
  if (v.ground) {
    const g = v.ground, keys = new Set<string>();
    if (!Number.isFinite(g.cellMeters) || g.cellMeters < .1 || g.cellMeters > 100 || JSON.stringify(g.origin) !== '[0,0]' ||
      g.minimumSupport !== 3 || g.method !== 'observed-cell-minimum-v1' || !Array.isArray(g.cells) || g.cells.length > 10000) throw new Error('Invalid observed ground');
    for (const c of g.cells) {
      const key = `${c?.x},${c?.y}`;
      if (!c || !Number.isSafeInteger(c.x) || !Number.isSafeInteger(c.y) || !Number.isFinite(c.x * g.cellMeters) || !Number.isFinite(c.y * g.cellMeters) ||
        !Number.isFinite(c.elevation) || !Number.isFinite(c.maxElevation) || c.maxElevation < c.elevation ||
        !Number.isSafeInteger(c.points) || c.points < 3 || keys.has(key)) throw new Error('Invalid supported ground cell');
      keys.add(key);
    }
  }
  return v;
}
export async function fetchPreprocessing(revision: string, signal: AbortSignal, bounds?: CropBox): Promise<PreprocessingSummary> {
  const response = await fetch('/datasets/toronto3d/preprocessing' + (bounds ? '?bounds=' + encodeURIComponent(JSON.stringify(bounds)) : ''), { signal });
  if (!response.ok) throw new Error(`Preprocessing request failed (${response.status})`);
  // Bound browser parsing, even if a proxy/server fails to enforce the summary cap.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing preprocessing response');
  const decoder = new TextDecoder(); let text = '', bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024 * 1024) throw new Error('Preprocessing response too large');
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode(); signal.throwIfAborted();
    return validatePreprocessing(JSON.parse(text), revision);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export const CLUSTER_CLASS_COLORS: Readonly<Record<number, string>> = Object.freeze({
  6: '#bca2ff', 7: '#67d5e8', 8: '#f49ac2', 4: '#86aaff',
});
export const FIT_COLOR = '#ffbf69';
export const GROUND_COLOR = '#69e599';
export function preprocessingLegend(summary: PreprocessingSummary) {
  return {
    classes: [...new Set(summary.overlays.map(o => o.label))].sort((a, b) => a - b),
    clusters: summary.overlays.length,
    fits: summary.overlays.filter(o => o.fit?.status === 'fitted').length,
    ground: summary.ground?.cells.length ?? 0,
  };
}

/** Bounds, approximate fits and observed ground tiles are disposable observations, never CAD authority. */
export function createPreprocessingLayer(scene: THREE.Scene) {
  const group = new THREE.Group(); scene.add(group);
  const clear = () => {
    for (const child of [...group.children]) {
      const helper = child as THREE.Box3Helper;
      helper.geometry.dispose();
      (Array.isArray(helper.material) ? helper.material : [helper.material]).forEach(m => m.dispose());
      group.remove(child);
    }
  };
  return {
    get count() { return group.children.length; },
    set(summary?: PreprocessingSummary) {
      clear();
      for (const o of summary?.overlays ?? []) {
        const helper = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(...o.bounds.min), new THREE.Vector3(...o.bounds.max)), new THREE.Color(CLUSTER_CLASS_COLORS[o.label] ?? '#bca2ff'));
        helper.userData.derivedInstanceId = o.id; group.add(helper);
        if (o.fit?.status === 'fitted') {
          const f = o.fit;
          const geometry = f.kind === 'vertical-cylinder' ? new THREE.CylinderGeometry(f.radius, f.radius, f.dimensions[2], 16) : new THREE.BoxGeometry(...f.dimensions);
          if (f.kind === 'vertical-cylinder') geometry.rotateX(Math.PI / 2);
          const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: FIT_COLOR, transparent: true, opacity: .28, depthWrite: false, side: THREE.DoubleSide }));
          mesh.position.set(...f.center); mesh.rotation.z = f.yawRadians; mesh.userData.derivedInstanceId = o.id; mesh.userData.observedFit = true; group.add(mesh);
        }
      }
      if (summary?.ground?.cells.length) {
        const g = summary.ground, positions: number[] = [];
        for (const c of g.cells) {
          const x = c.x * g.cellMeters, y = c.y * g.cellMeters, s = g.cellMeters, z = c.elevation;
          positions.push(x,y,z, x+s,y,z, x+s,y+s,z, x,y,z, x+s,y+s,z, x,y+s,z);
        }
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: GROUND_COLOR, transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide }));
        mesh.userData.observedGround = true; group.add(mesh);
      }
    },
    dispose() { clear(); scene.remove(group); },
  };
}
