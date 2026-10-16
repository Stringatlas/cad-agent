// Actual prepared data, one exhaustive point-reference HTTP query plus independent verifier.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createIsolatedDemoServer as createDemoServer } from './isolated-demo-server';
import { PotreeDataset } from '../apps/server/src/potree';
import { DEFAULT_DATASET_ROOT } from '../apps/server/src/dataset-routes';
import { createPolePickCache } from '../apps/web/src/pole-picking';
import { createPoleChannel, type PoleState } from '../apps/web/src/pole-client';

const directory = new URL('../artifacts/closest-pole-ui/', import.meta.url);
await mkdir(directory, { recursive: true });
const controller = new AbortController(), server = createDemoServer();
const originalFetch = globalThis.fetch;
let channel: ReturnType<typeof createPoleChannel> | undefined;
const stop = () => { controller.abort(); channel?.cancel(); };
process.once('SIGINT', stop);
const report: Record<string, unknown> = { status: 'failed' };
const start = performance.now();
try {
  const dataset = new PotreeDataset(DEFAULT_DATASET_ROOT), sample = await dataset.sample({ budget: 10000, depth: 0 }, 'display', controller.signal);
  const harnessBefore = await dataset.observe({ budget: 256, depth: 0 }, controller.signal);
  const selected = createPolePickCache(sample).resolve(0)!; assert.ok(selected);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.fetch = ((input, options) => originalFetch(typeof input === 'string' && input.startsWith('/datasets/') ? base + input : input, options)) as typeof fetch;
  let state: PoleState = { phase: 'idle' }, phase = '', scanned = -1;
  channel = createPoleChannel(value => {
    state = value;
    if (value.phase !== phase || (value.progress && value.progress.scannedPoints - scanned >= 5_000_000)) {
      phase = value.phase; scanned = value.progress?.scannedPoints ?? -1;
      console.log(JSON.stringify({ phase, progress: value.progress, elapsedSeconds: (performance.now() - start) / 1000 }));
    }
  });
  await channel.select(selected); controller.signal.throwIfAborted();
  assert.equal(state.phase, 'verified-found', JSON.stringify(state));
  const result = state.result!; assert.ok(result.status === 'verified-found');
  assert.deepEqual(result.queryPosition, selected.position); assert.deepEqual(result.request.input, { kind: 'point-ref', key: selected.key });
  assert.equal(result.request.domain.kind, 'whole-dataset'); assert.equal(result.search.scannedPoints, sample.dataset.totalPoints);
  assert.equal(result.verification.scannedPoints, sample.dataset.totalPoints); assert.equal(result.search.resolutionPoints, sample.dataset.totalPoints);
  assert.equal(result.verification.resolutionPoints, sample.dataset.totalPoints);
  const harnessAfter = await dataset.observe({ budget: 256, depth: 0 }, controller.signal); assert.deepEqual(harnessAfter, harnessBefore);
  const winner = result.nearest!.key;
  report.status = 'passed'; report.selected = selected; report.result = result;
  report.display = { count: sample.count, sampleHash: sample.sampleHash, containsWinner: sample.labels.some((_, i) => sample.sourceIds[i * 2] === winner.sourceFileId && sample.sourceIds[i * 2 + 1] === winner.sourceRow) };
  report.harnessHash = harnessBefore.sampleHash; report.harnessUnchanged = true;
} catch (error) { report.error = String(error); console.error(error); process.exitCode = 1; }
finally {
  report.elapsedSeconds = (performance.now() - start) / 1000;
  channel?.dispose(); globalThis.fetch = originalFetch; server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve())); process.off('SIGINT', stop);
  await writeFile(new URL('actual-http.json', directory), JSON.stringify(report, null, 2) + '\n');
}
