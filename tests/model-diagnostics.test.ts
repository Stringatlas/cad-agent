import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { createRejectedResponseRecorder, inspectRejectedBody, recordRejectedResponse, type BodyShape } from '../apps/server/src/model-diagnostics';

const freshSignal = () => new AbortController().signal;
const bytes = (text: string) => new TextEncoder().encode(text);
function fragmented(text: string, size: number) {
  const value = bytes(text); let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === value.length) { controller.close(); return; }
      controller.enqueue(value.subarray(offset, offset + size)); offset = Math.min(value.length, offset + size);
    },
  }, { highWaterMark: 0 }));
}
function readerFixture(read: () => Promise<ReadableStreamReadResult<Uint8Array>>, cancel: () => Promise<void> = async () => {}) {
  let reads = 0; let cancels = 0; let releases = 0;
  const response = new Response();
  Object.defineProperty(response, 'body', { value: { getReader: () => ({
    read: () => { reads++; return read(); },
    cancel: () => { cancels++; return cancel(); },
    releaseLock: () => { releases++; },
  }) } });
  return { response, counts: () => ({ reads, cancels, releases }) };
}
function privateRoot(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'spatial-diagnostic-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function records(root: string) {
  const directories = readdirSync(root);
  assert.equal(directories.length, 1);
  assert.match(directories[0]!, /^spatial-model-diagnostics-/);
  const directory = join(root, directories[0]!);
  return { directory, files: readdirSync(directory).map(file => join(directory, file)) };
}

for (const [text, expected] of [
  ['', 'empty'], [' \n\t\uFEFF', 'empty'], ['data: secret', 'sse-like'], [': ping', 'sse-like'],
  ['event: message', 'sse-like'], ['id: secret', 'sse-like'], ['retry: 1000', 'sse-like'],
  [' {"secret":"not retained"}', 'json-like'], ['\n[1,2]', 'json-like'],
  ['<!DOCTYPE html><title>secret</title>', 'html-like'], ['<HTML lang="en">', 'html-like'],
  ['<body>secret</body>', 'html-like'], ['<!-- secret -->', 'html-like'], ['not a protocol', 'other'],
] as const) test(`body appearance: ${JSON.stringify(text.slice(0, 24))} => ${expected}`, async () => {
  const response = new Response(text);
  assert.equal(await inspectRejectedBody(response, freshSignal()), expected);
  assert.equal(response.body!.locked, false);
});

test('null and binary bodies have closed classifications', async () => {
  assert.equal(await inspectRejectedBody(new Response(null), freshSignal()), 'empty');
  assert.equal(await inspectRejectedBody(new Response(new Uint8Array([0xff, 0, 0xfe])), freshSignal()), 'other');
});

test('fragmented BOM, whitespace, and protocol prefixes are counted and recognized', async () => {
  for (const [text, size, shape] of [
    ['\uFEFF \ndata: secret', 1, 'sse-like'],
    ['\uFEFF \n {"secret":true}', 1, 'json-like'],
    ['\uFEFF \n<!DOCTYPE html>secret', 2, 'html-like'],
  ] as const) {
    const response = fragmented(text, size);
    assert.equal(await inspectRejectedBody(response, freshSignal()), shape);
    assert.equal(response.body!.locked, false);
  }
});

test('only 1 KiB is retained, including BOM and whitespace, even for an oversized chunk', async () => {
  for (const prefix of [' '.repeat(1_024), '\uFEFF' + ' '.repeat(1_021)]) {
    const fixture = readerFixture(async () => ({ done: false, value: bytes(prefix + 'data: private-' + 'x'.repeat(100_000)) }));
    assert.equal(await inspectRejectedBody(fixture.response, freshSignal()), 'other');
    assert.deepEqual(fixture.counts(), { reads: 1, cancels: 1, releases: 1 });
  }
  const response = new Response(' '.repeat(1_023) + '{' + 'x'.repeat(100_000));
  assert.equal(await inspectRejectedBody(response, freshSignal()), 'json-like');
});

test('16-read cap includes empty chunks and never claims empty without EOF', async () => {
  for (const value of [new Uint8Array(), bytes(' '), bytes('d')]) {
    const fixture = readerFixture(async () => ({ done: false, value }));
    assert.equal(await inspectRejectedBody(fixture.response, freshSignal()), 'other');
    assert.deepEqual(fixture.counts(), { reads: 16, cancels: 1, releases: 1 });
  }
});

test('byte cap also applies across reads rather than only to individual chunks', async () => {
  const fixture = readerFixture(async () => ({ done: false, value: bytes(' '.repeat(100)) }));
  assert.equal(await inspectRejectedBody(fixture.response, freshSignal()), 'other');
  assert.deepEqual(fixture.counts(), { reads: 11, cancels: 1, releases: 1 });
});

test('250ms deadline returns despite hostile read/cancel, then handles late rejection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let rejectRead!: (reason: unknown) => void;
  const fixture = readerFixture(() => new Promise((_resolve, reject) => { rejectRead = reject; }), () => new Promise(() => {}));
  let settled = false;
  const pending = inspectRejectedBody(fixture.response, freshSignal()).then(shape => { settled = true; return shape; });
  await tick(); t.mock.timers.tick(249); await tick(); assert.equal(settled, false);
  t.mock.timers.tick(1); assert.equal(await pending, 'timeout');
  assert.deepEqual(fixture.counts(), { reads: 1, cancels: 1, releases: 1 });
  rejectRead(new Error('secret-late-rejection')); await tick();
});

test('abort before inspection does no reads but cancels and releases', async () => {
  const controller = new AbortController(); controller.abort(new Error('secret-abort'));
  const fixture = readerFixture(async () => { throw new Error('must not read'); });
  assert.equal(await inspectRejectedBody(fixture.response, controller.signal), 'cancelled');
  assert.deepEqual(fixture.counts(), { reads: 0, cancels: 1, releases: 1 });
  assert.equal(await inspectRejectedBody(new Response(null), controller.signal), 'cancelled');
});

test('abort during a stalled read does not await cancellation or surface abort reasons', async () => {
  const controller = new AbortController();
  const fixture = readerFixture(() => new Promise(() => {}), () => Promise.reject(new Error('secret-cancel')));
  const pending = inspectRejectedBody(fixture.response, controller.signal);
  controller.abort(new Error('secret-abort'));
  assert.equal(await pending, 'cancelled');
  assert.deepEqual(fixture.counts(), { reads: 1, cancels: 1, releases: 1 });
  await tick();
});

test('real stalled streams are cancelled and unlocked even when cancel never settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }));
  const pending = inspectRejectedBody(response, freshSignal());
  t.mock.timers.tick(250);
  assert.equal(await pending, 'timeout');
  assert.equal(cancelled, true); assert.equal(response.body!.locked, false);
});

test('read failures and throwing readers remain diagnostic tags and do not leak errors', async () => {
  for (const read of [
    () => Promise.reject(new Error('secret-read')),
    () => { throw new Error('secret-sync-read'); },
  ]) {
    const fixture = readerFixture(read, () => { throw new Error('secret-sync-cancel'); });
    assert.equal(await inspectRejectedBody(fixture.response, freshSignal()), 'read-error');
    assert.deepEqual(fixture.counts(), { reads: 1, cancels: 1, releases: 1 });
  }
  const response = new Response('locked'); const reader = response.body!.getReader();
  assert.equal(await inspectRejectedBody(response, freshSignal()), 'read-error');
  reader.releaseLock();
});

test('inspection never clones, tees, parses, or returns private body/header/URL strings', async () => {
  const response = new Response('data: secret-body-sentinel', { headers: { 'x-secret': 'secret-header-sentinel' } });
  for (const method of ['clone', 'text', 'json', 'arrayBuffer', 'blob'] as const) {
    Object.defineProperty(response, method, { value: () => { assert.fail(`forbidden ${method}`); } });
  }
  Object.defineProperty(response.body, 'tee', { value: () => { assert.fail('forbidden tee'); } });
  Object.defineProperty(response, 'url', { value: 'https://secret-url-sentinel.invalid/?token=private' });
  assert.equal(await inspectRejectedBody(response, freshSignal()), 'sse-like');
});

test('records are a closed, redacted, attributed schema in private exclusive files', t => {
  const root = privateRoot(t); const record = createRejectedResponseRecorder(root);
  const response = new Response('secret-body-sentinel', { status: 200, headers: { 'content-type': 'text/html;secret-mime', authorization: 'secret-header-sentinel' } });
  Object.defineProperties(response, {
    url: { value: 'https://secret-url-sentinel.invalid/?token=secret-query' },
    type: { value: 'secret-type-sentinel' }, redirected: { value: true },
  });
  record(response, 'secret-format-sentinel' as 'other', 'secret-shape-sentinel' as BodyShape);
  const { directory, files } = records(root); assert.equal(files.length, 1);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(files[0]!).mode & 0o777, 0o600);
  const text = readFileSync(files[0]!, 'utf8'); assert.doesNotMatch(text, /secret|token|authorization|invalid/);
  const data = JSON.parse(text);
  assert.deepEqual(Object.keys(data).sort(), ['schemaVersion', 'pid', 'recordedAt', 'sequence', 'httpStatus', 'operation', 'check', 'responseUrl', 'responseType', 'responseFormat', 'redirected', 'bodyPresent', 'bodyShape'].sort());
  assert.deepEqual(data, {
    schemaVersion: 1, pid: process.pid, recordedAt: data.recordedAt, sequence: 1, httpStatus: 200,
    operation: 'responses.create', check: 'response-content-type', responseUrl: 'other', responseType: 'other',
    responseFormat: 'other', redirected: true, bodyPresent: true, bodyShape: 'other',
  });
  assert.equal(new Date(data.recordedAt).toISOString(), data.recordedAt);
  assert.equal(response.bodyUsed, false, 'recording must not consume or alter the response');
});

test('only exact fixed expected URL is labeled expected; absent stays distinct', t => {
  const root = privateRoot(t); const record = createRejectedResponseRecorder(root);
  for (const [url, type, body, status] of [
    ['https://api.openai.com/v1/responses', 'basic', null, 200],
    ['', 'default', null, 201],
    ['https://api.openai.com/v1/responses?secret', 'cors', 'body', 500],
    ['https://api.openai.com/v1/responses/', 'opaque', null, 200],
  ] as const) {
    const response = new Response(body, { status }); Object.defineProperties(response, { url: { value: url }, type: { value: type } });
    record(response, 'html', 'html-like');
  }
  const data = records(root).files.map(file => JSON.parse(readFileSync(file, 'utf8'))).sort((a, b) => a.sequence - b.sequence);
  assert.deepEqual(data.map(d => d.responseUrl), ['expected', 'absent', 'other', 'other']);
  assert.deepEqual(data.map(d => d.bodyPresent), [false, false, true, false]);
  assert.deepEqual(data.map(d => d.responseType), ['basic', 'default', 'cors', 'opaque']);
  assert.deepEqual(data.map(d => d.httpStatus), [200, 201, 500, 200]);
});

test('rotation retains only the latest eight records with monotonically increasing sequence', t => {
  const root = privateRoot(t); const record = createRejectedResponseRecorder(root);
  for (let i = 0; i < 100; i++) {
    record(new Response(null), 'missing', 'empty');
    assert.ok(records(root).files.length <= 8);
  }
  const data = records(root).files.map(file => JSON.parse(readFileSync(file, 'utf8')));
  assert.equal(data.length, 8);
  assert.deepEqual(data.map(d => d.sequence).sort((a, b) => a - b), [93, 94, 95, 96, 97, 98, 99, 100]);
});

test('filesystem and hostile response failures do not throw, enqueue work, or leak data', t => {
  const root = privateRoot(t); const notDirectory = join(root, 'file'); writeFileSync(notDirectory, 'occupied');
  const broken = createRejectedResponseRecorder(notDirectory);
  for (let i = 0; i < 100; i++) assert.doesNotThrow(() => broken(new Response(null), 'html', 'timeout'));
  assert.deepEqual(readdirSync(root), ['file']);
  const hostile = new Response(); Object.defineProperty(hostile, 'url', { get() { throw new Error('secret-getter-sentinel'); } });
  const guarded = createRejectedResponseRecorder(root);
  assert.doesNotThrow(() => guarded(hostile, 'other', 'read-error'));
  assert.deepEqual(readdirSync(root), ['file']);
});

test('exclusive creation never overwrites a preexisting diagnostic path', t => {
  const root = privateRoot(t); const record = createRejectedResponseRecorder(root);
  record(new Response(null), 'missing', 'empty');
  const { directory } = records(root); const occupied = join(directory, `diagnostic-${process.pid}-2.json`);
  writeFileSync(occupied, 'existing-private-record', { mode: 0o600 });
  assert.doesNotThrow(() => record(new Response(null), 'html', 'other'));
  assert.equal(readFileSync(occupied, 'utf8'), 'existing-private-record');
  assert.doesNotThrow(() => record(new Response(null), 'html', 'other'));
  assert.equal(readdirSync(directory).length, 2);
});

test('default recorder is enabled and uses private OS temp artifacts, not the repository', t => {
  const before = new Set(readdirSync(tmpdir()));
  recordRejectedResponse(new Response(null), 'missing', 'empty');
  const created = readdirSync(tmpdir()).filter(name => name.startsWith('spatial-model-diagnostics-') && !before.has(name));
  const ours = created.map(name => join(tmpdir(), name)).filter(dir => readdirSync(dir).some(name => name === `diagnostic-${process.pid}-1.json`));
  assert.equal(ours.length, 1);
  t.after(() => rmSync(ours[0]!, { recursive: true, force: true }));
  assert.equal(statSync(ours[0]!).mode & 0o777, 0o700);
  const file = join(ours[0]!, `diagnostic-${process.pid}-1.json`);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).bodyShape, 'empty');
});
