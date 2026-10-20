import { randomUUID } from 'node:crypto';
import { CAD_LIMITS, CadError, canonicalCadOperation, canonicalResolvedPlacementSpecification, type ModelAreaOfInterest, type PointOverrideSnapshot, type ResolvedPlacementSpecification, type TorontoCadProposal, type TorontoCadSnapshot, type Vec3 } from '@spatial/contracts';
import { SemanticArtifact, digest } from './semantic-artifact';
import { readPreprocessing } from './preprocessing-summary';
import { loadPreparedSemanticDiskIndex } from './semantic-disk-index';
import { PointOverrideSession } from './point-overrides';
import { TorontoCadError, TorontoCadSession } from './toronto-cad-session';
import { searchPlacement, type PlacementSearchResult } from './placement-search';

export interface PlacementSearchSettings {
  readonly dimensions: Vec3; readonly frontAccessDepth: number; readonly poleSeparation: number;
  readonly maxGroundSlopeDegrees: number; readonly maxGroundRelief: number; readonly spacingMeters: number; readonly allowedYawDegrees: readonly number[];
}
export interface PlacementSearchRequest { readonly area: ModelAreaOfInterest; readonly settings: PlacementSearchSettings }
export interface PlacementSearchResponse extends PlacementSearchResult { readonly searchId: string; readonly specification: ResolvedPlacementSpecification }
const TTL = 5 * 60_000;
const budgets = { maxPoses: 5000, limit: 5, diversityMeters: 2 } as const;
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TorontoCadError('invalid-request');
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k))) throw new TorontoCadError('invalid-request');
  return r;
}
function request(value: unknown): PlacementSearchRequest {
  const r = record(value, ['area', 'settings']);
  record(r.area, ['datasetId', 'artifactRevision', 'frameId', 'units', 'localOrigin', 'corners']);
  const s = record(r.settings, ['dimensions', 'frontAccessDepth', 'poleSeparation', 'maxGroundSlopeDegrees', 'maxGroundRelief', 'spacingMeters', 'allowedYawDegrees']);
  if (typeof s.spacingMeters !== 'number' || !Number.isFinite(s.spacingMeters) || s.spacingMeters <= 0 || s.spacingMeters > 1000 ||
      !Array.isArray(s.allowedYawDegrees) || !s.allowedYawDegrees.length || s.allowedYawDegrees.length > 4 || s.allowedYawDegrees.some(y => ![0, 90, 180, 270].includes(y))) throw new TorontoCadError('invalid-request');
  // Validate the native operation envelope before any source/terrain work. Access
  // dimensions are placement semantics, not native body dimensions.
  try { canonicalCadOperation({ kind: 'box', center: [0, 0, 0], dimensions: s.dimensions }); }
  catch (error) { throw new TorontoCadError(error instanceof CadError && error.code === 'resource-limit' ? 'resource-limit' : 'invalid-request'); }
  return structuredClone(r) as unknown as PlacementSearchRequest;
}

/** Single retained shortlist; original-source search refuses effective edits and never rebases. */
export class PlacementSearchSession {
  private retained?: { response: PlacementSearchResponse; spacingMeters: number; expires: number };
  private expiry?: ReturnType<typeof setTimeout>;
  private active = false;
  private closed = false;
  private drained: Promise<void> = Promise.resolve();
  private finish?: () => void;
  private readonly controllers = new Set<AbortController>();
  constructor(private readonly directory: string, private readonly points: PointOverrideSession, private readonly cad: TorontoCadSession) {}
  private clear() { this.retained = undefined; clearTimeout(this.expiry); this.expiry = undefined; }
  private async admitted<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) throw new TorontoCadError('unavailable');
    if (this.active) throw new TorontoCadError('busy');
    this.active = true;
    this.drained = new Promise(resolve => { this.finish = resolve; });
    const controller = new AbortController(); this.controllers.add(controller);
    try { return await work(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal); }
    finally { this.active = false; this.controllers.delete(controller); this.finish?.(); this.finish = undefined; }
  }
  private async authorities(signal: AbortSignal) {
    const points = await this.points.execute('snapshot', undefined, signal) as PointOverrideSnapshot;
    const cad = await this.cad.execute('snapshot', undefined, signal) as TorontoCadSnapshot;
    if (points.entries.length || cad.bodies.length) throw new TorontoCadError('stale-revision');
    return { points, cad };
  }
  /** No await between these guards and the caller's publication/admission. */
  private assertAuthorities(spec: ResolvedPlacementSpecification): void {
    const b = spec.parameters.binding;
    this.points.assertOriginalBinding({ ...b.pointAuthority, artifactRevision: b.artifactRevision });
    this.cad.assertOriginalBinding({ ...b.cadAuthority, artifactRevision: b.artifactRevision });
  }
  private async check(spec: ResolvedPlacementSpecification, signal: AbortSignal, checkCad = true) {
    signal.throwIfAborted(); const b = spec.parameters.binding;
    const artifact = await SemanticArtifact.open(this.directory, signal);
    try {
      if (artifact.dataset.revision !== b.artifactRevision || digest(JSON.stringify(await readPreprocessing(artifact.dataset, undefined, signal))) !== b.terrainRevision) throw new TorontoCadError('stale-artifact');
      await artifact.check(signal);
    } finally { await artifact.close(); }
    const checkPoints = async () => {
      const p = await this.points.execute('snapshot', undefined, signal) as PointOverrideSnapshot;
      if (p.sessionId !== b.pointAuthority.sessionId || p.revision !== b.pointAuthority.revision || p.entries.length) throw new TorontoCadError('stale-revision');
      if (p.artifactRevision !== b.artifactRevision) throw new TorontoCadError('stale-artifact');
    };
    await checkPoints();
    if (checkCad) {
      const c = await this.cad.execute('snapshot', undefined, signal) as TorontoCadSnapshot;
      if (c.sessionId !== b.cadAuthority.sessionId || c.revision !== b.cadAuthority.revision || c.bodies.length) throw new TorontoCadError('stale-revision');
      // CAD snapshots perform asynchronous kernel/source validation. Recheck
      // points afterwards rather than publishing the earlier point snapshot.
      await checkPoints();
    }
    signal.throwIfAborted();
  }
  async search(body: unknown, signal?: AbortSignal): Promise<PlacementSearchResponse> {
    const input = request(body);
    return this.admitted(signal, async signal => {
      this.clear();
      const artifact = await SemanticArtifact.open(this.directory, signal);
      let response: PlacementSearchResponse;
      try {
        const { points, cad } = await this.authorities(signal), area = input.area, settings = input.settings;
        if (area.datasetId !== 'toronto3d' || area.frameId !== 'toronto3d-local-v1' || area.units !== 'm' ||
            !Array.isArray(area.localOrigin) || area.localOrigin.length !== 3 || area.localOrigin.some((n, i) => n !== artifact.dataset.coordinates.localOrigin[i])) throw new TorontoCadError('invalid-request');
        if (area.artifactRevision !== artifact.dataset.revision) throw new TorontoCadError('stale-artifact');
        const terrain = await readPreprocessing(artifact.dataset, undefined, signal), disk = await loadPreparedSemanticDiskIndex(artifact, signal);
        if (!disk || terrain.binding.indexHash !== disk.hash || terrain.binding.sourceHash !== disk.sourceHash) throw new TorontoCadError('stale-artifact');
        let specification: ResolvedPlacementSpecification;
        try {
          specification = canonicalResolvedPlacementSpecification({ schemaVersion: 1, parameters: {
            binding: { datasetId: 'toronto3d', artifactRevision: artifact.dataset.revision, terrainRevision: digest(JSON.stringify(terrain)), frameId: 'toronto3d-local-v1', units: 'm', localOrigin: area.localOrigin,
              pointAuthority: { sessionId: points.sessionId, revision: points.revision }, cadAuthority: { sessionId: cad.sessionId, revision: cad.revision } },
            area: { corners: area.corners }, dimensions: settings.dimensions, frontAccessDepth: settings.frontAccessDepth, frontAccessHeight: settings.dimensions?.[2],
            poleSeparation: settings.poleSeparation, poleDistance: { from: 'box-boundary', metric: 'horizontal', to: 'observed-pole-points' },
            maxGroundSlopeDegrees: settings.maxGroundSlopeDegrees, maxGroundRelief: settings.maxGroundRelief, groundMeasurement: 'sampled-plane-slope-and-height-range',
            allowedYawDegrees: settings.allowedYawDegrees, containment: 'footprint-and-access', maxBodyConflicts: 0, maxAccessConflicts: 0,
            ranking: [{ metric: 'ground-slope', direction: 'minimize' }, { metric: 'ground-relief', direction: 'minimize' }, { metric: 'pole-separation', direction: 'maximize' }]
          }, assumptions: [
            { field: 'frontAccessHeight', reason: 'Access height equals the requested box height.' },
            { field: 'poleDistance', reason: 'Horizontal distance from box boundary to original observed Pole points.' },
            { field: 'containment', reason: 'Both footprint and front access must fit inside the AOI.' },
            { field: 'maxBodyConflicts', reason: 'No observed body conflicts permitted.' }, { field: 'maxAccessConflicts', reason: 'No observed access conflicts permitted.' },
            { field: 'ranking', reason: 'Lexicographic: slope minimum, relief minimum, pole separation maximum.' }
          ] });
        } catch { throw new TorontoCadError('invalid-request'); }
        if (specification.parameters.area.corners.some(corner => corner.slice(0, 2).some(n => Math.abs(n) > CAD_LIMITS.maxCoordinate))) throw new TorontoCadError('resource-limit');
        const result = await searchPlacement(artifact, specification, { ...budgets, spacingMeters: settings.spacingMeters, signal });
        // Terrain determines Z, independently of the AOI's display-plane height.
        // Never advertise an exact operation the native proposal route rejects.
        for (const candidate of result.candidates) {
          try { canonicalCadOperation(candidate.operation); }
          catch (error) { throw new TorontoCadError(error instanceof CadError && error.code === 'resource-limit' ? 'resource-limit' : 'invalid-request'); }
        }
        response = { ...result, ...(result.reason ? { reason: signal.aborted ? 'cancelled' : 'placement-search-incomplete' } : {}), searchId: randomUUID(), specification,
          limitations: [...result.limitations, `Server budget: spacing ${settings.spacingMeters}m; at most 5000 poses, 5 shortlisted sites, 2m center diversity. Only the latest search is retained, for 5 minutes.`] };
      } finally { await artifact.close(); }
      // No source/terrain/close I/O may follow the final authority validation.
      await this.check(response.specification, signal);
      signal.throwIfAborted();
      // Async snapshots alone cannot establish an atomic pair of authorities.
      this.assertAuthorities(response.specification);
      if (response.status === 'complete') {
        this.retained = { response: structuredClone(response), spacingMeters: input.settings.spacingMeters, expires: Date.now() + TTL };
        this.expiry = setTimeout(() => this.clear(), TTL); this.expiry.unref();
      }
      return response;
    });
  }
  async propose(body: unknown, signal?: AbortSignal): Promise<TorontoCadProposal> {
    const r = record(body, ['searchId', 'candidateId']);
    if (typeof r.searchId !== 'string' || r.searchId.length > 100 || typeof r.candidateId !== 'string' || r.candidateId.length > 100) throw new TorontoCadError('invalid-request');
    const { searchId, candidateId } = r;
    return this.admitted(signal, async signal => {
      const held = this.retained;
      if (!held || Date.now() >= held.expires || held.response.searchId !== searchId) { if (held && Date.now() >= held.expires) this.clear(); throw new TorontoCadError('stale-revision'); }
      const candidate = held.response.candidates.find(c => c.id === candidateId);
      if (!candidate) throw new TorontoCadError('invalid-request');
      const spec = held.response.specification;
      await this.check(spec, signal);
      const artifact = await SemanticArtifact.open(this.directory, signal);
      try {
        const current = await searchPlacement(artifact, spec, { ...budgets, spacingMeters: held.spacingMeters, signal });
        const exact = current.candidates.find(c => c.id === candidate.id);
        // Wall-clock query diagnostics are not placement metrics and vary per execution.
        const deterministic = (value: unknown) => JSON.stringify(value, (key, item) => key === 'milliseconds' ? undefined : item);
        if (current.status !== 'complete' || deterministic(exact) !== deterministic(candidate) || JSON.stringify(current.binding) !== JSON.stringify(held.response.binding)) throw new TorontoCadError('stale-artifact');
      } finally { await artifact.close(); }
      await this.check(spec, signal);
      this.assertAuthorities(spec);
      // The CAD authority checks its own exact session/revision at proposal and approval.
      // Capture no request or shortlist lifetime: approval remains guarded after expiry/close.
      const directory = this.directory, points = this.points, binding = structuredClone(spec.parameters.binding);
      const approvalCheck = async (incomingSignal?: AbortSignal) => {
        const signal = AbortSignal.any([incomingSignal ?? new AbortController().signal, AbortSignal.timeout(5000)]);
        const source = await SemanticArtifact.open(directory, signal);
        try {
          if (source.dataset.revision !== binding.artifactRevision ||
              digest(JSON.stringify(await readPreprocessing(source.dataset, undefined, signal))) !== binding.terrainRevision) throw new TorontoCadError('stale-artifact');
          await source.check(signal);
        } catch { throw new TorontoCadError('stale-artifact'); } finally { await source.close(); }
        // Last awaited precondition: a point edit during terrain I/O cannot slip through.
        let p: PointOverrideSnapshot;
        try { p = await points.execute('snapshot', undefined, signal) as PointOverrideSnapshot; }
        catch { throw new TorontoCadError('stale-revision'); }
        if (p.sessionId !== binding.pointAuthority.sessionId || p.revision !== binding.pointAuthority.revision || p.entries.length || p.artifactRevision !== binding.artifactRevision) throw new TorontoCadError('stale-revision');
        // A snapshot can become stale before its promise resumes. CAD's own busy
        // gate protects CAD here; only points need the final synchronous barrier.
        try { points.assertOriginalBinding({ ...binding.pointAuthority, artifactRevision: binding.artifactRevision }); }
        catch { throw new TorontoCadError('stale-revision'); }
      };
      const proposal = await this.cad.execute('propose', { sessionId: binding.cadAuthority.sessionId, revision: binding.cadAuthority.revision,
        artifactRevision: binding.artifactRevision, operation: candidate.operation }, signal, approvalCheck) as TorontoCadProposal;
      // Fail closed if point/terrain changed during native creation; the retained proposal's
      // independent approval guard still prevents acceptance even if this response is lost.
      await approvalCheck(signal); signal.throwIfAborted();
      this.assertAuthorities(spec);
      return proposal;
    });
  }
  async close(): Promise<void> { this.closed = true; this.clear(); for (const c of this.controllers) c.abort(); await this.drained; }
}
