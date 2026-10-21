import type { CropSelection, CropStats } from '@spatial/contracts';

export type CropPhase = 'idle' | 'loading' | 'complete' | 'cancelled' | 'error';
export type CropAction = 'load' | 'complete' | 'cancel' | 'fail' | 'clear';
/** Completion is a transport outcome, not merely receipt of an end event. */
export function nextCropPhase(phase: CropPhase, action: CropAction): CropPhase {
  if (action === 'clear') return 'idle';
  if (action === 'load') return 'loading';
  if (action === 'fail') return 'error';
  if (phase !== 'loading') return phase;
  return action === 'complete' ? 'complete' : 'cancelled';
}

export function cropFeedback(phase: CropPhase, stats?: CropStats, viewerAvailable = true) {
  const count = (stats?.count ?? 0).toLocaleString('en-US');
  return {
    canLoad: viewerAvailable,
    canCancel: phase === 'loading',
    canClear: phase === 'loading' || stats !== undefined,
    canRetry: viewerAvailable && (phase === 'cancelled' || phase === 'error'),
    count: `Full-resolution selection: ${count} points${phase === 'complete' ? ' · complete, no downsampling' : phase !== 'idle' ? ' · partial, selection incomplete' : ''}`,
    progress: phase === 'loading'
      ? `Loaded ${count} points · scanned ${(stats?.scannedPoints ?? 0).toLocaleString('en-US')} source points · read ${(stats?.bytesRead ?? 0).toLocaleString('en-US')} source bytes. Selected total unknown until completion; no percentage or ETA.`
      : undefined,
  };
}

export function describeCropSelection(selection?: CropSelection): string {
  if (!selection) return 'Box selection · enter finite center and positive dimensions in local meters.';
  const bounds = ['X', 'Y', 'Z'].map((axis, i) => `${axis} ${selection.min[i].toFixed(3)}…${selection.max[i].toFixed(3)}`).join(' · ');
  return selection.planes
    ? `Projected window · frozen camera volume × dataset extent (local m): ${bounds}. These bounds are the dataset clipping extent, not the frustum's shape; includes occluded depth.`
    : `Axis-aligned box · inclusive local bounds (m): ${bounds}.`;
}
