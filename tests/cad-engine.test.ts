import assert from 'node:assert/strict';
import test from 'node:test';
import { CAD_LIMITS, PROJECT_FRAME_ID, CadError, canonicalCadRequest, type CadBodyResult, type CadResult, type CadSource } from '@spatial/contracts';
import { inspectStepMeters } from '../packages/geometry/src/cad-kernel';
import { CadWorkerClient } from '../apps/server/src/cad-client';

const SOURCE: CadSource = { sessionId: 'engine-test', projectRevision: 1, frameId: PROJECT_FRAME_ID };
const BOX = { kind: 'box' as const, center: [0, 0, 0] as const, dimensions: [2, 2, 2] as const };
function solid(value: CadResult): CadBodyResult { assert.ok('source' in value); return value; }
function near(a: number, b: number, tolerance = 1e-7) { assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`); }
function code(expected: string) { return (error: unknown) => error instanceof CadError && error.code === expected; }

// Every modeling test uses the actual isolated OpenCascade worker, not a mock or analytic adapter.
test('real OpenCascade sandbox validates primitives, immutable booleans, mesh and meter STEP', async t => {
  const cad = new CadWorkerClient(SOURCE); t.after(() => cad.close());
  const box = solid(await cad.execute({ kind: 'box', center: [2, -3, 4], dimensions: [2, 3, 4] }));
  await t.test('kernel BRep validity, actual measured topology/volume/bounds', () => {
    assert.equal(box.valid, true); assert.equal(box.units, 'm'); assert.deepEqual(box.source, SOURCE);
    assert.deepEqual(box.kernel, { name: 'OpenCascade', package: 'replicad-opencascadejs', version: '1.1.0', validation: 'BRepCheck_Analyzer' });
    near(box.volume, 24); assert.deepEqual(box.bounds, { min: [1, -4.5, 2], max: [3, -1.5, 6] });
    assert.deepEqual(box.topology, { solids: 1, faces: 6, edges: 12, vertices: 8 });
  });
  const cylinder = solid(await cad.execute({ kind: 'cylinder', center: [-2, 3, 5], radius: 0.5, height: 2 }));
  await t.test('cylinder Z axis and midpoint convention', () => {
    near(cylinder.volume, Math.PI * 0.5); assert.deepEqual(cylinder.bounds, { min: [-2.5, 2.5, 4], max: [-1.5, 3.5, 6] });
    assert.equal(cylinder.topology.solids, 1); assert.equal(cylinder.topology.faces, 3);
  });
  const left = solid(await cad.execute(BOX));
  const right = solid(await cad.execute({ ...BOX, center: [1, 0, 0] }));
  const cutter = solid(await cad.execute({ kind: 'cylinder', center: [0, 0, 0], radius: 0.5, height: 2 }));
  const perforated = solid(await cad.execute({ kind: 'boolean', operator: 'subtract', left: left.body, right: cutter.body }));
  await t.test('curved boolean through-hole is a valid single solid', async () => {
    near(perforated.volume, 8 - Math.PI * 0.5);
    assert.deepEqual(perforated.bounds, left.bounds); assert.equal(perforated.topology.solids, 1);
    assert.equal(perforated.topology.faces, 7);
    assert.deepEqual(await cad.execute({ kind: 'inspect', body: cutter.body }), cutter);
  });
  await t.test('three booleans return measured solids and do not mutate either input', async () => {
    for (const [operator, volume, bounds] of [
      ['union', 12, { min: [-1, -1, -1], max: [2, 1, 1] }],
      ['subtract', 4, { min: [-1, -1, -1], max: [0, 1, 1] }],
      ['intersect', 4, { min: [0, -1, -1], max: [1, 1, 1] }],
    ] as const) {
      const result = solid(await cad.execute({ kind: 'boolean', operator, left: left.body, right: right.body }));
      near(result.volume, volume); assert.deepEqual(result.bounds, bounds); assert.equal(result.complexity, 2);
      assert.notEqual(result.body.bodyId, left.body.bodyId); assert.equal(result.body.bodyRevision, 1);
    }
    assert.deepEqual(await cad.execute({ kind: 'inspect', body: left.body }), left);
    assert.deepEqual(await cad.execute({ kind: 'inspect', body: right.body }), right);
  });
  await t.test('empty, face-only and disconnected results are rejected without altering inputs', async () => {
    const distant = solid(await cad.execute({ ...BOX, center: [10, 0, 0] }));
    const touching = solid(await cad.execute({ ...BOX, center: [2, 0, 0] }));
    for (const operation of [
      { kind: 'boolean', operator: 'intersect', left: left.body, right: distant.body },
      { kind: 'boolean', operator: 'union', left: left.body, right: distant.body },
      { kind: 'boolean', operator: 'subtract', left: left.body, right: left.body },
      { kind: 'boolean', operator: 'intersect', left: left.body, right: touching.body },
    ] as const) await assert.rejects(cad.execute(operation), code('invalid-solid'));
    assert.deepEqual(await cad.execute({ kind: 'inspect', body: left.body }), left);
    // Failed booleans do not poison the worker or prevent a subsequent valid operation.
    near(solid(await cad.execute({ kind: 'boolean', operator: 'intersect', left: left.body, right: right.body })).volume, 4);
  });
  await t.test('tessellation is plain bounded flat arrays with valid normals, indices and measured bounds', async () => {
    for (const primitive of [box, cylinder]) {
      const mesh = await cad.execute({ kind: 'tessellate', body: primitive.body }); assert.ok('triangles' in mesh);
      assert.deepEqual(Object.keys(mesh).sort(), ['body', 'normals', 'triangles', 'units', 'vertices']);
      for (const a of [mesh.vertices, mesh.normals, mesh.triangles]) assert.ok(Array.isArray(a));
      assert.equal(mesh.vertices.length % 3, 0); assert.equal(mesh.triangles.length % 3, 0);
      assert.equal(mesh.normals.length, mesh.vertices.length); assert.ok(mesh.vertices.length > 0 && mesh.triangles.length > 0);
      assert.ok(mesh.vertices.length / 3 <= CAD_LIMITS.maxMeshVertices && mesh.triangles.length / 3 <= CAD_LIMITS.maxMeshTriangles);
      for (let i = 0; i < mesh.vertices.length; i++) {
        assert.ok(Number.isFinite(mesh.vertices[i]));
        assert.ok(mesh.vertices[i] >= primitive.bounds.min[i % 3] - 1e-5 && mesh.vertices[i] <= primitive.bounds.max[i % 3] + 1e-5);
      }
      for (let i = 0; i < mesh.normals.length; i += 3) near(Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]), 1, 1e-5);
      for (const index of mesh.triangles) assert.ok(Number.isSafeInteger(index) && index >= 0 && index < mesh.vertices.length / 3);
      for (let axis = 0; axis < 3; axis++) {
        const positions = mesh.vertices.filter((_, i) => i % 3 === axis);
        near(Math.min(...positions), primitive.bounds.min[axis], 0.01); near(Math.max(...positions), primitive.bounds.max[axis], 0.01);
      }
    }
  });
  await t.test('exported STEP carries explicit meters and rereads actual solid dimensions in a separate kernel', async () => {
    const result = await cad.execute({ kind: 'export-step', body: box.body }); assert.ok('step' in result);
    assert.equal(result.units, 'm'); assert.equal(typeof result.step, 'string'); assert.ok(result.step.startsWith('ISO-10303-21;'));
    assert.ok(result.step.includes('SI_UNIT($,.METRE.)')); assert.ok(!result.step.includes('SI_UNIT(.MILLI.,.METRE.)'));
    assert.ok(Buffer.byteLength(result.step) <= CAD_LIMITS.maxStepBytes);
    const reread = await inspectStepMeters(result.step);
    near(reread.volume, 24); assert.deepEqual(reread.bounds, box.bounds); assert.deepEqual(reread.topology, box.topology);
    assert.deepEqual(await cad.execute({ kind: 'inspect', body: box.body }), box);
    // Curved and boolean STEP outputs also pass the adapter's native reread/volume/bounds gate.
    for (const shape of [cylinder, perforated]) {
      const exported = await cad.execute({ kind: 'export-step', body: shape.body }); assert.ok('step' in exported);
      assert.ok(exported.step.includes('SI_UNIT($,.METRE.)')); assert.ok(Buffer.byteLength(exported.step) <= CAD_LIMITS.maxStepBytes);
      assert.deepEqual(await cad.execute({ kind: 'inspect', body: shape.body }), shape);
    }
  });
  await t.test('returned objects cannot mutate registry, and stale/deleted refs never alias another body', async () => {
    const original = structuredClone(box);
    (box as unknown as { volume: number }).volume = -1;
    (box.bounds.min as unknown as number[])[0] = -100;
    assert.deepEqual(await cad.execute({ kind: 'inspect', body: original.body }), original);
    await assert.rejects(cad.execute({ kind: 'inspect', body: { ...original.body, bodyRevision: 2 } as never }), code('stale-body'));
    assert.deepEqual(await cad.execute({ kind: 'delete', body: original.body }), { deleted: true });
    await assert.rejects(cad.execute({ kind: 'inspect', body: original.body }), code('unknown-body'));
    await assert.rejects(cad.execute({ kind: 'delete', body: original.body }), code('unknown-body'));
    const replacement = solid(await cad.execute(BOX)); assert.notEqual(replacement.body.bodyId, original.body.bodyId);
    await assert.rejects(cad.execute({ kind: 'inspect', body: original.body }), code('unknown-body'));
  });
  await t.test('deleting boolean inputs releases only their handles, not the result solid', async () => {
    await cad.execute({ kind: 'delete', body: left.body }); await cad.execute({ kind: 'delete', body: cutter.body });
    assert.deepEqual(await cad.execute({ kind: 'inspect', body: perforated.body }), perforated);
    const mesh = await cad.execute({ kind: 'tessellate', body: perforated.body }); assert.ok('triangles' in mesh && mesh.triangles.length > 0);
  });
});

test('bounded body registry, boolean complexity and finite dimensions', async t => {
  const cad = new CadWorkerClient(SOURCE); t.after(() => cad.close());
  let current = solid(await cad.execute(BOX));
  const stored = [current];
  for (let i = 0; i < 4; i++) {
    current = solid(await cad.execute({ kind: 'boolean', operator: 'union', left: current.body, right: current.body })); stored.push(current);
  }
  assert.equal(current.complexity, CAD_LIMITS.maxBooleanComplexity);
  await assert.rejects(cad.execute({ kind: 'boolean', operator: 'union', left: current.body, right: current.body }), code('resource-limit'));
  while (stored.length < CAD_LIMITS.maxBodies) stored.push(solid(await cad.execute(BOX)));
  await assert.rejects(cad.execute(BOX), code('resource-limit'));
  assert.deepEqual(await cad.execute({ kind: 'inspect', body: current.body }), current);
  await cad.execute({ kind: 'delete', body: stored[0].body });
  const smallest = solid(await cad.execute({ ...BOX, dimensions: [0.001, 0.001, 0.001] })); near(smallest.volume, 1e-9, 1e-15);
  await assert.rejects(cad.execute({ ...BOX, center: [NaN, 0, 0] }), code('invalid-request'));
  await assert.rejects(cad.execute({ ...BOX, center: [1001, 0, 0] }), code('resource-limit'));
  await assert.rejects(cad.execute({ ...BOX, dimensions: [-1, 1, 1] }), code('resource-limit'));
  await assert.rejects(cad.execute({ ...BOX, dimensions: [101, 1, 1] }), code('resource-limit'));
  for (const malformed of [
    { ...SOURCE, operation: { ...BOX, ignored: true } }, { ...SOURCE, operation: BOX, ignored: true },
    { ...SOURCE, operation: { kind: 'cylinder', center: [0, 0, 0], radius: 1, height: Infinity } },
    { ...SOURCE, operation: { kind: 'box', center: [0, 0], dimensions: [1, 1, 1] } },
    { ...SOURCE, operation: { kind: 'box', center: new Array(3), dimensions: [1, 1, 1] } },
    { ...SOURCE, operation: { kind: 'import-step', step: '' } },
  ]) assert.throws(() => canonicalCadRequest(malformed), code('invalid-request'));
});

test('one in flight, cancellation resets old handles, close terminates a real worker', async t => {
  const cad = new CadWorkerClient(SOURCE); t.after(() => cad.close());
  const initializing = cad.execute(BOX);
  await assert.rejects(cad.execute(BOX), code('busy'));
  const original = solid(await initializing);
  const controller = new AbortController();
  const cancelled = cad.execute({ kind: 'export-step', body: original.body }, controller.signal);
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(cancelled, code('closed'));
  const replacement = solid(await cad.execute(BOX));
  assert.notEqual(replacement.body.bodyId, original.body.bodyId);
  await assert.rejects(cad.execute({ kind: 'inspect', body: original.body }), code('unknown-body'));
  const pending = cad.execute({ kind: 'export-step', body: replacement.body });
  const rejection = assert.rejects(pending, code('closed'));
  await cad.close(); await rejection;
  await assert.rejects(cad.execute(BOX), code('closed'));
});

test('hard wall-clock timeout terminates blocked real kernel startup and permits reset attempts', async t => {
  const cad = new CadWorkerClient(SOURCE, 1); t.after(() => cad.close());
  const start = Date.now();
  await assert.rejects(cad.execute(BOX), code('timeout'));
  assert.ok(Date.now() - start < 1000);
  // New work waits for termination rather than overlapping the abandoned worker.
  await assert.rejects(cad.execute(BOX), code('timeout'));
  await cad.close();
});
