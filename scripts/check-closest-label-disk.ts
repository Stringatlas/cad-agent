// Task010 actual all-label preparation / production HTTP benchmark. Separate processes:
// pnpm exec tsx scripts/check-closest-label-disk.ts --prepare [OS-temp evidence directory]
// pnpm exec tsx scripts/check-closest-label-disk.ts --http [same evidence directory]
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, readdir, stat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { TORONTO_SEMANTIC_LABELS, type TorontoSemanticLabel, type NearestPoleRequest } from '@spatial/contracts';
import { SemanticArtifact } from '../apps/server/src/semantic-artifact';
import { getSemanticDiskIndex, cacheRoot } from '../apps/server/src/semantic-disk-index';
import { preparePoleIndex } from '../apps/server/src/pole-index';
import { createIsolatedDemoServer as createDemoServer } from './isolated-demo-server';
import { DEFAULT_DATASET_ROOT } from '../apps/server/src/dataset-routes';
import { fetchClosestPole } from '../apps/web/src/pole-client';

const mode = process.argv[2], output = resolve(process.argv[3] ?? join(tmpdir(), 'spatial-task010-actual'));
assert.ok(mode === '--prepare' || mode === '--http');
await mkdir(output, { recursive: true });
const control = new AbortController(), abort = () => control.abort();
process.once('SIGINT', abort); process.once('SIGTERM', abort);
const report: Record<string, unknown> = { status: 'failed', mode, output, node: process.version,
  command: `pnpm exec tsx scripts/check-closest-label-disk.ts ${mode} ${output}`, source: DEFAULT_DATASET_ROOT };
try {
  if (mode === '--prepare') {
    let last = 0; const start = performance.now(), cpu = process.cpuUsage();
    const prepared = await preparePoleIndex(DEFAULT_DATASET_ROOT, control.signal, p => {
      if (performance.now() - last > 5000) { last = performance.now(); console.log(`prepare ${p.scannedPoints} points / ${p.payloadBytes} source bytes`); }
    });
    let bytes = 0; for (const name of await readdir(prepared.directory)) bytes += (await stat(join(prepared.directory, name))).size;
    Object.assign(report, { preparationMilliseconds: performance.now() - start, cpuMicroseconds: process.cpuUsage(cpu),
      coldBuild: prepared.cache === 'built', preparation: prepared, cacheBytes: bytes,
      peakRSSBytes: process.resourceUsage().maxRSS * 1024 });
    assert.equal(prepared.totalPoints, 78320210); assert.equal(prepared.indexedPoints, 897825);
    assert.equal(prepared.cache, 'built', 'Cold build evidence must not silently substitute cache reload');
    assert.equal(prepared.sourceReads.payloadBytes, 78320210 * 55);
  } else {
    // Require persisted cache before calling production query (never allow accidental cold build).
    const prepared = JSON.parse(await readFile(join(output, 'prepare.json'), 'utf8'));
    assert.equal(prepared.status, 'passed');
    assert.ok(prepared.preparation.directory.startsWith((await realpath(cacheRoot)) + '/'));
    await stat(join(prepared.preparation.directory, 'index.json'));
    const snapshot = await SemanticArtifact.open(DEFAULT_DATASET_ROOT, control.signal);
    const revision = snapshot.dataset.revision, manifest = JSON.parse(snapshot.manifestBytes.toString());
    const counts = Array.from({ length: 9 }, (_, label) => manifest.sources.reduce((n: number, source: { label_counts: number[] }) => n + source.label_counts[label], 0));
    await snapshot.close();
    const server = createDemoServer(), nativeFetch = globalThis.fetch;
    const measurements: unknown[] = []; const commonHashes = new Set<string>();
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    globalThis.fetch = ((url, options) => nativeFetch(new URL(String(url), base), options)) as typeof fetch;
    const query = async (label: TorontoSemanticLabel, file: number, row: number, tag: string) => {
      const request: NearestPoleRequest = { requestId: `${tag}-${label}-${file}-${row}`, datasetId: 'toronto3d', expectedArtifactRevision: revision,
        units: 'm', frameId: 'toronto3d-local-v1', input: { kind: 'point-ref', key: { sourceFileId: file, sourceRow: row } },
        filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: label }, metric: 'euclidean-3d', domain: { kind: 'whole-dataset' } };
      const start = performance.now(), cpu = process.cpuUsage(), phases: string[] = [];
      const result = await fetchClosestPole(request, control.signal, progress => {
        assert.notEqual(progress.phase, 'index', 'Persisted HTTP run must not build a cache'); phases.push(progress.phase);
      });
      const milliseconds = performance.now() - start;
      assert.equal(result.status, 'verified-found', JSON.stringify(result));
      if (result.status !== 'verified-found') throw new Error('Not found');
      assert.equal(result.nearest!.label, label); assert.equal(result.search.algorithm, 'semantic-disk-page-index-v1');
      assert.equal(result.verification.verifier, 'semantic-disk-page-verifier-v1');
      assert.equal(result.search.index!.hash, prepared.preparation.indexHash); commonHashes.add(result.search.index!.hash);
      assert.equal(result.search.matchingPoints, counts[label]); assert.equal(result.search.index!.points, counts[label]);
      assert.equal(result.sourceReads!.payloadBytes, 220);
      if (label === 6 && file === 4 && row === 156656) {
        assert.deepEqual(result.nearest!.key, { sourceFileId: 4, sourceRow: 486157 });
        assert.deepEqual(result.nearest!.position, [261.605, 263.00100000000003, 139.178]);
        assert.equal(result.nearest!.distanceMeters, 26.550779009287126);
      }
      const measurement = { tag, label, name: TORONTO_SEMANTIC_LABELS[label], milliseconds, cpuMicroseconds: process.cpuUsage(cpu), phases, result };
      measurements.push(measurement); console.log(`${tag} ${TORONTO_SEMANTIC_LABELS[label]} ${milliseconds.toFixed(1)}ms`); return milliseconds;
    };
    try {
      report.persistedFirstHTTPMilliseconds = await query(6, 4, 156656, 'persisted-first');
      const summaries = [];
      for (let label = 0; label <= 8; label++) {
        const samples: number[] = [];
        for (let repeat = 0; repeat < 5; repeat++) {
          samples.push(await query(label as TorontoSemanticLabel, 4, 156656, `warm-${repeat}-overview`));
          samples.push(await query(label as TorontoSemanticLabel, 1, 0, `warm-${repeat}-source1`));
        }
        samples.sort((a, b) => a - b);
        summaries.push({ label, name: TORONTO_SEMANTIC_LABELS[label as TorontoSemanticLabel], count: counts[label], queries: samples.length,
          medianMilliseconds: (samples[4] + samples[5]) / 2, p95Milliseconds: samples[Math.ceil(samples.length * .95) - 1], maxMilliseconds: samples.at(-1) });
      }
      assert.equal(commonHashes.size, 1);
      Object.assign(report, { summaries, measurements, peakRSSBytes: process.resourceUsage().maxRSS * 1024,
        warmThresholdMilliseconds: 2000, percentile: 'nearest-rank p95 of ten production queries/two source selections per label; preparation/persisted-first excluded' });
      // Report every category even when the latency acceptance is missed.
      assert.ok(summaries.every(s => s.p95Milliseconds < 2000), 'Warm p95 must be below 2 seconds for every label');
      const reopened = await SemanticArtifact.open(DEFAULT_DATASET_ROOT, control.signal);
      try { const acquired = await getSemanticDiskIndex(reopened, control.signal); assert.equal(acquired.cache, 'memory'); await acquired.index.check(control.signal); }
      finally { await reopened.close(); }
    } finally { globalThis.fetch = nativeFetch; await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); }
  }
  report.status = 'passed';
} catch (error) { report.error = String(error); report.cancelled = control.signal.aborted; process.exitCode = 1; }
finally {
  process.off('SIGINT', abort); process.off('SIGTERM', abort);
  await writeFile(join(output, mode === '--prepare' ? 'prepare.json' : 'http.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: ${output}`);
}
