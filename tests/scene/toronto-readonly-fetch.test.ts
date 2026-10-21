import test from 'node:test';
import assert from 'node:assert/strict';
import { torontoReadonlyFetch } from '../../apps/web/src/scenes/toronto/toronto-readonly-fetch';
import { torontoCadTransport, TorontoCadController, type TorontoCadView } from '../../apps/web/src/scenes/toronto/cad/toronto-cad-client';
import { overrideTransport, PointOverrideController, type PointEditView } from '../../apps/web/src/scenes/toronto/points/point-override-client';
const busy = () => Response.json({ ok: false, error: { code: 'busy' } }, { status: 429 });

test('actual CAD/override snapshot transports retry busy reads with the same signal and URL', async () => {
  const original = globalThis.fetch;
  try {
    for (const read of [() => torontoCadTransport('refresh', undefined, new AbortController().signal), () => overrideTransport('refresh'), () => overrideTransport('pending')]) {
      const calls: { url: string; signal: AbortSignal | null | undefined }[] = [];
      globalThis.fetch = async (url, init) => { calls.push({ url: String(url), signal: init?.signal }); return calls.length < 3 ? busy() : Response.json({ ok: true, result: 'snapshot' }); };
      assert.equal(await read(), 'snapshot'); assert.equal(calls.length, 3);
      assert.ok(calls.every(c => c.url === calls[0].url && c.signal === calls[0].signal));
    }
  } finally { globalThis.fetch = original; }
});
test('all mutation actions are single-shot even for known busy', async () => {
  const original = globalThis.fetch;
  try {
    for (const action of ['propose', 'approve', 'decline', 'undo'] as const) {
      let calls = 0; globalThis.fetch = async () => { calls++; return busy(); };
      await assert.rejects(torontoCadTransport(action, { exact: 'body' }, new AbortController().signal), /CAD busy/); assert.equal(calls, 1);
      calls = 0; await assert.rejects(overrideTransport(action, { exact: 'body' }), /Override busy/); assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = original; }
});
test('unknown/malformed/nonbusy responses and network failures are never retried', async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [Response.json({ ok: false, error: { code: 'other' } }, { status: 429 }), Response.json({ ok: false, error: { code: 'busy' } }, { status: 503 }), new Response('broken', { status: 429, headers: { 'content-type': 'application/json' } }), new Response('busy', { status: 429 })]) {
      let calls = 0; globalThis.fetch = async () => { calls++; return response; };
      assert.equal(await torontoReadonlyFetch('/datasets/toronto3d/cad', { method: 'GET' }), response); assert.equal(calls, 1);
    }
    let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('network failure'); };
    await assert.rejects(overrideTransport('refresh'), /network failure/); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
test('persistent busy is bounded and preserves existing transport error', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return busy(); };
  try { await assert.rejects(torontoCadTransport('refresh', undefined, new AbortController().signal), /CAD busy/); assert.equal(calls, 9); }
  finally { globalThis.fetch = original; }
});
test('abort during wait and pre-abort stop reads without another fetch', async () => {
  const original = globalThis.fetch;
  try {
    for (const preabort of [false, true]) {
      const controller = new AbortController(); let calls = 0;
      globalThis.fetch = async () => { calls++; setTimeout(() => controller.abort(), 10); return busy(); };
      if (preabort) controller.abort();
      await assert.rejects(overrideTransport('refresh', undefined, controller.signal), { name: 'AbortError' });
      assert.equal(calls, preabort ? 0 : 1);
    }
  } finally { globalThis.fetch = original; }
});
test('generation changes/disposal abort real retry waits and suppress late state', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return busy(); };
  try {
    const cadStates: TorontoCadView[] = [], cad = new TorontoCadController(v => cadStates.push(v)); cad.bind('a'.repeat(64));
    const pending = cad.refresh(); await new Promise(r => setTimeout(r, 10)); cad.bind('b'.repeat(64)); const n = cadStates.length;
    await pending; assert.equal(cadStates.length, n); assert.equal(calls, 1); cad.dispose();
    calls = 0; const states: PointEditView[] = [], points = new PointOverrideController(v => states.push(v));
    const refreshing = points.refresh(); await new Promise(r => setTimeout(r, 10)); points.dispose(); const m = states.length;
    await refreshing; assert.equal(states.length, m); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
