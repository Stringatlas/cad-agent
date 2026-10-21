import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TORONTO_SEMANTIC_LABELS, type Vec3, type ModelAreaOfInterest } from '@spatial/contracts';
import { SemanticArtifact } from '../../apps/server/src/spatial/semantic-artifact';
import { getSemanticDiskIndex, dropSemanticDiskIndexMemoryCache } from '../../apps/server/src/spatial/semantic-disk-index';
export type SourcePoint = { xyz: Vec3; label: number };
export function denseGround(size: number, cell = .5): SourcePoint[] {
  const points: SourcePoint[] = [];
  for (let y = cell / 2; y < size; y += cell) for (let x = cell / 2; x < size; x += cell) for (let n = 0; n < 3; n++) points.push({ xyz: [x, y, 0], label: n === 2 ? 2 : 1 });
  return points;
}
export async function candidateSource(raw: SourcePoint[]) {
  const root = await mkdtemp(join(tmpdir(), 'area-candidate-source-')); await mkdir(join(root, 'octree'));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: raw.length, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-1000, -1000, -100], max: [1000, 1000, 1000] }, scale: [.001, .001, .001], offset: [0, 0, 0], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-1000, -1000, -100], max: [1000, 1000, 1000] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 }] };
  const payload = Buffer.alloc(raw.length * 28);
  raw.forEach((p, i) => {
    p.xyz.forEach((n, a) => payload.writeInt32LE(Math.round(n * 1000), i * 28 + a * 4));
    payload.writeUInt16LE(1, i * 28 + 18); payload.writeUInt32LE(i, i * 28 + 20); payload.writeFloatLE(p.label, i * 28 + 24);
  });
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(raw.length, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale,
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? raw.length : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const snapshot = await SemanticArtifact.open(root), prepared = await getSemanticDiskIndex(snapshot);
  const area = (size: number): ModelAreaOfInterest => ({ datasetId: 'toronto3d', artifactRevision: snapshot.dataset.revision, frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0], corners: [[0, 0, 100], [size, 0, 100], [size, size, 100], [0, size, 100]] });
  return { root, snapshot, area, async close() {
    dropSemanticDiskIndexMemoryCache(); await snapshot.close();
    await rm(prepared.index.directory, { recursive: true, force: true }); await rm(root, { recursive: true, force: true });
  } };
}
