// Independent offline membership audit: scans original prepared records, not the semantic cache.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SemanticArtifact, SEMANTIC_LIMITS } from '../apps/server/src/semantic-artifact';
import type { InstanceManifest } from '../apps/server/src/semantic-instances';

export async function checkSemanticInstances(datasetRoot: string, directory: string, signal?: AbortSignal) {
  assert.ok((await stat(join(directory, 'manifest.json'))).size <= 64 * 1024 * 1024, 'Audit manifest budget exceeded');
  const manifest: InstanceManifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, 'semantic-instances-v1'); assert.equal(manifest.complete, true);
  assert.equal(manifest.membership.file, 'memberships.bin'); assert.equal(manifest.membership.recordBytes, 16);
  assert.equal(manifest.binding.units, 'm'); assert.equal(manifest.binding.frameId, 'toronto3d-local-v1');
  const snapshot = await SemanticArtifact.open(datasetRoot, signal);
  try {
    assert.equal(snapshot.dataset.revision, manifest.binding.artifactRevision);
    assert.deepEqual(snapshot.dataset.coordinates, manifest.binding.coordinates);
    const membership = await open(join(directory, 'memberships.bin'), 'r');
    try {
      assert.equal((await membership.stat()).size, manifest.membership.bytes);
      const counts = new Uint32Array(manifest.instances.length), selected = new Set(manifest.settings.classes.map(c => c.label));
      const sourceHash = createHash('sha256'), membershipHash = createHash('sha256');
      const buffer = Buffer.alloc(64 * 1024); let used = 0, loaded = 0, consumed = 0;
      const next = async () => {
        if (used === loaded) {
          const wanted = Math.min(buffer.length, manifest.membership.bytes - consumed);
          assert.ok(wanted >= 16, 'Missing source membership');
          const read = await membership.read(buffer, 0, wanted, consumed); assert.equal(read.bytesRead, wanted);
          loaded = wanted; used = 0; membershipHash.update(buffer.subarray(0, loaded));
        }
        const values = [0, 4, 8, 12].map(at => buffer.readUInt32LE(used + at)); used += 16; consumed += 16; return values;
      };
      const { stride, fields } = snapshot.layout, perRead = Math.floor(SEMANTIC_LIMITS.readBytes / stride);
      for (let base = 0; base < snapshot.dataset.totalPoints; base += perRead) {
        const count = Math.min(perRead, snapshot.dataset.totalPoints - base);
        const bytes = await snapshot.read('payload', base * stride, count * stride, signal); sourceHash.update(bytes);
        for (let i = 0; i < count; i++) {
          const at = i * stride, label = bytes.readFloatLE(at + fields.scalar_Label);
          if (!selected.has(label as 4 | 6 | 7 | 8)) continue;
          const [ordinal, file, row, physical] = await next();
          assert.ok(ordinal < manifest.instances.length, 'Unknown instance ordinal'); assert.equal(manifest.instances[ordinal].label, label);
          assert.equal(file, bytes.readUInt16LE(at + fields['point source id'])); assert.equal(row, bytes.readUInt32LE(at + fields.source_row));
          assert.equal(physical, base + i); counts[ordinal]++;
        }
      }
      assert.equal(consumed, manifest.membership.bytes); assert.equal(consumed / 16, manifest.membership.points);
      assert.equal(sourceHash.digest('hex'), manifest.binding.sourceHash); assert.equal(membershipHash.digest('hex'), manifest.membership.sha256);
      manifest.instances.forEach((instance, i) => assert.equal(counts[i], instance.points));
      await snapshot.check(signal);
      const summaries = manifest.settings.classes.map(c => ({ label: c.label, voxelMeters: c.voxelMeters,
        instances: manifest.instances.filter(i => i.label === c.label).length,
        points: manifest.instances.filter(i => i.label === c.label).reduce((sum, i) => sum + i.points, 0) }));
      return { status: 'passed', artifactRevision: snapshot.dataset.revision, originalPointsScanned: snapshot.dataset.totalPoints,
        exactMemberships: consumed / 16, summaries, sourceReads: snapshot.sourceReads,
        scope: 'Exact complete original-source memberships/counts/checksums; not an independent connectivity or segmentation-quality oracle' };
    } finally { await membership.close(); }
  } finally { await snapshot.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 4, 'Usage: check-semantic-instances.ts DATASET_ROOT INSTANCE_DIRECTORY');
    console.log(JSON.stringify(await checkSemanticInstances(resolve(process.argv[2]), resolve(process.argv[3]))));
  } catch (error) { console.error(JSON.stringify({ status: 'failed', error: String(error) })); process.exitCode = 1; }
}
