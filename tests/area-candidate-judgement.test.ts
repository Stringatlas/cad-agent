import test from 'node:test';
import { withProductSkills } from './helpers/product-skill-transport';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AreaCandidateJudgement } from '../apps/server/src/area-candidate-judgement';
import { ProviderModel, type BoundModelScene, type ModelAuth } from '../apps/server/src/provider-model';
import { validateAreaCandidateResult } from '../apps/web/src/area-candidate-client';
import type { AreaCandidateResult, ModelCaptureRequest, ModelChatEvent, ModelVisualObservation } from '@spatial/contracts';
const hash = 'a'.repeat(64);
function pool(): AreaCandidateResult {
  return { status: 'complete', area: { datasetId: 'toronto3d', artifactRevision: hash, frameId: 'toronto3d-local-v1', units: 'm', localOrigin: [627285,4841948,0], corners: [[0,0,0],[100,0,0],[100,100,0],[0,100,0]] },
    candidates: [1,2,3].map(rank => ({ id: `evidence-${rank}`, rank, position: [rank * 5, 5, 0], groundPoints: 20, groundReliefMeters: .02, observedObstacleCells: 0, poleDistanceMeters: null })),
    settings: { maxCandidates: 20, spacingMeters: 2, clearanceRadiusMeters: .5, maxGroundReliefMeters: .25, minPoleDistanceMeters: 0, ranking: 'flat-ground' },
    binding: { artifactRevision: hash, indexHash: hash, sourceHash: hash, pointAuthority: { sessionId: 'points', revision: 0 }, cadAuthority: { sessionId: 'cad', revision: 0 } },
    evidence: { pagesRead: 1, sourcePointsExamined: 1000, areaPoints: 1000, cellsEvaluated: 50, elapsedMilliseconds: 5, cellMeters: 1 }, limitations: ['Observed source only'] };
}
function image(request: ModelCaptureRequest, result: AreaCandidateResult): ModelVisualObservation {
  assert.equal(request.kind, 'camera'); if (request.kind !== 'camera') throw Error();
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 10000);
  camera.position.set(...request.position); camera.up.set(...request.up!); camera.lookAt(new THREE.Vector3(...request.target)); camera.updateMatrixWorld(true);
  return { schemaVersion: 1, observationId: 'image-id', viewGeneration: 0,
    image: { mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA', byteLength: 3, sha256: hash }, viewport: { width: 500, height: 500, pixelRatio: 1, pixelOrigin: 'top-left' },
    binding: { sourceId: 'toronto3d', sourceRevision: hash, frameId: 'toronto3d-local-v1', units: 'm', origin: [627285,4841948,0], upAxis: 'z', handedness: 'right' },
    camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: camera.up.toArray(), near: .1, far: 10000, fov: 60, aspect: 1, zoom: 1, matrixWorld: camera.matrixWorld.toArray(), matrixWorldInverse: camera.matrixWorldInverse.toArray(), projectionMatrix: camera.projectionMatrix.toArray() },
    coverage: { kind: 'fixture', complete: false, displayedPointCount: 1000, areaCandidateEvidence: { scanId: result.assessment!.scanId, nearby: result.candidates.map(c => ({ id: c.id, count: 10 })) } } };
}
const selection = (candidateId: string) => ({ candidateId, rationale: 'Visible open approach; supported observed ground at this coordinate.', uncertainty: 'Occluded surfaces and buried utilities unknown.' });
function retained() { const judge = new AreaCandidateJudgement(), result = judge.retain(pool()), request = judge.captureRequest()!, captured = image(request, result); return { judge, result, request, captured }; }
test('model picks/reorders a strict subset, final count/order and rationale survive UI validation', () => {
  const f = retained(), receipt = f.judge.capture(f.request, f.captured, 2)!;
  assert.ok(receipt); const result = f.judge.finalize({ scanId: f.result.assessment!.scanId, captureId: receipt, selections: [selection('evidence-3'), selection('evidence-1')] }, 3);
  assert.equal(result.assessment!.kind, 'model-assessed'); assert.deepEqual(result.candidates.map(c => [c.id,c.rank]), [['evidence-3',1],['evidence-1',2]]);
  assert.equal(validateAreaCandidateResult(result).candidates.length, 2);
  assert.equal(f.result.assessment!.kind, 'provisional'); assert.equal(f.result.candidates.length, 3);
});
test('invented/duplicate IDs, empty reasons, wrong scan/receipt, no capture, same-round premature judgement rejected', () => {
  const f = retained(); const args = { scanId: f.result.assessment!.scanId, captureId: 'invented', selections: [selection('evidence-1')] };
  assert.throws(() => f.judge.finalize(args, 3)); const captureId = f.judge.capture(f.request, f.captured, 2)!;
  const valid = { ...args, captureId };
  for (const bad of [{ ...valid, scanId: 'old-scan' }, { ...valid, selections: [selection('invented')] }, { ...valid, selections: [selection('evidence-1'),selection('evidence-1')] }, { ...valid, selections: [{ ...selection('evidence-1'), rationale: '' }] }, { ...valid, selections: [] }]) assert.throws(() => f.judge.finalize(bad, 3));
  assert.throws(() => f.judge.finalize(valid, 2));
  f.judge.retain(pool()); assert.throws(() => f.judge.finalize(valid, 4));
});
test('unrelated view, missing geometry, wrong source/scan or cropped-away image cannot produce an assessed receipt', () => {
  const f = retained();
  for (const captured of [undefined, { ...f.captured, binding: { ...f.captured.binding, sourceRevision: 'old' } }, { ...f.captured, coverage: { kind: 'empty', complete: false, displayedPointCount: 0 } }, { ...f.captured, crop: { x: 1, y: 0, width: 499, height: 500, outputWidth: 499, outputHeight: 500 } }, { ...f.captured, coverage: { ...f.captured.coverage, areaCandidateEvidence: { scanId: f.result.assessment!.scanId, nearby: [{ id: 'evidence-1', count: 0 }] } } }]) assert.equal(f.judge.capture(f.request, captured, 2), undefined);
  assert.equal(f.judge.capture({ kind: 'current' }, f.captured, 2), undefined);
});
const tool = (name: string, args: unknown, call_id = name) => ({ type: 'function_call', namespace: 'scene', name, call_id, arguments: JSON.stringify(args) });
const response = (output: unknown[]) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
async function providerFixture(options: { unavailable?: boolean; stale?: boolean; premature?: boolean } = {}) {
  const requests: any[] = [], events: ModelChatEvent[] = []; let scan: AreaCandidateResult | undefined, receipt: string | undefined, checks = 0;
  const auth = { status: () => ({ mode: 'api-key', ready: true, authenticated: true }), credentialGeneration: () => 'generation', onCredentialChange: () => () => {}, credential: async () => ({ mode: 'api-key', bearer: 'fake', constraints: { billing: 'api-key', responsesOnly: false } }) } as unknown as ModelAuth;
  const model = new ProviderModel(auth, withProductSkills(async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'mock-model' }] });
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (requests.length === 1) return response([tool('scan_area_candidates', { settings: pool().settings })]);
    if (requests.length === 2) {
      const output = JSON.parse(body.input.findLast((i: any) => i.type === 'function_call_output').output);
      scan = output.result;
      const capture = tool('capture_scene', output.candidateAssessmentCapture);
      return response(options.premature ? [capture, tool('finalize_area_candidates', { scanId: scan!.assessment!.scanId, captureId: 'unknown', selections: [selection('evidence-3')] })] : [capture]);
    }
    if (options.unavailable) return response([]);
    // This request contains the actual input_image, not merely a hash or promise.
    assert.ok(body.input.some((i: any) => i.role === 'user' && Array.isArray(i.content) && i.content.some((c: any) => c.type === 'input_image' && c.image_url.startsWith('data:image/png;base64,'))));
    if (requests.length === 3) {
      const capture = JSON.parse(body.input.findLast((i: any) => i.type === 'function_call_output').output);
      receipt = capture.candidateCaptureId; assert.ok(receipt);
      return response([tool('finalize_area_candidates', { scanId: scan!.assessment!.scanId, captureId: receipt, selections: [selection('evidence-3'), selection('evidence-1')] })]);
    }
    return response([]);
  }, ['area-candidates']));
  const scene: BoundModelScene = { context: {}, check: async () => {}, close: async () => {}, scanAreaCandidates: async () => pool(),
    checkAreaCandidates: async () => { checks++; if (options.stale && checks > 1) throw Error('stale source/authority'); },
    captureScene: async request => options.unavailable ? undefined : image(request, scan!) };
  await model.models(new AbortController().signal);
  try { await model.turn({ requestId: 'judgement-request', conversationId: null, generation: 'generation', model: 'mock-model', text: 'Choose the best two locations', scene: { mode: 'toronto', project: null, toronto: [], areaOfInterest: pool().area } }, scene, async e => { events.push(e); }, new AbortController().signal); }
  finally { model.close(); }
  return { requests, events, checks };
}
test('mock provider scan → targeted image delivered → model subset judgement → final UI tool event', async () => {
  const f = await providerFixture(); const tools = f.events.filter(e => e.kind === 'tool');
  assert.deepEqual(tools.map(e => e.name), ['load_skill','scan_area_candidates','capture_scene','finalize_area_candidates']);
  const result = (tools.at(-1)!.context as { result: AreaCandidateResult }).result;
  assert.deepEqual(validateAreaCandidateResult(result).candidates.map(c => c.id), ['evidence-3','evidence-1']); assert.ok(f.checks >= 3);
});
test('unavailable image leaves only provisional evidence; stale guard and capture+judgement same response fail closed', async () => {
  const f = await providerFixture({ unavailable: true });
  const tools = f.events.filter(e => e.kind === 'tool'); assert.equal(tools.some(e => e.name === 'finalize_area_candidates'), false);
  assert.equal((tools.find(e => e.name === 'scan_area_candidates')!.context as { result: AreaCandidateResult }).result.assessment!.kind, 'provisional');
  await assert.rejects(providerFixture({ stale: true })); await assert.rejects(providerFixture({ premature: true }));
});
