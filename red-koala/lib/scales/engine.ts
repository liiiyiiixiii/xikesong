import type { MinuteBucket, Sample, ScaleConfig, Source, WeightEvent } from "./types.ts";

export interface DeviceState {
  bootId: string; sequence: number; sampledAt: string; receivedAt: string;
  stableNet: number | null; displayedNet: number | null;
  mode: "active" | "empty" | "removed" | "unstable" | "anomaly";
  candidates: number[]; previousBoots: string[]; needsBaseline: boolean;
  beforeRemoval: number | null; freshnessOpening?: boolean; pendingId?: string; suppressOpening?: boolean; openedDate?: string;
}
export interface MeasurementResult { state: DeviceState; events: WeightEvent[]; intervals: { from: number; to: number; empty: boolean }[]; accepted: boolean; }
export function newState(): DeviceState { return { bootId: "", sequence: -1, sampledAt: "", receivedAt: "", stableNet: null, displayedNet: null, mode: "unstable", candidates: [], previousBoots: [], needsBaseline: true, beforeRemoval: null }; }
const timestamp = (s: string) => Date.parse(s);
function event(source: Source, config: ScaleConfig, sample: Sample, receivedAt: string, kind: WeightEvent["kind"], weightG: number): WeightEvent {
  return { id: `${source}:${config.id}:${sample.bootId}:${sample.sequence}:${kind}`, source, scaleId: config.id, dishId: config.dishId, at: sample.sampledAt, receivedAt, kind, weightG: Math.round(weightG * 100) / 100 };
}
/** Only verified stable changes become demand. Missing intervals never receive implied consumption. */
export function measure(source: Source, config: ScaleConfig, prior: DeviceState, sample: Sample, receivedAt: string): MeasurementResult {
  const state = structuredClone(prior), events: WeightEvent[] = [], intervals: MeasurementResult["intervals"] = [];
  const sameBoot = state.bootId === sample.bootId;
  if ((sameBoot && sample.sequence <= state.sequence) || state.previousBoots.includes(sample.bootId) || (state.sampledAt && timestamp(sample.sampledAt) <= timestamp(state.sampledAt))) return { state, events, intervals, accepted: false };
  const sampleDay = new Date(timestamp(sample.sampledAt) + 8 * 3600000).toISOString().slice(0, 10), previousDay = state.sampledAt ? new Date(timestamp(state.sampledAt) + 8 * 3600000).toISOString().slice(0, 10) : null;
  if (previousDay && previousDay !== sampleDay) { state.stableNet = null; state.displayedNet = null; state.candidates = []; state.beforeRemoval = null; state.needsBaseline = true; state.mode = "unstable"; delete state.pendingId; delete state.suppressOpening; }
  const previousAt = timestamp(state.sampledAt), nextAt = timestamp(sample.sampledAt), gap = state.sampledAt ? (nextAt - previousAt) / 1000 : 0;
  const fresh = timestamp(receivedAt) - nextAt <= 10000;
  const recovery = !sameBoot || gap > 10 || !fresh;
  if (!sameBoot && state.bootId) state.previousBoots.push(state.bootId);
  state.previousBoots = state.previousBoots.slice(-32);
  state.bootId = sample.bootId; state.sequence = sample.sequence; state.sampledAt = sample.sampledAt; state.receivedAt = receivedAt;
  if (recovery && state.stableNet !== null && previousDay === sampleDay && !prior.needsBaseline) { const missing = event(source, config, sample, receivedAt, "correction", 0); missing.resolution = "data_gap"; events.push(missing); }
  if (recovery && state.stableNet !== null) { state.beforeRemoval = state.stableNet; state.needsBaseline = true; state.candidates = []; state.mode = "unstable"; }
  // The bowl itself has positive tare: a reading below tare is absence, never a take.
  const net = sample.grossG - config.tareG;
  if (net < -config.noiseG) {
    if (state.stableNet !== null && state.beforeRemoval === null) state.beforeRemoval = state.stableNet;
    state.mode = "removed"; state.displayedNet = null; state.needsBaseline = true; state.candidates = [];
    return { state, events, intervals, accepted: true };
  }
  const value = Math.max(0, net);
  if (value > config.fullG * 4) {
    state.mode = "anomaly"; state.displayedNet = null; state.candidates = []; state.needsBaseline = true; state.beforeRemoval ??= prior.stableNet;
    return { state, events, intervals, accepted: true };
  }
  state.candidates.push(value);
  if (state.candidates.length > 3) state.candidates.shift();
  const plausible = prior.stableNet !== null && (value >= prior.stableNet || Math.abs(value - prior.stableNet) <= Math.max(config.fullG * .7, 100));
  const continuous = !recovery && fresh && gap > 0 && gap <= 10 && prior.stableNet !== null && !prior.needsBaseline && !prior.pendingId && !state.pendingId && ["active", "empty", "unstable"].includes(prior.mode) && plausible;
  const stable = state.candidates.length === 3 && Math.max(...state.candidates) - Math.min(...state.candidates) <= config.noiseG;
  if (!stable) { state.mode = "unstable"; state.displayedNet = prior.needsBaseline || recovery ? null : prior.displayedNet; if (continuous) intervals.push({ from: previousAt, to: nextAt, empty: prior.mode === "empty" }); return { state, events, intervals, accepted: true }; }
  const current = [...state.candidates].sort((a, b) => a - b)[1];
  state.displayedNet = current;
  if (state.needsBaseline || state.stableNet === null) {
    const old = state.beforeRemoval;
    if (old !== null && Math.abs(old - current) >= config.noiseG) {
      const pending = event(source, config, sample, receivedAt, "pending", old - current);
      events.push(pending); state.pendingId = pending.id;
    }
    if (state.freshnessOpening) { const opening=event(source,config,sample,receivedAt,"refill",current); opening.resolution="freshness_opening"; events.push(opening); delete state.freshnessOpening; state.openedDate=sampleDay; }
    if (state.openedDate !== sampleDay && !state.suppressOpening) { events.push(event(source, config, sample, receivedAt, "opening", current)); state.openedDate = sampleDay; }
    state.stableNet = current; state.needsBaseline = false; state.beforeRemoval = null; delete state.suppressOpening;
  } else {
    const delta = current - state.stableNet;
    if (Math.abs(delta) >= config.noiseG) {
      const suspicious = delta < 0 && Math.abs(delta) > Math.max(config.fullG * .7, 100);
      const change = event(source, config, sample, receivedAt, suspicious ? "pending" : delta < 0 ? "take" : "refill", suspicious ? -delta : Math.abs(delta));
      events.push(change); state.stableNet = current;
      if (suspicious) state.pendingId = change.id;
    }
  }
  state.mode = state.pendingId ? "anomaly" : current <= config.noiseG ? "empty" : "active";
  if (continuous && !state.pendingId) intervals.push({ from: previousAt, to: nextAt, empty: prior.mode === "empty" });
  return { state, events, intervals, accepted: true };
}
export function minuteParts(from: number, to: number) { const result: { minute: string; seconds: number }[] = []; for (let start = from; start < to;) { const stop = Math.min(to, Math.floor(start / 60000) * 60000 + 60000); result.push({ minute: new Date(Math.floor(start / 60000) * 60000).toISOString(), seconds: (stop - start) / 1000 }); start = stop; } return result; }
export function updateBuckets(source: Source, config: ScaleConfig, result: MeasurementResult, existing: MinuteBucket[]): MinuteBucket[] {
  type DetailedBucket = MinuteBucket & { observedSpans?: [number, number][]; emptySpans?: [number, number][]; remainingAt?: string };
  const buckets = new Map<string, DetailedBucket>(existing.map(b => [b.minute, structuredClone(b)]));
  const get = (minute: string) => { let b = buckets.get(minute); if (!b) { b = { source, scaleId: config.id, dishId: config.dishId, minute, takeG: 0, refillG: 0, observedSeconds: 0, emptySeconds: 0, remainingG: null }; buckets.set(minute, b); } return b; };
  for (const interval of result.intervals) for (const p of minuteParts(interval.from, interval.to)) { const b = get(p.minute); (b.observedSpans ??= []).push([Math.max(interval.from, Date.parse(p.minute)), Math.min(interval.to, Date.parse(p.minute) + 60000)]); b.observedSeconds = Math.min(60, b.observedSeconds + p.seconds); if (interval.empty) { (b.emptySpans ??= []).push([Math.max(interval.from, Date.parse(p.minute)), Math.min(interval.to, Date.parse(p.minute) + 60000)]); b.emptySeconds = Math.min(b.observedSeconds, b.emptySeconds + p.seconds); } }
  for (const e of result.events) { const b = get(new Date(Math.floor(timestamp(e.at) / 60000) * 60000).toISOString()); if (e.kind === "take") b.takeG += e.weightG; if (e.kind === "refill") b.refillG += e.weightG; }
  if (result.state.sampledAt) { const b = get(new Date(Math.floor(timestamp(result.state.sampledAt) / 60000) * 60000).toISOString()); b.remainingG = result.state.displayedNet; b.remainingAt = result.state.sampledAt; }
  return [...buckets.values()];
}
export function consumptionRate(buckets: MinuteBucket[], expectedSeconds: number) { const observed = buckets.reduce((sum, b) => sum + b.observedSeconds, 0), coverage = expectedSeconds > 0 ? Math.min(1, observed / expectedSeconds) : 0; return { coverage, rate: coverage >= .8 && observed >= 30 ? buckets.reduce((sum, b) => sum + b.takeG, 0) / observed * 60 : null }; }

/** A dish is empty only when every bound bowl is simultaneously verified empty. */
export function dishEmptySeconds(buckets: MinuteBucket[], scaleIds: string[], from: number, to: number) {
  if (!scaleIds.length || to <= from) return 0;
  // Aggregate-only historical minutes are exact for one bowl. Multiple bowls
  // still require interval overlap evidence; never infer simultaneous emptiness.
  let aggregateSeconds=0;
  if(scaleIds.length===1)for(const b of buckets){if((b as MinuteBucket & {emptySpans?:[number,number][]}).emptySpans)continue;const start=Date.parse(b.minute),overlap=Math.max(0,Math.min(to,start+60000)-Math.max(from,start))/1000;aggregateSeconds+=Math.max(0,b.emptySeconds-(60-overlap));}
  const changes: { at: number; id: string; delta: number }[] = [];
  for (const b of buckets) {
    const spans = (b as MinuteBucket & { emptySpans?: [number, number][] }).emptySpans ?? [];
    for (const [a, z] of spans) { const start = Math.max(from, a), end = Math.min(to, z); if (end > start) changes.push({at:start,id:b.scaleId,delta:1},{at:end,id:b.scaleId,delta:-1}); }
  }
  changes.sort((a,b)=>a.at-b.at); const active = new Map<string,number>(); let total = 0, previous = from;
  for (let i = 0; i < changes.length;) { const at = changes[i].at; if (scaleIds.every(id => (active.get(id) ?? 0) > 0)) total += (at - previous) / 1000; while (i < changes.length && changes[i].at === at) { const c = changes[i++]; active.set(c.id,(active.get(c.id) ?? 0)+c.delta); } previous=at; }
  return total+aggregateSeconds;
}
