import { checkedSettings, checkedView, planAdaptiveDisplay, type AdaptiveNode, type AdaptiveSettings, type AdaptiveStats, type AdaptiveView } from './adaptive-plan';

/** One bounded request lane. Camera movement replans admission; disposal invalidates late responses. */
export function createAdaptiveLoader<T extends { name: string; count: number }>(options: {
  hierarchy(signal: AbortSignal): Promise<AdaptiveNode[]>;
  load(node: AdaptiveNode, signal: AbortSignal): Promise<T>;
  add(payload: T): void; remove(names: readonly string[]): void; status(stats: AdaptiveStats): void;
  settings: AdaptiveSettings;
}) {
  const settings = checkedSettings(options.settings), resident = new Map<string, number>();
  let nodes: AdaptiveNode[] | undefined, desired: AdaptiveNode[] = [], view: AdaptiveView | undefined;
  let disposed = false, busy = false, dirty = true, limited = false, generation = 0, error: string | null = null;
  let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined, signature = '';
  const publish = () => options.status({ loadedPoints: [...resident.values()].reduce((a, b) => a + b, 0), chunks: resident.size,
    pending: nodes ? desired.filter(n => !resident.has(n.name)).length + (dirty ? 1 : 0) : 1, budgetLimited: limited, error });
  const replan = () => {
    if (!dirty || !nodes || !view) return;
    const plan = planAdaptiveDisplay({ nodes }, view, settings, new Set(resident.keys()));
    desired = plan.nodes; limited = plan.budgetLimited; dirty = false;
    const keep = new Set(desired.map(n => n.name)), remove = [...resident.keys()].filter(name => !keep.has(name));
    if (remove.length) { options.remove(remove); for (const name of remove) resident.delete(name); }
  };
  const pump = () => {
    if (disposed || busy || error || !view) return;
    try { replan(); } catch (cause) { error = String(cause); publish(); return; }
    const node = nodes ? desired.find(n => !resident.has(n.name)) : undefined;
    if (nodes && !node) { publish(); return; }
    const token = generation, abort = new AbortController(); controller = abort; busy = true; publish();
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
          if (desired.some(n => n.name === node.name)) {
            if (payload.name !== node.name || payload.count !== node.count) throw new Error('Invalid native node admission');
            options.add(payload); resident.set(node.name, node.count);
          }
        }
      } catch (cause) { if (!disposed && token === generation) error = cause instanceof Error ? cause.message : String(cause); }
      finally {
        clearTimeout(timeout); busy = false; if (controller === abort) controller = undefined;
        if (!disposed) { publish(); pump(); }
      }
    })();
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
    retry() { if (disposed) return; generation++; controller?.abort(); error = null; dirty = true; pump(); },
    dispose() {
      if (disposed) return;
      disposed = true; generation++; controller?.abort(); if (timer) clearTimeout(timer);
      options.remove([...resident.keys()]); resident.clear();
    },
  };
}
