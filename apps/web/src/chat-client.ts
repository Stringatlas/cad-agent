import { assertProjectState, PROJECT_FRAME_ID, CHAT_REPLY_BYTES, TOOL_SCHEMA_VERSION, TOOL_VERSION, canonicalChatRequest,
  canonicalToolRequest, canonicalProtocolJson, chatOutcomeState, inspectionCommand, protocolRecord, protocolKeys, protocolToken,
  protocolHash, type ProjectSnapshot, type ChatRequest, type ChatResponse, type ChatState } from '@spatial/contracts';

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error(`Server unavailable (HTTP ${response.status})`);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted(); const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > CHAT_REPLY_BYTES) throw new Error('Response budget exceeded'); chunks.push(value);
    }
    signal.throwIfAborted(); const bytes = new Uint8Array(size); let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function fetchProject(signal: AbortSignal): Promise<ProjectSnapshot> {
  const response = await fetch('/project', { signal });
  const sessionId = response.headers.get('X-Spatial-Session'), frameId = response.headers.get('X-Spatial-Frame');
  protocolToken(sessionId); if (frameId !== PROJECT_FRAME_ID) throw new Error('Unknown project frame');
  const project = await boundedJson(response, signal); assertProjectState(project);
  return { sessionId, frameId, project };
}
export function validateChatResponse(value: unknown, request: ChatRequest): ChatResponse {
  const r = protocolRecord(value); protocolKeys(r, ['sessionId', 'projectRevision', 'generation', 'requestId', 'state', 'code'], ['reply', 'evidence']);
  if (r.sessionId !== request.sessionId || r.projectRevision !== request.projectRevision || r.generation !== request.generation || r.requestId !== request.requestId ||
    !['completed', 'rejected', 'incomplete', 'error', 'cancelled'].includes(String(r.state)) || typeof r.code !== 'string' || r.code.length > 80) throw new Error('Stale or invalid chat response');
  if (r.reply !== undefined) {
    const reply = protocolRecord(r.reply); protocolKeys(reply, ['schemaVersion', 'toolVersion', 'request', 'outcome']);
    if (reply.schemaVersion !== TOOL_SCHEMA_VERSION || reply.toolVersion !== TOOL_VERSION) throw new Error('Invalid protocol');
    const call = canonicalToolRequest(reply.request), command = inspectionCommand(request.command), e = protocolRecord(r.evidence);
    protocolKeys(e, ['runId', 'requestId', 'semanticHash', 'configHash']); protocolHash(e.semanticHash); protocolHash(e.configHash);
    if (!command || e.runId !== call.runId || e.requestId !== call.requestId ||
      call.tool !== command.tool || canonicalProtocolJson(call.args) !== canonicalProtocolJson(command.args)) throw new Error('Wrong tool request');
    const o = protocolRecord(reply.outcome);
    if (!['observed', 'verification-rejected', 'error', 'incomplete'].includes(String(o.status))) throw new Error('Invalid inspection outcome');
    if (o.status === 'observed') {
      const d = protocolRecord(o.data), dataset = call.tool === 'dataset.metadata' ? d : protocolRecord(d.dataset);
      const coordinates = protocolRecord(dataset.coordinates);
      if (o.kind !== (call.tool === 'dataset.metadata' ? 'metadata' : 'observation') ||
        o.coverage !== (call.tool === 'dataset.metadata' ? 'metadata-only' : 'bounded-first-chunk-sample') ||
        dataset.id !== call.binding.datasetId || dataset.revision !== call.binding.artifactRevision ||
        coordinates.units !== call.binding.units || coordinates.handedness !== 'right' || coordinates.upAxis !== 'Z' ||
        canonicalProtocolJson(coordinates.localOrigin) !== '[627285,4841948,0]' ||
        (call.tool === 'dataset.observe' && canonicalProtocolJson(d.lod) !== canonicalProtocolJson(call.args.lod))) throw new Error('Wrong dataset/frame/LOD');
    }
    if (chatOutcomeState(r.reply as ChatResponse['reply'] & {}) !== r.state) throw new Error('Outcome state mismatch');
  } else if (r.state === 'completed' || r.evidence !== undefined) throw new Error('Missing dispatcher evidence');
  return r as unknown as ChatResponse;
}
export type ChatLoader = (request: ChatRequest, signal: AbortSignal) => Promise<ChatResponse>;
export const fetchInspection: ChatLoader = async (request, signal) => {
  canonicalChatRequest(request);
  return validateChatResponse(await boundedJson(await fetch('/chat/inspect', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
  }), signal), request);
};
export interface ChatEntry { readonly command: string; readonly state: ChatState; readonly code: string; readonly response?: ChatResponse }
/** Generation gates even loaders that ignore abort. No result callback can touch scene geometry. */
export class ChatController {
  private generation = 0; private active?: AbortController; private disposed = false;
  constructor(private binding: Pick<ChatRequest, 'sessionId' | 'projectRevision'>, private readonly publish: (entry: ChatEntry) => void, private readonly load: ChatLoader = fetchInspection) {}
  bind(binding: Pick<ChatRequest, 'sessionId' | 'projectRevision'>) { this.invalidate(); this.binding = { ...binding }; }
  private invalidate() { this.generation++; this.active?.abort(); this.active = undefined; }
  cancel() { if (!this.active) return; this.invalidate(); this.publish({ command: '', state: 'cancelled', code: 'cancelled' }); }
  dispose() { this.disposed = true; this.invalidate(); }
  async submit(command: string) {
    if (this.disposed) return;
    this.invalidate(); const generation = this.generation, controller = this.active = new AbortController();
    const request: ChatRequest = { ...this.binding, generation, requestId: `request-${generation}`, command };
    this.publish({ command, state: 'pending', code: 'pending' });
    try {
      const response = validateChatResponse(await this.load(request, controller.signal), request);
      if (!this.disposed && !controller.signal.aborted && generation === this.generation) this.publish({ command, state: response.state, code: response.code, response });
    } catch {
      if (!this.disposed && !controller.signal.aborted && generation === this.generation) this.publish({ command, state: 'error', code: 'server-unavailable-or-invalid-response' });
    } finally { if (generation === this.generation) this.active = undefined; }
  }
}
