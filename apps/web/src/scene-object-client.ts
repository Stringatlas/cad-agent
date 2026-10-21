import { canonicalSceneObjectProposal, canonicalSceneObjectProposalRequest, canonicalSceneObjectSnapshot, type SceneObjectInput, type SceneObjectSnapshot, type AuthoredObjectReference, type DatumPoint } from '@spatial/contracts';
import { torontoAuthorityRequest } from './toronto-authority-transport';

export type SceneObjectAction = 'refresh' | 'propose' | 'approve' | 'decline' | 'undo';
export type SceneObjectTransport = (action: SceneObjectAction, body: unknown, signal: AbortSignal) => Promise<unknown>;
export const sceneObjectTransport: SceneObjectTransport = (action, body, signal) => torontoAuthorityRequest({
  endpoint: '/datasets/toronto3d/objects', maxResponseLength: 1_000_000,
  responseName: 'object authority', errorPrefix: 'Object authority: ',
}, action, body, signal);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function authoredReference(snapshot: SceneObjectSnapshot, object: DatumPoint): AuthoredObjectReference {
  if (!snapshot.objects.some(value => same(value, object))) throw new Error('Datum is not committed');
  return { kind: 'authored-object', sessionId: snapshot.sessionId, revision: snapshot.revision, objectId: object.id, objectRevision: object.objectRevision, frameId: object.frameId, units: object.units };
}
export interface SceneObjectView { snapshot?: SceneObjectSnapshot; busy: boolean; needsRefresh: boolean; error?: string }
/** Volatile authority mirror. Ambiguous writes clear candidates and require explicit refresh. */
export class SceneObjectController {
  private state: SceneObjectView = { busy: false, needsRefresh: true };
  private artifact?: string; private generation = 0; private active?: AbortController; private alive = true;
  constructor(private publish: (view: SceneObjectView) => void, private transport: SceneObjectTransport = sceneObjectTransport) {}
  private emit(update: Partial<SceneObjectView>) { this.state = { ...this.state, ...update }; if (this.alive) this.publish(this.state); }
  bind(artifact?: string) {
    if (artifact === this.artifact) return;
    this.artifact = artifact; this.generation++; this.active?.abort(); this.emit({ snapshot: undefined, busy: false, needsRefresh: true, error: undefined });
  }
  private async run(action: SceneObjectAction, value?: { name: string; input: SceneObjectInput } | string) {
    if (!this.alive || !this.artifact || this.state.busy || (action !== 'refresh' && this.state.needsRefresh)) return;
    const before = this.state.snapshot, ticket = ++this.generation, abort = new AbortController(); this.active = abort;
    const timer = setTimeout(() => abort.abort(), 30_000);
    const binding = before && { sessionId: before.sessionId, revision: before.revision, artifactRevision: before.artifactRevision };
    let request: unknown;
    try {
      request = action === 'refresh' ? undefined : action === 'propose' ? canonicalSceneObjectProposalRequest({ ...binding, frameId: 'toronto3d-local-v1', units: 'm', ...(value as { name: string; input: SceneObjectInput }) }) : { ...binding, ...(action === 'undo' ? { transactionId: value } : { proposalId: value }) };
      this.emit({ busy: true, error: undefined });
      const reply = await this.transport(action, request, abort.signal);
      if (!this.alive || ticket !== this.generation) return;
      if (action === 'propose') {
        const candidate = canonicalSceneObjectProposal(reply);
        const expected = request as ReturnType<typeof canonicalSceneObjectProposalRequest>;
        if (!before || candidate.sessionId !== before.sessionId || candidate.revision !== before.revision || candidate.artifactRevision !== this.artifact || candidate.object.name !== expected.name || (expected.input.kind === 'position' && !same(candidate.object.position, expected.input.position)) || before.objects.some(o => o.id === candidate.object.id) || before.proposals.some(p => p.proposalId === candidate.proposalId || p.object.id === candidate.object.id)) throw new Error('Object proposal mismatch');
        this.emit({ snapshot: canonicalSceneObjectSnapshot({ ...before, proposals: [...before.proposals, candidate] }) });
      } else {
        const next = canonicalSceneObjectSnapshot(reply);
        if (next.artifactRevision !== this.artifact) throw new Error('Object artifact changed');
        if (action !== 'refresh') {
          if (!before || next.sessionId !== before.sessionId || next.revision !== before.revision + (action === 'decline' ? 0 : 1)) throw new Error('Object mutation binding mismatch');
          if (action === 'decline' && (!same(next.objects, before.objects) || !same(next.proposals, before.proposals.filter(p => p.proposalId !== value)) || next.nextUndoTransactionId !== before.nextUndoTransactionId)) throw new Error('Decline changed unrelated objects');
          if (action === 'approve') {
            const candidate = before.proposals.find(p => p.proposalId === value);
            if (!candidate || !same(next.objects, [...before.objects, candidate.object]) || next.proposals.length) throw new Error('Publication differs from reviewed datum');
          }
          if (action === 'undo' && (!same(next.objects, before.objects.slice(0, -1)) || next.proposals.length)) throw new Error('Undo changed unrelated objects');
        }
        this.emit({ snapshot: next, needsRefresh: false });
      }
    } catch (error) {
      if (this.alive && ticket === this.generation) this.emit({ snapshot: undefined, needsRefresh: true, error: `${error instanceof Error ? error.message : 'Object request failed'}. Refresh objects before retrying.` });
    } finally { clearTimeout(timer); if (this.alive && ticket === this.generation) { this.active = undefined; this.emit({ busy: false }); } }
  }
  refresh() { return this.run('refresh'); }
  propose(name: string, input: SceneObjectInput) { return this.run('propose', { name, input }); }
  approve(id: string) { if (this.state.snapshot?.proposals.some(p => p.proposalId === id)) return this.run('approve', id); }
  decline(id: string) { if (this.state.snapshot?.proposals.some(p => p.proposalId === id)) return this.run('decline', id); }
  undo() { const id = this.state.snapshot?.nextUndoTransactionId; if (id) return this.run('undo', id); }
  dispose() { this.alive = false; this.generation++; this.active?.abort(); }
}
