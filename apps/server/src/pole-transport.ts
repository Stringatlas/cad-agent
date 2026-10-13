import type { ServerResponse } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { NearestPoleRequest } from '@spatial/contracts';
import type { SemanticProgress } from './semantic-query';
import { queryIndexedClosestPole } from './pole-index';

/** One latest progress value, one bounded socket frame; no per-checkpoint queue. */
export async function streamClosestPole(directory: string, request: NearestPoleRequest, response: ServerResponse, controller: AbortController) {
  const signal = controller.signal;
  response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  const write = async (event: unknown) => {
    signal.throwIfAborted();
    const line = JSON.stringify(event) + '\n';
    if (Buffer.byteLength(line) > 65536) throw new Error('Oversized query frame');
    if (!response.write(line)) await once(response, 'drain', { signal });
  };
  const binding = { requestId: request.requestId, artifactRevision: request.expectedArtifactRevision };
  await write({ type: 'start', ...binding, request });
  let latest: SemanticProgress | undefined, finished = false;
  const timer = new AbortController();
  const stopTimer = () => timer.abort();
  signal.addEventListener('abort', stopTimer, { once: true });
  // Search remains bounded independently of the slow client. Intermediate counters may be coalesced.
  const pump = (async () => {
    try {
      while (!finished) {
        await delay(200, undefined, { signal: timer.signal });
        const progress = latest; latest = undefined;
        if (progress) await write({ type: 'progress', ...binding, progress });
      }
    } catch (error) {
      if (finished && timer.signal.aborted && (error as Error).name === 'AbortError') return;
      controller.abort(); throw error;
    }
  })();
  // Observe rejection immediately while the authoritative operation cleans up its snapshot.
  void pump.catch(() => {});
  try {
    const result = await queryIndexedClosestPole(directory, request, signal, progress => { latest = progress; });
    finished = true;
    stopTimer(); // Fast queries must not wait for the next 200ms progress tick.
    await pump;
    if (latest) await write({ type: 'progress', ...binding, progress: latest });
    await write({ type: 'result', ...binding, result });
    response.end();
  } catch (error) {
    // An unexpected composition/socket failure must interrupt the HTTP body, never leave it hanging.
    response.destroy();
    throw error;
  } finally {
    finished = true; stopTimer(); controller.abort();
    signal.removeEventListener('abort', stopTimer);
    await pump.catch(() => {});
  }
}
