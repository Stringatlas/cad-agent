import { parentPort, workerData } from 'node:worker_threads';
import { CAD_LIMITS, CadError, canonicalCadRequest, type CadOperation, type CadReply, type CadSource } from '@spatial/contracts';
import { createOpenCascadeAdapter } from '@spatial/geometry/cad-kernel';
import type { CadAdapter } from '@spatial/geometry';

if (!parentPort) throw new Error('CAD requires a worker');
const port = parentPort;
const source: CadSource = Object.freeze({ sessionId: workerData.sessionId, projectRevision: workerData.projectRevision, frameId: workerData.frameId });
let adapter: CadAdapter | undefined, active = false;
port.on('message', async (message: { id: number; operation: CadOperation }) => {
  let reply: CadReply;
  if (active) { port.postMessage({ id: message.id, reply: { ok: false, error: { code: 'busy', message: 'CAD worker busy' } } }); return; }
  active = true;
  try {
    // Revalidate at the kernel boundary, even though trusted main thread canonicalizes.
    const { operation } = canonicalCadRequest({ ...source, operation: message.operation });
    adapter ??= await createOpenCascadeAdapter(source);
    const result = await adapter.execute(operation);
    reply = { ok: true, result };
    if (Buffer.byteLength(JSON.stringify(reply)) > CAD_LIMITS.maxResponseBytes) throw new CadError('resource-limit', 'CAD response limit exceeded');
  } catch (error) {
    reply = { ok: false, error: error instanceof CadError ? { code: error.code, message: error.message } : { code: 'kernel-failure', message: 'CAD worker failed' } };
  } finally { active = false; }
  port.postMessage({ id: message.id, reply });
});
