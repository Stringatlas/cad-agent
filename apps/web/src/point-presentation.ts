import { TORONTO_SEMANTIC_LABELS, type PointObservation, type TorontoSemanticLabel } from '@spatial/contracts';
import type { PoleSelection } from './pole-picking';
import type { TorontoDraftPoint } from './draft-context';

export function semanticName(label: unknown): string {
  return typeof label === 'number' && Number.isInteger(label) && Object.hasOwn(TORONTO_SEMANTIC_LABELS, label)
    ? TORONTO_SEMANTIC_LABELS[label as TorontoSemanticLabel].replaceAll('_', ' ') : 'Unknown';
}

/** UI-only source metadata; otherwise match original provenance AND coordinates, never color/proximity. */
export function observedPointLabel(point: PoleSelection, observation?: PointObservation): TorontoSemanticLabel | undefined {
  if (semanticName(point.semanticLabel) !== 'Unknown') return point.semanticLabel;
  if (!observation || observation.dataset.revision !== point.artifactRevision || observation.dataset.id !== point.datasetId) return;
  for (let i = 0; i < observation.count; i++) {
    if (observation.sourceIds[i * 2] !== point.key.sourceFileId || observation.sourceIds[i * 2 + 1] !== point.key.sourceRow) continue;
    if (!point.position.every((n, axis) => n === observation.positions[i * 3 + axis])) return;
    const label = observation.labels[i];
    return semanticName(label) === 'Unknown' ? undefined : label as TorontoSemanticLabel;
  }
}
export function pointSemanticName(point: TorontoDraftPoint): string {
  // Validated nearest-label lineage is also an exact source-class witness.
  return semanticName(point.semanticLabel ?? (point.evidence?.outcome.status === 'verified-found' ? point.evidence.request.filter.value : undefined));
}
