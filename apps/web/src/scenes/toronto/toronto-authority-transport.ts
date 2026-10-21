import { torontoReadonlyFetch } from './toronto-readonly-fetch';

interface AuthorityTransportPolicy {
  readonly endpoint: '/datasets/toronto3d/cad' | '/datasets/toronto3d/objects';
  /** Existing decoded-text character limit, not a streaming byte budget. */
  readonly maxResponseLength: number;
  readonly responseName: string;
  readonly errorPrefix: string;
}

/** JSON transport only: domain validation and approval/revision gates stay with each controller. */
export async function torontoAuthorityRequest(
  policy: AuthorityTransportPolicy,
  action: 'refresh' | 'propose' | 'approve' | 'decline' | 'undo',
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await torontoReadonlyFetch(`${policy.endpoint}${action === 'refresh' ? '' : `/${action}`}`, {
    method: action === 'refresh' ? 'GET' : 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
  });
  if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error(`Invalid ${policy.responseName} response`);
  const text = await response.text();
  if (text.length > policy.maxResponseLength) throw new Error(`Oversized ${policy.responseName} response`);
  const reply = JSON.parse(text);
  if (!response.ok || reply.ok !== true) throw new Error(`${policy.errorPrefix}${reply.error?.code ?? response.status}`);
  return reply.result;
}
