import { assertBoxEntity, canonicalPersistentProject, canonicalProtocolJson, type BoxEdit, type ProjectState } from '@spatial/contracts';

/** Candidate transition only; publication and approvals belong to the project authority. */
export function boxEditCandidate(state: ProjectState, edit: BoxEdit): ProjectState {
  const previous = state.entities.find(e => e.id === edit.entityId);
  if (edit.kind === 'create-box' ? !!previous : previous?.kind !== 'box') throw new RangeError('Box edit entity precondition');
  if (state.revision >= Number.MAX_SAFE_INTEGER) throw new RangeError('Revision exhausted');
  const box = { id: edit.entityId, kind: 'box' as const, center: edit.center, dimensions: edit.dimensions };
  assertBoxEntity(box);
  const candidate = canonicalPersistentProject({ ...state, revision: state.revision + 1, selectedEntityId: null,
    entities: edit.kind === 'create-box' ? [...state.entities, box] : state.entities.map(e => e.id === edit.entityId ? box : e) });
  const actual = candidate.entities.find(e => e.id === edit.entityId);
  if (canonicalProtocolJson(actual) !== canonicalProtocolJson(box) ||
    canonicalProtocolJson(candidate.entities.filter(e => e.id !== edit.entityId)) !== canonicalProtocolJson(state.entities.filter(e => e.id !== edit.entityId))) throw new Error('Box parameter postconditions failed');
  return candidate;
}

/** Undo preserves current monotonic geometry revision; it never restores the old counter. */
export function undoBoxCandidate(current: ProjectState, before: ProjectState, after: ProjectState): ProjectState {
  if (current.revision >= Number.MAX_SAFE_INTEGER || canonicalProtocolJson(current.entities) !== canonicalProtocolJson(after.entities) ||
    canonicalProtocolJson(current.coordinates) !== canonicalProtocolJson(before.coordinates)) throw new RangeError('Undo precondition');
  const candidate = canonicalPersistentProject({ ...before, selectedEntityId: null, revision: current.revision + 1 });
  if (canonicalProtocolJson(candidate.entities) !== canonicalProtocolJson(before.entities)) throw new Error('Undo postcondition');
  return candidate;
}
