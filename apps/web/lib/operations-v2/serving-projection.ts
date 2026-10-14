import { rows } from './queries.ts';
import type { MeasurementSample } from './measurement.ts';
import { bowlSchema, type Bowl } from '@zhishan/contracts/v2/serving';
import type { OperationsStore, Write } from './storage.ts';
import { decode, type BindingPayload, type CyclePayload, type DevicePayload, type LatestPayload, type Row, type Rule } from './records.ts';
export type ServingProjection = {
  bindingId: string; ruleVersion: number | null; state: Bowl['servingState'];
  candidate: Bowl['servingState'] | null; candidateSince: string | null;
  halfWindow: { startedAt: string; firstG: number; lastAt: string; maxChangeG: number } | null;
  bowl: Bowl;
};
export type ServingInterval = { id: string; binding_id: string; dish_id: string; started_at: string; ended_at: string; quality: string; empty: number; rule_version: string | null; payload: string };
const emptyObservation = { loadNetG: null, foodRemainingG: null, estimatedFoodG: null, confirmedFoodG: null, observedAt: null, confirmedAt: null, quality: 'offline', evidenceIds: [], zone: 'unknown', locationQuality: 'unknown', locationObservedAt: null } as const;
const stateOrder = ['empty', 'low', 'half', 'full'] as const;
function currentObservation(device: DevicePayload, latest: LatestPayload | null, now: string) {
  const observation = latest?.bindingId === device.bindingId ? { ...latest.observation } : { ...emptyObservation };
  if (!observation.observedAt || !device.measurement || Date.parse(now) - Date.parse(observation.observedAt) > device.measurement.freshMs) {
    observation.quality = observation.observedAt ? 'stale' : 'offline'; observation.foodRemainingG = null;
    observation.loadNetG = null; observation.estimatedFoodG = null;
  }
  const locationAge = observation.locationObservedAt ? Date.parse(now) - Date.parse(observation.locationObservedAt) : Infinity;
  if (!device.measurement?.locationFreshMs || locationAge > device.measurement.locationFreshMs || ['offline', 'removed'].includes(observation.quality)) {
    observation.zone = 'unknown'; observation.locationQuality = observation.locationObservedAt ? 'stale' : 'unknown';
  }
  return observation;
}
function classify(g: number, full: number, rule: Rule, prior: Bowl['servingState']) {
  const threshold = rule.config.thresholds!, h = threshold.hysteresisRatio * full;
  const low = threshold.lowRatio * full, high = threshold.fullRatio * full;
  if (g <= threshold.emptyG) return 'empty' as const;
  if (prior === 'empty' && g <= threshold.emptyG + h) return 'empty' as const;
  if (prior === 'low' && g <= low + h || prior === 'half' && g <= low - h || prior === 'unknown' && g <= low || prior === 'empty' && g <= low) return 'low' as const;
  if (prior === 'full' && g >= high - h || prior !== 'full' && g >= high + (prior === 'unknown' ? 0 : h)) return 'full' as const;
  return g <= low && prior === 'full' ? 'low' as const : 'half' as const;
}
export function projectServing(device: DevicePayload, binding: BindingPayload, latest: LatestPayload | null, rule: Rule | null, previous: ServingProjection | null, cycles: CyclePayload[], now: string): ServingProjection {
  const observation = currentObservation(device, latest, now);
  const projection: ServingProjection = {
    bindingId: binding.id, ruleVersion: rule?.version ?? null, state: 'unknown', candidate: null, candidateSince: null, halfWindow: null,
    bowl: { scaleId: binding.scaleId, bindingId: binding.id, dishId: binding.dishId, dishName: binding.dishName,
      positionOrder: device.positionOrder, bindingVersion: binding.version, freshnessBatchId: binding.freshnessBatchId, containerRef: binding.containerRef,
      tareG: binding.tareG, fullFoodG: binding.fullFoodG, ...observation, servingState: 'unknown', recommendation: 'verify', reasonCodes: [],
      cycleId: cycles[0]?.cycle.id ?? null, taskId: null, ruleVersion: rule?.version ?? null },
  };
  // Evidence stays in the measurement record; the public bowl does not carry it.
  delete (projection.bowl as Bowl & { evidenceIds?: readonly string[] }).evidenceIds;
  const bowl = projection.bowl, reasons = bowl.reasonCodes;
  const usableRule = rule?.config.enabled && rule.config.thresholds && rule.config.halfPolicy && rule.config.thresholds.emptyG < rule.config.thresholds.lowRatio * binding.fullFoodG;
  if (!usableRule) reasons.push('RULE_NOT_CONFIGURED');
  if (observation.zone === 'unknown') reasons.push('LOCATION_UNKNOWN');
  if (observation.quality !== 'good') reasons.push(({ stale: 'STALE_READING', offline: 'DEVICE_OFFLINE', removed: 'CONTAINER_REMOVED', unstable: 'UNSTABLE_READING', pending: 'PENDING_REVIEW', estimated: 'UNSTABLE_READING' } as const)[observation.quality]);
  if (observation.foodRemainingG === null) reasons.push('UNKNOWN_FOOD_WEIGHT');
  if (!usableRule || observation.quality !== 'good' || observation.foodRemainingG === null || !observation.observedAt) return projection;
  const prior = previous?.ruleVersion === rule!.version ? previous : null;
  const candidate = classify(observation.foodRemainingG, binding.fullFoodG, rule!, prior?.state ?? 'unknown');
  let state = candidate;
  if (prior && candidate !== prior.state && prior.state !== 'unknown' && rule!.config.thresholds!.holdSeconds > 0) {
    projection.candidate = candidate;
    projection.candidateSince = prior.candidate === candidate ? prior.candidateSince : observation.observedAt;
    if (Date.parse(observation.observedAt) - Date.parse(projection.candidateSince!) < rule!.config.thresholds!.holdSeconds * 1000) state = prior.state as typeof candidate;
    else { projection.candidate = null; projection.candidateSince = null; }
  }
  projection.state = state; bowl.servingState = state;
  if (state === 'full') bowl.recommendation = 'none';
  if (state === 'low') { bowl.recommendation = 'refill'; reasons.push('LOW_WEIGHT'); }
  if (state === 'empty') { bowl.recommendation = 'urgent'; reasons.push('EMPTY_WEIGHT'); }
  if (state === 'half') {
    const policy = rule!.config.halfPolicy!, time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(now));
    const peak = rule!.config.peakPeriods.some(p => time >= p.start && time < p.end);
    let unchanged = false;
    if (policy.mode === 'cycles') {
      const evidence = cycles.slice(0, policy.unchangedCycles!);
      unchanged = evidence.length === policy.unchangedCycles && evidence.every(item => item.cycle.status === 'confirmed' && item.cycle.confirmedTakeG !== null && item.cycle.confirmedTakeG <= policy.changeToleranceG && Date.parse(item.cycle.returnedAt!) >= Date.parse(rule!.updatedAt));
    }
    if (policy.mode === 'time') {
      const old = prior?.state === 'half' ? prior.halfWindow : null;
      const continuous = old && Date.parse(observation.observedAt) - Date.parse(old.lastAt) <= device.measurement!.maxSampleGapMs;
      const maxChangeG = continuous ? Math.max(old.maxChangeG, Math.abs(observation.foodRemainingG - old.firstG)) : 0;
      projection.halfWindow = continuous && maxChangeG <= policy.changeToleranceG ? { ...old, lastAt: observation.observedAt, maxChangeG } : { startedAt: observation.observedAt, lastAt: observation.observedAt, firstG: observation.foodRemainingG, maxChangeG: 0 };
      unchanged = Date.parse(projection.halfWindow.lastAt) - Date.parse(projection.halfWindow.startedAt) >= policy.observationSeconds! * 1000;
    }
    if (peak && policy.refillDuringPeak) { bowl.recommendation = 'refill'; reasons.push('PEAK_PERIOD'); }
    else if (unchanged) { bowl.recommendation = 'defer'; reasons.push('HALF_NO_CHANGE'); }
    else { bowl.recommendation = 'watch'; reasons.push('HALF_ACTIVE'); }
  }
  bowlSchema.parse(bowl);
  return projection;
}

export async function intervalWrite(store: OperationsStore, device: DevicePayload, binding: BindingPayload, prior: ServingProjection | null, next: ServingProjection, rule: Rule | null): Promise<Write | null> {
  const from = prior?.bowl.observedAt, to = next.bowl.observedAt;
  if (!from || !to || Date.parse(to) <= Date.parse(from) || !binding.measurement || prior!.ruleVersion !== next.ruleVersion) return null;
  const start = new Date(from).toISOString(), end = new Date(to).toISOString();
  const [samples, faults, operations] = await Promise.all([
    rows<Row<MeasurementSample>>(store, 'samples', { where: { scale_id: device.id }, range: { column: 'sampled_at', from: start, to: end, toInclusive: true } }),
    rows<Row<unknown>>(store, 'device_events', { where: { scale_id: device.id, type: ['device_fault', 'device_recovered'] }, range: { column: 'occurred_at', from: start, to: end, toInclusive: true } }),
    rows<Row<unknown>>(store, 'operations', { where: { binding_id: binding.id }, range: { column: 'occurred_at', from: start, fromInclusive: false, to: end, toInclusive: true } }),
  ]);
  const ordered = samples.map(decode).sort((a, b) => Date.parse(a.sample.sampledAt) - Date.parse(b.sample.sampledAt));
  if (!ordered.length) return null;
  const continuous = ordered.length >= 2 && Date.parse(ordered[0].sample.sampledAt) === Date.parse(from) && Date.parse(ordered.at(-1)!.sample.sampledAt) === Date.parse(to) && ordered.every((item, i) => item.sample.measurementStatus === 'ok' && item.sample.grossG >= binding.tareG && (!i || item.sample.bootId === ordered[i - 1].sample.bootId && item.sample.sequence > ordered[i - 1].sample.sequence && Date.parse(item.sample.sampledAt) - Date.parse(ordered[i - 1].sample.sampledAt) <= binding.measurement!.maxSampleGapMs));
  const quality = continuous && !faults.length && !operations.length && prior!.bowl.quality === 'good' && next.bowl.quality === 'good' ? 'good' : continuous && !faults.length ? 'estimated' : 'pending';
  const empty = quality === 'good' && prior!.bowl.servingState === 'empty' && next.bowl.servingState === 'empty' && !!rule?.config.thresholds && ordered.every(item => item.sample.measurementStatus === 'ok' && item.sample.grossG - binding.tareG <= rule.config.thresholds!.emptyG + rule.config.thresholds!.hysteresisRatio * binding.fullFoodG);
  const nonEmpty = quality === 'good' && prior!.bowl.servingState !== 'empty' && prior!.bowl.servingState !== 'unknown' && next.bowl.servingState !== 'empty' && next.bowl.servingState !== 'unknown' && !!rule?.config.thresholds && ordered.every(item => item.sample.measurementStatus === 'ok' && item.sample.grossG - binding.tareG > rule.config.thresholds!.emptyG);
  return { type: 'upsert', table: 'serving_intervals', values: { id: binding.id + ':' + end, binding_id: binding.id, dish_id: binding.dishId, started_at: start, ended_at: end, quality, empty: empty ? 1 : 0, rule_version: rule ? String(rule.version) : null, payload: JSON.stringify({ evidenceIds: ordered.map(item => item.id), measurement: binding.measurement, rule: rule?.config ?? null, nonEmpty, foodKnown: next.bowl.foodRemainingG !== null && prior!.bowl.foodRemainingG !== null }) } };
}


export { stateOrder };
