import assert from 'node:assert/strict';
import test from 'node:test';
import type { CropSelection, CropStats } from '@spatial/contracts';
import { cropFeedback, nextCropPhase, type CropPhase } from '../../apps/web/src/scenes/toronto/display/crop-feedback';
import { createCropChannel } from '../../apps/web/src/scenes/toronto/display/crop-client';

const stats: CropStats = { count: 12345, scannedPoints: 20000, bytesRead: 1000000, hierarchyRecords: 2, hierarchyChunks: 1, payloadNodes: 1, maxDepth: 0 };
const selection: CropSelection = { min: [1, 2, 3], max: [4, 5, 6] };

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
