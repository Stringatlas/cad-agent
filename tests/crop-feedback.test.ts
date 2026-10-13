import assert from 'node:assert/strict';
import test from 'node:test';
import type { CropSelection, CropStats } from '@spatial/contracts';
import { cropFeedback, describeCropSelection, nextCropPhase, type CropPhase } from '../apps/web/src/crop-feedback';
import { createCropChannel } from '../apps/web/src/crop-client';

const stats: CropStats = { count: 12345, scannedPoints: 20000, bytesRead: 1000000, hierarchyRecords: 2, hierarchyChunks: 1, payloadNodes: 1, maxDepth: 0 };
const selection: CropSelection = { min: [1, 2, 3], max: [4, 5, 6] };

test('selection feedback identifies exact box vs frozen projected clipping extent', () => {
  assert.match(describeCropSelection(selection), /Axis-aligned box.*inclusive local bounds \(m\).*X 1.000…4.000/);
  const projected = { ...selection, planes: [[1, 0, 0, 0], [-1, 0, 0, 10], [0, 1, 0, 0], [0, -1, 0, 10], [0, 0, 1, 0], [0, 0, -1, 10]] } as CropSelection;
  assert.match(describeCropSelection(projected), /Projected window.*frozen camera volume/);
  assert.match(describeCropSelection(projected), /dataset clipping extent, not the frustum's shape; includes occluded depth/);
  assert.match(describeCropSelection(), /finite center and positive dimensions/);
});

test('streaming feedback reports actual counts/work, never an invented total, percent or ETA', () => {
  const waiting = cropFeedback('loading');
  assert.match(waiting.count, /0 points · partial, selection incomplete/);
  assert.match(waiting.progress!, /Loaded 0 points · scanned 0 source points · read 0 source bytes/);
  const loading = cropFeedback('loading', stats);
  assert.match(loading.progress!, /Loaded 12,345 points · scanned 20,000 source points · read 1,000,000 source bytes/);
  assert.match(loading.progress!, /Selected total unknown until completion/);
  assert.equal(loading.progress!.includes('%'), false);
  assert.equal(loading.canCancel, true); assert.equal(loading.canClear, true); assert.equal(loading.canRetry, false);
  // Empty batches still show work, not completion.
  assert.match(cropFeedback('loading', { ...stats, count: 0 }).progress!, /Loaded 0 points · scanned 20,000/);
});

test('completed, cancelled, failed and cleared feedback has honest labels and controls', () => {
  let phase = nextCropPhase('idle', 'load');
  phase = nextCropPhase(phase, 'cancel'); assert.equal(phase, 'cancelled');
  const cancelled = cropFeedback(phase, stats);
  assert.match(cancelled.count, /partial, selection incomplete/);
  assert.equal(cancelled.canCancel, false); assert.equal(cancelled.canRetry, true); assert.equal(cancelled.canClear, true);
  assert.equal(nextCropPhase(phase, 'complete'), 'cancelled');
  phase = nextCropPhase(phase, 'load'); phase = nextCropPhase(phase, 'fail');
  assert.equal(phase, 'error'); assert.equal(cropFeedback(phase, stats).canRetry, true);
  phase = nextCropPhase(phase, 'load'); phase = nextCropPhase(phase, 'complete');
  const complete = cropFeedback(phase, { ...stats, count: 0 });
  assert.match(complete.count, /0 points · complete, no downsampling/);
  assert.equal(complete.canCancel, false); assert.equal(complete.canRetry, false); assert.equal(complete.progress, undefined);
  assert.equal(nextCropPhase(phase, 'cancel'), 'complete');
  phase = nextCropPhase(phase, 'clear');
  assert.equal(phase, 'idle'); assert.equal(cropFeedback(phase).canClear, false);
  assert.equal(cropFeedback('error').canRetry, true); // Retry even after failure before the first batch.
});

test('viewer resource failure blocks all selection loads/retries until scene reload, without hiding retained detail', () => {
  for (const phase of ['idle', 'loading', 'complete', 'cancelled', 'error'] as const) {
    const failed = cropFeedback(phase, stats, false);
    assert.equal(failed.canLoad, false);
    assert.equal(failed.canRetry, false);
    assert.equal(failed.canClear, true);
    assert.match(failed.count, /12,345 points/);
    assert.equal(cropFeedback(phase, stats, true).canLoad, true);
  }
  assert.equal(cropFeedback('error', stats, true).canRetry, true, 'ordinary transport errors remain retryable');
});

test('end event followed by transport/framing failure never certifies completed feedback', async () => {
  let phase: CropPhase = 'loading'; let retained: CropStats | undefined;
  const channel = createCropChannel(event => {
    if (event.type === 'end') retained = event.stats; // UI records stats, not completion here.
  }, async (_selection, _signal, publish) => {
    await publish({ type: 'end', complete: true, stats, sampleHash: 'a'.repeat(64) });
    assert.match(cropFeedback(phase, retained).count, /partial/);
    throw new Error('Invalid full-resolution stream framing');
  });
  try { await channel.load(selection); phase = nextCropPhase(phase, 'complete'); }
  catch { phase = nextCropPhase(phase, 'fail'); }
  assert.equal(phase, 'error'); assert.match(cropFeedback(phase, retained).count, /partial/);
  channel.dispose();
});
