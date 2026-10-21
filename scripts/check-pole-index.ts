// Actual prepared-artifact benchmark. Does not rerun the ~79s exhaustive oracle.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { NearestPoleRequest, NearestPoleToolOutcome } from '@spatial/contracts';
import { SemanticArtifact } from '../apps/server/src/spatial/semantic-artifact';
import { preparePoleIndex, queryIndexedClosestPole } from '../apps/server/src/spatial/pole-index';

const root = fileURLToPath(new URL('../data/processed/toronto3d/prepared/', import.meta.url));
const controller = new AbortController(), abort = () => controller.abort();
process.once('SIGINT', abort); process.once('SIGTERM', abort);
const signal = controller.signal;
function verified(value: NearestPoleToolOutcome) {
  assert.ok(value.status === 'verified-found', JSON.stringify(value));
  if (value.status !== 'verified-found') throw new Error('Not verified');
  assert.deepEqual(value.nearest!.key, { sourceFileId: 4, sourceRow: 486157 });
  assert.deepEqual(value.nearest!.position, [261.605, 263.00100000000003, 139.178]);
  assert.equal(value.nearest!.distanceMeters, 26.550779009287126);
  assert.deepEqual(value.queryPosition, [243.786, 243.429, 141.267]);
  assert.equal(value.search.algorithm, 'semantic-disk-page-index-v1'); assert.equal(value.search.completion, 'indexed');
  assert.equal(value.search.arithmetic, 'xyz-binary64-v1'); assert.equal(value.verification.verifier, 'semantic-disk-page-verifier-v1');
  assert.equal(value.search.index!.points, 897825); assert.deepEqual(value.verification.index, value.search.index);
  assert.match(value.search.index!.hash, /^[a-f0-9]{64}$/);
  for (const evidence of [value.search, value.verification]) {
    assert.equal(evidence.matchingPoints, 897825);
    const disk = evidence.disk!; assert.ok(disk);
    assert.ok(Object.values(disk).every(n => Number.isSafeInteger(n) && n >= 0));
    assert.equal(disk.totalPages, Math.ceil(value.dataset.totalPoints / 4096));
    assert.equal(disk.visitedPages + disk.excludedPages + disk.prunedPages, disk.totalPages);
    assert.equal(disk.coveredPoints, value.dataset.totalPoints); assert.equal(disk.cacheBytes, evidence.scannedPoints * 40);
    assert.ok(disk.visitedPages > 0 && evidence.scannedPoints >= disk.visitedPages && evidence.scannedPoints <= Math.min(value.dataset.totalPoints, disk.visitedPages * 4096));
    const full: number = disk.visitedPages * 4096, tail: number = (disk.visitedPages - 1) * 4096 + (value.dataset.totalPoints % 4096 || 4096);
    assert.ok((full <= value.dataset.totalPoints && evidence.scannedPoints === full) || evidence.scannedPoints === tail, 'Visited pages contain complete records, including the single possible tail page');
    assert.equal(disk.maxCacheReadBytes, disk.visitedPages === 1 ? evidence.scannedPoints * 40 : 163840);
    assert.equal(evidence.payloadBytes, 55); assert.equal(evidence.hierarchyBytes, 0); assert.equal(evidence.hierarchyChunks, 0); assert.equal(evidence.payloadNodes, 0);
  }
  return value;
}
async function request(reference: boolean): Promise<NearestPoleRequest> {
  const snapshot = await SemanticArtifact.open(root, signal);
  try { return { requestId: reference ? 'pole-index-point-reference' : 'pole-index-coordinate', datasetId: 'toronto3d', expectedArtifactRevision: snapshot.dataset.revision,
    units: 'm', frameId: 'toronto3d-local-v1', input: reference ? { kind: 'point-ref', key: { sourceFileId: 4, sourceRow: 156656 } } : { kind: 'coordinate', position: [243.786, 243.429, 141.267] },
    filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: 6 }, metric: 'euclidean-3d', domain: { kind: 'whole-dataset' } }; }
  finally { await snapshot.close(); }
}
async function measured<T>(work: () => Promise<T>) {
  const cpu = process.cpuUsage(), start = performance.now(), result = await work();
  return { milliseconds: performance.now() - start, cpuMicroseconds: process.cpuUsage(cpu), result };
}
async function query(reference: boolean) {
  const r = await request(reference), timing = await measured(() => queryIndexedClosestPole(root, r, signal));
  const result = verified(timing.result);
  for (const evidence of [result.search, result.verification]) {
    assert.equal(evidence.resolutionPoints, reference ? 1 : 0); assert.equal(evidence.resolutionPayloadBytes, reference ? 55 : 0);
  }
  assert.equal(result.sourceReads!.payloadBytes, reference ? 220 : 110, 'Two independent winners plus, for point-ref, two selected original records');
  assert.equal(result.sourceReads!.payloadBytes, result.search.payloadBytes + result.verification.payloadBytes + result.search.resolutionPayloadBytes + result.verification.resolutionPayloadBytes);
  return { ...timing, result };
}
async function restarted() {
  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--restart'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], signal });
    let output = '', errors = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
    child.once('error', reject); child.once('close', code => {
      if (code !== 0) reject(new Error(`Restart check failed: ${errors}`));
      else { try { resolve(JSON.parse(output)); } catch (error) { reject(error); } }
    });
  });
}
if (process.argv.includes('--restart')) {
  try { console.log(JSON.stringify({ firstCoordinate: await query(false), warmReference: await query(true), peakMemoryBytes: process.resourceUsage().maxRSS * 1024 })); }
  catch (error) { console.error(error); process.exitCode = 1; }
} else {
  const report: Record<string, unknown> = { status: 'failed', command: 'pnpm exec tsx scripts/check-pole-index.ts', node: process.version,
    scope: 'offline common all-label disk index preparation (built/loaded/memory reported separately); independently ordered proof-aware page verification on every query; two original winners and two original selected records for point-ref',
    historicalBaselineMilliseconds: 79000, baselineRerun: false };
  try {
    let last = 0;
    const preparation = await measured(() => preparePoleIndex(root, signal, event => {
      if (performance.now() - last > 3000) { last = performance.now(); console.log(`prepare ${event.scannedPoints} points; ${event.payloadBytes} bytes`); }
    }));
    report.preparation = preparation;
    report.coldBuild = preparation.result.cache === 'built';
    report.coordinate = await query(false); report.reference = await query(true);
    report.repeats = [await query(false), await query(true), await query(false), await query(true)];
    report.persistedRestart = await restarted();
    let cacheBytes = 0; for (const asset of await readdir(preparation.result.directory)) cacheBytes += (await stat(join(preparation.result.directory, asset))).size;
    report.cacheBytes = cacheBytes; report.peakMemoryBytes = process.resourceUsage().maxRSS * 1024;
    report.status = 'passed';
  } catch (error) { report.error = String(error); report.cancelled = signal.aborted; process.exitCode = 1; }
  await mkdir('artifacts/closest-pole-performance', { recursive: true });
  await writeFile('artifacts/closest-pole-performance/actual-data.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: artifacts/closest-pole-performance/actual-data.json`);
}
process.off('SIGINT', abort); process.off('SIGTERM', abort);
