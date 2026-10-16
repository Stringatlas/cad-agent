import { chmodSync, closeSync, constants, fchmodSync, mkdtempSync, openSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Appearance only: these tags neither validate a protocol nor establish origin. */
export type BodyShape = 'empty' | 'sse-like' | 'json-like' | 'html-like' | 'other' | 'timeout' | 'read-error' | 'cancelled';
type ResponseFormat = 'json' | 'html' | 'text' | 'missing' | 'other';
const PREFIX_BYTES = 1_024;
const MAX_READS = 16;
const DEADLINE_MS = 250;
const EXPECTED_URL = 'https://api.openai.com/v1/responses';

function prefixShape(bytes: Uint8Array): BodyShape | undefined {
  // Decode only the retained prefix. TextDecoder handles a fragmented UTF-8 BOM.
  const prefix = new TextDecoder().decode(bytes).trimStart();
  if (/^(?:data:|event:|id:|retry:|:)/.test(prefix)) return 'sse-like';
  if (/^[{[]/.test(prefix)) return 'json-like';
  if (/^<(?:!doctype\s+html(?:\s|>)|html(?:\s|>)|head(?:\s|>)|body(?:\s|>)|!--)/i.test(prefix)) return 'html-like';
  return undefined;
}

/** Inspect the existing stream, never tee it or retain/publish its contents. */
export async function inspectRejectedBody(response: Response, signal: AbortSignal): Promise<BodyShape> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const body = response.body;
    if (!body) return signal.aborted ? 'cancelled' : 'empty';
    reader = body.getReader();
    if (signal.aborted) return 'cancelled';
    const interrupted = new Promise<'timeout' | 'cancelled'>(resolve => {
      onAbort = () => resolve('cancelled');
      signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => resolve('timeout'), DEADLINE_MS);
      if (signal.aborted) resolve('cancelled');
    });
    const prefix = new Uint8Array(PREFIX_BYTES);
    let length = 0;
    for (let reads = 0; reads < MAX_READS; reads++) {
      // Attach a rejection handler before racing: a late read failure must not leak.
      const read = reader.read().then(value => ({ kind: 'read' as const, value }), () => ({ kind: 'read-error' as const }));
      const result = await Promise.race([read, interrupted]);
      if (typeof result === 'string') return result;
      if (signal.aborted) return 'cancelled';
      if (result.kind === 'read-error') return 'read-error';
      if (result.value.done) {
        const retained = prefix.subarray(0, length);
        return prefixShape(retained) ?? (new TextDecoder().decode(retained).trim().length === 0 ? 'empty' : 'other');
      }
      const chunk = result.value.value;
      const count = Math.min(chunk.byteLength, PREFIX_BYTES - length);
      prefix.set(chunk.subarray(0, count), length);
      length += count;
      const shape = prefixShape(prefix.subarray(0, length));
      if (shape) return shape;
      if (length === PREFIX_BYTES) return 'other';
    }
    // Neither a read/byte limit nor an all-whitespace prefix proves EOF.
    return 'other';
  } catch {
    return signal.aborted ? 'cancelled' : 'read-error';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (reader) {
      // Cancellation can throw, reject, or never settle. Never wait for it.
      try { void reader.cancel().catch(() => {}); } catch { /* diagnostic only */ }
      try { reader.releaseLock(); } catch { /* already released/hostile reader */ }
    }
  }
}

function safeFormat(value: ResponseFormat): ResponseFormat {
  switch (value) {
    case 'json': case 'html': case 'text': case 'missing': return value;
    default: return 'other';
  }
}
function safeShape(value: BodyShape): BodyShape {
  switch (value) {
    case 'empty': case 'sse-like': case 'json-like': case 'html-like': case 'timeout': case 'read-error': case 'cancelled': return value;
    default: return 'other';
  }
}
function safeType(value: ResponseType): ResponseType | 'other' {
  switch (value) {
    case 'basic': case 'cors': case 'default': case 'error': case 'opaque': case 'opaqueredirect': return value;
    default: return 'other';
  }
}

/**
 * Test seam for an isolated temp root. The runtime singleton below uses OS tmpdir.
 * No asynchronous queue: at most eight records and one private directory per writer.
 * Any filesystem failure permanently disables this writer, without logging inputs.
 */
export function createRejectedResponseRecorder(tempRoot = tmpdir()): (response: Response, responseFormat: ResponseFormat, bodyShape: BodyShape) => void {
  let directory: string | undefined;
  let disabled = false;
  let sequence = 0;
  const files: string[] = [];
  return (response, responseFormat, bodyShape) => {
    if (disabled) return;
    let path: string | undefined;
    let fd: number | undefined;
    let created = false;
    try {
      // Deliberately reconstruct a closed schema. Never spread/stringify response,
      // headers, caller objects, URLs, body text, exceptions, or provider identifiers.
      const status = response.status;
      const url = response.url;
      const record = {
        schemaVersion: 1,
        pid: process.pid,
        recordedAt: new Date().toISOString(),
        sequence: ++sequence,
        httpStatus: Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0,
        operation: 'responses.create',
        check: 'response-content-type',
        responseUrl: url === EXPECTED_URL ? 'expected' : url === '' ? 'absent' : 'other',
        responseType: safeType(response.type),
        responseFormat: safeFormat(responseFormat),
        redirected: response.redirected === true,
        bodyPresent: response.body !== null,
        bodyShape: safeShape(bodyShape),
      };
      if (!directory) {
        directory = mkdtempSync(join(tempRoot, 'spatial-model-diagnostics-'));
        chmodSync(directory, 0o700);
      }
      // Remove before creating, so the bound also holds during a write.
      if (files.length === 8) {
        unlinkSync(files[0]!);
        files.shift();
      }
      path = join(directory, `diagnostic-${process.pid}-${sequence}.json`);
      fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = true;
      fchmodSync(fd, 0o600);
      writeFileSync(fd, `${JSON.stringify(record)}\n`, { encoding: 'utf8' });
      closeSync(fd);
      fd = undefined;
      files.push(path);
    } catch {
      disabled = true;
      if (fd !== undefined) { try { closeSync(fd); } catch { /* diagnostic only */ } }
      if (created && path) { try { unlinkSync(path); } catch { /* diagnostic only */ } }
      if (directory && files.length === 0) { try { rmdirSync(directory); } catch { /* diagnostic only */ } }
    }
  };
}

/** Call only from a wrong-MIME rejection, not successful model traffic. */
export const recordRejectedResponse = createRejectedResponseRecorder();
