import { Worker } from 'node:worker_threads';
import { CAD_LIMITS, CadError, canonicalCadOperation, type CadOperation, type CadResult, type CadReply, type CadSource } from '@spatial/contracts';

/** Single-worker admission with hard termination. Reset invalidates EVERY previously issued handle. */
export class CadWorkerClient {
  private worker: Worker | undefined;
  private active = false;
  private closed = false;
  private nextId = 1;
  private pendingReject: ((error: CadError) => void) | undefined;
  private terminating: Promise<unknown> = Promise.resolve();
  constructor(readonly source: CadSource, private readonly timeoutMs: number = CAD_LIMITS.operationTimeoutMs) {
    this.source = Object.freeze({ ...source });
  }
  private reset(worker: Worker) {
    if (this.worker === worker) this.worker = undefined;
    // Await prior exit before admitting a fresh worker; never overlap kernel instances after a timeout.
    this.terminating = worker.terminate().catch(() => {});
  }
  async execute(input: CadOperation, signal?: AbortSignal): Promise<CadResult> {
    if (this.closed) throw new CadError('closed', 'CAD sandbox is closed');
    if (this.active) throw new CadError('busy', 'One CAD operation is already in flight');
    const operation = canonicalCadOperation(input);
    this.active = true;
    try {
      await this.terminating;
      if (this.closed || signal?.aborted) throw new CadError('closed', 'CAD request cancelled');
      let worker = this.worker;
      if (!worker) {
        worker = new Worker(new URL('./cad-worker-bootstrap.mjs', import.meta.url), {
          workerData: this.source, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
        });
        const owned = worker;
        // Keep idle failures contained too: an unhandled Worker 'error' would otherwise crash HTTP.
        worker.on('error', () => { if (this.worker === owned) this.reset(owned); });
        worker.on('exit', () => { if (this.worker === owned) this.worker = undefined; });
        this.worker = worker;
      }
      worker.unref();
      const id = this.nextId++;
      return await new Promise<CadResult>((resolve, reject) => {
        let settled = false;
        const clean = () => {
          clearTimeout(timer); worker.off('message', message); worker.off('error', failure); worker.off('exit', exit);
          signal?.removeEventListener('abort', abort); this.pendingReject = undefined;
        };
        const fail = (error: CadError, reset = true) => {
          if (settled) return; settled = true; clean(); if (reset) this.reset(worker); reject(error);
        };
        const failure = () => fail(new CadError('kernel-failure', 'CAD worker failed; all sandbox bodies invalidated'));
        const exit = () => failure();
        const abort = () => fail(new CadError('closed', 'CAD request cancelled; all sandbox bodies invalidated'));
        const message = (value: { id: number; reply: CadReply }) => {
          if (value.id !== id || settled) return;
          if (!value.reply.ok) {
            fail(new CadError(value.reply.error.code, value.reply.error.message), value.reply.error.code === 'kernel-failure'); return;
          }
          settled = true; clean(); resolve(value.reply.result);
        };
        const timer = setTimeout(() => fail(new CadError('timeout', 'CAD operation timed out; all sandbox bodies invalidated')), this.timeoutMs);
        this.pendingReject = error => fail(error);
        worker.on('message', message); worker.once('error', failure); worker.once('exit', exit);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort(); else worker.postMessage({ id, operation });
      });
    } finally { this.active = false; }
  }
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.pendingReject?.(new CadError('closed', 'CAD sandbox closed; all bodies invalidated'));
      if (this.worker) this.reset(this.worker);
    }
    await this.terminating;
  }
}
