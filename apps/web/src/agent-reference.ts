import { canonicalModelScene, TORONTO_SEMANTIC_LABELS, type ModelReferenceSelection, type TorontoSemanticLabel } from '@spatial/contracts';
import type { TorontoDraftPoint } from './draft-context';

/** Resolve original source records, never rendered Float32 or effective override positions. */
export async function resolveAgentTorontoPoint(reference: Extract<ModelReferenceSelection, { kind: 'toronto-point' }>, revision: string, signal: AbortSignal, transport: typeof fetch = fetch): Promise<Omit<TorontoDraftPoint, 'name'>> {
  const params = new URLSearchParams({ revision, sourceFileId: String(reference.key.sourceFileId), sourceRow: String(reference.key.sourceRow) });
  const response = await transport(`/datasets/toronto3d/point?${params}`, { signal });
  if (!response.ok || !response.body) throw new Error('Original source point unavailable.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted(); const next = await reader.read(); if (next.done) break;
      size += next.value.length; if (size > 4096) throw new Error('Source point response exceeds limit.'); chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (value.artifactRevision !== revision || value.key?.sourceFileId !== reference.key.sourceFileId || value.key?.sourceRow !== reference.key.sourceRow ||
    !Number.isInteger(value.semanticLabel) || !Object.hasOwn(TORONTO_SEMANTIC_LABELS, value.semanticLabel)) throw new Error('Source point binding mismatch.');
  const { semanticLabel, ...original } = value;
  const point = canonicalModelScene({ mode: 'toronto', project: null, toronto: [{ ...original, name: 'Point 1' }] }).toronto[0]!;
  const { name: _name, ...source } = point;
  return { ...source, semanticLabel: semanticLabel as TorontoSemanticLabel };
}
