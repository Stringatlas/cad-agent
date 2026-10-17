import * as THREE from 'three';
import type { BoxProposal } from '@spatial/contracts';

/** Disposable preview caches only. Never assign an authoritative entity pick ID. */
export function createBoxGhost(proposal: BoxProposal) {
  const geometry = new THREE.BoxGeometry(...proposal.after.dimensions), edges = new THREE.EdgesGeometry(geometry);
  const ghost = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffbd59, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide }));
  const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffc766, transparent: true, opacity: 0.9, depthTest: false }));
  for (const object of [ghost, outline]) {
    object.position.set(...proposal.after.center);
    object.userData.preview = true; object.userData.proposalId = proposal.proposalId;
    object.raycast = () => {}; // Non-pickable even if a caller traverses the entire scene.
  }
  ghost.renderOrder = 4; outline.renderOrder = 5;
  return [ghost, outline] as const;
}
