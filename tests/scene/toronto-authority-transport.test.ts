import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneObjectTransport } from '../../apps/web/src/scenes/toronto/objects/scene-object-client';
import { torontoCadTransport } from '../../apps/web/src/scenes/toronto/cad/toronto-cad-client';

const clients = [
  { name: 'objects', transport: sceneObjectTransport, limit: 1_000_000, invalid: 'Invalid object authority response', oversized: 'Oversized object authority response', error: 'Object authority: ' },
  { name: 'cad', transport: torontoCadTransport, limit: 16_000_000, invalid: 'Invalid CAD response', oversized: 'Oversized CAD response', error: 'CAD ' },
] as const;
const actions = ['refresh', 'propose', 'approve', 'decline', 'undo'] as const;

for (const client of clients) {
  test(`${client.name}: exact action routing, body encoding and signal forwarding`, async () => {
    const original = globalThis.fetch;
    try {
      for (const action of actions) {
        for (const body of [undefined, null, false, { sessionId: 's', revision: 2, proposalId: 'p' }]) {
          const signal = new AbortController().signal;
          let calls = 0;
          globalThis.fetch = async (url, init) => {
            calls++;
            assert.equal(url, `/datasets/toronto3d/${client.name}${action === 'refresh' ? '' : `/${action}`}`);
            assert.deepEqual(init, { method: action === 'refresh' ? 'GET' : 'POST', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}), signal });
            return Response.json({ ok: true, result: { retained: 'unvalidated domain result' } });
          };
          assert.deepEqual(await client.transport(action, body, signal), { retained: 'unvalidated domain result' });
          assert.equal(calls, 1);
        }
      }
    } finally { globalThis.fetch = original; }
  });

  test(`${client.name}: preserves response validation and error wording`, async () => {
    const original = globalThis.fetch;
    try {
      const cases: { response: () => Response; expected: string | typeof SyntaxError | typeof TypeError }[] = [
        { response: () => new Response('{}'), expected: client.invalid },
        { response: () => new Response(' '.repeat(client.limit + 1), { headers: { 'content-type': 'application/json' } }), expected: client.oversized },
        { response: () => new Response('{broken', { headers: { 'content-type': 'application/json' } }), expected: SyntaxError },
        { response: () => Response.json(null), expected: TypeError },
        { response: () => Response.json({ ok: false, error: { code: 'stale' } }, { status: 409 }), expected: `${client.error}stale` },
        { response: () => Response.json({ ok: true, result: 'not successful' }, { status: 503 }), expected: `${client.error}503` },
        { response: () => Response.json({ ok: 'true' }), expected: `${client.error}200` },
      ];
      for (const { response, expected } of cases) {
        let calls = 0;
        globalThis.fetch = async () => { calls++; return response(); };
        await assert.rejects(client.transport('propose', {}, new AbortController().signal), error => typeof expected === 'string' ? error instanceof Error && error.message === expected : error instanceof expected);
        assert.equal(calls, 1);
      }
      // Preserve the inclusive character limit and existing non-strict envelope handling.
      globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: 7, extra: true }).padEnd(client.limit, ' '), { headers: { 'content-type': 'application/json; charset=utf-8' } });
      assert.equal(await client.transport('refresh', undefined, new AbortController().signal), 7);
    } finally { globalThis.fetch = original; }
  });

  test(`${client.name}: never retries mutation failures and propagates cancellation unchanged`, async () => {
    const original = globalThis.fetch;
    try {
      for (const action of actions.filter(action => action !== 'refresh')) {
        let calls = 0;
        globalThis.fetch = async () => { calls++; return Response.json({ ok: false, error: { code: 'busy' } }, { status: 429 }); };
        await assert.rejects(client.transport(action, {}, new AbortController().signal), { message: `${client.error}busy` });
        assert.equal(calls, 1);
      }
      const controller = new AbortController(), reason = new Error('cancelled by caller');
      globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
        assert.equal(init?.signal, controller.signal);
        init.signal.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      });
      const pending = client.transport('propose', {}, controller.signal);
      controller.abort(reason);
      await assert.rejects(pending, error => error === reason);
      let calls = 0;
      globalThis.fetch = async () => { calls++; throw new Error('unexpected fetch'); };
      await assert.rejects(client.transport('refresh', undefined, controller.signal), error => error === reason);
      assert.equal(calls, 0);
    } finally { globalThis.fetch = original; }
  });
}

test('refresh retry policy stays endpoint-specific: CAD retries known busy, objects do not', async () => {
  const original = globalThis.fetch;
  try {
    for (const client of clients) {
      let calls = 0;
      globalThis.fetch = async () => ++calls === 1 ? Response.json({ ok: false, error: { code: 'busy' } }, { status: 429 }) : Response.json({ ok: true, result: 'snapshot' });
      const pending = client.transport('refresh', undefined, new AbortController().signal);
      if (client.name === 'cad') { assert.equal(await pending, 'snapshot'); assert.equal(calls, 2); }
      else { await assert.rejects(pending, { message: 'Object authority: busy' }); assert.equal(calls, 1); }
    }
  } finally { globalThis.fetch = original; }
});
