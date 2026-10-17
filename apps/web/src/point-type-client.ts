import { TORONTO_SEMANTIC_LABELS, type TorontoSemanticLabel } from '@spatial/contracts';
import type { TorontoDraftPoint } from './draft-context';
import { pointSemanticName } from './point-presentation';

export type PointTypeState = ReadonlyMap<string, TorontoSemanticLabel | 'loading' | undefined>;
/** Source coordinates, not effective override positions, bind this UI-only metadata. */
export function pointTypeKey(point: TorontoDraftPoint): string {
  return JSON.stringify([point.datasetId, point.artifactRevision, point.key.sourceFileId, point.key.sourceRow, point.position]);
}
export async function fetchPointType(point: TorontoDraftPoint, signal: AbortSignal, transport: typeof fetch = fetch): Promise<TorontoSemanticLabel> {
  const params = new URLSearchParams({ revision: point.artifactRevision, sourceFileId: String(point.key.sourceFileId), sourceRow: String(point.key.sourceRow) });
  const response = await transport(`/datasets/toronto3d/point?${params}`, { signal });
  if (!response.ok) throw new Error('Point type unavailable');
  const text = await response.text();
  if (text.length > 4096) throw new Error('Point type response too large');
  const value = JSON.parse(text);
  if (!value || value.datasetId !== point.datasetId || value.artifactRevision !== point.artifactRevision || value.frameId !== point.frameId ||
      value.units !== point.units || value.handedness !== point.handedness || value.upAxis !== point.upAxis ||
      !Array.isArray(value.localOrigin) || value.localOrigin.length !== 3 || !point.localOrigin.every((n, i) => n === value.localOrigin[i]) ||
      value.key?.sourceFileId !== point.key.sourceFileId || value.key?.sourceRow !== point.key.sourceRow ||
      !Array.isArray(value.position) || value.position.length !== 3 || !point.position.every((n, i) => n === value.position[i]) ||
      typeof value.semanticLabel !== 'number' || !Number.isInteger(value.semanticLabel) || !Object.hasOwn(TORONTO_SEMANTIC_LABELS, value.semanticLabel)) throw new Error('Point type source mismatch');
  signal.throwIfAborted();
  return value.semanticLabel as TorontoSemanticLabel;
}

/** One request at a time, at most the selected-reference count retained. No point,
 * model context, proposal, query, or source geometry is mutated by a late label. */
export function createPointTypeChannel(publish: (state: PointTypeState) => void, transport: typeof fetch = fetch) {
  let state = new Map<string, TorontoSemanticLabel | 'loading' | undefined>();
  let generation = 0, controller: AbortController | undefined, alive = true;
  return {
    bind(points: readonly TorontoDraftPoint[]) {
      const ticket = ++generation; controller?.abort(); controller = new AbortController();
      const current = controller;
      const unresolved = points.filter(point => pointSemanticName(point) === 'Unknown');
      const previous = state;
      state = new Map(unresolved.map(point => {
        const key = pointTypeKey(point);
        return [key, previous.has(key) && previous.get(key) !== 'loading' ? previous.get(key) : 'loading'];
      }));
      publish(new Map(state));
      void (async () => {
        for (const point of unresolved) {
          const key = pointTypeKey(point);
          if (state.get(key) !== 'loading') continue;
          let label: TorontoSemanticLabel | undefined;
          try { label = await fetchPointType(point, AbortSignal.any([current.signal, AbortSignal.timeout(3500)]), transport); }
          catch { /* Optional type metadata fails quietly to Unknown, never a guessed label. */ }
          if (!alive || current.signal.aborted || ticket !== generation) return;
          state.set(key, label); publish(new Map(state));
        }
      })();
    },
    dispose() { alive = false; generation++; controller?.abort(); state.clear(); },
  };
}
