// Actual prepared-artifact benchmark. Does not rerun the ~79s exhaustive oracle.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { NearestPoleRequest, NearestPoleToolOutcome } from '@spatial/contracts';
import { SemanticArtifact } from '../apps/server/src/semantic-artifact';
import { preparePoleIndex, queryIndexedClosestPole } from '../apps/server/src/pole-index';

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
  assert.equal(result.sourceReads!.payloadBytes, result.verification.payloadBytes + 2 * result.search.resolutionPayloadBytes);
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
    scope: 'one complete category index build; exact whole-category linear verification on every query; selected/winner original prepared record reads',
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
