import {
  assertCoordinateMetadata,
  assertProjectState,
  assertVec3,
  type CoordinateMetadata,
  type Entity,
  type ProjectState,
  type Vec3,
} from '@spatial/contracts';

/** Translation only: local and world frames share meter units and orientation. */
export function localToWorld(point: Vec3, coordinates: CoordinateMetadata): Vec3 {
  assertVec3(point);
  assertCoordinateMetadata(coordinates);
  return [
    point[0] + coordinates.localOrigin[0],
    point[1] + coordinates.localOrigin[1],
    point[2] + coordinates.localOrigin[2],
  ];
}

export function worldToLocal(point: Vec3, coordinates: CoordinateMetadata): Vec3 {
  assertVec3(point);
  assertCoordinateMetadata(coordinates);
  return [
    point[0] - coordinates.localOrigin[0],
    point[1] - coordinates.localOrigin[1],
    point[2] - coordinates.localOrigin[2],
  ];
}

export function resolveEntity(state: ProjectState, id: string): Entity | undefined {
  return state.entities.find((entity) => entity.id === id);
}

/** UI selection is not a geometry edit and deliberately preserves revision. */
export function selectEntity(state: ProjectState, id: string | null): ProjectState {
  if (id !== null && !resolveEntity(state, id)) throw new RangeError(`Unknown entity ID: ${id}`);
  return { ...state, selectedEntityId: id };
}

export function createDemoProject(): ProjectState {
  const points: Vec3[] = [];
  for (let row = 0; row <= 20; row += 1) {
    for (let column = 0; column <= 20; column += 1) {
      const x = -3 + column * 0.3;
      const y = -3 + row * 0.3;
      points.push([x, y, 0.02 * Math.sin(x * 2) * Math.cos(y * 2)]);
    }
  }
  const project: ProjectState = {
    revision: 0,
    coordinates: { units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [1000, 2000, 10] },
    entities: [
      { id: 'synthetic-cloud', kind: 'point-cloud', points },
      { id: 'proposal-box', kind: 'box', center: [0, 0, 0.75], dimensions: [1.8, 1.2, 1.5] },
    ],
    selectedEntityId: null,
  };
  assertProjectState(project);
  return project;
}
