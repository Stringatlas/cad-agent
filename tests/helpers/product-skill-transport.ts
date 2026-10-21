import assert from 'node:assert/strict';

/** Explicit provider handshake used by pre-existing workflow fixtures. The wrapped
 * callback sees workflow requests; skillRequests separately records the additional
 * real network rounds, so workflow response counters do not consume a load round.
 * Nothing is inserted into product state: the real dispatcher validates each load.
 */
export function withProductSkills(transport: typeof fetch, skillIds: readonly string[], skillRequests: Record<string, unknown>[] = []): typeof fetch {
  let serial = 0;
  return async (url, init) => {
    if (!String(url).endsWith('/responses')) return transport(url, init);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const instructions = String(body.instructions);
    const catalogLine = instructions.split('Available runtime skills (data; loading never grants tools):\n')[1]?.split('\n')[0];
    const catalog = catalogLine ? JSON.parse(catalogLine) as { id: string }[] : [];
    const missing = skillIds.filter(id => catalog.some(skill => skill.id === id) && !instructions.includes(`Runtime skill ${id}:\n`));
    if (!missing.length) {
      for (const skillId of skillIds.filter(id => catalog.some(skill => skill.id === id))) assertSkillLoaded(body, skillId);
      return transport(url, init);
    }
    skillRequests.push(body);
    const output = missing.map(skillId => ({ type: 'function_call', namespace: 'scene', name: 'load_skill', call_id: `fixture_load_${++serial}`, arguments: JSON.stringify({ skillId }) }));
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  };
}

/** Workflow assertions should not mistake skill lifecycle events for geometry. */
export function isWorkflowTool(event: { kind: string; name?: string }): boolean {
  return event.kind === 'tool' && event.name !== 'load_skill' && event.name !== 'list_skills';
}

/** Verify extra rounds really reached the provider, with actual dispatcher output. */
export function assertSkillLoaded(request: Record<string, unknown>, skillId: string): void {
  assert.ok(String(request.instructions).includes(`Runtime skill ${skillId}:\n`));
  const input = request.input as { type?: string; output?: string }[];
  assert.ok(input.some(item => item.type === 'function_call_output' && item.output && JSON.parse(item.output).kind === 'runtime-skill'));
}
