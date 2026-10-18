import { assertVec3, type Vec3, type TorontoSemanticLabel } from '@spatial/contracts';
import type { TorontoDraftPoint } from './draft-context';

interface Witness { position: Vec3; label: TorontoSemanticLabel; source: { sourceFileId: number; sourceRow: number }; artifactRevision: string; frameId: string; units: string }
export interface PlacementWitnessSelection { kind: 'utility-box-witness'; assessment: unknown; volume: 'body' | 'access'; witness: Witness }
/** Display only a bounded subset already returned by a complete, source-bound assessment. */
export function placementWitnesses(value: unknown, references: readonly TorontoDraftPoint[]): PlacementWitnessSelection[] {
  try {
    const a = value as { status: string; complete: boolean; pointName: string; source: TorontoDraftPoint; binding: { artifactRevision: string; frameId: string; units: string; domain: string }; body: { complete: boolean; points: Witness[] }; access: { complete: boolean; points: Witness[] } | null };
    const source = references.find(p => p.name === a.pointName);
    if (!source || a.status !== 'assessed' || a.complete !== true || a.binding.domain !== 'original-source-points' ||
      a.binding.artifactRevision !== source.artifactRevision || a.binding.frameId !== source.frameId || a.binding.units !== 'm' ||
      JSON.stringify(a.source.key) !== JSON.stringify(source.key) || JSON.stringify(a.source.position) !== JSON.stringify(source.position)) return [];
    const output: PlacementWitnessSelection[] = [];
    for (const volume of ['body', 'access'] as const) {
      const result = a[volume]; if (result === null && volume === 'access') continue;
      if (!result || result.complete !== true || !Array.isArray(result.points) || result.points.length > 12) return [];
      const witness = result.points[0]; if (!witness) continue;
      assertVec3(witness.position);
      if (!Number.isInteger(witness.label) || witness.label < 0 || witness.label > 8 || !Number.isInteger(witness.source.sourceFileId) || witness.source.sourceFileId < 1 || witness.source.sourceFileId > 4 ||
        !Number.isSafeInteger(witness.source.sourceRow) || witness.source.sourceRow < 0 || witness.source.sourceRow > 0xffffffff ||
        witness.artifactRevision !== source.artifactRevision || witness.frameId !== source.frameId || witness.units !== 'm') return [];
      output.push({ kind: 'utility-box-witness', assessment: value, volume, witness });
    }
    return output;
  } catch { return []; }
}
/** Reread the original record before adding a normal numbered scene pin. No invented nearest-verification lineage. */
export async function placementWitnessSelection(value: PlacementWitnessSelection, references: readonly TorontoDraftPoint[], transport: typeof fetch = fetch): Promise<Omit<TorontoDraftPoint, 'name'>> {
  const candidate = placementWitnesses(value.assessment, references).find(p => p.volume === value.volume && JSON.stringify(p.witness) === JSON.stringify(value.witness));
  if (!candidate) throw new Error('Placement evidence changed; assess again.');
  const witness = candidate.witness;
  const params = new URLSearchParams({ revision: witness.artifactRevision, sourceFileId: String(witness.source.sourceFileId), sourceRow: String(witness.source.sourceRow) });
  const response = await transport(`/datasets/toronto3d/point?${params}`, { signal: AbortSignal.timeout(5000) });
  const text = await response.text();
  if (!response.ok || text.length > 4096) throw new Error('Source witness unavailable; assess again.');
  const point = JSON.parse(text);
  if (point.datasetId !== 'toronto3d' || point.artifactRevision !== witness.artifactRevision || point.frameId !== 'toronto3d-local-v1' || point.units !== 'm' ||
    point.handedness !== 'right' || point.upAxis !== 'Z' || JSON.stringify(point.localOrigin) !== '[627285,4841948,0]' ||
    point.key.sourceFileId !== witness.source.sourceFileId || point.key.sourceRow !== witness.source.sourceRow ||
    JSON.stringify(point.position) !== JSON.stringify(witness.position) || point.semanticLabel !== witness.label) throw new Error('Source witness mismatch; assess again.');
  return { datasetId: 'toronto3d', artifactRevision: witness.artifactRevision, key: { sourceFileId: witness.source.sourceFileId, sourceRow: witness.source.sourceRow },
    position: [...witness.position], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0], semanticLabel: witness.label };
}
