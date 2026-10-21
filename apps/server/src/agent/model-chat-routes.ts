import type { IncomingMessage, ServerResponse } from 'node:http';
import { MODEL_CHAT_LIMITS as L, MODEL_VISUAL_LIMITS, canonicalModelTurnRequest, type ModelChatEvent, type ModelTurnRequest } from '@spatial/contracts';
import { ProviderModel, ModelError, inspectAgentTools, type ModelAuth, type ModelTransport, type BoundModelScene } from './provider-model';
import { ModelBrowserBroker } from './model-browser-broker';
import { createModelAgentRuntime, retryModelSceneRead } from './model-agent-runtime';
import { ModelVisualBroker } from './model-visual-broker';
import { validateModelVisual } from './model-visual';
import { bindModelScene, type ModelEditingAuthorities } from './model-scene';

function readBody(request: IncomingMessage, signal: AbortSignal, maxBytes: number = L.requestBytes): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const clean = () => { request.off('data', data); request.off('end', end); request.off('error', fail); signal.removeEventListener('abort', fail); };
    const fail = () => { clean(); request.pause(); reject(new ModelError(signal.aborted ? 'cancelled' : 'invalid-request')); };
    const data = (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) fail(); else chunks.push(chunk); };
    const end = () => { clean(); try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new ModelError('invalid-request')); } };
    request.on('data', data); request.once('end', end); request.once('error', fail); signal.addEventListener('abort', fail, { once: true });
    if (signal.aborted) fail();
  });
}
async function writeEvent(response: ServerResponse, event: ModelChatEvent, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted(); if (response.destroyed || response.writableEnded) throw new ModelError('cancelled');
  const line = `${JSON.stringify(event)}\n`; if (Buffer.byteLength(line) > L.frameBytes) throw new ModelError('output-limit');
  if (response.write(line)) return;
  await new Promise<void>((resolve, reject) => {
    const clean = () => { response.off('drain', drain); response.off('close', fail); response.off('error', fail); signal.removeEventListener('abort', fail); };
    const drain = () => { clean(); resolve(); };
    const fail = () => { clean(); reject(new ModelError('cancelled')); };
    response.once('drain', drain); response.once('close', fail); response.once('error', fail); signal.addEventListener('abort', fail, { once: true });
    if (signal.aborted || response.destroyed) fail();
  });
}
/** One admission includes catalog/credentials, body reading, scene checks and all tool rounds. */
export function createModelChatRoutes(auth: ModelAuth, directory: string, transport?: ModelTransport, editing?: ModelEditingAuthorities) {
  const model = new ProviderModel(auth, transport);
  let active: AbortController | undefined, closed = false, windowStart = Date.now(), calls = 0;
  let broker: ModelVisualBroker | undefined, browserBroker: ModelBrowserBroker | undefined, boundActive: BoundModelScene | undefined, readingToolResult = false;
  const unsubscribe = auth.onCredentialChange(() => active?.abort());
  return {
    close() { closed = true; active?.abort(); unsubscribe(); model.close(); },
    async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (!['/chat/tools', '/chat/models', '/chat/turn', '/chat/tool-result', '/chat/browser-result'].includes(url.pathname)) return false;
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
      const send = (status: number, code: string) => { response.statusCode = status; response.setHeader('Connection', 'close'); response.end(JSON.stringify({ error: { code } })); };
      const origins = new Set([`http://127.0.0.1:${request.socket.localPort}`, 'http://127.0.0.1:5173']);
      if (!origins.has(`http://${request.headers.host ?? ''}`) || (request.headers.origin !== undefined && !origins.has(request.headers.origin)) ||
        (request.headers['sec-fetch-site'] !== undefined && !['same-origin', 'same-site', 'none'].includes(String(request.headers['sec-fetch-site'])))) { send(403, 'local-only'); return true; }
      const toolsInspection = url.pathname === '/chat/tools';
      const catalog = url.pathname === '/chat/models' || toolsInspection, browserResult = url.pathname === '/chat/browser-result', toolResult = url.pathname === '/chat/tool-result' || browserResult;
      const requestLimit = toolResult && !browserResult ? MODEL_VISUAL_LIMITS.resultBytes : MODEL_VISUAL_LIMITS.requestBytes;
      if (request.method !== (catalog ? 'GET' : 'POST') || url.search || (request.url?.length ?? 0) > 512 || request.headers['content-encoding'] ||
        (catalog && (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) !== 0)) ||
        (!catalog && (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers['content-type'] ?? '') || Number(request.headers['content-length'] ?? 0) > requestLimit))) { send(400, 'invalid-request'); return true; }
      if (toolsInspection) {
        if (closed) { send(400, 'closed'); return true; }
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(inspectAgentTools())); return true;
      }
      if (toolResult) {
        // Browser-only callback; never admit a new model operation or credential call here.
        if (!request.headers.origin || !origins.has(request.headers.origin)) { send(403, 'local-only'); return true; }
        const current = browserResult ? browserBroker : broker, bound = boundActive, turn = active;
        if (closed || !turn || turn.signal.aborted || !current?.waiting || !bound || readingToolResult) { send(400, 'invalid-tool-result'); return true; }
        readingToolResult = true;
        const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(), 5000); timer.unref();
        const signal = AbortSignal.any([turn.signal, timeout.signal]);
        const abort = () => timeout.abort(); request.once('aborted', abort); response.once('close', abort);
        try {
          const body = await readBody(request, signal, requestLimit); signal.throwIfAborted();
          await bound.check(); signal.throwIfAborted();
          if ((browserResult ? browserBroker : broker) !== current || active !== turn) throw new ModelError('invalid-tool-result');
          current.accept(body); response.statusCode = 204; response.end();
        } catch { if (!response.destroyed && !response.writableEnded) send(400, 'invalid-tool-result'); }
        finally { clearTimeout(timer); request.off('aborted', abort); response.off('close', abort); readingToolResult = false; }
        return true;
      }
      if (closed || active) { send(429, 'busy'); return true; }
      if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); calls = 0; }
      if (++calls > L.requestsPerMinute) { send(429, 'rate-limit'); return true; }
      const controller = new AbortController(); active = controller;
      let timedOut = false, call: ModelTurnRequest | undefined, terminal = false, bound: BoundModelScene | undefined;
      const abort = () => controller.abort();
      const timer = setTimeout(() => { timedOut = true; abort(); }, L.deadlineMs); timer.unref();
      response.once('close', abort); request.once('aborted', abort);
      const emit = async (event: ModelChatEvent) => {
        if (terminal) throw new ModelError('provider-protocol');
        if (event.kind === 'done' || event.kind === 'error') terminal = true;
        if (!response.headersSent) response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        await writeEvent(response, event, controller.signal);
      };
      try {
        if (catalog) {
          const result = await model.models(controller.signal); controller.signal.throwIfAborted();
          response.end(JSON.stringify(result)); return true;
        }
        const raw = await readBody(request, controller.signal, MODEL_VISUAL_LIMITS.requestBytes);
        const suppliedVisual = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).visualObservation : undefined;
        const suppliedImage = suppliedVisual && typeof suppliedVisual === 'object' ? (suppliedVisual as Record<string, unknown>).image : undefined;
        if (suppliedImage && typeof suppliedImage === 'object') {
          const image = suppliedImage as Record<string, unknown>;
          const prefixLength = image.mimeType === 'image/jpeg' ? 'data:image/jpeg;base64,'.length : 'data:image/png;base64,'.length;
          if (typeof image.byteLength === 'number' && image.byteLength > MODEL_VISUAL_LIMITS.imageBytes ||
            typeof image.dataUrl === 'string' && image.dataUrl.length > Math.ceil(MODEL_VISUAL_LIMITS.imageBytes / 3) * 4 + prefixLength) throw new ModelError('image-too-large');
        }
        call = canonicalModelTurnRequest(raw);
        if (!call.visualObservation && Buffer.byteLength(JSON.stringify(raw)) > L.requestBytes) throw new ModelError('invalid-request');
        const visual = await validateModelVisual(call, controller.signal);
        if (call.generation !== auth.credentialGeneration()) throw new ModelError('stale-account');
        // Bind dataset metadata and the separate Toronto editing authorities.
        bound = await retryModelSceneRead(() => bindModelScene(call!.scene, directory, controller.signal, visual, editing), controller.signal);
        broker = new ModelVisualBroker(call.requestId, controller.signal, emit);
        browserBroker = new ModelBrowserBroker(call.requestId, controller.signal, emit);
        const runtime = createModelAgentRuntime(call, bound, directory, controller.signal, browserBroker, editing);
        bound = new Proxy(runtime, { get(target, key) {
          if (key === 'resolveVisualPixel') return (args: { observationId: string; x: number; y: number }, toolCallId: string) => broker!.resolve(args, toolCallId);
          return Reflect.get(target, key);
        } });
        boundActive = bound;
        await model.turn(call, bound, emit, controller.signal);
        response.end();
      } catch (error) {
        const code = timedOut ? 'deadline' : controller.signal.aborted ? 'cancelled' : error instanceof ModelError ? error.code : 'request-failed';
        if (!response.destroyed && !response.writableEnded) {
          if (call && !terminal && !controller.signal.aborted) {
            // A fixed error frame, never provider exception/body text. Partial text is not completed history.
            try { await emit({ kind: 'error', requestId: call.requestId, code }); response.end(); }
            catch { response.destroy(); }
          } else if (response.headersSent || controller.signal.aborted) response.destroy();
          else send(400, code);
        }
      } finally {
        clearTimeout(timer); response.off('close', abort); request.off('aborted', abort);
        broker = undefined; browserBroker = undefined; boundActive = undefined;
        await bound?.close().catch(() => undefined); if (active === controller) active = undefined;
      }
      return true;
    },
  };
}
