// Bounded actual-artifact integration check; never preprocesses or rewrites dataset files.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PotreeDataset, READ_LIMITS } from '../apps/server/src/datasets/potree';
import { DEFAULT_DATASET_ROOT } from '../apps/server/src/datasets/dataset-routes';
import { createIsolatedDemoServer as createDemoServer } from './isolated-demo-server';
import { once } from 'node:events';

const adapter = new PotreeDataset(DEFAULT_DATASET_ROOT);
const report: Record<string, unknown> = { status: 'failed', checks: [] };
const summaries: unknown[] = [];
try {
  const initial = await adapter.observe({ budget: 1024, depth: 2 });
  assert.equal(initial.count, 1024);
  for (const purpose of ['display', 'harness'] as const) {
    for (const depth of [0, 1, 2, 3]) {
      const budget = purpose === 'display' ? 100_000 : 4096;
      const sample = await adapter.sample({ budget, depth }, purpose);
      assert.equal(sample.count, Math.min(sample.candidatePoints, budget));
      assert.ok(sample.bytesRead <= READ_LIMITS.total + READ_LIMITS.hierarchy);
      assert.equal(new Set(sample.sourceIds.reduce<string[]>((ids, _n, i) => { if (i % 2 === 0) ids.push(`${sample.sourceIds[i]}:${sample.sourceIds[i + 1]}`); return ids; }, [])).size, sample.count);
      assert.ok(sample.positions.every((n, i) => n >= sample.dataset.bounds.min[i % 3] - 0.002 && n <= sample.dataset.bounds.max[i % 3] + 0.002));
      summaries.push({ purpose, depth, budget, count: sample.count, candidatePoints: sample.candidatePoints, bytesRead: sample.bytesRead, nodes: sample.nodes, sampleHash: sample.sampleHash });
    }
  }
  assert.deepEqual(await adapter.observe({ budget: 1024, depth: 2 }), initial);
  const server = createDemoServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/datasets/toronto3d/observation?purpose=harness&budget=1024&depth=2`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(Buffer.byteLength(body) < 16 * 1024 * 1024);
    assert.deepEqual(JSON.parse(body), initial);
    report.http = { status: response.status, responseBytes: Buffer.byteLength(body), sampleHash: initial.sampleHash };
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  report.status = 'passed';
  report.dataset = initial.dataset;
  report.checks = ['all supported depths and maximum budgets bounded', 'stable provenance unique within each sample', 'local positions within prepared bounds', 'harness unchanged after unrelated display/harness requests', 'actual read-only HTTP observation matches direct adapter output'];
} catch (error) { report.error = String(error); process.exitCode = 1; }
report.samples = summaries;
await mkdir('artifacts/toronto-preview', { recursive: true });
await writeFile('artifacts/toronto-preview/actual-samples.json', JSON.stringify(report, null, 2) + '\n');
console.log(`Actual Toronto preview: ${report.status}; artifacts/toronto-preview/actual-samples.json`);
