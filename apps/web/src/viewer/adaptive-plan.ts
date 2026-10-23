import type { CropBox, Vec3 } from '@spatial/contracts';

export interface AdaptiveNode { name: string; count: number; bounds: CropBox }
export interface AdaptiveSettings { nearRadius: number; pixelThreshold: number; pointBudget: number }
export interface AdaptiveView {
  position: Vec3;
  /** Orbit target metadata in dataset-local meters; never overrides camera-distance LOD. */
  focus?: Vec3;
  planes: readonly (readonly [number, number, number, number])[];
  viewportHeight: number;
  fovDegrees: number;
}
export interface AdaptiveStats { loadedPoints: number; chunks: number; pending: number; budgetLimited: boolean; error: string | null }
export interface AdaptivePlan { nodes: AdaptiveNode[]; points: number; budgetLimited: boolean }
export const MAX_ADAPTIVE_POINTS = 50_000_000;
export const DEFAULT_ADAPTIVE_POINTS = 3_000_000;
export const DEFAULT_ADAPTIVE_SETTINGS: Readonly<AdaptiveSettings> = Object.freeze({ nearRadius: 30, pixelThreshold: 80, pointBudget: DEFAULT_ADAPTIVE_POINTS });

export function checkedSettings(value: AdaptiveSettings): AdaptiveSettings {
  if (!Number.isFinite(value.nearRadius) || value.nearRadius < 0 || value.nearRadius > 10_000 || !Number.isFinite(value.pixelThreshold) || value.pixelThreshold < 1 || value.pixelThreshold > 10_000 || !Number.isSafeInteger(value.pointBudget) || value.pointBudget < 1 || value.pointBudget > MAX_ADAPTIVE_POINTS) throw new RangeError('Invalid adaptive display settings');
  return { ...value };
}
export function checkedView(view: AdaptiveView) {
  if (view.position.length !== 3 || !view.position.every(Number.isFinite) || (view.focus !== undefined && (view.focus.length !== 3 || !view.focus.every(Number.isFinite))) || !Number.isFinite(view.viewportHeight) || view.viewportHeight <= 0 || !Number.isFinite(view.fovDegrees) || view.fovDegrees <= 0 || view.fovDegrees >= 180 || !view.planes.every(p => p.length === 4 && p.every(Number.isFinite) && Math.hypot(p[0], p[1], p[2]) > 0)) throw new RangeError('Invalid adaptive display camera');
}

/** Additive native nodes: children are eligible only after their ancestor payloads fit.
 * Near intersections refine to leaves; far nodes refine by projected box diameter.
 * Coarse visible octants get coverage before refinement. Finer nodes compete by
 * projected size (chunk diameter / camera distance), independent of orbit focus.
 * The point budget caps admission; it never sets a requested depth or resolution.
 * A small visibility/refinement margin retains boundary nodes without an extra cache.
 */
export function planAdaptiveDisplay(hierarchy: { nodes: readonly AdaptiveNode[] }, view: AdaptiveView, settings: AdaptiveSettings = DEFAULT_ADAPTIVE_SETTINGS, previous: ReadonlySet<string> = new Set()): AdaptivePlan {
  checkedView(view); checkedSettings(settings);
  const children = new Map<string, AdaptiveNode[]>();
  for (const node of hierarchy.nodes) {
    const parent = node.name.slice(0, -1), siblings = children.get(parent) ?? [];
    siblings.push(node); children.set(parent, siblings);
  }
  type Candidate = { node: AdaptiveNode; distance: number; coverage: boolean; pixels: number; near: boolean };
  const heap: Candidate[] = [];
  const better = (a: Candidate, b: Candidate) => Number(a.coverage) - Number(b.coverage) || a.pixels - b.pixels || b.distance - a.distance || b.node.name.localeCompare(a.node.name);
  const push = (node: AdaptiveNode) => {
    const diagonal = Math.hypot(...node.bounds.max.map((n, i) => n - node.bounds.min[i]));
    const margin = previous.has(node.name) ? Math.max(0.5, diagonal * 0.05) : 0;
    if (view.planes.some(p => p[0] * (p[0] >= 0 ? node.bounds.max[0] : node.bounds.min[0]) + p[1] * (p[1] >= 0 ? node.bounds.max[1] : node.bounds.min[1]) + p[2] * (p[2] >= 0 ? node.bounds.max[2] : node.bounds.min[2]) + p[3] < -margin * Math.hypot(p[0], p[1], p[2]))) return;
    const distance = Math.hypot(...view.position.map((n, i) => Math.max(node.bounds.min[i] - n, 0, n - node.bounds.max[i])));
    const pixels = diagonal * view.viewportHeight / (2 * Math.tan(view.fovDegrees * Math.PI / 360) * Math.max(0.01, distance));
    const item = { node, distance, pixels, coverage: node.name.length <= 2, near: distance <= settings.nearRadius + margin };
    let at = heap.length; heap.push(item);
    while (at > 0) { const parent = (at - 1) >> 1; if (better(heap[parent], item) >= 0) break; heap[at] = heap[parent]; at = parent; } heap[at] = item;
  };
  for (const root of children.get('') ?? []) push(root);
  const nodes: AdaptiveNode[] = []; let points = 0, budgetLimited = false;
  while (heap.length) {
    const item = heap[0], last = heap.pop()!;
    if (heap.length) {
      let at = 0; heap[0] = last;
      while (at * 2 + 1 < heap.length) { let child = at * 2 + 1; if (child + 1 < heap.length && better(heap[child + 1], heap[child]) > 0) child++; if (better(last, heap[child]) >= 0) break; heap[at] = heap[child]; at = child; } heap[at] = last;
    }
    if (points + item.node.count > settings.pointBudget) { budgetLimited = true; continue; }
    nodes.push(item.node); points += item.node.count;
    if (item.near || item.pixels >= settings.pixelThreshold * (previous.has(item.node.name) ? 0.9 : 1)) for (const child of children.get(item.node.name) ?? []) push(child);
  }
  return { nodes, points, budgetLimited };
}

