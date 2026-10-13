// Task008: actual loopback HTTP + production browser channel. Historical task007
// scripts/artifacts and the persisted cache are read-only benchmark inputs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalPoleRequest, type NearestPoleToolOutcome } from '@spatial/contracts';
import { DEFAULT_DATASET_ROOT } from '../apps/server/src/dataset-routes';
import { createDemoServer } from '../apps/server/src/index';
import { PotreeDataset } from '../apps/server/src/potree';
import { SemanticArtifact } from '../apps/server/src/semantic-artifact';
import { createPoleChannel, validatePoleResult, type PoleState } from '../apps/web/src/pole-client';
import { createPolePickCache, type PoleSelection } from '../apps/web/src/pole-picking';

const output = fileURLToPath(new URL('../artifacts/closest-pole-performance/', import.meta.url));
const historicalPath = new URL('../artifacts/closest-pole-ui/actual-http.json', import.meta.url);
const backendPath = new URL('../artifacts/closest-pole-performance/actual-data.json', import.meta.url);
const controller = new AbortController(), abort = () => controller.abort();
process.once('SIGINT', abort); process.once('SIGTERM', abort);
const signal = controller.signal;
function found(value: NearestPoleToolOutcome) {
  assert.equal(value.status, 'verified-found', JSON.stringify(value));
  if (value.status !== 'verified-found') throw new Error('Expected verified-found');
  return value;
}
async function inputs() {
  const historical = JSON.parse(await readFile(historicalPath, 'utf8')) as {
    status: string; selected: PoleSelection; result: NearestPoleToolOutcome; elapsedSeconds: number;
    display: { count: number; sampleHash: string; containsWinner: boolean }; harnessHash: string;
  };
  assert.equal(historical.status, 'passed');
  const historicalResult = found(historical.result);
  validatePoleResult(historicalResult, canonicalPoleRequest(historicalResult.request));
  assert.deepEqual(historical.selected.key, { sourceFileId: 4, sourceRow: 156656 });
  assert.deepEqual(historical.selected.position, [243.786, 243.429, 141.267]);
  assert.deepEqual(historicalResult.nearest!.key, { sourceFileId: 4, sourceRow: 486157 });
  assert.equal(historicalResult.nearest!.distanceMeters, 26.550779009287126);
  assert.equal(historicalResult.search.matchingPoints, 897825);
  const backend = JSON.parse(await readFile(backendPath, 'utf8')) as {
    status: string; preparation: { result: { directory: string; indexHash: string; indexedPoints: number; totalPoints: number } };
  };
  assert.equal(backend.status, 'passed');
  const prepared = backend.preparation.result;
  // Fail before invoking a route if the recorded cache is missing or its source
  // binding changed. Never call preparePoleIndex/drop cache or allow a cold build.
  const snapshot = await SemanticArtifact.open(DEFAULT_DATASET_ROOT, signal);
  let binding: string;
  try {
    const identities = [];
    for (const asset of ['manifest.json', 'octree/metadata.json', 'octree/hierarchy.bin', 'octree/octree.bin']) {
      const stat = await lstat(join(snapshot.root, asset));
      identities.push([stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
    }
    await snapshot.check(signal);
    binding = createHash('sha256').update(JSON.stringify([snapshot.root, snapshot.dataset.revision, identities])).digest('hex');
    assert.equal(snapshot.dataset.revision, historical.selected.artifactRevision);
    assert.equal(snapshot.dataset.totalPoints, 78320210);
  } finally { await snapshot.close(); }
  const cacheDirectory = join(await realpath(tmpdir()), 'spatial-cad-pole-index-v1', binding);
  assert.equal(cacheDirectory, prepared.directory, 'Dataset identity changed; cache rebuild is outside this benchmark');
  assert.equal(await realpath(cacheDirectory), cacheDirectory);
  const cacheFiles = ['index.json', 'poles.bin', 'source-1.bin', 'source-2.bin', 'source-3.bin', 'source-4.bin'];
  const cacheIdentities = await Promise.all(cacheFiles.map(async asset => {
    const stat = await lstat(join(cacheDirectory, asset)); assert.ok(stat.isFile() && !stat.isSymbolicLink());
    return [asset, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs];
  }));
  const header = JSON.parse(await readFile(join(cacheDirectory, 'index.json'), 'utf8')) as {
    identity: string; revision: string; hash: string; points: number; totalPoints: number;
  };
  assert.equal(header.identity, binding); assert.equal(header.revision, historical.selected.artifactRevision);
  assert.equal(header.hash, prepared.indexHash); assert.match(header.hash, /^[a-f0-9]{64}$/);
  assert.equal(header.points, 897825); assert.equal(header.totalPoints, 78320210);
  assert.equal(prepared.indexedPoints, header.points); assert.equal(prepared.totalPoints, header.totalPoints);
  return { historical, historicalResult, cacheDirectory, cacheFiles, cacheIdentities, header };
}

async function measureHttp(warmRepeats: number) {
  const input = await inputs(), dataset = new PotreeDataset(DEFAULT_DATASET_ROOT);
  // Reproduce task007's actual picking baseline rather than inventing a query
  // coordinate or substituting an array offset for original source provenance.
  const sample = await dataset.sample({ budget: 10000, depth: 0 }, 'display', signal);
  const selected = createPolePickCache(sample).resolve(0); assert.ok(selected);
  assert.deepEqual(selected, input.historical.selected);
  assert.equal(sample.sampleHash, input.historical.display.sampleHash);
  const harnessBefore = await dataset.observe({ budget: 256, depth: 0 }, signal);
  assert.equal(harnessBefore.sampleHash, input.historical.harnessHash);
  const server = createDemoServer(), originalFetch = globalThis.fetch;
  let channel: ReturnType<typeof createPoleChannel> | undefined;
  let requests = 0, state: PoleState = { phase: 'idle' }, queryStarted = 0;
  let phases: { phase: PoleState['phase']; milliseconds: number; progress?: PoleState['progress'] }[] = [];
  let responses: { status: number; contentType: string | null; headersMilliseconds: number }[] = [];
  const cancel = () => channel?.cancel(); signal.addEventListener('abort', cancel, { once: true });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening', { signal });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    // Only resolve the browser's relative URL to this real loopback server.
    // Fetch, NDJSON streaming, request binding and result validation are production.
    globalThis.fetch = (async (url, options) => {
      assert.ok(typeof url === 'string' && url.startsWith('/datasets/toronto3d/closest-pole?'));
      requests++;
      const response = await originalFetch(base + url, options);
      responses.push({ status: response.status, contentType: response.headers.get('content-type'), headersMilliseconds: performance.now() - queryStarted });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /^application\/x-ndjson/);
      return response;
    }) as typeof fetch;
    channel = createPoleChannel(value => {
      state = value;
      phases.push({ phase: value.phase, milliseconds: performance.now() - queryStarted, ...(value.progress ? { progress: value.progress } : {}) });
    });
    const measurements = [];
    for (let iteration = 0; iteration <= warmRepeats; iteration++) {
      signal.throwIfAborted(); phases = []; responses = []; state = { phase: 'idle' };
      const priorRequests = requests, cpu = process.cpuUsage(); queryStarted = performance.now();
      await channel.select(selected); const milliseconds = performance.now() - queryStarted;
      signal.throwIfAborted();
      assert.equal(state.phase, 'verified-found', JSON.stringify(state));
      assert.ok(state.result); const result = found(state.result);
      assert.equal(requests - priorRequests, 1, 'Each channel query must perform real HTTP');
      assert.equal(responses.length, 1);
      assert.deepEqual(result.request.input, { kind: 'point-ref', key: selected.key });
      assert.equal(result.request.domain.kind, 'whole-dataset');
      assert.deepEqual(result.queryPosition, input.historicalResult.queryPosition);
      assert.deepEqual(result.nearest, input.historicalResult.nearest, 'Exact original winner/distance must be unchanged');
      assert.equal(result.dataset.totalPoints, 78320210);
      assert.equal(result.search.algorithm, 'pole-category-index-v1');
      assert.equal(result.search.completion, 'indexed'); assert.equal(result.search.arithmetic, 'xyz-binary64-v1');
      assert.deepEqual(result.search.index, { points: 897825, hash: input.header.hash });
      assert.deepEqual(result.verification.index, result.search.index);
      assert.equal(result.verification.verifier, 'pole-category-linear-v1');
      assert.equal(result.verification.scannedPoints, 897825);
      assert.ok(result.search.scannedPoints > 0 && result.search.scannedPoints < 897825);
      for (const evidence of [result.search, result.verification]) {
        assert.equal(evidence.matchingPoints, 897825); assert.equal(evidence.resolutionPoints, 1);
        assert.equal(evidence.resolutionPayloadBytes, 55); assert.equal(evidence.hierarchyBytes, 0);
        assert.equal(evidence.hierarchyChunks, 0); assert.equal(evidence.payloadNodes, 0);
        assert.equal(evidence.artifactRevision, selected.artifactRevision);
      }
      assert.equal(result.search.payloadBytes, 0); assert.equal(result.verification.payloadBytes, 55);
      assert.match(result.verification.transcriptHash, /^[a-f0-9]{64}$/);
      assert.notEqual(result.search.traversalHash, result.verification.transcriptHash);
      assert.equal(result.sourceReads?.payloadBytes, 165, 'Only two original reference reads plus winning record');
      assert.equal(result.sourceReads.payloadBytes, 2 * result.search.resolutionPayloadBytes + result.verification.payloadBytes);
      measurements.push({ mode: iteration === 0 ? 'persisted-first-query' : 'warm-query', milliseconds,
        historicalSpeedup: input.historical.elapsedSeconds * 1000 / milliseconds, cpuMicroseconds: process.cpuUsage(cpu),
        responses, phases, result });
    }
    assert.equal(requests, warmRepeats + 1);
    const harnessAfter = await dataset.observe({ budget: 256, depth: 0 }, signal);
    assert.deepEqual(harnessAfter, harnessBefore);
    const cacheAfter = await Promise.all(input.cacheFiles.map(async asset => {
      const stat = await lstat(join(input.cacheDirectory, asset));
      return [asset, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs];
    }));
    assert.deepEqual(cacheAfter, input.cacheIdentities, 'Persisted cache must not be replaced or modified');
    return { status: 'passed', pid: process.pid, node: process.version, selected, measurements, httpRequests: requests,
      index: { points: input.header.points, hash: input.header.hash }, cacheDirectory: input.cacheDirectory, cacheUnchanged: true,
      baselinePath: 'artifacts/closest-pole-ui/actual-http.json', historicalBaselineMilliseconds: input.historical.elapsedSeconds * 1000,
      baselineRerun: false, coldBuild: false, display: { count: sample.count, sampleHash: sample.sampleHash },
      harnessHash: harnessBefore.sampleHash, harnessUnchanged: true, peakMemoryBytes: process.resourceUsage().maxRSS * 1024 };
  } finally {
    channel?.dispose(); globalThis.fetch = originalFetch; signal.removeEventListener('abort', cancel);
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
async function freshProcess() {
  return new Promise<Awaited<ReturnType<typeof measureHttp>>>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--persisted-child'], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], signal,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject); child.once('close', code => {
      if (code !== 0) reject(new Error(`Fresh-process HTTP check failed (${code}): ${stderr}`));
      else { try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); } }
    });
  });
}
if (process.argv.includes('--persisted-child')) {
  try { console.log(JSON.stringify(await measureHttp(2))); }
  catch (error) { console.error(error); process.exitCode = 1; }
} else {
  const report: Record<string, unknown> = { status: 'failed', command: 'pnpm exec tsx scripts/check-closest-pole-performance-http.ts',
    scope: 'actual loopback production route/transport and production browser channel/client; category-linear verifier, not original full-record oracle',
    baselineRerun: false, coldBuild: false, browserRenderingChecked: false };
  await mkdir(output, { recursive: true });
  try {
    const current = await measureHttp(5); report.currentProcess = current;
    const persisted = await freshProcess(); report.freshProcess = persisted;
    assert.notEqual(current.pid, persisted.pid);
    assert.deepEqual(current.selected, persisted.selected); assert.deepEqual(current.index, persisted.index);
    await writeFile(join(output, 'http-persisted-first.json'), JSON.stringify(persisted, null, 2) + '\n');
    const warm = [...current.measurements.slice(1), ...persisted.measurements.slice(1)].map(value => value.milliseconds);
    const first = [current.measurements[0].milliseconds, persisted.measurements[0].milliseconds];
    const summary = { status: 'passed', historicalBaselineMilliseconds: current.historicalBaselineMilliseconds,
      baselineRerun: false, coldBuild: false, httpRequests: current.httpRequests + persisted.httpRequests,
      persistedFirstMilliseconds: first, freshProcessFirstMilliseconds: persisted.measurements[0].milliseconds,
      warmMilliseconds: warm, warmMinimumMilliseconds: Math.min(...warm), warmMaximumMilliseconds: Math.max(...warm),
      warmMeanMilliseconds: warm.reduce((sum, value) => sum + value, 0) / warm.length,
      minimumWarmSpeedup: current.historicalBaselineMilliseconds / Math.max(...warm),
      originalSourcePayloadBytesPerReference: 165, categoryVerifierPoints: 897825, index: current.index,
      winner: current.measurements[0].result.nearest, cacheUnchanged: true, harnessUnchanged: true,
      browserRenderingChecked: false };
    report.summary = summary;
    // Interactive acceptance: at least two orders of magnitude on warm HTTP.
    assert.ok(summary.minimumWarmSpeedup >= 100, `Warm HTTP speedup ${summary.minimumWarmSpeedup}x is below 100x`);
    report.status = 'passed';
    await writeFile(join(output, 'http-summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) { report.error = String(error); console.error(error); process.exitCode = 1; }
  await writeFile(join(output, 'http-actual.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: artifacts/closest-pole-performance/http-actual.json`);
}
process.off('SIGINT', abort); process.off('SIGTERM', abort);
