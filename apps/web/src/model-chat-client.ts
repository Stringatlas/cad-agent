import { MODEL_CHAT_LIMITS, MODEL_INSPECTION_LIMITS, MODEL_VISUAL_LIMITS, canonicalModelVisualToolResult, canonicalModelVisualObservation, modelVisualImageSize, modelVisualSourcePixel, type ModelVisualObservation, type VisualPixelResolution, type ModelRequestInspection, type ModelRequestPhase, canonicalModelScene, canonicalModelTurnRequest, canonicalModelCatalog, canonicalModelChatEvent,
  canonicalSceneContextRequest, canonicalProtocolJson, freezeProtocolValue, protocolKeys, protocolRecord, protocolToken,
  type ModelCaptureRequest, type ModelReferenceSelection, type ModelAreaOfInterest, type ModelCatalog, type ModelScene, type ModelTurnRequest, type ModelChatEvent, type ProjectSnapshot } from '@spatial/contracts';
import type { TorontoDraftPoint } from './draft-context';
import type { ProjectView } from './project-client';

export const MODEL_CLIENT_LIMITS = Object.freeze({ catalogBytes: 1024 * 1024, streamBytes: MODEL_CHAT_LIMITS.providerBytes,
  frameBytes: MODEL_CHAT_LIMITS.frameBytes, outputChars: MODEL_CHAT_LIMITS.outputChars, textChars: MODEL_CHAT_LIMITS.textChars, requestBytes: MODEL_CHAT_LIMITS.requestBytes,
  deadlineMs: MODEL_CHAT_LIMITS.deadlineMs, catalogDeadlineMs: 15000, maxModels: MODEL_CHAT_LIMITS.models,
  maxTurns: MODEL_CHAT_LIMITS.turns, maxTools: MODEL_CHAT_LIMITS.toolCalls, historyBytes: MODEL_CHAT_LIMITS.historyBytes });
export interface VisualModelAttachment {
  readonly observation: ModelVisualObservation;
  /** Pixel grounding availability only; historical image input remains usable when false. */
  isCurrent(): boolean;
  resolvePixel(id: string, x: number, y: number): VisualPixelResolution;
}
const encoder = new TextEncoder();
const token = (value: unknown) => { protocolToken(value); return value; };
const safeCode = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(value)) throw new Error('Invalid error code');
  return value;
};
function modelId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/.test(value)) throw new Error('Invalid model');
  return value;
}
/** Only references from the visible scene enter a turn; hidden-mode retained pins never leak. */
export function modelScene(mode: string, snapshot: ProjectSnapshot | undefined,
  view: Pick<ProjectView, 'selectedId' | 'points' | 'needsRefresh'>, points: readonly TorontoDraftPoint[], areaOfInterest?: ModelAreaOfInterest): ModelScene {
  if (mode !== 'demo' && mode !== 'toronto' && mode !== 'pole') throw new Error('Unknown scene');
  const project = snapshot && !view.needsRefresh ? canonicalSceneContextRequest({ sessionId: snapshot.sessionId,
    projectRevision: snapshot.project.revision, frameId: snapshot.frameId, units: snapshot.project.coordinates.units,
    entityIds: mode === 'demo' && view.selectedId ? [view.selectedId] : [], points: mode === 'demo' ? view.points : [] }) : null;
  return freezeProtocolValue(canonicalModelScene({ mode, project, toronto: mode === 'toronto' ? points : [], ...(mode === 'toronto' && areaOfInterest ? { areaOfInterest } : {}) }));
}
export function validateModelCatalog(value: unknown): ModelCatalog {
  const r = protocolRecord(canonicalModelCatalog(value)); protocolKeys(r, ['mode', 'ready', 'code', 'generation', 'models']);
  if (!['disabled', 'api-key', 'chatgpt'].includes(String(r.mode)) || typeof r.ready !== 'boolean' ||
    !Array.isArray(r.models) || r.models.length > MODEL_CLIENT_LIMITS.maxModels) throw new Error('Invalid catalog');
  token(r.generation); safeCode(r.code);
  const models = r.models.map(value => {
    const m = protocolRecord(value); protocolKeys(m, ['id', 'label']); modelId(m.id);
    if (typeof m.label !== 'string' || !m.label.length || m.label.length > 256 || /[\u0000-\u001f\u007f]/.test(m.label)) throw new Error('Invalid model label');
    return { id: m.id as string, label: m.label };
  });
  if (new Set(models.map(m => m.id)).size !== models.length || (!r.ready && models.length) || (r.mode === 'disabled' && r.ready)) throw new Error('Invalid catalog readiness');
  return freezeProtocolValue({ ...r, models }) as unknown as ModelCatalog;
}
/** Exact downstream envelope validation; tool data is bounded inert JSON, never markup or executable calls. */
export function validateModelEvent(value: unknown, request: ModelTurnRequest): ModelChatEvent {
  const r = protocolRecord(canonicalModelChatEvent(value));
  const keys: Record<string, string[]> = { 'browser-request': ['toolCallId', 'nonce', 'action'], 'approval-wait': ['proposalId', 'authority'], 'approval-result': ['proposalId', 'authority', 'outcome', 'scene'], 'request-inspection': ['inspection'], 'request-phase': ['round', 'phase'], start: ['conversationId', 'model'], delta: ['text'], tool: ['name', 'context'], 'tool-request': ['toolCallId', 'nonce', 'observationId', 'x', 'y'], done: ['conversationId'], error: ['code'] };
  if (typeof r.kind !== 'string' || !Object.hasOwn(keys, r.kind)) throw new Error('Unknown event');
  protocolKeys(r, ['kind', 'requestId', ...keys[r.kind]!]);
  if (r.requestId !== request.requestId) throw new Error('Wrong request identity');
  if (r.kind === 'start' || r.kind === 'done') token(r.conversationId);
  if (r.kind === 'start' && (r.model !== request.model || (request.conversationId !== null && r.conversationId !== request.conversationId))) throw new Error('Wrong conversation/model');
  if (r.kind === 'delta' && (typeof r.text !== 'string' || !r.text.length || r.text.length > MODEL_CLIENT_LIMITS.outputChars)) throw new Error('Invalid text delta');
  if (r.kind === 'tool') {
    if (!['inspect_scene', 'capture_scene', 'select_reference'].includes(String(r.name)) && !(r.name === 'resolve_visual_pixel' && request.visualObservation) &&
      !(['nearest_label', 'assess_utility_box', 'propose_utility_box'].includes(String(r.name)) && request.scene.mode === 'toronto' && request.scene.toronto.length > 0) &&
      !(['propose_point_move', 'propose_point_move_to_nearest_label', 'propose_cad_box', 'propose_cad_cylinder'].includes(String(r.name)) && request.scene.mode === 'toronto' && (!String(r.name).startsWith('propose_point_move') || request.scene.toronto.length > 0)) &&
      !((r.name === 'propose_box_create' || r.name === 'propose_box_update') && request.scene.mode === 'demo' && request.scene.project)) throw new Error('Unsupported tool');
    canonicalProtocolJson(r.context, { maxDepth: 12, maxNodes: 4096, maxArrayLength: 256, maxStringLength: 12000 });
  }
  if (r.kind === 'tool-request') {
    const observation = request.visualObservation;
    if (!observation || r.observationId !== observation.observationId || (r.x as number) >= modelVisualImageSize(observation).width ||
      (r.y as number) >= modelVisualImageSize(observation).height) throw new Error('Invalid visual tool request');
  }
  if (r.kind === 'request-inspection') {
    const snapshot = r.inspection as ModelRequestInspection;
    if (snapshot.continuation !== (request.conversationId !== null)) throw new Error('Wrong inspection continuation');
    const body = protocolRecord(JSON.parse(snapshot.bodyJson));
    if (body.model !== request.model) throw new Error('Wrong inspection model');
  }
  if (r.kind === 'error') safeCode(r.code);
  return freezeProtocolValue(r) as unknown as ModelChatEvent;
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('Cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
async function readBody(response: Response, signal: AbortSignal, max: number, chunk: (bytes: Uint8Array) => void | Promise<void>,
  guard: () => void = () => signal.throwIfAborted()): Promise<void> {
  if (!response.body) throw new Error('Missing body');
  const reader = response.body.getReader(); let total = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      guard(); signal.throwIfAborted(); const { done, value } = await abortable(reader.read(), signal);
      guard(); signal.throwIfAborted(); if (done) return;
      total += value.byteLength; if (total > max) throw new Error('Response budget'); await chunk(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel); cancel();
    // A hostile injected transport can leave read/cancel pending. Do not await it or block cancellation.
    try { reader.releaseLock(); } catch { /* read still pending; stale gates own publication */ }
  }
}
async function fetchResponse(fetcher: typeof fetch, path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  const pending = fetcher(path, { ...init, signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
  const response = await abortable(pending, signal); signal.throwIfAborted();
  if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('Server unavailable'); }
  return response;
}
export async function fetchModelCatalog(signal: AbortSignal, fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)): Promise<ModelCatalog> {
  const response = await fetchResponse(fetcher, '/chat/models', { method: 'GET' }, signal);
  const decoder = new TextDecoder('utf-8', { fatal: true }); let text = '';
  await readBody(response, signal, MODEL_CLIENT_LIMITS.catalogBytes, bytes => { text += decoder.decode(bytes, { stream: true }); });
  text += decoder.decode();
  return validateModelCatalog(JSON.parse(text));
}
export interface ModelAgentCallbacks {
  oncapture?: (request: ModelCaptureRequest, isCurrent: () => boolean) => Promise<VisualModelAttachment>;
  onselectreference?: (reference: ModelReferenceSelection, isCurrent: () => boolean) => Promise<ModelScene>;
  onapprovalwait?: (waiting: boolean) => void;
  onauthorityrefresh?: () => Promise<ModelScene>;
}
export async function streamModelTurn(request: ModelTurnRequest, signal: AbortSignal, publish: (event: ModelChatEvent) => unknown | Promise<unknown>,
  fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init), attachment?: VisualModelAttachment, agent: ModelAgentCallbacks = {}): Promise<string> {
  request = canonicalModelTurnRequest(request);
  let observation = request.visualObservation;
  if (observation ? !attachment || JSON.stringify(attachment.observation) !== JSON.stringify(observation) : attachment !== undefined) throw new Error('Invalid visual attachment');
  const guard = () => {
    signal.throwIfAborted();
  };
  guard();
  token(request.requestId); token(request.generation); modelId(request.model);
  if (request.conversationId !== null) token(request.conversationId);
  if (!request.text.trim() || request.text.length > MODEL_CLIENT_LIMITS.textChars) throw new Error('Text budget');
  const body = JSON.stringify(request); if (encoder.encode(body).length > (observation ? MODEL_VISUAL_LIMITS.requestBytes : MODEL_CLIENT_LIMITS.requestBytes)) throw new Error('Request budget');
  guard();
  const response = await fetchResponse(fetcher, '/chat/turn', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body }, signal);
  try { guard(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
  if (response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/x-ndjson') { void response.body?.cancel().catch(() => {}); throw new Error('Invalid stream content type'); }
  const decoder = new TextDecoder('utf-8', { fatal: true }); let buffer = '', frameBytes = 0, output = 0, tools = 0;
  let started: string | undefined; let terminal: ModelChatEvent | undefined;
  let round = 0, roundPhase: 'prepared' | ModelRequestPhase | undefined;
  const toolIds = new Set<string>(), nonces = new Set<string>();
  let pendingApproval: Extract<ModelChatEvent, { kind: 'approval-wait' }> | undefined;
  const accept = async (line: string) => {
    guard();
    if (!line || terminal) throw new Error('Invalid stream framing');
    const event = validateModelEvent(JSON.parse(line), request);
    if (event.kind === 'start') { if (started) throw new Error('Duplicate start'); started = event.conversationId; }
    else if (event.kind !== 'error' && !started) throw new Error('Missing start');
    if (event.kind === 'done' && event.conversationId !== started) throw new Error('Wrong terminal identity');
    if (event.kind === 'delta') { output += event.text.length; if (output > MODEL_CLIENT_LIMITS.outputChars) throw new Error('Output budget'); }
    if (event.kind === 'tool' && ++tools > MODEL_CLIENT_LIMITS.maxTools) throw new Error('Tool budget');
    if (event.kind === 'approval-wait') {
      if (pendingApproval) throw new Error('Overlapping approvals'); pendingApproval = event;
    }
    if (event.kind === 'approval-result') {
      if (!pendingApproval || pendingApproval.proposalId !== event.proposalId || pendingApproval.authority !== event.authority) throw new Error('Unbound approval result');
      pendingApproval = undefined;
    }
    if (event.kind === 'done' && pendingApproval) throw new Error('Unfinished human approval');
    if (event.kind === 'browser-request') {
      if (toolIds.has(event.toolCallId) || nonces.has(event.nonce) || toolIds.size >= MODEL_CLIENT_LIMITS.maxTools) throw new Error('Browser tool budget/identity');
      toolIds.add(event.toolCallId); nonces.add(event.nonce);
      await abortable(Promise.resolve(publish(event)), signal); guard();
      let result: unknown = { status: 'unavailable' };
      if (event.action.kind === 'capture' && agent.oncapture) {
        try {
          attachment = await abortable(agent.oncapture(event.action.request, () => !signal.aborted), signal); guard(); observation = attachment.observation;
          request = { ...request, visualObservation: observation };
          result = { status: 'captured', observation };
        } catch { guard(); }
      } else if (event.action.kind === 'select-reference' && agent.onselectreference) {
        const scene = canonicalModelScene(await abortable(agent.onselectreference(event.action.reference, () => !signal.aborted), signal)); guard();
        request = { ...request, scene }; result = { status: 'selected', scene };
      }
      const accepted = await fetchResponse(fetcher, '/chat/browser-result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: request.requestId, toolCallId: event.toolCallId, nonce: event.nonce, result }) }, signal);
      void accepted.body?.cancel().catch(() => {}); guard(); if (accepted.status !== 204) throw new Error('Invalid browser result response');
      return;
    }
    if (event.kind === 'approval-result') request = { ...request, scene: event.scene };
    if (event.kind === 'tool-request') {
      if (!attachment || !observation || toolIds.has(event.toolCallId) || nonces.has(event.nonce) || toolIds.size >= MODEL_CLIENT_LIMITS.maxTools) throw new Error('Visual tool budget/identity');
      toolIds.add(event.toolCallId); nonces.add(event.nonce);
      guard();
      const source = modelVisualSourcePixel(observation, event.x, event.y);
      let result: VisualPixelResolution;
      // Never intersect current geometry using a historical camera. Missing live grounding
      // is an ordinary tool observation, not a reason to discard the image or answer.
      if (!attachment.isCurrent()) result = { status: 'unavailable', observationId: event.observationId, ...source, reason: 'Capture-time pixel grounding is no longer available' };
      else {
        result = attachment.resolvePixel(event.observationId, source.x, source.y);
        if (result.status === 'stale') result = { ...result, status: 'unavailable' };
      }
      guard();
      // Validate the adapter's SOURCE identity before translating only coordinates back to the sent image.
      canonicalModelVisualToolResult({ requestId: request.requestId, toolCallId: event.toolCallId,
        nonce: event.nonce, observationId: event.observationId, result });
      if (result.x !== source.x || result.y !== source.y) throw new Error('Invalid source visual resolution');
      const payload = canonicalModelVisualToolResult({ requestId: request.requestId, toolCallId: event.toolCallId,
        nonce: event.nonce, observationId: event.observationId, result: { ...result, x: event.x, y: event.y } });
      if (payload.result.x !== event.x || payload.result.y !== event.y || payload.result.status === 'stale' || payload.result.status === 'invalid') throw new Error('Invalid visual resolution');
      guard();
      const accepted = await fetchResponse(fetcher, '/chat/tool-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, signal);
      void accepted.body?.cancel().catch(() => {});
      guard();
      if (accepted.status !== 204) throw new Error('Invalid tool result response');
      return;
    }
    if (event.kind === 'request-inspection') {
      if (event.inspection.round !== round + 1 || round >= MODEL_INSPECTION_LIMITS.rounds || (round && roundPhase !== 'completed')) throw new Error('Invalid inspection sequence');
      round = event.inspection.round; roundPhase = 'prepared';
    }
    if (event.kind === 'request-phase') {
      if (event.round !== round || !roundPhase ||
        !(event.phase === 'dispatched' ? roundPhase === 'prepared' :
          event.phase === 'completed' ? roundPhase === 'dispatched' : roundPhase === 'prepared' || roundPhase === 'dispatched')) throw new Error('Invalid inspection phase');
      roundPhase = event.phase;
    }
    if (event.kind === 'done' && round && roundPhase !== 'completed') throw new Error('Unfinished inspection');
    if (event.kind === 'done' || event.kind === 'error') terminal = event;
    else { guard(); await abortable(Promise.resolve(publish(event)), signal); guard(); }
  };
  await readBody(response, signal, MODEL_CLIENT_LIMITS.streamBytes, async bytes => {
    // Bound a frame before decoding/allocating it, including adversarial no-newline streams.
    for (const byte of bytes) { if (byte === 10) frameBytes = 0; else if (++frameBytes > MODEL_CLIENT_LIMITS.frameBytes) throw new Error('Frame budget'); }
    buffer += decoder.decode(bytes, { stream: true }); let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); await accept(line); }
  }, guard);
  buffer += decoder.decode(); guard();
  if (buffer || !terminal) throw new Error('Missing terminal/EOF');
  // Completion is intentionally withheld until EOF and all trailing bytes are checked.
  const final = terminal as ModelChatEvent;
  if (final.kind !== 'done') throw new ModelTurnFailure(final.kind === 'error' ? final.code : 'invalid-stream');
  guard(); publish(final); guard(); return final.conversationId;
}
export class ModelTurnFailure extends Error { constructor(readonly code: string) { super('Model turn unavailable'); } }
export interface ModelFailureDescription { readonly title: string; readonly detail: string; readonly recovery: string; }
/** Closed UI copy only: header classifications never claim that a provider body or inference was verified. */
export function modelFailureDescription(code: string | undefined): ModelFailureDescription {
  const formats: Readonly<Record<string, string>> = {
    'provider-format-json': 'HTTP 200 headers declared JSON, not the required event stream.',
    'provider-format-html': 'HTTP 200 headers declared HTML, not the required event stream.',
    'provider-format-text': 'HTTP 200 headers declared text, not the required event stream.',
    'provider-format-missing': 'HTTP 200 headers did not declare a response format for the required event stream.',
    'provider-format-other': 'HTTP 200 headers declared an unsupported response format, not the required event stream.',
  };
  if (code && Object.hasOwn(formats, code)) return {
    title: 'Provider response format rejected',
    detail: `${formats[code]} No completed answer was accepted; HTTP 200 does not prove inference succeeded.`,
    recovery: 'Check the configured provider mode and server protocol diagnostics. Resolve the format mismatch before an explicit new send; no automatic retry or fallback was used.',
  };
  switch (code) {
    case 'provider-protocol': return { title: 'Provider stream failed protocol validation',
      detail: 'The response did not satisfy the required stream protocol. No completed answer was accepted.',
      recovery: 'Check server protocol diagnostics and provider compatibility before explicitly sending again. No automatic retry or fallback was used.' };
    case 'usage-limit': case 'plan-usage-unavailable': return { title: 'Provider usage unavailable',
      detail: 'The provider reported a usage limit or unavailable plan usage.',
      recovery: 'Check usage and plan availability in Account. Wait for availability; do not repeatedly retry. No paid-provider fallback was used.' };
    case 'reauthorize': case 'credential-unavailable': case 'stale-account': return { title: 'Provider authorization unavailable',
      detail: 'The configured account authorization is unavailable or no longer current.',
      recovery: 'Check Account and sign in again if required, then explicitly refresh models and select a model before sending.' };
    case 'permission-denied': case 'plan-permission-required': case 'plan-user-not-eligible': return { title: 'Provider access not authorized',
      detail: 'The configured account does not currently have the required permission or plan eligibility.',
      recovery: 'Check Account permissions and eligibility before refreshing models. Repeated sends will not resolve an access restriction.' };
    case 'provider-incomplete': return { title: 'Provider reported an incomplete response',
      detail: 'The provider did not finish this answer. Any partial text is not a completed result.',
      recovery: 'Check provider availability and request limits before explicitly sending a new request.' };
    case 'interrupted-stream': case 'invalid-or-unavailable-stream': return { title: 'Model response interrupted or unavailable',
      detail: 'A valid response ending and clean EOF were not received. No completed answer was accepted.',
      recovery: 'Check server connectivity and protocol diagnostics before explicitly sending a new request. No automatic retry was made.' };
    case 'deadline-incomplete': return { title: 'Model response deadline exceeded',
      detail: 'The request timed out before a valid stream ending and EOF could be accepted.',
      recovery: 'Check provider availability and server diagnostics before an explicit new send. No automatic retry was made.' };
    case 'cancelled-new-conversation-required': case 'cancelled': return { title: 'Model request cancelled',
      detail: 'The request was stopped. Any partial text is incomplete.',
      recovery: 'Send again only when ready; the next send starts a new server conversation.' };
    case 'history-limit-new-chat-required': case 'history-limit': return { title: 'Conversation history limit reached',
      detail: 'This request could not finish within the conversation history budget.',
      recovery: 'Choose New chat before sending again. If server history capacity is full, wait for its idle expiry.' };
    case 'provider-unavailable': return { title: 'Configured provider unavailable',
      detail: 'The configured provider could not complete this request.',
      recovery: 'Check provider availability and server connectivity before an explicit new send. No automatic retry or fallback was used.' };
    default: return { title: 'Model request failed',
      detail: 'No completed answer was accepted. Further failure details are unavailable.',
      recovery: 'Check Account, server connectivity and safe server diagnostics before explicitly sending again. No automatic retry or fallback was used.' };
  }
}
export interface ModelInspectionView extends ModelRequestInspection {
  readonly phase: 'prepared' | ModelRequestPhase | 'interrupted';
  /** Local terminal states describe monitoring only, not proof that provider execution stopped. */
  readonly source: 'server' | 'client';
}
export const MODEL_INSPECTION_HISTORY_BYTES = 256 * 1024;
function messageBytes(messages: readonly ModelMessage[]): number {
  return encoder.encode(JSON.stringify(messages.map(({ inspections: _snapshots, attachments: _images, ...m }) => m))).length;
}
function settleInspections(message: ModelMessage, phase: 'cancelled' | 'interrupted'): ModelMessage {
  return { ...message, inspections: message.inspections?.map(s => s.phase === 'prepared' || s.phase === 'dispatched' ? { ...s, phase, source: 'client' } : s) };
}
/** Old snapshots are evicted explicitly; answer/history budget remains independent. */
function boundInspections(messages: ModelMessage[]): ModelMessage[] {
  let bytes = encoder.encode(JSON.stringify(messages.map(m => m.inspections ?? []))).length;
  if (bytes <= MODEL_INSPECTION_HISTORY_BYTES) return messages;
  return messages.map(m => {
    const snapshots = [...(m.inspections ?? [])]; let dropped = m.inspectionsDropped ?? 0;
    while (bytes > MODEL_INSPECTION_HISTORY_BYTES && snapshots.length) {
      bytes -= encoder.encode(JSON.stringify(snapshots.shift())).length; ++dropped;
    }
    return { ...m, inspections: snapshots, inspectionsDropped: dropped };
  });
}
export interface ModelMessage {
  readonly role: 'user' | 'assistant'; readonly text: string; readonly state: 'complete' | 'streaming' | 'incomplete';
  readonly tools: readonly unknown[]; readonly failureCode?: string;
  readonly attachments?: readonly ModelVisualObservation[];
  readonly inspections?: readonly ModelInspectionView[]; readonly inspectionsDropped?: number;
}
export interface ModelChatView {
  readonly catalogPhase: 'idle' | 'loading' | 'ready' | 'error'; readonly catalog?: ModelCatalog; readonly model: string;
  readonly phase: 'idle' | 'streaming' | 'completed' | 'error' | 'cancelled'; readonly code: string; readonly messages: readonly ModelMessage[];
  readonly historyNotice?: string;
  readonly continuationActive?: boolean;
}
/** Volatile conversation handles only. No assistant history, credentials, or tools are sent by this client. */
export class ModelChatController {
  view: ModelChatView = { catalogPhase: 'idle', model: '', phase: 'idle', code: 'refresh-models', messages: [] };
  private scene?: ModelScene; private sceneKey = ''; private conversationId: string | null = null;
  private sequence = 0; private generation = 0; private active?: AbortController; private disposed = false;
  private catalogActive?: AbortController; private catalogSequence = 0;
  constructor(private publish: (view: ModelChatView) => void,
    private fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private deadlineMs: number = MODEL_CLIENT_LIMITS.deadlineMs, private catalogDeadlineMs: number = MODEL_CLIENT_LIMITS.catalogDeadlineMs,
    private proposalEvents: ModelAgentCallbacks & { onproposal?: (proposal: unknown, isCurrent: () => boolean) => void; oninvalidate?: () => void; onauthorityproposal?: (kind: 'points' | 'cad') => void } = {}) {}
  private approvalWaiting = false;
  private selecting?: ModelReferenceSelection;
  private acceptAgentScene(scene: ModelScene) {
    this.scene = freezeProtocolValue(canonicalModelScene(scene)); this.sceneKey = canonicalProtocolJson(this.scene);
  }
  private set(patch: Partial<ModelChatView>) { this.view = freezeProtocolValue({ ...this.view, ...patch, continuationActive: this.conversationId !== null }); if (!this.disposed) this.publish(this.view); }
  private invalidate() { ++this.generation; this.active?.abort(); this.active = undefined; }
  bind(scene: ModelScene) {
    const key = canonicalProtocolJson(canonicalModelScene(scene));
    if (this.sceneKey === key) return;
    if (this.active && this.scene && (this.approvalWaiting || this.selecting)) {
      const previous = this.scene;
      const same = (a: unknown, b: unknown) => canonicalProtocolJson(a) === canonicalProtocolJson(b);
      const approvalChange = this.approvalWaiting && previous.project && scene.project && scene.project.projectRevision === previous.project.projectRevision + 1 &&
        same({ ...scene, project: { ...scene.project, projectRevision: previous.project.projectRevision } }, previous);
      const selection = this.selecting;
      const point = selection?.kind === 'toronto-point' ? scene.toronto.at(-1) : scene.project?.points.at(-1);
      const selectionChange = selection && point && (selection.kind === 'toronto-point' ?
        scene.toronto.length === previous.toronto.length + 1 && same((point as { key: unknown }).key, selection.key) && same({ ...scene, toronto: scene.toronto.slice(0, -1) }, previous) :
        scene.project && previous.project && scene.project.points.length === previous.project.points.length + 1 &&
        (point as { entityId: string }).entityId === selection.entityId && (point as { pointIndex: number }).pointIndex === selection.pointIndex &&
        same({ ...scene, project: { ...scene.project, points: scene.project.points.slice(0, -1) } }, previous));
      if (approvalChange || selectionChange) { this.acceptAgentScene(scene); return; }
    }
    const sameSession = this.scene?.mode === scene.mode && this.scene?.project?.sessionId === scene.project?.sessionId &&
      this.scene?.project?.frameId === scene.project?.frameId;
    if (!this.active && sameSession) {
      this.proposalEvents.oninvalidate?.(); this.acceptAgentScene(scene); return;
    }
    this.invalidate(); this.scene = freezeProtocolValue(JSON.parse(key) as ModelScene); this.sceneKey = key; this.conversationId = null;
    this.contextReset('Scene context changed');
  }
  /** Retained messages are display-only: only the volatile handle can continue server history. */
  private contextReset(reason: string) {
    this.proposalEvents.oninvalidate?.();
    this.invalidate(); this.conversationId = null;
    this.set({ phase: 'idle', code: 'new-conversation-context',
      historyNotice: this.view.messages.length ? `${reason}. Messages from the previous context are kept for reference only, not sent to the model. New messages use the current scene, model and account.` : this.view.historyNotice,
      messages: this.view.messages.map(m => m.state === 'streaming' ? { ...settleInspections(m, 'cancelled'), state: 'incomplete', failureCode: 'cancelled-new-conversation-required' } : m) });
  }
  /** Explicit lifecycle notification blocks readiness immediately; ordinary focus only revalidates. */
  accountChanged() {
    ++this.catalogSequence; this.catalogActive?.abort(); this.catalogActive = undefined;
    this.contextReset('Account connection changed');
    this.set({ catalogPhase: 'idle', catalog: undefined, model: '', code: 'refresh-models' });
  }
  newChat() { this.proposalEvents.oninvalidate?.(); this.invalidate(); this.conversationId = null; this.set({ messages: [], historyNotice: undefined, phase: 'idle', code: 'new-chat' }); }
  selectModel(model: string) {
    if (!this.view.catalog?.ready || (model !== '' && !this.view.catalog.models.some(m => m.id === model))) return;
    if (model === this.view.model) return;
    this.contextReset('Selected model changed'); this.set({ model, code: 'model-changed' });
  }
  cancel() {
    if (!this.active && !this.catalogActive) return;
    this.proposalEvents.oninvalidate?.();
    ++this.catalogSequence; this.catalogActive?.abort(); this.catalogActive = undefined;
    this.invalidate(); this.conversationId = null;
    this.set({ phase: 'cancelled', code: 'cancelled-new-conversation-required',
      catalogPhase: this.view.catalogPhase === 'loading' ? 'idle' : this.view.catalogPhase,
      messages: this.view.messages.map(m => m.state === 'streaming' ? { ...settleInspections(m, 'cancelled'), state: 'incomplete', failureCode: 'cancelled-new-conversation-required' } : m) });
  }
  dispose() { this.proposalEvents.oninvalidate?.(); this.disposed = true; this.invalidate(); ++this.catalogSequence; this.catalogActive?.abort(); }
  async refreshModels() {
    if (this.disposed) return;
    this.catalogActive?.abort();
    const sequence = ++this.catalogSequence, controller = this.catalogActive = new AbortController();
    const previous = this.view.catalog;
    this.set({ catalogPhase: 'loading' });
    const timer = setTimeout(() => controller.abort(), this.catalogDeadlineMs);
    try {
      const catalog = await fetchModelCatalog(controller.signal, this.fetcher);
      if (this.disposed || sequence !== this.catalogSequence) return;
      const model = catalog.ready ? (catalog.models.some(m => m.id === this.view.model) ? this.view.model : catalog.models[0]?.id ?? '') : '';
      if (previous && (previous.generation !== catalog.generation || previous.mode !== catalog.mode || !catalog.ready || model !== this.view.model)) {
        this.contextReset('Account or available model changed');
      }
      this.set({ catalogPhase: 'ready', catalog, model });
    } catch {
      if (!this.disposed && sequence === this.catalogSequence) {
        this.contextReset('Account readiness could not be verified');
        this.set({ catalogPhase: 'error', code: 'catalog-unavailable' });
      }
    } finally { clearTimeout(timer); if (sequence === this.catalogSequence) this.catalogActive = undefined; }
  }
  async send(text: string, attachment?: VisualModelAttachment): Promise<boolean> {
    const { catalog, model, messages } = this.view;
    if (this.disposed || this.active || this.view.catalogPhase !== 'ready' || !this.scene || !catalog?.ready || !model || !text.trim() || text.length > MODEL_CLIENT_LIMITS.textChars) return false;
    if (messages.filter(m => m.role === 'user').length >= MODEL_CLIENT_LIMITS.maxTurns ||
      messageBytes(messages) + encoder.encode(text).length > MODEL_CLIENT_LIMITS.historyBytes - 65536) {
      this.set({ code: 'history-limit-new-chat-required' }); return false;
    }
    const imageBytes = messages.reduce((total, message) => total + (message.attachments ?? []).reduce((sum, image) => sum + encoder.encode(image.image.dataUrl).length, 0), 0);
    if (imageBytes + (attachment ? encoder.encode(attachment.observation.image.dataUrl).length : 0) > MODEL_CHAT_LIMITS.imageHistoryBytes) {
      this.set({ code: 'history-limit-new-chat-required' }); return false;
    }
    // UI attachments may be Svelte $state proxies; never freeze their live object graph.
    const observation = attachment ? canonicalModelVisualObservation(attachment.observation) : undefined;
    this.invalidate(); const currentGeneration = this.generation, controller = this.active = new AbortController();
    const request: ModelTurnRequest = { requestId: `model-${crypto.randomUUID()}-${++this.sequence}`, conversationId: this.conversationId,
      generation: catalog.generation, model, text, scene: this.scene, ...(observation ? { visualObservation: observation } : {}) };
    let next: ModelMessage[] = [...messages, { role: 'user', text, state: 'complete', tools: [], ...(observation ? { attachments: [observation] } : {}) }, { role: 'assistant', text: '', state: 'streaming', tools: [] }];
    this.set({ messages: [...next], phase: 'streaming', code: 'waiting-for-model' });
    const current = () => !this.disposed && currentGeneration === this.generation;
    const timer = setTimeout(() => controller.abort(), this.deadlineMs);
    try {
      const id = await streamModelTurn(request, controller.signal, async event => {
        if (!current() || controller.signal.aborted) return;
        if (event.kind === 'approval-wait') { this.approvalWaiting = true; this.proposalEvents.onapprovalwait?.(true); }
        if (event.kind === 'approval-result') {
          this.acceptAgentScene(event.scene);
          if (this.proposalEvents.onauthorityrefresh) {
            const refreshed = await this.proposalEvents.onauthorityrefresh();
            if (!current() || controller.signal.aborted) return;
            if (canonicalProtocolJson(canonicalModelScene(refreshed)) !== this.sceneKey) throw new Error('Authority refresh changed scene');
          }
          this.approvalWaiting = false; this.proposalEvents.onapprovalwait?.(false);
        }
        const last = next[next.length - 1]!;
        const updated = event.kind === 'delta' ? { ...last, text: last.text + event.text } :
          event.kind === 'tool' ? { ...last, tools: [...last.tools, event.context] } :
          event.kind === 'request-inspection' ? { ...last, inspections: [...(last.inspections ?? []), { ...event.inspection, phase: 'prepared' as const, source: 'server' as const }] } :
          event.kind === 'request-phase' ? { ...last, inspections: last.inspections?.map(s => s.round === event.round ? { ...s, phase: event.phase, source: 'server' as const } : s) } : last;
        if (messageBytes([...next.slice(0, -1), updated]) > MODEL_CLIENT_LIMITS.historyBytes) throw new ModelTurnFailure('history-limit-new-chat-required');
        next[next.length - 1] = updated; next = boundInspections(next);
        this.set({ messages: [...next], code: event.kind === 'tool' ? 'inspecting-bound-scene' : 'receiving-model-response' });
        if (event.kind === 'tool' && request.scene.mode === 'toronto') {
          if (event.name === 'propose_point_move' || (event.name === 'propose_point_move_to_nearest_label' && protocolRecord(event.context).status === 'pending')) this.proposalEvents.onauthorityproposal?.('points');
          if (event.name === 'propose_cad_box' || event.name === 'propose_cad_cylinder' || event.name === 'propose_utility_box') this.proposalEvents.onauthorityproposal?.('cad');
        }
        if (event.kind === 'tool' && (event.name === 'propose_box_create' || event.name === 'propose_box_update') && request.scene.mode === 'demo') {
          const context = protocolRecord(event.context);
          protocolKeys(context, ['kind', 'proposal']);
          if (context.kind !== 'project-box-proposal' || protocolRecord(protocolRecord(context.proposal).edit).kind !==
            (event.name === 'propose_box_create' ? 'create-box' : 'update-box')) throw new ModelTurnFailure('invalid-or-unavailable-stream');
          this.proposalEvents.onproposal?.(context.proposal, () => current() && !controller.signal.aborted);
        }
      }, this.fetcher, attachment, {
        oncapture: this.proposalEvents.oncapture ? async (capture, isCurrent) => {
          const captured = await this.proposalEvents.oncapture!(capture, isCurrent);
          if (current() && !controller.signal.aborted) {
            const bytes = next.reduce((total, message) => total + (message.attachments ?? []).reduce((sum, image) => sum + encoder.encode(image.image.dataUrl).length, 0), 0);
            if (bytes + encoder.encode(captured.observation.image.dataUrl).length > MODEL_CHAT_LIMITS.imageHistoryBytes) throw new ModelTurnFailure('history-limit');
            const observation = canonicalModelVisualObservation(captured.observation);
            const last = next[next.length - 1]!;
            next[next.length - 1] = { ...last, attachments: [...(last.attachments ?? []), observation] };
            this.set({ messages: [...next] });
          }
          return captured;
        } : undefined,
        onselectreference: this.proposalEvents.onselectreference ? async reference => {
          this.selecting = reference;
          try {
            const scene = await this.proposalEvents.onselectreference!(reference, () => current() && !controller.signal.aborted);
            if (current() && !controller.signal.aborted) this.acceptAgentScene(scene);
            return scene;
          } finally { this.selecting = undefined; }
        } : undefined,
      });
      if (!current() || controller.signal.aborted) return true;
      this.conversationId = id; next[next.length - 1] = { ...next[next.length - 1]!, state: 'complete' };
      this.set({ messages: [...next], phase: 'completed', code: 'completed' });
    } catch (error) {
      if (current()) {
        this.proposalEvents.oninvalidate?.();
        const code = controller.signal.aborted ? 'deadline-incomplete' : error instanceof ModelTurnFailure ? error.code : 'invalid-or-unavailable-stream';
        this.conversationId = null; next[next.length - 1] = { ...settleInspections(next[next.length - 1]!, controller.signal.aborted ? 'cancelled' : 'interrupted'), state: 'incomplete', failureCode: code };
        this.set({ messages: [...next], phase: 'error', code });
      }
    } finally { clearTimeout(timer); if (current()) this.active = undefined; this.approvalWaiting = false; this.selecting = undefined; this.proposalEvents.onapprovalwait?.(false); }
    return true;
  }
}
