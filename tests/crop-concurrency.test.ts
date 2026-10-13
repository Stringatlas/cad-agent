import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { PotreeDataset } from '../apps/server/src/potree';
import { createDemoServer } from '../apps/server/src/index';
import { CROP_BATCH_POINTS, type CropEvent } from '@spatial/contracts';

test('crop and harness share two-operation cap with no unbounded request queue', async () => {
  const originalCrop = PotreeDataset.prototype.crop, originalObserve = PotreeDataset.prototype.sample;
  let entered = 0, release!: () => void, bothEntered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { bothEntered = resolve; });
  const wait = async () => { if (++entered === 2) bothEntered(); await gate; throw new Error('Fixture unavailable'); };
  PotreeDataset.prototype.crop = async function* () { await wait(); };
  PotreeDataset.prototype.sample = wait;
  const server = createDemoServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const pending: Promise<Response>[] = [];
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/datasets/toronto3d`;
    const crop = base + '/crop?minX=0&minY=0&minZ=0&maxX=1&maxY=1&maxZ=1';
    pending.push(fetch(crop), fetch(base + '/observation?purpose=harness&budget=256&depth=0'));
    await ready;
    assert.equal((await fetch(crop)).status, 429); assert.equal(entered, 2);
    release(); assert.deepEqual((await Promise.all(pending)).map(r => r.status), [503, 503]);
    assert.equal((await fetch(crop)).status, 503); assert.equal(entered, 3);
  } finally {
    release(); await Promise.allSettled(pending);
    await new Promise<void>(resolve => server.close(() => resolve()));
    PotreeDataset.prototype.crop = originalCrop; PotreeDataset.prototype.sample = originalObserve;
  }
});

test('HTTP stream disconnect aborts work, returns generator and frees its concurrency slot', async () => {
  const originalCrop = PotreeDataset.prototype.crop, originalSample = PotreeDataset.prototype.sample;
  let closed!: () => void, aborted = false, produced = 0;
  const finished = new Promise<void>(resolve => { closed = resolve; });
  PotreeDataset.prototype.crop = async function* (_selection, signal) {
    try {
      while (true) {
        signal?.throwIfAborted(); produced++;
        yield { type: 'batch', sequence: produced - 1, positions: Array(CROP_BATCH_POINTS * 3).fill(0), colors: Array(CROP_BATCH_POINTS * 3).fill(0),
          stats: { count: produced * CROP_BATCH_POINTS, scannedPoints: produced * CROP_BATCH_POINTS, bytesRead: produced, hierarchyChunks: 1, hierarchyRecords: 1, payloadNodes: 1, maxDepth: 0 } } satisfies CropEvent;
      }
    } finally { aborted = signal?.aborted ?? false; closed(); }
  };
  PotreeDataset.prototype.sample = async () => { throw new Error('Fixture unavailable'); };
  const server = createDemoServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const controller = new AbortController();
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/datasets/toronto3d`;
    const response = await fetch(base + '/crop?minX=0&minY=0&minZ=0&maxX=1&maxY=1&maxZ=1', { signal: controller.signal });
    const reader = response.body!.getReader(); await reader.read(); controller.abort(); await reader.cancel().catch(() => {});
    await Promise.race([finished, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Server cancellation timeout')), 2000))]);
    assert.equal(aborted, true); assert.ok(produced < 100, 'bounded socket backpressure, not eager whole-stream traversal');
    // With the cancelled slot freed, two new unavailable operations fail 503, not busy 429.
    assert.deepEqual((await Promise.all([fetch(base + '/observation?purpose=harness&budget=256&depth=0'), fetch(base + '/observation?purpose=harness&budget=256&depth=0')])).map(r => r.status), [503, 503]);
  } finally {
    controller.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    PotreeDataset.prototype.crop = originalCrop; PotreeDataset.prototype.sample = originalSample;
  }
});
