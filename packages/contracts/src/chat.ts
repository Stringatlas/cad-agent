import type { ProjectState } from './index';
import { protocolRecord, protocolKeys, protocolToken, protocolInteger, type ToolReply } from './tool-protocol';

export const PROJECT_FRAME_ID = 'demo-local-v1' as const;
export const CHAT_BODY_BYTES = 1024;
export const CHAT_REPLY_BYTES = 1024 * 1024;
export type ChatState = 'pending' | 'completed' | 'rejected' | 'incomplete' | 'error' | 'cancelled';
export interface ProjectSnapshot { readonly sessionId: string; readonly frameId: typeof PROJECT_FRAME_ID; readonly project: ProjectState }
export interface ChatRequest {
  readonly sessionId: string; readonly projectRevision: number; readonly generation: number;
  readonly requestId: string; readonly command: string;
}
export interface ChatResponse extends Omit<ChatRequest, 'command'> {
  readonly state: Exclude<ChatState, 'pending'>; readonly code: string;
  readonly reply?: ToolReply;
  readonly evidence?: { readonly runId: string; readonly requestId: string; readonly semanticHash: string; readonly configHash: string };
}
/** Deliberately not natural language or an arbitrary tool API. */
export function inspectionCommand(text: string): { tool: 'dataset.metadata'; args: Record<string, never> } | { tool: 'dataset.observe'; args: { lod: { budget: number; depth: number } } } | null {
  if (text === 'metadata') return { tool: 'dataset.metadata', args: {} };
  const match = /^observe ([1-9]\d{0,3}) ([0-3])$/.exec(text);
  if (match && Number(match[1]) <= 4096) return { tool: 'dataset.observe', args: { lod: { budget: Number(match[1]), depth: Number(match[2]) } } };
  return null;
}
export function canonicalChatRequest(value: unknown): ChatRequest {
  const r = protocolRecord(value); protocolKeys(r, ['sessionId', 'projectRevision', 'generation', 'requestId', 'command']);
  protocolToken(r.sessionId); protocolToken(r.requestId); protocolInteger(r.projectRevision); protocolInteger(r.generation);
  if (typeof r.command !== 'string' || r.command.length > 80) throw new TypeError('Invalid command');
  return { sessionId: r.sessionId, projectRevision: r.projectRevision, generation: r.generation, requestId: r.requestId, command: r.command };
}
export function chatOutcomeState(reply: ToolReply): Exclude<ChatState, 'pending'> {
  const o = reply.outcome;
  if (o.status === 'observed' || o.status === 'verified-found' || o.status === 'verified-none') return 'completed';
  if (o.status === 'verification-rejected') return 'rejected';
  if (o.status === 'incomplete') return o.reason === 'cancelled' ? 'cancelled' : 'incomplete';
  return 'error';
}
