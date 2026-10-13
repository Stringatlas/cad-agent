// One explicit-region actual check; scans the full prepared payload, never regenerates data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { NearestPoleRequest, Vec3 } from '@spatial/contracts';
import { queryClosestPole } from '../apps/server/src/semantic-query';
import { PotreeDataset } from '../apps/server/src/potree';
import { DEFAULT_DATASET_ROOT } from '../apps/server/src/dataset-routes';

const output = 'artifacts/closest-pole/actual-data.json';
const report: Record<string, unknown> = { status: 'failed', command: 'pnpm exec tsx scripts/check-closest-pole.ts', scope: 'one inclusive 5m AABB; whole-payload scans for search and independent verification' };
const started = performance.now();
const controller = new AbortController();
const abort = () => controller.abort(); process.once('SIGINT', abort); process.once('SIGTERM', abort);
async function hashFile(path: string) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) {
    controller.signal.throwIfAborted(); hash.update(chunk);
  } return hash.digest('hex');
}
try {
  const sampler = new PotreeDataset(DEFAULT_DATASET_ROOT), root = await sampler.sample({ budget: 100000, depth: 0 }, 'display', controller.signal);
  const indexes = root.labels.flatMap((label, i) => label === 6 ? [i] : []);
  indexes.sort((a, b) => root.sourceIds[a * 2] - root.sourceIds[b * 2] || root.sourceIds[a * 2 + 1] - root.sourceIds[b * 2 + 1]);
  assert.ok(indexes.length, 'No Pole in root payload: choose and record another complete payload before retrying');
  const index = indexes[0], selected = root.positions.slice(index * 3, index * 3 + 3) as unknown as Vec3;
  const q: Vec3 = [selected[0] + 0.25, selected[1] + 0.25, selected[2]];
  const request: NearestPoleRequest = { requestId: 'actual-aabb-v1', datasetId: 'toronto3d', expectedArtifactRevision: root.dataset.revision, units: 'm', frameId: 'toronto3d-local-v1',
    input: { kind: 'coordinate', position: q }, filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: 6 }, metric: 'euclidean-3d',
    domain: { kind: 'aabb', min: q.map(n => n - 2.5) as unknown as Vec3, max: q.map(n => n + 2.5) as unknown as Vec3 } };
  report.request = request; report.seed = { node: 'r', key: root.sourceIds.slice(index * 2, index * 2 + 2), position: selected };
  const harnessBefore = await sampler.observe({ budget: 1024, depth: 2 }, controller.signal);
  const displayBefore = await sampler.sample({ budget: 100000, depth: 3 }, 'display', controller.signal);
  let lastLog = 0;
  const progress = (event: { phase: string; scannedPoints: number; payloadBytes: number }) => {
    if (performance.now() - lastLog > 4000) { lastLog = performance.now(); console.log(`${event.phase}: ${event.scannedPoints} points, ${event.payloadBytes} payload bytes`); }
  };
  const firstStart = performance.now(), result = await queryClosestPole(DEFAULT_DATASET_ROOT, request, controller.signal, progress);
  report.firstMilliseconds = performance.now() - firstStart; report.result = result;
  assert.equal(result.status, 'verified-found', JSON.stringify(result)); if (result.status !== 'verified-found') throw new Error('Not verified');
  assert.ok(result.nearest); assert.equal(result.search.scannedPoints, root.dataset.totalPoints); assert.equal(result.verification.scannedPoints, root.dataset.totalPoints);
  const repeatStart = performance.now(), repeated = await queryClosestPole(DEFAULT_DATASET_ROOT, request, controller.signal, progress);
  report.repeatMilliseconds = performance.now() - repeatStart; assert.deepEqual(repeated, result);
  assert.deepEqual(await sampler.observe({ budget: 1024, depth: 2 }, controller.signal), harnessBefore);
  assert.deepEqual(await sampler.sample({ budget: 100000, depth: 3 }, 'display', controller.signal), displayBefore);
  report.independence = { harnessHash: harnessBefore.sampleHash, displayHash: displayBefore.sampleHash };
  // Read just the winner's original PLY record, independently of prepared decode.
  const raw = await open(join(DEFAULT_DATASET_ROOT, '../../../raw/toronto3d', `L00${result.nearest.key.sourceFileId}.ply`), 'r');
  try {
    const headerBytes = Buffer.alloc(65536); await raw.read(headerBytes, 0, headerBytes.length, 0);
    const marker = Buffer.from('end_header\n'), end = headerBytes.indexOf(marker); assert.ok(end >= 0);
    const header = headerBytes.subarray(0, end + marker.length).toString('ascii');
    assert.match(header, /format binary_little_endian 1.0/);
    assert.deepEqual(header.split('\n').filter(s => s.startsWith('property ')), ['property double x', 'property double y', 'property double z',
      'property uchar red', 'property uchar green', 'property uchar blue', 'property float scalar_Intensity', 'property float scalar_GPSTime', 'property float scalar_ScanAngleRank', 'property float scalar_Label']);
    const bytes = Buffer.alloc(43), offset = end + marker.length + result.nearest.key.sourceRow * 43;
    assert.equal((await raw.read(bytes, 0, bytes.length, offset)).bytesRead, bytes.length);
    assert.equal(bytes.readFloatLE(39), 6);
    const origin = root.dataset.coordinates.localOrigin, rawLocal = [0, 1, 2].map(i => bytes.readDoubleLE(i * 8) - origin[i]);
    const errors = rawLocal.map((n, i) => Math.abs(n - result.nearest!.position[i])); assert.ok(errors.every(n => n <= 0.0015 + 1e-8));
    report.rawWitness = { key: result.nearest.key, rawLocal, preparedLocal: result.nearest.position, errors, tolerancePerAxisMeters: 0.0015 };
  } finally { await raw.close(); }
  const digests: Record<string, string> = {};
  for (const asset of ['manifest.json', 'octree/metadata.json', 'octree/hierarchy.bin', 'octree/octree.bin']) digests[asset] = await hashFile(join(DEFAULT_DATASET_ROOT, asset));
  digests['validation-report.json'] = await hashFile(join(DEFAULT_DATASET_ROOT, '../validation-report.json')); report.artifactDigests = digests;
  const owned = ['packages/contracts/src/index.ts', 'packages/contracts/src/semantic-query.ts', 'packages/agent-harness/src/index.ts', 'packages/agent-harness/src/semantic-query.ts',
    'apps/server/src/semantic-artifact.ts', 'apps/server/src/semantic-query.ts', 'apps/server/src/semantic-verifier.ts', 'tests/semantic-query.test.ts', 'scripts/check-closest-pole.ts'];
  const code = createHash('sha256'); for (const path of owned.sort()) code.update(path).update(await readFile(path));
  report.code = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), ownedFiles: owned, ownedSourceHash: code.digest('hex'),
    node: process.version, pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim() };
  report.status = 'passed';
} catch (error) { report.error = String(error); report.cancelled = controller.signal.aborted; process.exitCode = 1; }
finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
report.totalMilliseconds = performance.now() - started;
await mkdir('artifacts/closest-pole', { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Closest Pole actual check: ${report.status}; ${output}`);
