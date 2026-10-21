import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink, open, utimes, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { TORONTO_SEMANTIC_LABELS, TOOL_SCHEMA_VERSION, TOOL_VERSION, canonicalProtocolJson,
  type ToolRequest, type TorontoSemanticLabel, type NearestPoleRequest, type PreparedArtifactIdentity } from '@spatial/contracts';
import { ReadonlyToolRuntime, exportRunEvidence, parseRunEvidence, replayRunEvidence, EvidenceFailure,
  type ReplayEnvironment, type ReadonlyToolAdapter } from '../../packages/agent-harness/src/index';
import { prepareReadonlyTools } from '../../apps/server/src/agent/tool-adapter';
import { prepareArtifactEvidence, verifyArtifactEvidence, ArtifactEvidenceFailure, ARTIFACT_DIGEST_CHUNK_BYTES, RunEvidenceStore, sha256Protocol } from '../../apps/server/src/agent/tool-evidence';
import { PotreeDataset } from '../../apps/server/src/datasets/potree';
import { preparePoleIndex, queryIndexedClosestPole, dropPoleIndexMemoryCache } from '../../apps/server/src/spatial/pole-index';

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'spatial-tool-fixture-')));
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: 9, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-10, -10, 110], max: [10, 10, 130] }, scale: [.001, .001, .001], offset: [0, 0, 120], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-10, -10, 110], max: [10, 10, 130] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 },
    ] };
  const payload = Buffer.alloc(9 * 28);
  for (let label = 0; label < 9; label++) {
    payload.writeInt32LE(label * 1000, label * 28); payload.writeUInt16LE(1, label * 28 + 18);
    payload.writeUInt32LE(label, label * 28 + 20); payload.writeFloatLE(label, label * 28 + 24);
  }
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(9, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  await mkdir(join(root, 'octree')); await mkdir(join(root, 'evidence'), { mode: 0o700 });
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: [.001, .001, .001],
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS, sources: [1, 2, 3, 4].map(id => ({ source_file_id: id, file: `L00${id}.ply`, points: id === 1 ? 9 : 0 })) }));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  let cache: string | undefined;
  return { root, payload, index: async () => { cache = (await preparePoleIndex(root)).directory; },
    clean: async () => { dropPoleIndexMemoryCache(); if (cache) await rm(cache, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); } };
}
type Prepared = Awaited<ReturnType<typeof prepareReadonlyTools>>;
function request(prepared: Prepared, tool: ToolRequest['tool'], requestId = 'request', label: TorontoSemanticLabel = 6): ToolRequest {
  const common = { schemaVersion: TOOL_SCHEMA_VERSION, toolVersion: TOOL_VERSION, runId: 'evidence-run', requestId, binding: { ...prepared.binding } };
  if (tool === 'dataset.metadata') return { ...common, tool, args: {} };
  if (tool === 'dataset.observe') return { ...common, tool, args: { lod: { budget: 3, depth: 0 } } };
  return { ...common, tool, args: { input: { kind: 'coordinate', position: [0, 0, 120] }, filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: label }, metric: 'euclidean-3d', domain: { kind: 'whole-dataset' } } };
}
async function trace(prepared: Prepared) {
  const runtime = prepared.createRuntime('evidence-run');
  for (const tool of ['dataset.metadata', 'dataset.observe', 'dataset.nearest-label'] as const) await runtime.execute(request(prepared, tool, tool));
  return { runtime, text: prepared.exportEvidence(runtime) };
}
function modify(text: string, change: (value: Record<string, any>) => void): string {
  const value = JSON.parse(text); change(value); return JSON.stringify(value);
}

test('real tiny prepared fixture: three tools, all nine labels, AABB and point-reference preserve independent verification', async () => {
  const f = await fixture();
  try {
    const prepared = await prepareReadonlyTools(f.root, { codeVersion: 'test-code-v1' }); await f.index();
    const runtime = prepared.createRuntime('evidence-run');
    assert.equal((await runtime.execute(request(prepared, 'dataset.metadata', 'metadata'))).outcome.status, 'observed');
    const observed = await runtime.execute(request(prepared, 'dataset.observe', 'observation'));
    assert.equal(observed.outcome.status, 'observed');
    if (observed.outcome.status === 'observed' && observed.outcome.kind === 'observation') {
      assert.equal(observed.outcome.coverage, 'bounded-first-chunk-sample'); assert.deepEqual(observed.outcome.data.labels, [0, 3, 6]);
    }
    for (let label = 0; label < 9; label++) {
      const q = request(prepared, 'dataset.nearest-label', `label-${label}`, label as TorontoSemanticLabel);
      const answer = await runtime.execute(q);
      assert.equal(answer.outcome.status, 'verified-found', JSON.stringify(answer));
      if (answer.outcome.status !== 'verified-found') throw new Error('Fixture verification failed');
      assert.deepEqual(answer.outcome.nearest?.key, { sourceFileId: 1, sourceRow: label });
      assert.equal(answer.outcome.nearest?.distanceMeters, label);
      assert.equal(answer.outcome.search.algorithm, 'semantic-disk-page-index-v1');
      assert.equal(answer.outcome.verification.verifier, 'semantic-disk-page-verifier-v1');
      assert.equal(answer.outcome.search.disk?.coveredPoints, 9);
      assert.equal(answer.outcome.verification.disk?.coveredPoints, 9);
      if (q.tool !== 'dataset.nearest-label') throw new Error('Fixture');
      const empty = await runtime.execute({ ...q, requestId: `empty-${label}`, args: { ...q.args, domain: { kind: 'aabb', min: [-9, -9, 111], max: [-8, -8, 112] } } });
      assert.equal(empty.outcome.status, 'verified-none');
      const ref = await runtime.execute({ ...q, requestId: `ref-${label}`, args: { ...q.args, input: { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: label } },
        domain: { kind: 'aabb', min: [-1, -1, 119], max: [9, 1, 121] } } });
      assert.equal(ref.outcome.status, 'verified-found');
      if (ref.outcome.status === 'verified-found') assert.equal(ref.outcome.nearest?.distanceMeters, 0);
    }
  } finally { await f.clean(); }
});

test('streamed fixed-asset SHA-256 identity uses contents, bounded chunk constant and explicit cancellation/missing/symlink failures', async () => {
  const f = await fixture();
  try {
    const identity = await prepareArtifactEvidence(f.root);
    assert.equal(ARTIFACT_DIGEST_CHUNK_BYTES, 64 * 1024);
    for (const asset of identity.assets) {
      const contents = await readFile(join(f.root, asset.name)); assert.equal(asset.size, contents.length);
      assert.equal(asset.sha256, createHash('sha256').update(contents).digest('hex'));
    }
    assert.equal(identity.digest, sha256Protocol(canonicalProtocolJson(identity.assets)));
    assert.equal(await verifyArtifactEvidence(f.root, identity), 'matched');
    const before = await new PotreeDataset(f.root).info();
    // Fix mtime to an exactly representable millisecond, then change bytes without changing stat-derived revision.
    const path = join(f.root, 'octree/octree.bin'), stamp = new Date(1700000000000);
    await utimes(path, stamp, stamp); const stable = await prepareArtifactEvidence(f.root);
    const changed = Buffer.from(f.payload); changed[12] = 1; await writeFile(path, changed); await utimes(path, stamp, stamp);
    const after = await new PotreeDataset(f.root).info();
    assert.equal(stable.revision, after.revision); assert.notEqual(before.revision, stable.revision);
    const digestChanged = await prepareArtifactEvidence(f.root); assert.notEqual(digestChanged.digest, stable.digest);
    assert.equal(await verifyArtifactEvidence(f.root, stable), 'mismatch');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(prepareArtifactEvidence(f.root, controller.signal), (e: unknown) => e instanceof ArtifactEvidenceFailure && e.code === 'cancelled');
    assert.equal(await verifyArtifactEvidence(f.root, stable, controller.signal), 'cancelled');
    await rm(path); assert.equal(await verifyArtifactEvidence(f.root, stable), 'missing');
    await symlink(join(f.root, 'manifest.json'), path); assert.equal(await verifyArtifactEvidence(f.root, stable), 'mismatch');
  } finally { await f.clean(); }
});

test('digest crosses multiple bounded chunks and live cancellation never returns an identity', async () => {
  const f = await fixture();
  try {
    const count = 10000, payload = Buffer.alloc(count * 28);
    for (let i = 0; i < count; i++) { payload.writeUInt16LE(1, i * 28 + 18); payload.writeUInt32LE(i, i * 28 + 20); }
    const metadata = JSON.parse((await readFile(join(f.root, 'octree/metadata.json'))).toString()); metadata.points = count;
    const manifest = JSON.parse((await readFile(join(f.root, 'manifest.json'))).toString()); manifest.sources[0].points = count;
    const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(count, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
    await writeFile(join(f.root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(f.root, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(f.root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(f.root, 'octree/octree.bin'), payload);
    const identity = await prepareArtifactEvidence(f.root), asset = identity.assets[3];
    assert.ok(asset.size > ARTIFACT_DIGEST_CHUNK_BYTES * 4); assert.equal(asset.sha256, createHash('sha256').update(payload).digest('hex'));
    const controller = new AbortController(), pending = prepareArtifactEvidence(f.root, controller.signal);
    const timer = setTimeout(() => controller.abort(), 0);
    try { await assert.rejects(pending, (e: unknown) => e instanceof ArtifactEvidenceFailure && e.code === 'cancelled'); }
    finally { clearTimeout(timer); }
  } finally { await f.clean(); }
});

test('default bounded redacted evidence persists/loads and replay really executes after artifact verification', async () => {
  const f = await fixture();
  try {
    const prepared = await prepareReadonlyTools(f.root, { codeVersion: 'test-code-v1' }); await f.index();
    const { text } = await trace(prepared);
    for (const field of ['"positions"', '"colors"', '"sourceIds"', '"labels"', '"nodes"', '"reason"']) assert.ok(!text.includes(field), field);
    assert.ok(!text.includes(f.root));
    const saved = parseRunEvidence(text, sha256Protocol); assert.equal(saved.records.length, 3);
    assert.equal(saved.records[2].status, 'verified-found'); assert.ok(saved.records.every(r => r.semanticHash.length === 64));
    const store = new RunEvidenceStore(join(f.root, 'evidence'));
    await store.save('fixture', text); assert.equal(await store.load('fixture'), text); assert.deepEqual(await store.read('fixture'), saved);
    let executions = 0, verified = false;
    const env: ReplayEnvironment = { ...prepared, verifyArtifact: async (a, s) => { const v = await prepared.verifyArtifact(a, s); verified = v === 'matched'; return v; },
      createRuntime: id => { assert.ok(verified); const dataset = new PotreeDataset(f.root); return new ReadonlyToolRuntime(id, prepared.binding, prepared.configuration, {
        metadata: async () => { executions++; return dataset.info(); },
        observe: async (lod, signal) => { executions++; const o = await dataset.observe(lod, signal); return { ...o, bytesRead: o.bytesRead + 100 }; },
        nearest: async (r, signal) => { executions++; const o = await queryIndexedClosestPole(f.root, r, signal);
          if (o.status === 'verified-found' || o.status === 'verified-none') {
            return { ...o, search: { ...o.search, traversalHash: '0'.repeat(64) }, verification: { ...o.verification, transcriptHash: '0'.repeat(64) },
              sourceReads: { ...o.sourceReads!, metadataBytes: o.sourceReads!.metadataBytes + 100 } };
          }
          return o;
        },
      }, sha256Protocol); } };
    assert.deepEqual(await replayRunEvidence(await store.load('fixture'), env), { status: 'matched', outcomes: ['observed', 'observed', 'verified-found'] });
    assert.equal(executions, 3);
    const timing = modify(text, e => { for (const r of e.records) { r.metrics.durationMs = 99999; r.metrics.readBytes = 12345; } });
    assert.equal((await replayRunEvidence(timing, prepared)).status, 'matched');
    const tiny = new ReadonlyToolRuntime('evidence-run', prepared.binding, { ...prepared.configuration, budgets: { ...prepared.configuration.budgets, maxEvidenceBytes: 1 } },
      { metadata: async () => new PotreeDataset(f.root).info(), observe: async () => ({}), nearest: async () => ({}) }, sha256Protocol);
    await tiny.execute(request(prepared, 'dataset.metadata'));
    assert.throws(() => exportRunEvidence(tiny, 'test-code-v1', prepared.artifact), e => e instanceof EvidenceFailure && e.code === 'export-budget');
  } finally { await f.clean(); }
});

test('replay explicitly rejects schema/tool/code/config, malformed evidence and semantic/status tampering', async () => {
  const f = await fixture();
  try {
    const prepared = await prepareReadonlyTools(f.root, { codeVersion: 'test-code-v1' }); await f.index(); const { text } = await trace(prepared);
    let work = 0;
    const noExecution: ReplayEnvironment = { ...prepared, createRuntime: id => { work++; return prepared.createRuntime(id); } };
    for (const [change, status] of [
      [(e: Record<string, any>) => { e.schemaVersion = 'v2'; }, 'schema-mismatch'],
      [(e: Record<string, any>) => { e.evidenceVersion = 'v2'; }, 'schema-mismatch'],
      [(e: Record<string, any>) => { e.toolVersion = 'v2'; }, 'tool-mismatch'],
      [(e: Record<string, any>) => { e.codeVersion = 'different-code'; }, 'code-mismatch'],
      [(e: Record<string, any>) => { e.configuration.budgets.maxCalls = 63; e.configHash = sha256Protocol(canonicalProtocolJson(e.configuration)); }, 'config-mismatch'],
      [(e: Record<string, any>) => { e.configHash = '0'.repeat(64); }, 'malformed-evidence'],
      [(e: Record<string, any>) => { e.artifact.assets[0].name = '../../secret'; }, 'malformed-evidence'],
      [(e: Record<string, any>) => { e.records[0].call.args.extra = true; }, 'malformed-evidence'],
      [(e: Record<string, any>) => { e.records[0].exception = 'secret'; }, 'malformed-evidence'],
      [(e: Record<string, any>) => { e.records[1].call.binding.artifactDigest = '0'.repeat(64); }, 'malformed-evidence'],
      [(e: Record<string, any>) => { e.records[0].metrics.durationMs = 'NaN'; }, 'malformed-evidence'],
    ] as const) assert.equal((await replayRunEvidence(modify(text, change), noExecution)).status, status);
    assert.equal(work, 0);
    assert.equal((await replayRunEvidence('{', noExecution)).status, 'malformed-evidence');
    assert.equal((await replayRunEvidence(' '.repeat(4 * 1024 * 1024 + 1), noExecution)).status, 'malformed-evidence');
    assert.deepEqual(await replayRunEvidence(modify(text, e => { e.records[0].semanticHash = '0'.repeat(64); }), prepared), { status: 'outcome-mismatch', record: 0 });
    assert.deepEqual(await replayRunEvidence(modify(text, e => { e.records[0].status = 'verified-found'; }), prepared), { status: 'outcome-mismatch', record: 0 });
    assert.deepEqual(await replayRunEvidence(modify(text, e => { e.records[2].call.args.filter.value = 7; }), prepared), { status: 'outcome-mismatch', record: 2 });
    const alteredArtifact = modify(text, e => { e.artifact.assets[0].sha256 = '0'.repeat(64); e.artifact.digest = sha256Protocol(canonicalProtocolJson(e.artifact.assets));
      for (const r of e.records) r.call.binding.artifactDigest = e.artifact.digest; });
    assert.equal((await replayRunEvidence(alteredArtifact, prepared)).status, 'artifact-mismatch');
    const unknownSchema = modify(text, e => { e.records[0].call.schemaVersion = 'v2'; });
    assert.equal((await replayRunEvidence(unknownSchema, prepared)).status, 'malformed-evidence');
  } finally { await f.clean(); }
});

test('artifact mismatch/missing/symlink/cancellation gate replay before execution', async () => {
  const f = await fixture();
  try {
    const prepared = await prepareReadonlyTools(f.root, { codeVersion: 'test-code-v1' }); await f.index(); const { text } = await trace(prepared);
    let executions = 0; const env = { ...prepared, createRuntime: (id: string) => { executions++; return prepared.createRuntime(id); } };
    const aborted = new AbortController(); aborted.abort(); assert.equal((await replayRunEvidence(text, env, aborted.signal)).status, 'cancelled');
    const path = join(f.root, 'octree/octree.bin'), file = await open(path, 'r+');
    try { await file.write(Buffer.from([1]), 0, 1, 12); } finally { await file.close(); }
    assert.equal((await replayRunEvidence(text, env)).status, 'artifact-mismatch');
    await rm(path); assert.equal((await replayRunEvidence(text, env)).status, 'artifact-missing');
    await symlink(join(f.root, 'manifest.json'), path); assert.equal((await replayRunEvidence(text, env)).status, 'artifact-mismatch'); assert.equal(executions, 0);
  } finally { await f.clean(); }
});

test('matching rejected/incomplete/error runs replay but never become verified success; arbitrary text redacted', async () => {
  const f = await fixture();
  try {
    const prepared = await prepareReadonlyTools(f.root, { codeVersion: 'test-code-v1' });
    const adapter: ReadonlyToolAdapter = { metadata: async () => { throw new Error('credential=secret/private/path'); },
      observe: async () => ({ status: 'incomplete', complete: false, reason: 'resource' }),
      nearest: async (_r: NearestPoleRequest) => ({ status: 'verification-rejected', reason: 'credential=secret/private/path' }) };
    const env: ReplayEnvironment = { ...prepared, createRuntime: id => new ReadonlyToolRuntime(id, prepared.binding, prepared.configuration, adapter, sha256Protocol) };
    const runtime = env.createRuntime('evidence-run');
    for (const tool of ['dataset.metadata', 'dataset.observe', 'dataset.nearest-label'] as const) await runtime.execute(request(prepared, tool, tool));
    const text = exportRunEvidence(runtime, prepared.codeVersion, prepared.artifact);
    assert.ok(!text.includes('credential')); assert.ok(!text.includes('secret')); assert.ok(!text.includes('private/path'));
    assert.deepEqual(await replayRunEvidence(text, env), { status: 'matched', outcomes: ['error', 'incomplete', 'verification-rejected'] });
  } finally { await f.clean(); }
});

test('persistence rejects path IDs, symlinks, oversized/invalid JSON and preserves constrained roundtrips', async () => {
  const f = await fixture();
  try {
    const prepared = await prepareReadonlyTools(f.root, { codeVersion: 'test-code-v1' });
    const runtime = prepared.createRuntime('evidence-run'); await runtime.execute(request(prepared, 'dataset.metadata'));
    const text = prepared.exportEvidence(runtime), directory = join(f.root, 'evidence'), store = new RunEvidenceStore(directory);
    await assert.rejects(store.save('../escape', text)); await assert.rejects(store.load('../escape'));
    await assert.rejects(store.save('invalid', '{}')); await assert.rejects(new RunEvidenceStore(directory, 1).save('small', text));
    await writeFile(join(directory, 'bad.json'), '{}'); await assert.rejects(store.load('bad'));
    await writeFile(join(directory, 'oversized.json'), ' '.repeat(4 * 1024 * 1024 + 1)); await assert.rejects(store.load('oversized'));
    await store.save('valid', text); await symlink(join(directory, 'valid.json'), join(directory, 'link.json')); await assert.rejects(store.load('link'));
    await store.save('link', text); assert.equal(await store.load('link'), text); // Atomic rename replaces, never follows, a destination symlink.
    const identity: PreparedArtifactIdentity = { ...prepared.artifact, digest: '0'.repeat(64) };
    assert.throws(() => exportRunEvidence(runtime, prepared.codeVersion, identity));
    assert.throws(() => exportRunEvidence(runtime, prepared.codeVersion, { ...prepared.artifact, assets: new Array<PreparedArtifactIdentity['assets'][number]>(4) }));
  } finally { await f.clean(); }
});
