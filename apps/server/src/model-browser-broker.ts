import { randomBytes } from 'node:crypto';
import { MODEL_VISUAL_LIMITS, protocolRecord, protocolKeys, canonicalModelScene, canonicalModelVisualObservation,
  type ModelBrowserAction, type ModelChatEvent, type ModelScene, type ModelVisualObservation } from '@spatial/contracts';
import { ModelError } from './provider-model';

export type BrowserAnswer = { readonly status: 'unavailable' } | { readonly status: 'captured'; readonly observation: ModelVisualObservation } |
  { readonly status: 'selected'; readonly scene: ModelScene };
/** One-use turn-bound capability for observation/selection only. Never approves geometry. */
export class ModelBrowserBroker {
  private pending?: { toolCallId: string; nonce: string; action: ModelBrowserAction; resolve(value: BrowserAnswer): void; reject(error: Error): void };
  constructor(private readonly requestId: string, private readonly signal: AbortSignal, private readonly emit: (event: ModelChatEvent) => Promise<void>) {}
  get waiting() { return !!this.pending && !this.signal.aborted; }
  async request(action: ModelBrowserAction, toolCallId: string): Promise<BrowserAnswer> {
    this.signal.throwIfAborted(); if (this.pending) throw new ModelError('busy');
    let p!: NonNullable<ModelBrowserBroker['pending']>;
    const answer = new Promise<BrowserAnswer>((resolve, reject) => { p = { action, toolCallId, nonce: randomBytes(32).toString('hex'), resolve, reject }; });
    void answer.catch(() => undefined); this.pending = p;
    const abort = () => p.reject(new ModelError('cancelled'));
    const timer = setTimeout(() => p.reject(new ModelError('visual-tool-deadline')), MODEL_VISUAL_LIMITS.toolDeadlineMs); timer.unref();
    this.signal.addEventListener('abort', abort, { once: true });
    try {
      if (this.signal.aborted) abort();
      await this.emit({ kind: 'browser-request', requestId: this.requestId, toolCallId, nonce: p.nonce, action });
      return await answer;
    } finally { clearTimeout(timer); this.signal.removeEventListener('abort', abort); if (this.pending === p) this.pending = undefined; }
  }
  accept(value: unknown) {
    const r = protocolRecord(value); protocolKeys(r, ['requestId', 'toolCallId', 'nonce', 'result']);
    const p = this.pending;
    if (!p || this.signal.aborted || r.requestId !== this.requestId || r.toolCallId !== p.toolCallId || r.nonce !== p.nonce) throw new ModelError('invalid-tool-result');
    const a = protocolRecord(r.result); let result: BrowserAnswer;
    if (a.status === 'unavailable') { protocolKeys(a, ['status']); result = { status: 'unavailable' }; }
    else if (a.status === 'captured' && p.action.kind === 'capture') { protocolKeys(a, ['status', 'observation']); result = { status: 'captured', observation: canonicalModelVisualObservation(a.observation) }; }
    else if (a.status === 'selected' && p.action.kind === 'select-reference') { protocolKeys(a, ['status', 'scene']); result = { status: 'selected', scene: canonicalModelScene(a.scene) }; }
    else throw new ModelError('invalid-tool-result');
    this.pending = undefined; p.resolve(result);
  }
}
