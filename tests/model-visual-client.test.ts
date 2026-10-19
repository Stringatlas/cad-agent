import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelChatController, streamModelTurn, validateModelEvent, type VisualModelAttachment } from '../apps/web/src/model-chat-client';
import { MODEL_CHAT_LIMITS, MODEL_VISUAL_LIMITS, type ModelChatEvent, type ModelTurnRequest, type ModelVisualObservation, type VisualObservation, type VisualPixelResolution } from '@spatial/contracts';

function observation(bytes = 1): VisualObservation {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return { schemaVersion: 1, observationId: 'observation-one', viewGeneration: 1,
    image: { mimeType: 'image/png', dataUrl: `data:image/png;base64,${Buffer.alloc(bytes).toString('base64')}`, sha256: 'a'.repeat(64), byteLength: bytes },
    viewport: { width: 8, height: 6, pixelRatio: 1, pixelOrigin: 'top-left' },
    camera: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], up: [0, 0, 1], near: .1, far: 100, fov: 50, aspect: 1, zoom: 1,
      matrixWorld: identity, matrixWorldInverse: identity, projectionMatrix: identity },
    binding: { sourceId: 'session-one', sourceRevision: 0, frameId: 'frame-one', units: 'm', origin: [0, 0, 0] },
    coverage: { kind: 'displayed-sample', complete: false, displayedPointCount: 4 } };
}
const scene = { mode: 'toronto', project: null, toronto: [] } as const;
function request(v?: ModelVisualObservation): ModelTurnRequest {
  return { requestId: 'request-one', conversationId: null, generation: 'account-one', model: 'fixture-vision-vNext', text: 'Inspect this scene', scene,
    ...(v ? { visualObservation: v } : {}) };
}
function adapter(v = observation()) {
  let current = true;
  const resolutions: unknown[] = [];
  const attachment: VisualModelAttachment = { observation: v, isCurrent: () => current,
    resolvePixel(id, x, y) { resolutions.push({ id, x, y }); return { status: 'resolved', observationId: id, x, y, provenance: { sourceRow: 42, position: [1, 2, 3] } }; } };
  return { attachment, resolutions, stale() { current = false; } };
}
const start = (r: ModelTurnRequest) => ({ kind: 'start', requestId: r.requestId, conversationId: 'conversation-one', model: r.model });
const done = (r: ModelTurnRequest) => ({ kind: 'done', requestId: r.requestId, conversationId: 'conversation-one' });
const tool = (r: ModelTurnRequest, extra: object = {}) => ({ kind: 'tool-request', requestId: r.requestId, toolCallId: 'call-one', nonce: 'nonce-one', observationId: r.visualObservation!.observationId, x: 2, y: 3, ...extra });
const lines = (events: unknown[]) => events.map(e => JSON.stringify(e) + '\n').join('');
const response = (events: unknown[]) => new Response(lines(events), { headers: { 'Content-Type': 'application/x-ndjson' } });
const signal = () => new AbortController().signal;
const delay = () => new Promise(resolve => setTimeout(resolve, 0));

test('pixel tool POST unblocks server-style stream, uses canonical identity and same secured fetcher; tool request is not published', async () => {
  const a = adapter(), r = request(a.attachment.observation), published: ModelChatEvent[] = [], calls: { path: string; init: RequestInit }[] = [];
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const fetcher: typeof fetch = async (path, init) => {
    calls.push({ path: String(path), init: init! });
    if (path === '/chat/turn') return new Response(new ReadableStream<Uint8Array>({ start(c) { stream = c; c.enqueue(new TextEncoder().encode(lines([start(r), tool(r)]))); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    assert.equal(path, '/chat/tool-result');
    assert.deepEqual(JSON.parse(init!.body as string), { requestId: r.requestId, toolCallId: 'call-one', nonce: 'nonce-one', observationId: 'observation-one',
      result: { status: 'resolved', observationId: 'observation-one', x: 2, y: 3, provenance: { sourceRow: 42, position: [1, 2, 3] } } });
    stream.enqueue(new TextEncoder().encode(lines([{ kind: 'tool', requestId: r.requestId, name: 'resolve_visual_pixel', context: { browserObserved: true, cadVerified: false } }, done(r)]))); stream.close();
    return new Response(null, { status: 204 });
  };
  const abort = signal();
  assert.equal(await streamModelTurn(r, abort, e => published.push(e), fetcher, a.attachment), 'conversation-one');
  assert.deepEqual(published.map(e => e.kind), ['start', 'tool', 'done']); assert.equal(a.resolutions.length, 1);
  assert.deepEqual(calls.map(c => c.path), ['/chat/turn', '/chat/tool-result']);
  for (const { init } of calls) { assert.equal(init.signal, abort); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); }
});

test('tool envelope identities, exact keys, integer coordinates and image bounds reject before resolution/POST', async () => {
  const a = adapter(), r = request(a.attachment.observation);
  for (const extra of [{ requestId: 'wrong' }, { observationId: 'wrong' }, { x: -1 }, { x: 8 }, { y: 6 }, { x: .5 }, { y: NaN }, { nonce: '' }, { toolCallId: 'bad call' }, { unknown: true }]) {
    let posts = 0;
    await assert.rejects(streamModelTurn(r, signal(), () => {}, async path => { if (path !== '/chat/turn') posts++; return response([start(r), tool(r, extra), done(r)]); }, a.attachment));
    assert.equal(posts, 0);
  }
  assert.equal(a.resolutions.length, 0);
  assert.throws(() => validateModelEvent(tool(r), request()));
  assert.throws(() => validateModelEvent({ kind: 'tool', requestId: r.requestId, name: 'resolve_visual_pixel', context: {} }, request()));
});

test('duplicate call IDs/nonces, bounded requests and terminal-late tool requests fail closed', async () => {
  for (const sequence of [
    [{}, { nonce: 'nonce-two' }], [{}, { toolCallId: 'call-two' }],
    Array.from({ length: MODEL_CHAT_LIMITS.toolCalls + 1 }, (_, i) => ({ toolCallId: `call-${i}`, nonce: `nonce-${i}` })),
  ]) {
    const a = adapter(), r = request(a.attachment.observation); let posts = 0;
    await assert.rejects(streamModelTurn(r, signal(), () => {}, async path => path === '/chat/turn' ? response([start(r), ...sequence.map(s => tool(r, s)), done(r)]) : (++posts, new Response(null, { status: 204 })), a.attachment));
    assert.equal(posts, sequence.length - 1);
  }
  const a = adapter(), r = request(a.attachment.observation);
  await assert.rejects(streamModelTurn(r, signal(), () => {}, async () => response([start(r), done(r), tool(r)]), a.attachment)); assert.equal(a.resolutions.length, 0);
});

test('two distinct tool requests are accepted; nonresolved bounded no-hit result is canonical', async () => {
  const a = adapter(), r = request(a.attachment.observation); let posts = 0;
  const attachment: VisualModelAttachment = { ...a.attachment, resolvePixel: (id, x, y) => ({ status: 'no-hit', observationId: id, x, y, reason: 'No displayed hit' }) };
  await streamModelTurn(r, signal(), () => {}, async (path, init) => {
    if (path === '/chat/turn') return response([start(r), tool(r), tool(r, { toolCallId: 'call-two', nonce: 'nonce-two' }), done(r)]);
    posts++; assert.equal(JSON.parse(init!.body as string).result.status, 'no-hit'); return new Response(null, { status: 204 });
  }, attachment); assert.equal(posts, 2);
});

test('invalid, mismatched and oversized pixel results never POST', async () => {
  const a = adapter(), r = request(a.attachment.observation);
  for (const result of [
    { status: 'resolved', observationId: 'wrong', x: 2, y: 3, provenance: {} },
    { status: 'resolved', observationId: 'observation-one', x: 1, y: 3, provenance: {} },
    { status: 'resolved', observationId: 'observation-one', x: 2, y: 3, provenance: { secret: 'x'.repeat(20000) } },
    ...['invalid', 'unknown'].map(status => ({ status, observationId: 'observation-one', x: 2, y: 3, reason: 'Not usable' })),
  ]) {
    let posts = 0;
    await assert.rejects(streamModelTurn(r, signal(), () => {}, async path => path === '/chat/turn' ? response([start(r), tool(r), done(r)]) : (++posts, new Response(null, { status: 204 })),
      { ...a.attachment, resolvePixel: () => result as VisualPixelResolution })); assert.equal(posts, 0);
  }
});

test('mismatched attachments reject without traffic; image continuation is supported', async () => {
  const a = adapter(), r = request(a.attachment.observation); let calls = 0;
  const f: typeof fetch = async () => { calls++; return response([]); };
  await assert.rejects(streamModelTurn(r, signal(), () => {}, f));
  await assert.rejects(streamModelTurn(request(), signal(), () => {}, f, a.attachment));
  const continued = { ...r, conversationId: 'conversation-one' };
  await streamModelTurn(continued, signal(), () => {}, async () => response([start(continued), done(continued)]), a.attachment);
  await assert.rejects(streamModelTurn(r, signal(), () => {}, f, { ...a.attachment, observation: { ...a.attachment.observation, viewGeneration: 2 } }));
  assert.equal(calls, 0);
  a.stale(); await streamModelTurn(r, signal(), () => {}, async () => response([start(r), done(r)]), a.attachment);
});

test('camera/view changes after headers, during publish/resolution/POST do not cancel historical-image answers', async () => {
  for (const when of ['headers', 'publish', 'resolution', 'post']) {
    const a = adapter(), r = request(a.attachment.observation), published: string[] = []; let posts = 0;
    const attachment = { ...a.attachment, resolvePixel(id: string, x: number, y: number) { const result = a.attachment.resolvePixel(id, x, y); if (when === 'resolution') a.stale(); return result; } };
    await streamModelTurn(r, signal(), e => { published.push(e.kind); if (when === 'publish') a.stale(); }, async path => {
      if (path === '/chat/turn') { if (when === 'headers') a.stale(); return response([start(r), tool(r), done(r)]); }
      posts++; if (when === 'post') a.stale(); return new Response(null, { status: 204 });
    }, attachment);
    assert.ok(published.includes('done')); assert.equal(posts, 1);
    if (when === 'headers' || when === 'publish') assert.equal(a.resolutions.length, 0);
  }
});

test('camera navigation during a pending body read preserves answer completion', async () => {
  const a = adapter(), r = request(a.attachment.observation), published: string[] = [];
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const pending = streamModelTurn(r, signal(), e => published.push(e.kind), async () => new Response(new ReadableStream<Uint8Array>({ start(c) { body = c; c.enqueue(new TextEncoder().encode(lines([start(r)]))); } }), { headers: { 'Content-Type': 'application/x-ndjson' } }), a.attachment);
  while (!published.length) await delay(); a.stale(); body.enqueue(new TextEncoder().encode(lines([done(r)])));
  body.close(); await pending; assert.deepEqual(published, ['start', 'done']);
});

test('abort from resolution is checked before result POST', async () => {
  const a = adapter(), r = request(a.attachment.observation), abort = new AbortController(); let posts = 0;
  await assert.rejects(streamModelTurn(r, abort.signal, () => {}, async path => path === '/chat/turn' ? response([start(r), tool(r), done(r)]) : (++posts, new Response(null, { status: 204 })),
    { ...a.attachment, resolvePixel(id, x, y) { abort.abort(); return a.attachment.resolvePixel(id, x, y); } })); assert.equal(posts, 0);
});

test('late abort of injected pending tool POST settles without accepting terminal or late response', async () => {
  const a = adapter(), r = request(a.attachment.observation), abort = new AbortController(), published: string[] = [];
  let finish!: (r: Response) => void, entered = false;
  const pending = streamModelTurn(r, abort.signal, e => published.push(e.kind), async path => {
    if (path === '/chat/turn') return response([start(r), tool(r), done(r)]);
    entered = true; return new Promise<Response>(resolve => { finish = resolve; });
  }, a.attachment);
  while (!entered) await delay(); abort.abort(); await assert.rejects(pending); finish(new Response(null, { status: 204 })); await delay();
  assert.deepEqual(published, ['start']);
});

test('non204, redirects/errors and rejected tool POST cannot accept completion', async () => {
  for (const status of [200, 302, 400, 403, 500]) {
    const a = adapter(), r = request(a.attachment.observation), published: string[] = [];
    await assert.rejects(streamModelTurn(r, signal(), e => published.push(e.kind), async path => path === '/chat/turn' ? response([start(r), tool(r), done(r)]) : new Response(null, { status }), a.attachment));
    assert.ok(!published.includes('done'));
  }
});

test('image-only request budget permits >64KiB and remains <=3MiB; text-only stays strict', async () => {
  const a = adapter(observation(100000)), r = request(a.attachment.observation); let calls = 0;
  await streamModelTurn(r, signal(), () => {}, async (_path, init) => { calls++; assert.ok(Buffer.byteLength(init!.body as string) > 65536); assert.ok(Buffer.byteLength(init!.body as string) <= MODEL_VISUAL_LIMITS.requestBytes); return response([start(r), done(r)]); }, a.attachment);
  assert.equal(calls, 1);
  const huge = adapter(observation(MODEL_VISUAL_LIMITS.pngBytes + 1));
  await assert.rejects(streamModelTurn(request(huge.attachment.observation), signal(), () => {}, async () => { calls++; return response([]); }, huge.attachment)); assert.equal(calls, 1);
  await assert.rejects(streamModelTurn({ ...request(), scene: { ...scene, toronto: Array(200).fill({}) } }, signal(), () => {}, async () => { calls++; return response([]); })); assert.equal(calls, 1);
});

test('image-bytes omission and metadata-only image projection survive event validation', () => {
  const a = adapter(), r = request(a.attachment.observation);
  const event = { kind: 'request-inspection', requestId: r.requestId, inspection: { round: 1, mode: 'api-key', continuation: false,
    bodyJson: JSON.stringify({ model: r.model, input: [{ type: 'input_image', detail: 'high', image: { mimeType: 'image/png', omitted: 'image-bytes', width: 8, height: 6, byteLength: 1, sha256: 'a'.repeat(64) } }] }), omissions: ['credentials-and-headers', 'image-bytes'] } };
  assert.deepEqual(validateModelEvent(event, r), event);
});

test('historical image stays usable after a real scene rebind; request tools use current scene, not capture binding', async () => {
  const a = adapter(), turns: ModelTurnRequest[] = [];
  const client = new ModelChatController(() => {}, async (path, init) => {
    if (path === '/chat/models') return Response.json({ mode: 'api-key', ready: true, generation: 'account-one', code: 'ready', models: [{ id: 'fixture-vision-vNext', label: 'Fixture' }] });
    const r = JSON.parse(init!.body as string) as ModelTurnRequest; turns.push(r); return response([start(r), done(r)]);
  });
  const currentScene = { mode: 'demo' as const, project: { sessionId: 'current-session', projectRevision: 8, frameId: 'demo-local-v1' as const, units: 'm' as const, entityIds: [], points: [] }, toronto: [] };
  try {
    client.bind(scene); await client.refreshModels();
    client.bind(currentScene); a.stale();
    assert.equal(await client.send('Discuss the old image', a.attachment), true);
    assert.equal(client.view.phase, 'completed');
    assert.deepEqual(turns[0].scene, currentScene);
    assert.equal(turns[0].visualObservation!.binding.sourceRevision, 0);
    assert.equal(turns[0].visualObservation!.binding.sourceId, 'session-one');
  } finally { client.dispose(); }
});

test('historical pixel tool reports unavailable without resolving against changed geometry', async () => {
  const a = adapter(); a.stale(); const r = request(a.attachment.observation); let result: unknown;
  await streamModelTurn(r, signal(), () => {}, async (path, init) => {
    if (path === '/chat/turn') return response([start(r), tool(r), done(r)]);
    result = JSON.parse(init!.body as string).result; return new Response(null, { status: 204 });
  }, a.attachment);
  assert.equal(a.resolutions.length, 0);
  assert.deepEqual(result, { status: 'unavailable', observationId: 'observation-one', x: 2, y: 3, reason: 'Capture-time pixel grounding is no longer available' });
});

// Model Svelte's deep state proxy restriction without weakening protocol freezing.
function reactiveObservation(value = observation()): VisualObservation {
  const proxies = new WeakMap<object, object>();
  const wrap = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    let proxy = proxies.get(value);
    if (!proxy) {
      proxy = new Proxy(value, {
        get: (target, key) => wrap(Reflect.get(target, key)),
        defineProperty() { throw new Error('state_descriptors_fixed'); },
      });
      proxies.set(value, proxy);
    }
    return proxy;
  };
  return wrap(value) as VisualObservation;
}

test('controller detaches reactive agent captures before freezing message history', async () => {
  const image = reactiveObservation(), a = adapter(image);
  const client = new ModelChatController(() => {}, async (path, init) => {
    if (path === '/chat/models') return Response.json({ mode: 'api-key', ready: true, generation: 'account-one', code: 'ready', models: [{ id: 'fixture-vision-vNext', label: 'Fixture' }] });
    if (path === '/chat/browser-result') return new Response(null, { status: 204 });
    const r = JSON.parse(init!.body as string) as ModelTurnRequest;
    return response([start(r), { kind: 'browser-request', requestId: r.requestId, toolCallId: 'capture-one', nonce: 'nonce-one', action: { kind: 'capture', request: { kind: 'current' } } }, done(r)]);
  }, undefined, undefined, { oncapture: async () => a.attachment });
  try {
    client.bind(scene); await client.refreshModels(); await client.send('Capture the scene');
    assert.equal(client.view.phase, 'completed');
    const retained = client.view.messages[1]!.attachments![0]!;
    assert.deepEqual(retained, image); assert.notEqual(retained, image);
    assert.ok(Object.isFrozen(retained.image)); assert.ok(!Object.isFrozen(image.image));
  } finally { client.dispose(); }
});

test('controller deduplicates exact images across successful continuation but retains changed images and original thumbnails', async () => {
  const turns: ModelTurnRequest[] = [], a = adapter(reactiveObservation());
  const client = new ModelChatController(() => {}, async (path, init) => {
    if (path === '/chat/models') return Response.json({ mode: 'api-key', ready: true, generation: 'account-one', code: 'ready', models: [{ id: 'fixture-vision-vNext', label: 'Fixture' }] });
    const r = JSON.parse(init!.body as string) as ModelTurnRequest; turns.push(r); return response([start(r), done(r)]);
  });
  try {
    client.bind(scene); await client.refreshModels();
    await client.send('AOI', a.attachment);
    const first = client.view.messages[0]!.attachments![0]!;
    // Equal but separately allocated/reactive input must also deduplicate.
    await client.send('Follow up', adapter(reactiveObservation()).attachment);
    assert.equal(turns[1]!.conversationId, 'conversation-one'); assert.equal(turns[1]!.visualObservation, undefined);
    assert.equal(client.view.messages[2]!.attachments, undefined);
    assert.equal(client.view.messages[0]!.attachments![0], first);
    const changed = adapter({ ...observation(), viewGeneration: 2 });
    await client.send('Changed capture metadata', changed.attachment);
    assert.deepEqual(turns[2]!.visualObservation, changed.attachment.observation);
    const pixels = adapter(observation(2));
    await client.send('Changed image bytes', pixels.attachment);
    assert.deepEqual(turns[3]!.visualObservation, pixels.attachment.observation);
    await client.send('Original AOI again', a.attachment);
    assert.equal(turns[4]!.visualObservation, undefined);
    assert.equal(turns[4]!.conversationId, 'conversation-one');
    assert.equal(client.view.messages.filter(message => message.attachments?.length).length, 3);
  } finally { client.dispose(); }
});

test('controller resends the same image after reset, failure, or cancellation, never relying on display-only history', async () => {
  for (const reset of ['new-chat', 'account', 'scene', 'failure', 'cancel'] as const) {
    const turns: ModelTurnRequest[] = [], a = adapter(); let fail = false, hold = false;
    const client = new ModelChatController(() => {}, async (path, init) => {
      if (path === '/chat/models') return Response.json({ mode: 'api-key', ready: true, generation: 'account-one', code: 'ready', models: [{ id: 'fixture-vision-vNext', label: 'Fixture' }] });
      const r = JSON.parse(init!.body as string) as ModelTurnRequest; turns.push(r);
      if (hold) return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines([start(r)]))); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
      return response(fail ? [start(r), { kind: 'error', requestId: r.requestId, code: 'provider-unavailable' }] : [start(r), done(r)]);
    });
    try {
      client.bind(scene); await client.refreshModels(); await client.send('First image', a.attachment);
      if (reset === 'new-chat') client.newChat();
      if (reset === 'account') { client.accountChanged(); await client.refreshModels(); }
      if (reset === 'scene') client.bind({ mode: 'pole', project: null, toronto: [] });
      if (reset === 'failure') { fail = true; await client.send('Failed followup', a.attachment); fail = false; }
      if (reset === 'cancel') {
        hold = true; const pending = client.send('Interrupted followup', a.attachment);
        while (turns.length < 2) await delay(); client.cancel(); await pending; hold = false;
      }
      await client.send('Fresh history needs image', a.attachment);
      // A confirmed failed followup preserves the completed image on the server.
      // Actual reset/cancellation cannot rely on that checkpoint.
      assert.equal(turns.at(-1)!.conversationId, reset === 'failure' ? 'conversation-one' : null, reset);
      assert.deepEqual(turns.at(-1)!.visualObservation, reset === 'failure' ? undefined : a.attachment.observation, reset);
      await client.send('Successful continuation', a.attachment);
      assert.equal(turns.at(-1)!.conversationId, 'conversation-one', reset);
      assert.equal(turns.at(-1)!.visualObservation, undefined, reset);
    } finally { client.dispose(); }
  }
});

test('controller keeps history through reactive screenshots and scene selection updates, retaining inline attachments', async () => {
  const turns: ModelTurnRequest[] = [], a = adapter(reactiveObservation());
  const client = new ModelChatController(() => {}, async (path, init) => {
    if (path === '/chat/models') return Response.json({ mode: 'api-key', ready: true, generation: 'account-one', code: 'ready', models: [{ id: 'fixture-vision-vNext', label: 'Unfamiliar catalog model' }] });
    const r = JSON.parse(init!.body as string) as ModelTurnRequest; turns.push(r); return response([start(r), done(r)]);
  });
  try {
    client.bind(scene); await client.refreshModels();
    assert.equal(await client.send('Text first'), true); assert.equal(client.view.continuationActive, true);
    assert.equal(await client.send('Image next', a.attachment), true); assert.equal(turns[1]!.conversationId, 'conversation-one'); assert.equal(turns[1]!.model, 'fixture-vision-vNext'); assert.deepEqual(turns[1]!.visualObservation, a.attachment.observation);
    assert.equal(client.view.phase, 'completed'); assert.equal(client.view.continuationActive, true);
    assert.deepEqual(client.view.messages[2]!.attachments, [a.attachment.observation]);
    assert.notEqual(client.view.messages[2]!.attachments![0], a.attachment.observation);
    assert.ok(Object.isFrozen(client.view.messages[2]!.attachments![0]!.image));
    assert.ok(!Object.isFrozen(a.attachment.observation.image));
    client.bind({ ...scene, areaOfInterest: { datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285, 4841948, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] } });
    await client.send('Refer to the previous screenshot'); assert.equal(turns[2]!.conversationId, 'conversation-one'); assert.ok(!Object.hasOwn(turns[2]!, 'visualObservation'));
    a.stale(); assert.equal(await client.send('Historical image', a.attachment), true); assert.equal(turns.length, 4);
    assert.equal(turns[3]!.conversationId, 'conversation-one'); assert.ok(!Object.hasOwn(turns[3]!, 'visualObservation'));
    assert.equal(client.view.messages.filter(message => message.attachments?.length).length, 1);
  } finally { client.dispose(); }
});
