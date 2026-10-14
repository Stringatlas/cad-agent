import type { IncomingMessage, ServerResponse } from 'node:http';
import { semanticToolOutcome } from '@spatial/agent-harness';
import { randomUUID } from 'node:crypto';
import { CHAT_BODY_BYTES, CHAT_REPLY_BYTES, TOOL_SCHEMA_VERSION, TOOL_VERSION, canonicalChatRequest, inspectionCommand,
  chatOutcomeState, canonicalProtocolJson, type ProjectState, type ChatRequest, type ChatResponse } from '@spatial/contracts';
import { prepareReadonlyTools } from './tool-adapter';

const BUDGETS = { maxCalls: 1000, maxConcurrency: 2, deadlineMs: 15000, maxEvidenceBytes: 256 * 1024 };
type Prepare = typeof prepareReadonlyTools;
function readBody(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0; const chunks: Buffer[] = [];
    const clean = () => { request.off('data', data); request.off('end', end); request.off('error', fail); signal.removeEventListener('abort', abort); };
    const fail = () => { clean(); reject(new Error('Invalid body')); };
    const abort = () => { request.pause(); fail(); };
    const data = (chunk: Buffer) => { bytes += chunk.length; if (bytes > CHAT_BODY_BYTES) { request.pause(); fail(); } else chunks.push(chunk); };
    const end = () => { clean(); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Invalid JSON')); } };
    request.on('data', data); request.once('end', end); request.once('error', fail); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
/** Fixed trusted operator composition. No root, tool name, config or adapter comes from HTTP. */
export function createChatRoutes(project: ProjectState, sessionId: string, directory: string, prepare: Prepare = prepareReadonlyTools) {
  let active = 0, preparing = false;
  let prepared: Awaited<ReturnType<Prepare>> | undefined;
  let runtime: ReturnType<Awaited<ReturnType<Prepare>>['createRuntime']> | undefined;
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://127.0.0.1'); }
    catch { response.statusCode = 400; response.end(JSON.stringify({ error: 'Invalid URL' })); return true; }
    if (url.pathname !== '/chat/inspect') return false;
    const send = (status: number, body: unknown) => {
      if (response.destroyed) return;
      const text = JSON.stringify(body);
      response.statusCode = status;
      response.end(Buffer.byteLength(text) <= CHAT_REPLY_BYTES ? text : JSON.stringify({ error: 'Reply budget exceeded' }));
    };
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '') ||
      (request.headers.origin !== undefined && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.origin))) {
      send(403, { error: 'Local access only' }); return true;
    }
    if (request.method !== 'POST' || url.search || request.headers['content-type'] !== 'application/json') { send(400, { error: 'Expected JSON inspection POST' }); return true; }
    if (Number(request.headers['content-length'] ?? 0) > CHAT_BODY_BYTES || request.headers['content-encoding']) {
      response.setHeader('Connection', 'close'); send(413, { error: 'Body limit' }); return true;
    }
    if (active >= 2) { response.setHeader('Connection', 'close'); send(429, { error: 'Inspection busy' }); return true; }
    active++;
    const controller = new AbortController(), abort = () => controller.abort();
    response.once('close', abort); request.once('aborted', abort);
    let deadline = false;
    const timer = setTimeout(() => { deadline = true; abort(); }, 20000);
    let call: ChatRequest | undefined;
    try {
      try { call = canonicalChatRequest(await readBody(request, controller.signal)); }
      catch { response.setHeader('Connection', 'close'); send(400, { error: 'Invalid bounded inspection request' }); return true; }
      const { command: _command, ...binding } = call;
      const result = (state: ChatResponse['state'], code: string, extra: Partial<ChatResponse> = {}) => send(200, { ...binding, state, code, ...extra });
      if (call.sessionId !== sessionId || call.projectRevision !== project.revision) { result('rejected', 'stale-project'); return true; }
      const command = inspectionCommand(call.command);
      if (!command) { result('rejected', 'unsupported-command'); return true; }
      if (!prepared) {
        if (preparing) { result('incomplete', 'preparing-busy'); return true; }
        preparing = true;
        try {
          prepared = await prepare(directory, { codeVersion: 'shared-chat-v1', budgets: BUDGETS }, controller.signal);
          runtime = prepared.createRuntime(`chat-${randomUUID()}`);
        }
        finally { preparing = false; }
      }
      controller.signal.throwIfAborted();
      if (!runtime) throw new Error('Runtime unavailable');
      const requestId = `call-${randomUUID()}`;
      const reply = await runtime.execute({ schemaVersion: TOOL_SCHEMA_VERSION, toolVersion: TOOL_VERSION, runId: runtime.runId,
        requestId, binding: prepared.binding, ...command }, controller.signal);
      controller.signal.throwIfAborted();
      result(chatOutcomeState(reply), reply.outcome.status, { reply, evidence: {
        runId: runtime.runId, requestId, semanticHash: runtime.hash(canonicalProtocolJson(semanticToolOutcome(reply.outcome))), configHash: runtime.configHash,
      } });
    } catch {
      if (call) {
        const { command: _command, ...binding } = call;
        send(200, { ...binding, state: deadline ? 'incomplete' : controller.signal.aborted ? 'cancelled' : 'error', code: deadline ? 'deadline' : controller.signal.aborted ? 'cancelled' : 'dataset-unavailable' });
      } else send(400, { error: 'Invalid inspection request' });
    } finally { clearTimeout(timer); response.off('close', abort); request.off('aborted', abort); active--; }
    return true;
  };
}
