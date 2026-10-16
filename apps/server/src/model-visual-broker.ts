import { randomBytes } from 'node:crypto';
import { MODEL_VISUAL_LIMITS, canonicalModelVisualToolResult, type ModelChatEvent, type VisualPixelResolution } from '@spatial/contracts';
import { ModelError } from './provider-model';

/** One pending browser RPC, scoped to one active model turn. No public reusable capabilities. */
export class ModelVisualBroker {
  private pending?: { requestId: string; toolCallId: string; nonce: string; observationId: string; x: number; y: number;
    resolve(result: VisualPixelResolution): void; reject(error: Error): void };
  constructor(private readonly requestId: string, private readonly signal: AbortSignal, private readonly emit: (event: ModelChatEvent) => Promise<void>) {}
  get waiting(): boolean { return this.pending !== undefined && !this.signal.aborted; }
  async resolve(args: { observationId: string; x: number; y: number }, toolCallId: string): Promise<VisualPixelResolution> {
    this.signal.throwIfAborted(); if (this.pending) throw new ModelError('busy');
    const nonce = randomBytes(32).toString('hex');
    let pending!: NonNullable<ModelVisualBroker['pending']>;
    const answer = new Promise<VisualPixelResolution>((resolve, reject) => { pending = { ...args, requestId: this.requestId, toolCallId, nonce, resolve, reject }; });
    // Attach rejection before publication: disconnect/timeout may occur while emit is blocked.
    void answer.catch(() => undefined);
    this.pending = pending;
    const reject = (code: string) => { if (this.pending === pending) this.pending = undefined; pending.reject(new ModelError(code)); };
    const abort = () => reject('cancelled');
    const timer = setTimeout(() => reject('visual-tool-deadline'), MODEL_VISUAL_LIMITS.toolDeadlineMs); timer.unref();
    this.signal.addEventListener('abort', abort, { once: true });
    try {
      if (this.signal.aborted) abort();
      await this.emit({ kind: 'tool-request', requestId: this.requestId, toolCallId, nonce, ...args });
      return await answer;
    } finally { clearTimeout(timer); this.signal.removeEventListener('abort', abort); if (this.pending === pending) this.pending = undefined; }
  }
  accept(value: unknown): void {
    const result = canonicalModelVisualToolResult(value), p = this.pending;
    if (!p || this.signal.aborted || result.requestId !== p.requestId || result.toolCallId !== p.toolCallId || result.nonce !== p.nonce ||
      result.observationId !== p.observationId || result.result.x !== p.x || result.result.y !== p.y) throw new ModelError('invalid-tool-result');
    // Consume before resolving so duplicates and replay cannot race the next tool round.
    this.pending = undefined; p.resolve(result.result);
  }
}
