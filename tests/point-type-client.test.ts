import assert from 'node:assert/strict';
import test from 'node:test';
import { createPointTypeChannel, fetchPointType, pointTypeKey, type PointTypeState } from '../apps/web/src/point-type-client';
import type { TorontoDraftPoint } from '../apps/web/src/draft-context';
const point: TorontoDraftPoint = { name: 'Point 1', datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), frameId: 'toronto3d-local-v1', key: { sourceFileId: 1, sourceRow: 10 }, position: [1.234, 0, 120.137], units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285,4841948,0] };
const record = (reference = point) => ({ datasetId: reference.datasetId, artifactRevision: reference.artifactRevision, frameId: reference.frameId, key: reference.key, position: reference.position, units: reference.units, handedness: reference.handedness, upAxis: reference.upAxis, localOrigin: reference.localOrigin, semanticLabel: 7 });
const reply = (body: unknown) => new Response(JSON.stringify(body));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('source label client requires exact original key, binary64 position, revision and coordinate metadata; rejects spoofed labels', async () => {
  const controller = new AbortController();
  assert.equal(await fetchPointType(point, controller.signal, async url => { assert.match(String(url), /sourceRow=10/); return reply(record()); }), 7);
  for (const patch of [{ datasetId: 'demo' }, { artifactRevision: 'b'.repeat(64) }, { frameId: 'other' }, { units: 'ft' }, { handedness: 'left' }, { upAxis: 'Y' }, { localOrigin: [0,0,0] }, { key: { sourceFileId: 1, sourceRow: 11 } }, { position: [Math.fround(1.234),0,120.137] }, { semanticLabel: 9 }, { semanticLabel: '7' }, { semanticLabel: 7.5 }]) {
    await assert.rejects(fetchPointType(point, controller.signal, async () => reply({ ...record(), ...patch })), /mismatch/);
  }
  controller.abort(); await assert.rejects(fetchPointType(point, controller.signal, async () => reply(record())), { name: 'AbortError' });
});

test('UI-only labels publish without mutating references; removed/revision-changed late responses cannot repopulate pins', async () => {
  const states: PointTypeState[] = [], pending: ((response: Response) => void)[] = [];
  const transport: typeof fetch = async () => new Promise<Response>(resolve => pending.push(resolve));
  const channel = createPointTypeChannel(state => states.push(state), transport);
  const original = JSON.stringify(point);
  channel.bind([point]); assert.equal(states.at(-1)?.get(pointTypeKey(point)), 'loading');
  const next = { ...point, name: 'Point 2' as const, artifactRevision: 'b'.repeat(64) };
  channel.bind([next]); pending[0](reply(record())); await tick();
  assert.equal(states.at(-1)?.has(pointTypeKey(point)), false); assert.equal(states.at(-1)?.get(pointTypeKey(next)), 'loading');
  pending[1](reply(record(next))); await tick(); assert.equal(states.at(-1)?.get(pointTypeKey(next)), 7);
  channel.bind([]); assert.equal(states.at(-1)?.size, 0); assert.equal(JSON.stringify(point), original);
  channel.bind([point]); const count = states.length; channel.dispose(); pending[2](reply(record())); await tick(); assert.equal(states.length, count);
});

test('type channel serializes reads, preserves resolved UI metadata on additions, and fails quietly to Unknown', async () => {
  let calls = 0, inflight = 0, maximum = 0; const states: PointTypeState[] = [];
  const other = { ...point, name: 'Point 2' as const, key: { sourceFileId: 1, sourceRow: 11 } };
  const channel = createPointTypeChannel(state => states.push(state), async url => { calls++; inflight++; maximum = Math.max(maximum, inflight); await tick(); inflight--; return String(url).includes('sourceRow=10') ? reply(record()) : new Response('', { status: 503 }); });
  channel.bind([point]); await tick(); await tick();
  assert.equal(states.at(-1)?.get(pointTypeKey(point)), 7);
  channel.bind([point, other]); await tick(); await tick();
  assert.equal(calls, 2); assert.equal(maximum, 1); assert.equal(states.at(-1)?.get(pointTypeKey(point)), 7); assert.equal(states.at(-1)?.get(pointTypeKey(other)), undefined);
  channel.dispose();
});
