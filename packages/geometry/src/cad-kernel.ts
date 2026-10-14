import init, { type OpenCascadeInstance, type TopoDS_Shape, type TopAbs_ShapeEnum } from 'replicad-opencascadejs';
import { CAD_LIMITS, CadError, canonicalCadOperation, type CadOperation, type CadResult, type CadSource,
  type CadBodyRef, type CadBodyResult, type CadValidation } from '@spatial/contracts';
import type { CadAdapter } from './cad';

// Only this subpath imports the real kernel. Server loads it in a disposable worker.
const KERNEL = Object.freeze({ name: 'OpenCascade', package: 'replicad-opencascadejs', version: '1.1.0', validation: 'BRepCheck_Analyzer' } as const);
type Native = { delete(): void };
class Scope {
  private objects: Native[] = [];
  own<T extends Native>(object: T): T { this.objects.push(object); return object; }
  dispose() { for (const object of this.objects.reverse()) object.delete(); this.objects = []; }
}
function topology(oc: OpenCascadeInstance, shape: TopoDS_Shape, kind: TopAbs_ShapeEnum, limit: number): number {
  const scope = new Scope();
  try {
    const explorer = scope.own(new oc.TopExp_Explorer(shape, kind));
    const seen: TopoDS_Shape[] = [];
    while (explorer.More()) {
      const item = explorer.Current();
      if (seen.some(s => s.IsSame(item))) item.delete();
      else {
        scope.own(item); seen.push(item);
        if (seen.length > limit) throw new CadError('resource-limit', 'Topology limit exceeded');
      }
      explorer.Next();
    }
    return seen.length;
  } finally { scope.dispose(); }
}
function validate(oc: OpenCascadeInstance, shape: TopoDS_Shape): CadValidation {
  const scope = new Scope();
  try {
    if (shape.IsNull()) throw new CadError('invalid-solid', 'Empty CAD result');
    if (topology(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, CAD_LIMITS.maxBodies) !== 1) throw new CadError('invalid-solid', 'Result must contain exactly one nonempty solid');
    const check = scope.own(new oc.BRepCheck_Analyzer(shape, true, false, true));
    if (!check.IsValid()) throw new CadError('invalid-solid', 'BRepCheck_Analyzer rejected the shape');
    const properties = scope.own(new oc.GProp_GProps());
    oc.BRepGProp.VolumeProperties(shape, properties, true, false, false);
    const volume = properties.Mass();
    if (!Number.isFinite(volume) || volume <= 1e-12) throw new CadError('invalid-solid', 'Result must have positive finite volume');
    const bbox = scope.own(new oc.Bnd_Box());
    oc.BRepBndLib.AddOptimal(shape, bbox, false, false);
    const min = [bbox.GetXMin(), bbox.GetYMin(), bbox.GetZMin()] as const;
    const max = [bbox.GetXMax(), bbox.GetYMax(), bbox.GetZMax()] as const;
    if ([...min, ...max].some(n => !Number.isFinite(n) || Math.abs(n) > CAD_LIMITS.maxCoordinate + CAD_LIMITS.maxDimension + 1e-5) || min.some((n, i) => max[i] <= n)) throw new CadError('invalid-solid', 'Invalid measured bounds');
    const counts = {
      solids: 1 as const,
      faces: topology(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, CAD_LIMITS.maxFaces),
      edges: topology(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, CAD_LIMITS.maxEdges),
      vertices: topology(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, CAD_LIMITS.maxVertices),
    };
    if (!counts.faces || !counts.edges || !counts.vertices) throw new CadError('invalid-solid', 'Missing solid topology');
    // Boolean results may be a compound containing one solid. Reject loose surfaces/edges/vertices.
    const explorer = scope.own(new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID));
    const solid = scope.own(explorer.Current());
    if (counts.faces !== topology(oc, solid, oc.TopAbs_ShapeEnum.TopAbs_FACE, CAD_LIMITS.maxFaces) ||
        counts.edges !== topology(oc, solid, oc.TopAbs_ShapeEnum.TopAbs_EDGE, CAD_LIMITS.maxEdges) ||
        counts.vertices !== topology(oc, solid, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, CAD_LIMITS.maxVertices)) throw new CadError('invalid-solid', 'Result contains loose topology');
    return { valid: true, volume, bounds: { min, max }, topology: counts, kernel: KERNEL };
  } finally { scope.dispose(); }
}
function readStep(oc: OpenCascadeInstance, step: string): CadValidation {
  if (new TextEncoder().encode(step).byteLength > CAD_LIMITS.maxStepBytes) throw new CadError('resource-limit', 'STEP output limit exceeded');
  const scope = new Scope();
  try {
    oc.FS.writeFile('/cad-import.step', step);
    const reader = scope.own(new oc.STEPControl_Reader());
    if (reader.ReadFile('/cad-import.step') !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new CadError('kernel-failure', 'STEP reader failed');
    // OCCT numeric length units are expressed relative to millimeters: 1000 = one meter.
    reader.SetSystemLengthUnit(1000);
    if (reader.TransferRoots() !== 1) throw new CadError('invalid-solid', 'STEP must contain one transferable root');
    return validate(oc, scope.own(reader.OneShape()));
  } finally { scope.dispose(); try { oc.FS.unlink('/cad-import.step'); } catch { /* not created */ } }
}
/** Independent kernel reread, for offline round-trip tests. No HTTP import operation. */
export async function inspectStepMeters(step: string): Promise<CadValidation> {
  const oc = await init({ print: () => {}, printErr: () => {} });
  return readStep(oc, step);
}

/** All native ownership remains private. Successful registration is atomic and immutable. */
export async function createOpenCascadeAdapter(source: CadSource): Promise<CadAdapter> {
  const oc = await init({ print: () => {}, printErr: () => {} });
  const binding = Object.freeze({ ...source });
  const bodies = new Map<string, { shape: TopoDS_Shape; result: CadBodyResult }>();
  let closed = false;
  const get = (ref: CadBodyRef) => {
    const body = bodies.get(ref.bodyId);
    if (!body) throw new CadError('unknown-body', 'Unknown or deleted sandbox body');
    if (ref.bodyRevision !== body.result.body.bodyRevision) throw new CadError('stale-body', 'Body revision is stale');
    return body;
  };
  const publish = (shape: TopoDS_Shape, complexity: number): CadBodyResult => {
    try {
      const validation = validate(oc, shape);
      const result: CadBodyResult = { body: { bodyId: `cad-${crypto.randomUUID()}`, bodyRevision: 1 }, source: binding, units: 'm', complexity, ...validation };
      // Store a detached frozen plain result: callers cannot mutate the registry through a returned object.
      const stored = structuredClone(result);
      Object.freeze(stored.body); Object.freeze(stored.source); Object.freeze(stored.bounds.min); Object.freeze(stored.bounds.max);
      Object.freeze(stored.bounds); Object.freeze(stored.topology); Object.freeze(stored.kernel); Object.freeze(stored);
      bodies.set(result.body.bodyId, { shape, result: stored });
      return result;
    } catch (error) { shape.delete(); throw error; }
  };
  return {
    source: binding,
    async execute(input: CadOperation): Promise<CadResult> {
      if (closed) throw new CadError('closed', 'CAD sandbox is closed');
      const operation = canonicalCadOperation(input);
      const scope = new Scope();
      try {
        if (operation.kind === 'box' || operation.kind === 'cylinder' || operation.kind === 'boolean') {
          if (bodies.size >= CAD_LIMITS.maxBodies) throw new CadError('resource-limit', 'Stored body limit reached; delete bodies first');
        }
        if (operation.kind === 'box') {
          const [dx, dy, dz] = operation.dimensions, [x, y, z] = operation.center;
          const p = scope.own(new oc.gp_Pnt(x - dx / 2, y - dy / 2, z - dz / 2));
          const maker = scope.own(new oc.BRepPrimAPI_MakeBox(p, dx, dy, dz));
          return publish(maker.Solid(), 1);
        }
        if (operation.kind === 'cylinder') {
          const [x, y, z] = operation.center;
          const p = scope.own(new oc.gp_Pnt(x, y, z - operation.height / 2));
          const direction = scope.own(new oc.gp_Dir(0, 0, 1));
          const axes = scope.own(new oc.gp_Ax2(p, direction));
          const maker = scope.own(new oc.BRepPrimAPI_MakeCylinder(axes, operation.radius, operation.height));
          return publish(maker.Shape(), 1);
        }
        if (operation.kind === 'boolean') {
          const left = get(operation.left), right = get(operation.right);
          const complexity = left.result.complexity + right.result.complexity;
          if (complexity > CAD_LIMITS.maxBooleanComplexity) throw new CadError('resource-limit', 'Boolean complexity limit exceeded');
          const argumentsList = scope.own(new oc.NCollection_List_TopoDS_Shape()); argumentsList.Append(left.shape);
          const tools = scope.own(new oc.NCollection_List_TopoDS_Shape()); tools.Append(right.shape);
          const builder = scope.own(operation.operator === 'union' ? new oc.BRepAlgoAPI_Fuse() : operation.operator === 'subtract' ? new oc.BRepAlgoAPI_Cut() : new oc.BRepAlgoAPI_Common());
          builder.SetArguments(argumentsList); builder.SetTools(tools); builder.SetNonDestructive(true); builder.SetRunParallel(false);
          builder.Build();
          if (!builder.IsDone() || builder.HasErrors()) throw new CadError('invalid-solid', 'Boolean kernel operation failed');
          builder.SimplifyResult(true, true);
          return publish(builder.Shape(), complexity);
        }
        const body = get(operation.body);
        if (operation.kind === 'inspect') return structuredClone(body.result);
        if (operation.kind === 'delete') { bodies.delete(operation.body.bodyId); body.shape.delete(); return { deleted: true }; }
        if (operation.kind === 'tessellate') {
          const mesh = scope.own(oc.ReplicadMeshExtractor.extract(body.shape, CAD_LIMITS.meshTolerance, CAD_LIMITS.meshAngularTolerance, false));
          const nv = mesh.getVerticesSize(), nn = mesh.getNormalsSize(), nt = mesh.getTrianglesSize();
          if (nv === 0 || nt === 0 || nv % 3 || nt % 3 || nn !== nv || nv / 3 > CAD_LIMITS.maxMeshVertices || nt / 3 > CAD_LIMITS.maxMeshTriangles) throw new CadError('resource-limit', 'Tessellation output limit exceeded');
          const heap = oc.wasmMemory.buffer;
          const vertices = Array.from(new Float32Array(heap, mesh.getVerticesPtr(), nv));
          const normals = Array.from(new Float32Array(heap, mesh.getNormalsPtr(), nn));
          const triangles = Array.from(new Uint32Array(heap, mesh.getTrianglesPtr(), nt));
          if (vertices.some(n => !Number.isFinite(n)) || normals.some(n => !Number.isFinite(n)) || triangles.some(n => n >= nv / 3)) throw new CadError('kernel-failure', 'Invalid kernel tessellation');
          return { body: structuredClone(body.result.body), units: 'm', vertices, normals, triangles };
        }
        if (operation.kind === 'export-step') {
          const writer = scope.own(new oc.STEPControl_Writer());
          if (!oc.Interface_Static.SetCVal('xstep.cascade.unit', 'M') || !oc.Interface_Static.SetCVal('write.step.unit', 'M')) throw new CadError('kernel-failure', 'Cannot configure STEP meter units');
          const progress = scope.own(new oc.Message_ProgressRange());
          if (writer.Transfer(body.shape, oc.STEPControl_StepModelType.STEPControl_ManifoldSolidBrep, true, progress) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone ||
              writer.Write('/cad-export.step') !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new CadError('kernel-failure', 'STEP writer failed');
          const file = oc.FS.readFile('/cad-export.step');
          if (file.byteLength > CAD_LIMITS.maxStepBytes) throw new CadError('resource-limit', 'STEP output limit exceeded');
          const step = new TextDecoder().decode(file);
          if (!step.includes('SI_UNIT($,.METRE.)')) throw new CadError('kernel-failure', 'STEP has no explicit meter units');
          const roundtrip = readStep(oc, step), original = body.result;
          if (Math.abs(roundtrip.volume - original.volume) > Math.max(1e-9, original.volume * 1e-7) ||
            roundtrip.bounds.min.some((n, i) => Math.abs(n - original.bounds.min[i]) > 1e-6) ||
            roundtrip.bounds.max.some((n, i) => Math.abs(n - original.bounds.max[i]) > 1e-6)) throw new CadError('kernel-failure', 'STEP meter round-trip changed geometry');
          return { body: structuredClone(body.result.body), units: 'm', step };
        }
        throw new CadError('invalid-request', 'Unsupported CAD operation');
      } catch (error) {
        if (error instanceof CadError) throw error;
        // Unknown native failures force the server worker to reset; do not return pointers or OCCT messages.
        throw new CadError('kernel-failure', 'OpenCascade operation failed');
      } finally { scope.dispose(); try { oc.FS.unlink('/cad-export.step'); } catch { /* not created */ } }
    },
    dispose() { if (!closed) { closed = true; for (const body of bodies.values()) body.shape.delete(); bodies.clear(); } },
  };
}
