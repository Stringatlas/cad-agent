import { createHash } from 'node:crypto';
import { MODEL_INSPECTION_LIMITS as L, type ModelInspectionOmission, type ModelRequestInspection } from '@spatial/contracts';

/** Only this allowlisted projection leaves the server. Raw replay objects never do. */
export function inspectModelRequest(body: Record<string, unknown>, mode: 'api-key' | 'chatgpt', round: number, continuation: boolean): ModelRequestInspection {
  const omissions = new Set<ModelInspectionOmission>(['credentials-and-headers']);
  const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const text = (v: unknown): unknown => {
    if (typeof v !== 'string') return undefined;
    if (v.length <= L.textChars) return v;
    omissions.add('truncated'); return v.slice(0, L.textChars) + '\n[truncated]';
  };
  const pick = (v: unknown, keys: string[]): Record<string, unknown> => {
    const r = object(v), out: Record<string, unknown> = {};
    if (Object.keys(r).some(k => !keys.includes(k))) omissions.add('unrecognized-fields');
    for (const key of keys) if (Object.hasOwn(r, key)) {
      const value = r[key];
      if (typeof value === 'string') out[key] = text(value);
      else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || value === null) out[key] = value;
    }
    return out;
  };
  const item = (v: unknown): unknown => {
    const r = object(v);
    if (r.type === 'reasoning') { omissions.add('opaque-reasoning'); return { type: 'reasoning', omitted: 'opaque-reasoning' }; }
    if (r.type === 'function_call') return pick(r, ['type', 'id', 'call_id', 'namespace', 'name', 'arguments', 'status']);
    if (r.type === 'function_call_output') return pick(r, ['type', 'call_id', 'output']);
    if ((r.type === 'message' || r.type === undefined) && ['user', 'developer', 'assistant'].includes(String(r.role))) {
      const out = pick(r, ['type', 'id', 'role', 'status', 'phase', 'content']);
      if (Array.isArray(r.content)) {
        if (r.content.length > 32) omissions.add('truncated');
        out.content = r.content.slice(0, 32).map(v => {
          const c = object(v);
          if (c.type === 'output_text' || c.type === 'input_text') return pick(c, ['type', 'text']);
          if (c.type === 'input_image' && typeof c.image_url === 'string' && /^data:image\/(?:png|jpeg);base64,/u.test(c.image_url) && c.image_url.length < 3 * 1024 * 1024) {
            const mimeType = c.image_url.startsWith('data:image/jpeg;') ? 'image/jpeg' : 'image/png';
            const bytes = Buffer.from(c.image_url.slice(`data:${mimeType};base64,`.length), 'base64');
            let dimensions: { width: number; height: number } | undefined;
            if (mimeType === 'image/png' && bytes.length >= 24) dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
            // Validated JPEGs carry dimensions in SOF markers. Inspect the bounded header,
            // not a second pixel decode/allocation for each provider round.
            if (mimeType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) {
              let at = 2;
              while (at + 4 <= bytes.length && bytes[at] === 0xff) {
                while (bytes[at] === 0xff) at++;
                const marker = bytes[at++];
                if (marker === 0xda || marker === 0xd9 || at + 2 > bytes.length) break;
                const length = bytes.readUInt16BE(at);
                if (length < 2 || at + length > bytes.length) break;
                if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) { dimensions = { width: bytes.readUInt16BE(at + 5), height: bytes.readUInt16BE(at + 3) }; break; }
                at += length;
              }
            }
            omissions.add('image-bytes');
            return { type: 'input_image', detail: c.detail, image: { mimeType, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length,
              ...dimensions, omitted: 'image-bytes' } };
          }
          if (c.type === 'refusal') return pick(c, ['type', 'refusal']);
          omissions.add('unrecognized-fields'); return { omitted: 'unrecognized-content' };
        });
      }
      return out;
    }
    omissions.add('unrecognized-fields'); return { omitted: 'unrecognized-input' };
  };
  const view = pick(body, ['model', 'instructions', 'store', 'stream', 'max_output_tokens', 'input', 'tools']);
  // Instructions are fixed trusted product instructions: preserve them without a synthetic role.
  const input = Array.isArray(body.input) ? body.input : [];
  view.input = [];
  // Tool schema is projected, not copied recursively; arbitrary provider extension fields stay private.
  if (Array.isArray(body.tools) && body.tools.length > 8) omissions.add('truncated');
  view.tools = (Array.isArray(body.tools) ? body.tools : []).slice(0, 8).map(v => {
    const ns = object(v), out = pick(ns, ['type', 'name', 'description', 'tools']);
    if (Array.isArray(ns.tools) && ns.tools.length > 8) omissions.add('truncated');
    out.tools = (Array.isArray(ns.tools) ? ns.tools : []).slice(0, 8).map(v => {
      const tool = object(v), t = pick(tool, ['type', 'name', 'description', 'parameters', 'strict']);
      // Current read-only tool has exactly this empty object schema. Never copy unknown schema fields.
      if (JSON.stringify(tool.parameters) === JSON.stringify({ type: 'object', properties: {}, required: [], additionalProperties: false }))
        t.parameters = { type: 'object', properties: {}, required: [], additionalProperties: false };
      else if (tool.name === 'resolve_visual_pixel' && JSON.stringify(tool.parameters) === JSON.stringify({ type: 'object', properties: { observationId: { type: 'string' }, x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 } }, required: ['observationId', 'x', 'y'], additionalProperties: false }))
        t.parameters = { type: 'object', properties: { observationId: { type: 'string' }, x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 } }, required: ['observationId', 'x', 'y'], additionalProperties: false };
      else { omissions.add('unrecognized-fields'); t.parameters = { omitted: 'unrecognized-schema' }; }
      return t;
    });
    return out;
  });
  const visible: unknown[] = [];
  for (const value of input.slice(0, L.inputItems)) {
    const projected = item(value); visible.push(projected); view.input = visible;
    // Reserve room for a visible omission marker, including JSON escaping overhead.
    if (Buffer.byteLength(JSON.stringify(view)) > L.snapshotBytes - 256) { visible.pop(); omissions.add('truncated'); break; }
  }
  if (visible.length < input.length) {
    omissions.add('truncated'); visible.push({ omitted: 'truncated-input', count: input.length - visible.length });
  }
  view.input = visible;
  let bodyJson = JSON.stringify(view);
  if (Buffer.byteLength(bodyJson) > L.snapshotBytes) {
    omissions.add('truncated'); bodyJson = JSON.stringify({ model: text(body.model), omitted: 'snapshot-byte-limit' });
  }
  return { round, mode, continuation, bodyJson, omissions: [...omissions] };
}
