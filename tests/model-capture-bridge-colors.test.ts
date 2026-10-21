import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelCaptureRequest, ModelTurnRequest } from '@spatial/contracts';
import { streamModelTurn } from '../apps/web/src/model-chat-client';

for (const colorMode of ['rgb', 'type', undefined] as const) test(`browser stream forwards capture mode ${colorMode ?? 'omitted'} unchanged to adapter`, async () => {
  const request: ModelTurnRequest = { requestId: 'request-one', conversationId: null, generation: 'account-one', model: 'fixture', text: 'Inspect scene', scene: { mode: 'toronto', toronto: [] } };
  const capture: ModelCaptureRequest = { kind: 'top-down', ...(colorMode ? { colorMode } : {}) };
  const frames = [{ kind: 'start', requestId: request.requestId, conversationId: 'conversation-one', model: request.model },
    { kind: 'browser-request', requestId: request.requestId, toolCallId: 'capture-one', nonce: 'nonce-one', action: { kind: 'capture', request: capture } },
    { kind: 'done', requestId: request.requestId, conversationId: 'conversation-one' }];
  let received: ModelCaptureRequest | undefined, posted: unknown;
  const fetcher = (async (path, init) => {
    if (path === '/chat/browser-result') { posted = JSON.parse(String(init?.body)); return new Response(null, { status: 204 }); }
    assert.equal(path, '/chat/turn');
    return new Response(frames.map(frame => JSON.stringify(frame)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
  }) as typeof fetch;
  await streamModelTurn(request, new AbortController().signal, () => {}, fetcher, undefined, {
    async oncapture(value, isCurrent) { assert.equal(isCurrent(), true); received = value; throw new Error('Unsupported fixture viewer'); },
  });
  assert.deepEqual(received, capture);
  assert.deepEqual(posted, { requestId: request.requestId, toolCallId: 'capture-one', nonce: 'nonce-one', result: { status: 'unavailable' } });
});
