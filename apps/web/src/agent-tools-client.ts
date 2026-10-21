import type { AgentToolsInspection } from '../../../packages/contracts/src/agent-tools-inspection';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

/** Validate before rendering; the registry is not a scene-bound availability report. */
export function validateAgentToolsInspection(value: unknown): AgentToolsInspection {
  if (!object(value) || value.kind !== 'agent-tools-inspection' || value.availability !== 'unknown-unbound' ||
    !object(value.instructions) || value.instructions.kind !== 'unbound-preview' || typeof value.instructions.text !== 'string' ||
    !Array.isArray(value.tools) || !value.tools.every(tool => object(tool) && tool.namespace === 'scene' &&
      typeof tool.name === 'string' && typeof tool.description === 'string' && object(tool.parameters) &&
      typeof tool.strict === 'boolean' && strings(tool.requirements) && (tool.skillId === null || typeof tool.skillId === 'string')) ||
    !Array.isArray(value.skills) || !value.skills.every(skill => object(skill) && typeof skill.id === 'string' &&
      typeof skill.name === 'string' && typeof skill.description === 'string' && typeof skill.instructions === 'string' &&
      strings(skill.tools) && strings(skill.dependencies) && strings(skill.modes) && skill.modes.every(mode => ['toronto', 'demo', 'pole'].includes(mode)))) {
    throw new Error('Invalid tools inspection response.');
  }
  return value as unknown as AgentToolsInspection;
}

export async function fetchAgentToolsInspection(signal: AbortSignal, fetcher: typeof fetch = globalThis.fetch): Promise<AgentToolsInspection> {
  const response = await fetcher('/chat/tools', {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
  });
  if (!response.ok) throw new Error('Tools inspection unavailable.');
  const result = validateAgentToolsInspection(await response.json());
  signal.throwIfAborted();
  return result;
}

export function filterAgentTools(tools: AgentToolsInspection['tools'], search: string): AgentToolsInspection['tools'] {
  const query = search.trim().toLowerCase();
  return query ? tools.filter(tool => [tool.name, tool.description, tool.skillId ?? '', ...tool.requirements].join(' ').toLowerCase().includes(query)) : tools;
}
