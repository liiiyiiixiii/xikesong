import type { SampleV2, DeviceEventV2 } from '@zhishan/contracts/v2/telemetry';
import { cycleSchema, type Cycle, type OperationRequest } from '@zhishan/contracts/v2/operations';

export const MEASUREMENT_ALGORITHM = 'cycle_balance_v2-mg-3' as const;
export type MeasurementBinding = {
  id: string; scaleId: string; dishId: string; validFrom: string; validTo: string | null;
  tareG: number; fullFoodG: number; foodOnly: boolean;
};
export type MeasurementSample = { id: string; sample: SampleV2; receivedAt: string };
export type ManualMeasurementBoundary = {
  eventId: string; scaleId: string; occurredAt: string; type: 'exit_kitchen' | 'enter_kitchen';
  sampleRef?: { bootId: string; sequence: number };
};
export type MeasurementEvent = { event: DeviceEventV2 | ManualMeasurementBoundary; receivedAt: string; origin: 'device' | 'manual' };
/** matched is a server attestation: the operation and its evidence were checked upstream. */
export type MeasurementOperation = { id: string; version: number; input: OperationRequest; status: 'recorded' | 'matched' | 'pending_review'; recordedAt: string };
export type MeasurementConfig = {
  boundaryWindowMs: number | null; maxSampleGapMs: number; freshMs: number;
  /** Independent expiry of boundary location evidence. Unconfigured means unknown. */
  locationFreshMs?: number | null;
  stableWindowMs: number; stableMinSamples: number; stableToleranceG: number;
  negativeToleranceG: number; maxStepG: number | null; timeZone: string; ruleVersion: string;
};
export type MeasurementInput = {
  binding: MeasurementBinding; samples: readonly MeasurementSample[]; events: readonly MeasurementEvent[];
  operations: readonly MeasurementOperation[]; asOf: string; version: number; config: MeasurementConfig;
  /** Last known device fault/recovery before this binding. Never rewrite its time. */
  priorFault?: MeasurementEvent | null;
  kitchenRefills?: readonly { enteredAt: string; exitedAt: string | null }[];
};
type Reason = Cycle['qualityReasons'][number];
type Boundary = MeasurementEvent & { event: ManualMeasurementBoundary };
type EffectiveOperation = MeasurementOperation & { lineage: string[] };
export type CycleCalculation = {
  cycleId: string; evidenceBundleId: string; evidenceIds: string[]; operationIds: string[];
  rawBalanceMg: number | null; toleranceMg: number; appliedToleranceMg: number;
  increaseMg: number; nonCustomerDecreaseMg: number; foodRefillMg: number;
  blockingReasons: Reason[]; closingDate: string | null; crossDay: boolean;
  algorithmVersion: typeof MEASUREMENT_ALGORITHM; ruleVersion: string; asOf: string;
};
export type MeasurementObservation = {
  loadNetG: number | null; foodRemainingG: number | null; estimatedFoodG: number | null;
  confirmedFoodG: number | null; observedAt: string | null; confirmedAt: string | null;
  quality: 'good' | 'estimated' | 'stale' | 'offline' | 'removed' | 'unstable' | 'pending';
  evidenceIds: string[]; zone: 'kitchen' | 'customer' | 'unknown';
  locationQuality: 'verified' | 'manual' | 'stale' | 'unknown'; locationObservedAt: string | null;
};
export type BoundaryResult = { eventId: string; cycleId: string; sampleId: string | null; processingStatus: 'applied' | 'waiting_sample' | 'pending_review' };
export type MeasurementProjection = { cycles: Cycle[]; cycleCalculations: CycleCalculation[]; observation: MeasurementObservation; boundaryResults: BoundaryResult[] };

export function gramsToMg(value: number): number {
  const mg = Math.round(value * 1000);
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000 || !Number.isSafeInteger(mg) || Math.abs(value * 1000 - mg) >= .00001) throw new Error('Invalid gram precision or range');
  return mg;
}
export function mgToGrams(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error('Unsafe milligram total');
  return value / 1000;
}
function sum(values: number[]) { const n = values.reduce((a, b) => a + b, 0); if (!Number.isSafeInteger(n)) throw new Error('Unsafe milligram total'); return n; }
function at(value: string) { const n = Date.parse(value); if (!Number.isFinite(n)) throw new Error('Invalid measurement time'); return n; }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
function unique<T>(values: readonly T[], key: (v: T) => string, payload: (v: T) => unknown): T[] {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = key(value), old = result.get(id);
    if (old && canonical(payload(old)) !== canonical(payload(value))) throw new Error(`Conflicting measurement identity: ${id}`);
    // Receipt order is not evidence order. Repeated records choose the same receipt
    // under any input permutation, preferring the earliest known receipt.
    const rank = (v: T) => { const r = v as { receivedAt?: string }; return r.receivedAt ? at(r.receivedAt) : 0; };
    if (!old || rank(value) < rank(old) || rank(value) === rank(old) && canonical(value) < canonical(old)) result.set(id, value);
  }
  return [...result.values()];
}
const distinct = <T>(values: T[]) => [...new Set(values)];
const isBoundary = (e: MeasurementEvent): e is Boundary => e.event.type === 'exit_kitchen' || e.event.type === 'enter_kitchen';
function trusted(op: EffectiveOperation) { return op.status === 'matched' && op.input.quantityStatus === 'measured' && op.input.weightG !== null && op.input.evidenceIds.length > 0; }
function deltaMg(op: EffectiveOperation) {
  if (op.input.weightG === null) return 0;
  const n = gramsToMg(op.input.weightG);
  return ['food_refill', 'ice_add'].includes(op.input.type) ? n : -n;
}
export function effectiveOperations(records: MeasurementOperation[]): EffectiveOperation[] {
  const byId = new Map(records.map(o => [o.id, o])), next = new Map<string, MeasurementOperation>();
  for (const op of records) if (op.input.correctsOperationId) {
    const target = byId.get(op.input.correctsOperationId);
    if (!target || target.input.bindingId !== op.input.bindingId || target.version !== op.input.expectedVersion || next.has(target.id)) throw new Error('Invalid or conflicting operation correction chain');
    next.set(target.id, op);
  }
  const visited = new Set<string>(), result: EffectiveOperation[] = [];
  for (const root of records.filter(o => !o.input.correctsOperationId)) {
    const lineage: string[] = []; let current = root;
    while (true) { if (visited.has(current.id)) throw new Error('Cyclic operation correction'); visited.add(current.id); lineage.push(current.id); const n = next.get(current.id); if (!n) break; current = n; }
    result.push({ ...current, lineage });
  }
  if (visited.size !== records.length) throw new Error('Cyclic operation correction');
  return result.sort((a, b) => at(a.input.occurredAt) - at(b.input.occurredAt) || a.id.localeCompare(b.id));
}
function configuration(c: MeasurementConfig) {
  for (const n of [c.maxSampleGapMs, c.freshMs]) if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Freshness and gap windows must be configured');
  for (const n of [c.stableWindowMs, ...(c.boundaryWindowMs === null ? [] : [c.boundaryWindowMs]), ...(c.locationFreshMs == null ? [] : [c.locationFreshMs])]) if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid measurement window');
  if (!Number.isSafeInteger(c.stableMinSamples) || c.stableMinSamples < 1 || !c.ruleVersion) throw new Error('Invalid stability configuration');
  gramsToMg(c.stableToleranceG); gramsToMg(c.negativeToleranceG); if (c.maxStepG !== null) gramsToMg(c.maxStepG);
  new Intl.DateTimeFormat('en-CA', { timeZone: c.timeZone }).format(0);
}

/**
 * Rebuild a binding from accepted immutable history. asOf is both event and knowledge
 * cutoff; reporting dates are separate (the return event's local date). A caller must
 * supply full binding history, not just the newly arrived packet. No clock, DB or IO.
 */
export function projectBindingMeasurement(input: MeasurementInput): MeasurementProjection {
  const { binding, config, asOf, version } = input; configuration(config);
  const now = at(asOf), start = at(binding.validFrom), end = binding.validTo === null ? Infinity : at(binding.validTo);
  if (end <= start || !Number.isSafeInteger(version) || version < 0) throw new Error('Invalid binding interval or version');
  const tare = gramsToMg(binding.tareG); gramsToMg(binding.fullFoodG);
  const inBinding = (time: string) => at(time) >= start && at(time) < end && at(time) <= now;
  const samples = unique(input.samples.filter(s => s.sample.scaleId === binding.scaleId && inBinding(s.sample.sampledAt) && at(s.receivedAt) <= now), s => `${s.sample.bootId}:${s.sample.sequence}`, s => s.sample)
    .sort((a, b) => at(a.sample.sampledAt) - at(b.sample.sampledAt) || a.sample.bootId.localeCompare(b.sample.bootId) || a.sample.sequence - b.sample.sequence);
  const prior = input.priorFault;
  const carriedFault = prior && prior.origin === 'device' && prior.event.scaleId === binding.scaleId
    && ['device_fault', 'device_recovered'].includes(prior.event.type) && at(prior.event.occurredAt) < start
    && at(prior.event.occurredAt) <= now && at(prior.receivedAt) <= now ? [prior] : [];
  const events = unique([...carriedFault, ...input.events.filter(e => e.event.scaleId === binding.scaleId && inBinding(e.event.occurredAt) && at(e.receivedAt) <= now)], e => e.event.eventId, e => ({ event: e.event, origin: e.origin }))
    .sort((a, b) => at(a.event.occurredAt) - at(b.event.occurredAt) || a.event.eventId.localeCompare(b.event.eventId));
  const lastFaultAt = (time: number) => {
    const states = events.filter(e => ['device_fault', 'device_recovered'].includes(e.event.type) && at(e.event.occurredAt) <= time);
    const latest = states.at(-1); if (!latest) return undefined;
    const simultaneous = states.filter(e => at(e.event.occurredAt) === at(latest.event.occurredAt));
    const boots = distinct(simultaneous.map(e => 'bootId' in e.event ? e.event.bootId : null));
    // A reboot provides no ordering between two simultaneous boot streams.
    if (boots.length > 1) return simultaneous.find(e => e.event.type === 'device_fault') ?? latest;
    const sequence = (e: MeasurementEvent) => 'eventSequence' in e.event ? e.event.eventSequence : -1;
    const newest = Math.max(...simultaneous.map(sequence)), heads = simultaneous.filter(e => sequence(e) === newest);
    return heads.find(e => e.event.type === 'device_fault') ?? heads.at(-1);
  };
  // Keep correction ancestors even when their replacement moves the occurrence time.
  const allOperations = unique(input.operations.filter(o => o.input.bindingId === binding.id && at(o.recordedAt) <= now && at(o.input.occurredAt) <= now), o => o.id, o => o);
  const operations = effectiveOperations(allOperations).filter(o => inBinding(o.input.occurredAt));
  const boundaries = events.filter(isBoundary), tolerance = gramsToMg(config.negativeToleranceG);
  const load = (s: MeasurementSample) => s.sample.measurementStatus === 'ok' ? gramsToMg(s.sample.grossG) - tare : null;
  const good = (s: MeasurementSample) => load(s) !== null && load(s)! >= 0;
  const sampleTime = (s: MeasurementSample) => at(s.sample.sampledAt);
  const sampleIdentity = (s: MeasurementSample) => `${s.sample.bootId}:${s.sample.sequence}`;
  const duringOps = (from: number, to: number) => operations.filter(o => at(o.input.occurredAt) > from && at(o.input.occurredAt) <= to);
  const crossesOperation = (a: number, b: number) => a !== b && operations.some(o => at(o.input.occurredAt) >= Math.min(a, b) && at(o.input.occurredAt) <= Math.max(a, b));
  const matching = (boundary: Boundary) => {
    const e = boundary.event, time = at(e.occurredAt);
    const candidates = e.sampleRef ? samples.filter(s => s.sample.bootId === e.sampleRef!.bootId && s.sample.sequence === e.sampleRef!.sequence)
      : config.boundaryWindowMs === null ? [] : samples.filter(s => Math.abs(sampleTime(s) - time) <= config.boundaryWindowMs!);
    const valid = candidates.filter(s => {
      const sampledAt = sampleTime(s);
      // An identity reference cannot make an old reading contemporary. Without
      // an explicit clock window only an exact-time reference can be used.
      if (Math.abs(sampledAt - time) > (config.boundaryWindowMs ?? 0)) return false;
      if ('bootId' in e && e.bootId !== s.sample.bootId) return false;
      if (!good(s) || crossesOperation(sampledAt, time)) return false;
      return !events.some(other => other.event.eventId !== e.eventId && at(other.event.occurredAt) >= Math.min(sampledAt, time) && at(other.event.occurredAt) <= Math.max(sampledAt, time));
    });
    return { sample: valid.length === 1 ? valid[0] : null, ambiguous: valid.length > 1, invalid: candidates.length > 0 && valid.length === 0, rejectedIds: candidates.map(s => s.id) };
  };
  const matches = new Map(boundaries.map(b => [b.event.eventId, matching(b)]));
  const sampleUsers = new Map<string, string[]>();
  for (const [eventId, match] of matches) if (match.sample) {
    const key = sampleIdentity(match.sample); sampleUsers.set(key, [...(sampleUsers.get(key) ?? []), eventId]);
  }
  // One measured instant cannot stand for both sides of a customer-area cycle.
  for (const users of sampleUsers.values()) if (users.length > 1) for (const eventId of users) {
    const match = matches.get(eventId)!; match.sample = null; match.ambiguous = true;
  }
  const localDate = (time: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at(time));
    return ['year', 'month', 'day'].map(name => parts.find(p => p.type === name)!.value).join('-');
  };
  type Pair = { exit?: Boundary; enter?: Boundary; conflicts: Reason[] };
  const pairs: Pair[] = []; let open: Pair | null = null, previous: Boundary | undefined, previousPair: Pair | undefined;
  for (const boundary of boundaries) {
    const time = at(boundary.event.occurredAt), isExit = boundary.event.type === 'exit_kitchen';
    const conflict = previous && (previous.event.type === boundary.event.type || at(previous.event.occurredAt) === time);
    if (conflict && previousPair) previousPair.conflicts.push('BOUNDARY_CONFLICT');
    if (isExit) {
      if (open) { open.conflicts.push('MISSING_RETURN', 'BOUNDARY_CONFLICT'); open = null; }
      open = { exit: boundary, conflicts: conflict ? ['BOUNDARY_CONFLICT'] : [] }; pairs.push(open); previousPair = open;
    } else if (open && time > at(open.exit!.event.occurredAt)) {
      open.enter = boundary; if (conflict) open.conflicts.push('BOUNDARY_CONFLICT'); previousPair = open; open = null;
    } else {
      if (open) { open.conflicts.push('BOUNDARY_CONFLICT', 'MISSING_RETURN'); open = null; }
      const orphan: Pair = { enter: boundary, conflicts: ['MISSING_EXIT', ...(conflict ? ['BOUNDARY_CONFLICT' as const] : [])] };
      pairs.push(orphan); previousPair = orphan;
    }
    previous = boundary;
  }
  const cycles: Cycle[] = [], cycleCalculations: CycleCalculation[] = [], boundaryResults: BoundaryResult[] = [];
  for (const pair of pairs) {
    const exit = pair.exit, enter = pair.enter, a = exit ? matches.get(exit.event.eventId)! : null, b = enter ? matches.get(enter.event.eventId)! : null;
    const from = exit ? at(exit.event.occurredAt) : at(enter!.event.occurredAt), to = enter ? at(enter.event.occurredAt) : Math.min(now, end);
    const reasons = [...pair.conflicts];
    if (exit && !a?.sample || enter && !b?.sample) reasons.push('MISSING_SAMPLE');
    if (a?.ambiguous || b?.ambiguous) reasons.push('BOUNDARY_CONFLICT');
    if (a?.invalid || b?.invalid) reasons.push('DATA_GAP');
    if (!enter && end <= now) reasons.push('MISSING_RETURN', 'BINDING_CHANGED');
    const intervalOps = duringOps(from, to), intervalSamples = samples.filter(s => sampleTime(s) >= from && sampleTime(s) <= to);
    const intervalEvents = events.filter(e => at(e.event.occurredAt) >= from && at(e.event.occurredAt) <= to);
    const faultsBefore = lastFaultAt(from);
    if (faultsBefore?.event.type === 'device_fault' || intervalEvents.some(e => e.event.type === 'device_fault') || intervalSamples.some(s => !good(s))) reasons.push('DATA_GAP');
    if (intervalOps.some(o => ['remove_container', 'replace_container'].includes(o.input.type))) reasons.push('BINDING_CHANGED');
    if (intervalOps.some(o => !trusted(o))) reasons.push('UNKNOWN_OPERATION');
    if (operations.some(o => at(o.input.occurredAt) === from || at(o.input.occurredAt) === to)) reasons.push('UNKNOWN_OPERATION');
    const weighing = unique([...(a?.sample ? [a.sample] : []), ...intervalSamples, ...(b?.sample ? [b.sample] : [])], s => `${s.sample.bootId}:${s.sample.sequence}`, s => s.sample).sort((x, y) => sampleTime(x) - sampleTime(y));
    const boots = distinct([...weighing.map(s => s.sample.bootId), ...intervalEvents.flatMap(e => 'bootId' in e.event ? [e.event.bootId] : [])]);
    if (boots.length > 1) reasons.push('DATA_GAP');
    for (let i = 1; i < weighing.length; i++) {
      const before = weighing[i - 1], after = weighing[i];
      if (after.sample.bootId !== before.sample.bootId || after.sample.sequence <= before.sample.sequence || sampleTime(after) - sampleTime(before) > config.maxSampleGapMs) reasons.push('DATA_GAP');
      if (good(before) && good(after)) {
        const ops = duringOps(sampleTime(before), sampleTime(after)), adjustment = sum(ops.filter(trusted).map(deltaMg));
        const unexplained = load(before)! - load(after)! + adjustment;
        if (unexplained < -tolerance) reasons.push('UNKNOWN_OPERATION');
        if (config.maxStepG !== null && unexplained > gramsToMg(config.maxStepG)) reasons.push('DATA_GAP');
      }
    }
    if (!enter && exit && (weighing.length === 0 || to - sampleTime(weighing.at(-1)!) > config.maxSampleGapMs)) reasons.push('DATA_GAP');
    const increaseMg = sum(intervalOps.filter(o => trusted(o) && ['food_refill', 'ice_add'].includes(o.input.type)).map(o => gramsToMg(o.input.weightG!)));
    const nonCustomerDecreaseMg = sum(intervalOps.filter(o => trusted(o) && ['drain', 'partial_remove'].includes(o.input.type)).map(o => gramsToMg(o.input.weightG!)));
    const foodRefillMg = sum(intervalOps.filter(o => trusted(o) && o.input.type === 'food_refill').map(o => gramsToMg(o.input.weightG!)));
    const rawBalanceMg = a?.sample && b?.sample ? sum([load(a.sample)!, -load(b.sample)!, increaseMg, -nonCustomerDecreaseMg]) : null;
    if (rawBalanceMg !== null && rawBalanceMg < -tolerance) reasons.push('NEGATIVE_BALANCE');
    const crossDay = !!exit && !!enter && localDate(exit.event.occurredAt) !== localDate(enter.event.occurredAt);
    const blocking = distinct(reasons).sort(), confirmed = !!exit && !!enter && rawBalanceMg !== null && blocking.length === 0;
    const id = `cycle:${(exit ?? enter)!.event.eventId}`, bundle = `evidence:${id}:v${version}`;
    const evidence = distinct([
      ...(exit ? [exit.event.eventId] : []), ...(enter ? [enter.event.eventId] : []),
      ...(a?.rejectedIds ?? []), ...(b?.rejectedIds ?? []), ...weighing.map(s => s.id), ...intervalEvents.map(e => e.event.eventId),
      ...(faultsBefore ? [faultsBefore.event.eventId] : []), ...intervalOps.flatMap(o => [...o.lineage, ...o.input.evidenceIds]),
    ]).sort();
    const cycle: Cycle = {
      id, bindingId: binding.id, scaleId: binding.scaleId, dishId: binding.dishId, version,
      status: confirmed ? 'confirmed' : !enter && blocking.length === 0 ? 'open' : 'pending',
      exitEventId: exit?.event.eventId ?? null, returnEventId: enter?.event.eventId ?? null,
      exitedAt: exit?.event.occurredAt ?? null, returnedAt: enter?.event.occurredAt ?? null,
      outG: a?.sample ? mgToGrams(load(a.sample)!) : null, inG: b?.sample ? mgToGrams(load(b.sample)!) : null,
      confirmedTakeG: confirmed ? mgToGrams(Math.max(0, rawBalanceMg!)) : null,
      effectiveAt: confirmed ? enter!.event.occurredAt : null, method: 'cycle_balance_v2',
      qualityReasons: [...blocking, ...(crossDay ? ['CROSS_DAY' as const] : [])], evidenceIds: evidence.length > 100 ? [bundle] : evidence,
    };
    cycleSchema.parse(cycle); cycles.push(cycle);
    cycleCalculations.push({ cycleId: id, evidenceBundleId: bundle, evidenceIds: evidence, operationIds: distinct(intervalOps.flatMap(o => o.lineage)), rawBalanceMg, toleranceMg: tolerance, appliedToleranceMg: confirmed && rawBalanceMg! < 0 ? -rawBalanceMg! : 0, increaseMg, nonCustomerDecreaseMg, foodRefillMg, blockingReasons: blocking, closingDate: enter ? localDate(enter.event.occurredAt) : null, crossDay, algorithmVersion: MEASUREMENT_ALGORITHM, ruleVersion: config.ruleVersion, asOf });
    for (const [boundary, match] of [[exit, a], [enter, b]] as const) if (boundary) boundaryResults.push({ eventId: boundary.event.eventId, cycleId: id, sampleId: match?.sample?.id ?? null, processingStatus: blocking.some(r => r !== 'MISSING_SAMPLE') ? 'pending_review' : !match?.sample ? 'waiting_sample' : 'applied' });
  }

  // Continuous observations are display estimates only. They never add a ledger row.
  let confirmedFoodG: number | null = null, confirmedAt: string | null = null;
  let window: MeasurementSample[] = [], last: MeasurementSample | undefined;
  const faultAt = (time: number) => lastFaultAt(time)?.event.type === 'device_fault';
  const stepDelta = (before: MeasurementSample, after: MeasurementSample) => input.kitchenRefills?.some(v => v.exitedAt && sampleTime(before) >= at(v.enteredAt) && sampleTime(after) <= at(v.exitedAt)) ? 0 : load(after)! - load(before)! - sum(duringOps(sampleTime(before), sampleTime(after)).filter(trusted).map(deltaMg));
  const unexplainedStep = (before: MeasurementSample, after: MeasurementSample) => good(before) && good(after) && (stepDelta(before, after) > tolerance || config.maxStepG !== null && Math.abs(stepDelta(before, after)) > gramsToMg(config.maxStepG));
  const unexplainedIncrease = samples.find((s, i) => i > 0 && good(samples[i - 1]) && good(s) && stepDelta(samples[i - 1], s) > tolerance);
  const removedSample = samples.find(s => load(s) !== null && load(s)! < 0);
  const unknownCompositionAt = operations.filter(o => !trusted(o) || ['ice_add', 'drain', 'remove_container', 'replace_container'].includes(o.input.type))
    .reduce((earliest, o) => Math.min(earliest, at(o.input.occurredAt)), Math.min(unexplainedIncrease ? sampleTime(unexplainedIncrease) : Infinity, removedSample ? sampleTime(removedSample) : Infinity));
  const compositionKnown = (time: number) => binding.foodOnly && time < unknownCompositionAt;
  for (const sample of samples) {
    const time = sampleTime(sample);
    const interrupted = last && (sample.sample.bootId !== last.sample.bootId || sample.sample.sequence <= last.sample.sequence || time - sampleTime(last) > config.maxSampleGapMs || duringOps(sampleTime(last), time).length > 0 || events.some(e => e.event.type === 'device_fault' && at(e.event.occurredAt) > sampleTime(last!) && at(e.event.occurredAt) <= time));
    if (interrupted) window = [];
    if (!good(sample) || faultAt(time) || !compositionKnown(time) || last && unexplainedStep(last, sample)) window = [];
    else {
      window.push(sample); while (window.length > 1 && sampleTime(window[1]) <= time - config.stableWindowMs) window.shift();
      const values = window.map(s => load(s)!);
      if (window.length >= config.stableMinSamples && time - sampleTime(window[0]) >= config.stableWindowMs && Math.max(...values) - Math.min(...values) <= gramsToMg(config.stableToleranceG)) { confirmedFoodG = mgToGrams(load(sample)!); confirmedAt = sample.sample.sampledAt; }
    }
    last = sample;
  }
  const latest = samples.at(-1), previousSample = samples.at(-2), latestAt = latest ? sampleTime(latest) : null;
  const fresh = latestAt !== null && now - latestAt <= config.freshMs, valid = !!latest && good(latest), active = start <= now && now < end;
  const currentFault = faultAt(now), removed = !!latest && load(latest) !== null && load(latest)! < 0;
  const unexplainedCurrent = !!previousSample && !!latest && unexplainedStep(previousSample, latest);
  const unknownOperation = operations.some(o => !trusted(o));
  const needsPostEventSample = !!latest && (operations.some(o => at(o.input.occurredAt) >= latestAt!) || events.some(e => ['device_fault', 'device_recovered'].includes(e.event.type) && at(e.event.occurredAt) > latestAt!));
  let quality: MeasurementObservation['quality'] = !active ? 'removed' : !latest ? 'offline' : !fresh ? 'stale' : currentFault || latest.sample.measurementStatus !== 'ok' ? 'offline' : removed ? 'removed' : unknownOperation || !compositionKnown(now) || unexplainedCurrent || needsPostEventSample ? 'pending' : confirmedAt === latest.sample.sampledAt ? 'good' : 'estimated';
  if (!valid && quality === 'estimated') quality = 'pending';
  const estimate = active && fresh && valid && !currentFault && !unexplainedCurrent && !needsPostEventSample && compositionKnown(now) ? mgToGrams(load(latest!)!) : null;
  const lastBoundary = boundaries.at(-1), lastBoundaryResult = lastBoundary ? boundaryResults.find(b => b.eventId === lastBoundary.event.eventId) : undefined;
  const locationConfigured = config.locationFreshMs != null;
  const locationExpired = !!lastBoundary && locationConfigured && now - at(lastBoundary.event.occurredAt) > config.locationFreshMs!;
  const locationSample = lastBoundaryResult?.sampleId ? samples.find(s => s.id === lastBoundaryResult.sampleId) : undefined;
  const locationSamples = lastBoundary ? unique([...(locationSample ? [locationSample] : []), ...samples.filter(s => sampleTime(s) >= at(lastBoundary.event.occurredAt))], sampleIdentity, s => s.sample).sort((a, b) => sampleTime(a) - sampleTime(b)) : [];
  const locationInterrupted = !!lastBoundary && (events.some(e => e.event.type === 'device_fault' && at(e.event.occurredAt) >= at(lastBoundary.event.occurredAt))
    || events.some(e => 'bootId' in e.event && locationSample && e.event.bootId !== locationSample.sample.bootId && at(e.event.occurredAt) >= at(lastBoundary.event.occurredAt))
    || operations.some(o => ['remove_container', 'replace_container'].includes(o.input.type) && at(o.input.occurredAt) >= at(lastBoundary.event.occurredAt))
    || locationSamples.some((s, i) => !good(s) || i > 0 && (s.sample.bootId !== locationSamples[i - 1].sample.bootId || s.sample.sequence <= locationSamples[i - 1].sample.sequence || sampleTime(s) - sampleTime(locationSamples[i - 1]) > config.maxSampleGapMs)));
  const locationUsable = !!lastBoundary && locationConfigured && !locationExpired && active && fresh && valid && !currentFault && !removed && !needsPostEventSample && !locationInterrupted && lastBoundaryResult?.processingStatus === 'applied';
  const observation: MeasurementObservation = {
    loadNetG: active && fresh && valid && !currentFault && !unexplainedCurrent && !needsPostEventSample ? mgToGrams(load(latest!)!) : null,
    foodRemainingG: quality === 'good' || quality === 'estimated' ? estimate : null, estimatedFoodG: estimate,
    confirmedFoodG, observedAt: latest?.sample.sampledAt ?? null, confirmedAt, quality,
    evidenceIds: distinct([...(latest ? [latest.id] : []), ...window.map(s => s.id), ...operations.flatMap(o => [...o.lineage, ...o.input.evidenceIds]), ...events.filter(e => ['device_fault', 'device_recovered'].includes(e.event.type)).map(e => e.event.eventId), ...(lastBoundary ? [lastBoundary.event.eventId] : []), ...(locationSample ? [locationSample.id] : [])]).sort(),
    zone: locationUsable ? lastBoundary!.event.type === 'exit_kitchen' ? 'customer' : 'kitchen' : 'unknown',
    locationQuality: locationUsable ? lastBoundary!.origin === 'manual' ? 'manual' : 'verified' : lastBoundary && locationConfigured && (locationExpired || !fresh) ? 'stale' : 'unknown',
    locationObservedAt: lastBoundary?.event.occurredAt ?? null,
  };
  return { cycles, cycleCalculations, observation, boundaryResults };
}
