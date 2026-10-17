import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as THREE from 'three';
import { ProjectSession } from '../apps/server/src/project-session';
import { projectBinding } from '../apps/web/src/project-client';
import { createBoxGhost } from '../apps/web/src/proposal-ghosts';
import { createEntityObject } from '../apps/web/src/entities';

test('ghosts are translucent solid and outline caches with exact local dimensions, never pickable entities', () => {
  const root = mkdtempSync(join(tmpdir(), 'spatial-ghost-render-'));
  const authority = new ProjectSession(join(root, 'project.json'));
  try {
    const snapshot = authority.snapshot();
    const proposal = authority.propose({ ...projectBinding(snapshot), edit: { kind: 'update-box', entityId: 'proposal-box', center: [1, 2, 3], dimensions: [4, 5, 6] } });
    const objects = createBoxGhost(proposal), [solid, outline] = objects;
    assert.ok(solid instanceof THREE.Mesh); assert.ok(outline instanceof THREE.LineSegments);
    assert.deepEqual(solid.position.toArray(), proposal.after.center); assert.deepEqual(outline.position.toArray(), proposal.after.center);
    solid.geometry.computeBoundingBox();
    assert.deepEqual(solid.geometry.boundingBox!.getSize(new THREE.Vector3()).toArray(), proposal.after.dimensions);
    assert.equal(solid.material.transparent, true); assert.ok(solid.material.opacity > 0 && solid.material.opacity < 1);
    assert.equal(solid.material.depthWrite, false); assert.equal(solid.userData.entityId, undefined);
    assert.equal(solid.userData.proposalId, proposal.proposalId);
    for (const object of objects) object.updateMatrixWorld();
    const ray = new THREE.Raycaster(new THREE.Vector3(1, 2, 10), new THREE.Vector3(0, 0, -1));
    assert.deepEqual(ray.intersectObjects([...objects], true), []);
    const committed = createEntityObject(proposal.after);
    assert.equal(committed.material.transparent, true);
    assert.notEqual(committed.material.opacity, solid.material.opacity);
    assert.notEqual(committed.material.color.getHex(), solid.material.color.getHex());
    assert.deepEqual(authority.snapshot(), snapshot);
    for (const object of [...objects, committed]) { object.geometry.dispose(); object.material.dispose(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
