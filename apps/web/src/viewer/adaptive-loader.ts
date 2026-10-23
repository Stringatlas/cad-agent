import { checkedSettings, checkedView, planAdaptiveDisplay, type AdaptiveNode, type AdaptivePlan, type AdaptiveSettings, type AdaptiveStats, type AdaptiveView } from './adaptive-plan';

export interface CaptureDetailLease {
  coverage: { status: 'ready'; targetPointCount: number; targetNodeCount: number; budgetLimited: boolean; pointBudget: number };
  /** Borrow the existing GPU projection synchronously. No await is allowed until restore. */
  render(): { changed: boolean; restore(): void };
  release(): void;
}

/** One physical request lane and shared payload cache, with independent user/capture demand.
 * User geometry stays resident while capture loading takes priority. CPU residency is
 * bounded by two point budgets; only one target occupies the existing GPU projection.
 */
export function createAdaptiveLoader<T extends { name: string; count: number }>(options: {
  hierarchy(signal: AbortSignal): Promise<AdaptiveNode[]>;
  load(node: AdaptiveNode, signal: AbortSignal): Promise<T>;
  add(payload: T): void; remove(names: readonly string[]): void; status(stats: AdaptiveStats): void;
  settings: AdaptiveSettings;
  enabled?: boolean;
}) {
  let settings = checkedSettings(options.settings), enabled = options.enabled ?? true;
  const cache = new Map<string, T>(), resident = new Map<string, number>();
  let nodes: AdaptiveNode[] | undefined, desired: AdaptiveNode[] = [], view: AdaptiveView | undefined;
  let disposed = false, busy = false, dirty = true, limited = false, generation = 0, error: string | null = null;
  let controller: AbortController | undefined, activeName: string | undefined, timer: ReturnType<typeof setTimeout> | undefined, signature = '';
  type Demand = { view: AdaptiveView; plan?: AdaptivePlan; ready: boolean; resolve(lease: CaptureDetailLease): void; reject(cause: unknown): void; cleanup(): void };
  let capture: Demand | undefined;
  let warm = new Set<string>();
  const publish = () => options.status({ loadedPoints: [...resident.values()].reduce((a, b) => a + b, 0), chunks: resident.size,
    pending: enabled ? nodes ? desired.filter(n => !resident.has(n.name)).length + (dirty ? 1 : 0) : 1 : 0, budgetLimited: limited, error });
  const evict = (keep: ReadonlySet<string>) => {
    const remove = [...resident.keys()].filter(name => !keep.has(name));
    if (remove.length) { options.remove(remove); for (const name of remove) resident.delete(name); }
  };
  const prune = () => {
    const keep = new Set([...resident.keys(), ...(capture ? capture.plan?.nodes.map(n => n.name) ?? [] : warm)]);
    for (const name of cache.keys()) if (!keep.has(name)) cache.delete(name);
  };
  const replan = () => {
    // Navigation still updates view, but cannot evict the user's geometry for a capture.
    if (!dirty || !nodes || !view || capture) return;
    const plan = planAdaptiveDisplay({ nodes }, view, settings, new Set(resident.keys()));
    desired = plan.nodes; limited = plan.budgetLimited;
    evict(new Set(desired.map(n => n.name))); dirty = false; prune();
  };
  const finishCapture = (demand: Demand, cause?: unknown) => {
    if (capture !== demand) return;
    capture = undefined; demand.cleanup(); prune(); dirty = true;
    if (cause) demand.reject(cause);
    // Resume at a task boundary so synchronous extraction/restoration can finish first.
    if (!disposed) queueMicrotask(pump);
  };
  const settleCapture = () => {
    const demand = capture;
    if (!demand || demand.ready || !nodes) return;
    demand.plan ??= planAdaptiveDisplay({ nodes }, demand.view, settings);
    warm = new Set(demand.plan.nodes.map(n => n.name)); prune();
    if (!demand.plan.nodes.every(n => cache.has(n.name))) return;
    demand.ready = true;
    const plan = demand.plan;
    demand.resolve({
      coverage: { status: 'ready', targetPointCount: plan.points, targetNodeCount: plan.nodes.length, budgetLimited: plan.budgetLimited, pointBudget: settings.pointBudget },
      render() {
        if (disposed || capture !== demand) throw new Error('Capture detail unavailable');
        const previous = [...resident.keys()], target = new Set(plan.nodes.map(n => n.name));
        const changed = previous.length !== target.size || previous.some(name => !target.has(name));
        const restore = () => {
          evict(new Set(previous));
          for (const name of previous) if (!resident.has(name)) { const payload = cache.get(name)!; options.add(payload); resident.set(name, payload.count); }
        };
        try {
          evict(target);
          for (const node of plan.nodes) if (!resident.has(node.name)) { options.add(cache.get(node.name)!); resident.set(node.name, node.count); }
        } catch (cause) { restore(); throw cause; }
        return { changed, restore };
      },
      release() { finishCapture(demand); },
    });
  };
  const pump = () => {
    if (disposed || busy || error || !enabled) return;
    let node: AdaptiveNode | undefined;
    try {
      replan(); settleCapture();
      if (capture) {
        if (capture.ready) return;
        node = capture.plan?.nodes.find(n => !cache.has(n.name));
      } else {
        // Reuse any payload already fetched for the capture before requesting again.
        for (const n of desired) if (!resident.has(n.name) && cache.has(n.name)) { options.add(cache.get(n.name)!); resident.set(n.name, n.count); }
        node = desired.find(n => !resident.has(n.name));
      }
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); if (capture) finishCapture(capture, cause); publish(); return; }
    if (nodes && !node) { publish(); return; }
    const token = generation, abort = new AbortController(); controller = abort; activeName = node?.name; busy = true; publish();
    const timeout = setTimeout(() => abort.abort(new Error('Detail request timed out. Retry loading detail.')), 20000);
    void (async () => {
      try {
        if (!nodes) {
          const result = await options.hierarchy(abort.signal);
          if (disposed || token !== generation || abort.signal.aborted) return;
          nodes = result; dirty = true; replan();
        } else if (node) {
          const payload = await options.load(node, abort.signal);
          if (disposed || token !== generation || abort.signal.aborted) return;
          replan();
          if (payload.name !== node.name || payload.count !== node.count) throw new Error('Invalid native node admission');
          if (capture?.plan?.nodes.some(n => n.name === node.name)) cache.set(node.name, payload);
          else if (!capture && desired.some(n => n.name === node.name)) {
            options.add(payload); resident.set(node.name, node.count); cache.set(node.name, payload);
          }
        }
      } catch (cause) {
        if (!disposed && token === generation) {
          const message = cause instanceof Error ? cause.message : String(cause);
          if (capture) finishCapture(capture, new Error(message));
          else error = message;
        }
      } finally {
        clearTimeout(timeout); busy = false; activeName = undefined; if (controller === abort) controller = undefined;
        if (!disposed) { publish(); pump(); }
      }
    })();
  };
  const invalidate = () => {
    generation++; controller?.abort();
    if (capture) finishCapture(capture, new Error('Capture detail cancelled by display change'));
    dirty = true;
  };
  return {
    update(next: AdaptiveView) {
      if (disposed) return;
      checkedView(next);
      const key = JSON.stringify([next.position.map(n => Math.round(n * 10)), next.focus?.map(n => Math.round(n * 10)), next.planes.map(p => p.map((n, i) => Math.round(n * (i === 3 ? 10 : 1000)))), next.viewportHeight, next.fovDegrees]);
      if (key === signature) return;
      signature = key; view = structuredClone(next); dirty = true; publish();
      if (!timer) timer = setTimeout(() => { timer = undefined; pump(); }, 120);
    },
    capture(next: AdaptiveView, signal: AbortSignal): Promise<CaptureDetailLease> {
      checkedView(next); signal.throwIfAborted();
      if (disposed || !enabled || error) return Promise.reject(new Error(error ?? 'Capture detail unavailable'));
      if (capture) finishCapture(capture, new Error('Capture superseded'));
      return new Promise((resolve, reject) => {
        const abort = () => {
          if (capture !== demand) return;
          // Cancel capture-only work, retaining the physical lane until it actually settles.
          if (activeName && !resident.has(activeName)) { generation++; controller?.abort(); }
          finishCapture(demand, signal.reason ?? new Error('Capture cancelled'));
        };
        const demand: Demand = { view: structuredClone(next), ready: false, resolve, reject,
          cleanup: () => signal.removeEventListener('abort', abort) };
        if (nodes) demand.plan = planAdaptiveDisplay({ nodes }, demand.view, settings);
        capture = demand;
        if (demand.plan) {
          warm = new Set(demand.plan.nodes.map(n => n.name));
          // Preempt background work outside the frozen capture target. Keep the
          // physical lane occupied until cancellation actually settles.
          if (activeName && !warm.has(activeName)) { generation++; controller?.abort(); }
        }
        prune(); signal.addEventListener('abort', abort, { once: true });
        pump();
      });
    },
    configure(next: Partial<AdaptiveSettings>) {
      const checked = checkedSettings({ ...settings, ...next });
      if (disposed) return;
      invalidate(); warm.clear(); settings = checked; replan(); prune(); publish(); pump();
    },
    reset() {
      if (disposed) return;
      invalidate(); if (timer) clearTimeout(timer); timer = undefined;
      evict(new Set()); cache.clear(); warm.clear(); nodes = undefined; desired = []; limited = false; error = null; enabled = true; publish(); pump();
    },
    retry() { if (disposed) return; invalidate(); error = null; replan(); publish(); pump(); },
    dispose() {
      if (disposed) return;
      disposed = true; invalidate(); if (timer) clearTimeout(timer);
      evict(new Set()); cache.clear();
    },
  };
}
