import { reportQuerySchema, reportResponseSchema, type ConsumptionReport } from '@zhishan/contracts/v2/reports';
import type { EndpointContext, OperationsServices } from './router.ts';
import type { OperationsStore } from './storage.ts';
import { OperationsError, requirePermission, tokenHash } from './security.ts';
import { decode, operationsMeta, type BindingPayload, type LedgerPayload, type LedgerRow, type Row } from './records.ts';
import { rows } from './queries.ts';
import { type ServingInterval } from './serving-projection.ts';
import type { MeasurementSample, MeasurementEvent } from './measurement.ts';
import { latestFault, readLatestFault } from './fault-state.ts';
import { timestamp } from '@zhishan/contracts/v2/common';

type ConfirmedReport = Extract<ConsumptionReport, { basis: 'cycle_balance_v2' }>;
type ReportRow = ConfirmedReport['rows'][number];
const day = (timestamp: string) => new Date(Date.parse(timestamp) + 8 * 3600000).toISOString().slice(0, 10);
function range(startDate: string, endDate: string) {
  return { from: new Date(startDate + 'T00:00:00+08:00').toISOString(), to: new Date(Date.parse(endDate + 'T00:00:00+08:00') + 86400000).toISOString() };
}
function cursor(cursor: string | undefined, revision: number, key: string) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(decodeURIComponent(cursor));
    if (parsed.revision !== revision) throw new OperationsError('VERSION_CONFLICT');
    if (parsed.key !== key || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0) throw new Error();
    return parsed.offset as number;
  } catch (error) { if (error instanceof OperationsError) throw error; throw new OperationsError('INVALID_REQUEST'); }
}
function addMg(total: number, amount: number) {
  const result = total + amount;
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(result)) throw new OperationsError('INTERNAL_ERROR');
  return result;
}
type Span = [number, number];
function union(spans: Span[]): Span[] {
  const result: Span[] = [];
  for (const [a, b] of spans.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1); if (last && a <= last[1]) last[1] = Math.max(last[1], b); else result.push([a, b]);
  }
  return result;
}
const duration = (spans: Span[]) => union(spans).reduce((total, [a, b]) => total + b - a, 0);
function bindingSpan(binding: BindingPayload, from: string, to: string, now: string): Span {
  return [Math.max(Date.parse(from), Date.parse(binding.validFrom)), Math.min(Date.parse(to), Date.parse(binding.validTo ?? now), Date.parse(now))];
}
async function observedSpan(store: OperationsStore, binding: BindingPayload, span: Span, intervals: ServingInterval[], now: string) {
  const [from, to] = span, spans: Span[] = intervals.filter(row => ['good', 'estimated'].includes(row.quality)).map(row => [Math.max(from, Date.parse(row.started_at)), Math.min(to, Date.parse(row.ended_at))]);
  const config = binding.measurement;
  if (to <= from) return { expected: 0, observed: 0, evidence: false };
  if (!config) return { expected: to - from, observed: duration(spans), evidence: intervals.length > 0 };
  const sampleFrom = new Date(Math.max(Date.parse(binding.validFrom), from - config.maxSampleGapMs)).toISOString(), sampleTo = new Date(Math.min(Date.parse(binding.validTo ?? new Date(to).toISOString()), to + config.maxSampleGapMs)).toISOString();
  const [sampleRows, eventRows, priorFault] = await Promise.all([
    rows<Row<MeasurementSample>>(store, 'samples', { where: { scale_id: binding.scaleId }, range: { column: 'sampled_at', from: sampleFrom, to: sampleTo, toInclusive: true } }),
    rows<Row<MeasurementEvent>>(store, 'device_events', { where: { scale_id: binding.scaleId, type: ['device_fault', 'device_recovered'] }, range: { column: 'occurred_at', from: sampleFrom, to: sampleTo, toInclusive: true } }),
    readLatestFault(store, binding.scaleId, sampleFrom, now),
  ]);
  const samples = sampleRows.map(decode).filter(s => Date.parse(s.sample.sampledAt) <= Date.parse(now) && Date.parse(s.receivedAt) <= Date.parse(now)).sort((a, b) => Date.parse(a.sample.sampledAt) - Date.parse(b.sample.sampledAt));
  const faultGroups = new Map<number, MeasurementEvent[]>();
  for (const event of [...(priorFault ? [priorFault] : []), ...eventRows.map(decode)].filter(e => Date.parse(e.receivedAt) <= Date.parse(now) && Date.parse(e.event.occurredAt) <= Date.parse(now))) {
    const time = Date.parse(event.event.occurredAt); faultGroups.set(time, [...(faultGroups.get(time) ?? []), event]);
  }
  const faults = [...faultGroups.entries()].sort(([a], [b]) => a - b).map(([, events]) => latestFault(events)!);
  let faultIndex = 0, faultActive = false;
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1].sample, current = samples[i].sample, a = Date.parse(previous.sampledAt), b = Date.parse(current.sampledAt);
    while (faultIndex < faults.length && Date.parse(faults[faultIndex].event.occurredAt) <= a) faultActive = faults[faultIndex++].event.type === 'device_fault';
    const faultBefore = faultActive; let faultDuring = false;
    while (faultIndex < faults.length && Date.parse(faults[faultIndex].event.occurredAt) <= b) { faultActive = faults[faultIndex++].event.type === 'device_fault'; faultDuring ||= faultActive; }
    if (previous.measurementStatus === 'ok' && current.measurementStatus === 'ok' && previous.grossG >= binding.tareG && current.grossG >= binding.tareG && current.bootId === previous.bootId && current.sequence > previous.sequence && b > a && b - a <= config.maxSampleGapMs && !faultBefore && !faultDuring) spans.push([Math.max(from, a), Math.min(to, b)]);
  }
  return { expected: to - from, observed: duration(spans), evidence: intervals.length > 0 || samples.length > 0 };
}
/** Missing evidence on any simultaneously supplied bowl prevents a whole-dish empty claim. */
export function wholeDishStockout(bindings: { binding: BindingPayload; span: Span }[], intervals: ServingInterval[]): number | null {
  const points = new Map<number, { type: 'binding' | 'evidence'; id: string; value: number; start: boolean }[]>();
  const add = (time: number, event: { type: 'binding' | 'evidence'; id: string; value: number; start: boolean }) => points.set(time, [...(points.get(time) ?? []), event]);
  const windows = new Map(bindings.filter(item => item.span[1] > item.span[0]).map(item => [item.binding.id, item.span]));
  for (const [id, [a, b]] of windows) { add(a, { type: 'binding', id, value: 0, start: true }); add(b, { type: 'binding', id, value: 0, start: false }); }
  for (const row of intervals) {
    const span = windows.get(row.binding_id); if (!span || row.quality !== 'good') continue;
    const payload = JSON.parse(row.payload) as { foodKnown?: boolean; nonEmpty?: boolean }; if (!payload.foodKnown || !row.empty && !payload.nonEmpty) continue;
    const a = Math.max(span[0], Date.parse(row.started_at)), b = Math.min(span[1], Date.parse(row.ended_at)); if (b <= a) continue;
    add(a, { type: 'evidence', id: row.binding_id, value: row.empty, start: true }); add(b, { type: 'evidence', id: row.binding_id, value: row.empty, start: false });
  }
  const active = new Set<string>(), evidence = new Map<string, { empty: number; food: number }>();
  const times = [...points.keys()].sort((a, b) => a - b); let stockout = 0, unknown = false, covered = false;
  for (let i = 0; i < times.length - 1; i++) {
    const time = times[i];
    for (const event of points.get(time)!.sort((a, b) => Number(a.start) - Number(b.start))) {
      if (event.type === 'binding') { if (event.start) active.add(event.id); else active.delete(event.id); }
      else { const count = evidence.get(event.id) ?? { empty: 0, food: 0 }; count[event.value ? 'empty' : 'food'] += event.start ? 1 : -1; evidence.set(event.id, count); }
    }
    if (!active.size) continue; covered = true;
    const states = [...active].map(id => evidence.get(id));
    if (states.some(state => state && state.food > 0)) continue;
    if (states.every(state => state && state.empty > 0)) stockout += times[i + 1] - time;
    else unknown = true;
  }
  return covered && !unknown ? stockout / 60000 : null;
}

export async function buildConfirmedReport(store: OperationsStore, input: EndpointContext<'report'>['query'], now: string): Promise<ConfirmedReport> {
  if (input.basis !== 'cycle_balance_v2') throw new OperationsError('UNAVAILABLE');
  const interval = range(input.startDate, input.endDate), filter: Record<string, string> = input.dishId ? { dish_id: input.dishId } : {};
  for (let attempt = 0; attempt < 5; attempt++) {
    const revision = await store.revision();
    const [ledger, active, ended, jobs, intervals] = await Promise.all([
      rows<LedgerRow>(store, 'ledger', { where: { current: 1 }, range: { column: 'effective_at', from: interval.from, to: interval.to, toInclusive: false } }),
      rows<Row<BindingPayload>>(store, 'bindings', { where: { ...filter, valid_to: null }, range: { column: 'valid_from', to: interval.to, toInclusive: false } }),
      rows<Row<BindingPayload>>(store, 'bindings', { where: filter, ranges: [{ column: 'valid_from', to: interval.to, toInclusive: false }, { column: 'valid_to', from: interval.from, fromInclusive: false }] }),
      rows<Row<unknown> & { scope: string; status: string }>(store, 'jobs', { notIn: { status: ['complete'] } }),
      rows<ServingInterval>(store, 'serving_intervals', { where: input.dishId ? { dish_id: input.dishId } : {}, ranges: [{ column: 'started_at', to: interval.to, toInclusive: false }, { column: 'ended_at', from: interval.from, fromInclusive: false }] }),
    ]);
    const buckets = new Map<string, { name: string; nameAt: string; totalMg: number | null; pending: number; confirmed: number; comparable: number; missingBoundary: boolean; dates: Set<string>; crossDay: boolean }>();
    const ensure = (id: string, name: string, at: string) => {
      let bucket = buckets.get(id);
      if (!bucket) { bucket = { name, nameAt: at, totalMg: null, pending: 0, confirmed: 0, comparable: 0, missingBoundary: false, dates: new Set(), crossDay: false }; buckets.set(id, bucket); }
      else if (at >= bucket.nameAt) { bucket.name = name; bucket.nameAt = at; }
      return bucket;
    };
    const bindings = [...new Map([...active, ...ended].map(record => [record.id, decode(record)])).values()];
    for (const binding of bindings) ensure(binding.dishId, binding.dishName, binding.validFrom);
    const coverage = await Promise.all(bindings.map(async binding => ({ binding, span: bindingSpan(binding, interval.from, interval.to, now), result: await observedSpan(store, binding, bindingSpan(binding, interval.from, interval.to, now), intervals.filter(row => row.binding_id === binding.id), now) })));
    let asOf: string | null = null;
    for (const record of ledger) {
      const payload = decode<LedgerPayload>(record), cycle = payload.cycle;
      if (input.dishId && cycle.dishId !== input.dishId) continue;
      // A pending closed cycle has a real date; an open cycle has none and must not be invented here.
      if (!cycle.returnedAt || Date.parse(cycle.returnedAt) > Date.parse(now) || day(cycle.returnedAt) < input.startDate || day(cycle.returnedAt) > input.endDate) continue;
      const bucket = ensure(cycle.dishId, payload.dishName, cycle.returnedAt);
      bucket.dates.add(day(cycle.returnedAt)); bucket.crossDay ||= payload.calculation.crossDay;
      bucket.comparable++; bucket.missingBoundary ||= cycle.qualityReasons.some(reason => ['MISSING_EXIT', 'MISSING_RETURN', 'BOUNDARY_CONFLICT'].includes(reason));
      if (!asOf || Date.parse(cycle.returnedAt) > Date.parse(asOf)) asOf = cycle.returnedAt;
      if (cycle.status === 'confirmed') {
        if (record.weight_mg === null || cycle.confirmedTakeG === null || Math.round(cycle.confirmedTakeG * 1000) !== record.weight_mg) throw new OperationsError('INTERNAL_ERROR');
        bucket.totalMg = addMg(bucket.totalMg ?? 0, record.weight_mg); bucket.confirmed++;
      } else if (cycle.status === 'pending') bucket.pending++;
    }
    const sorted = [...buckets.entries()].sort(([a, x], [b, y]) => (y.totalMg ?? -1) - (x.totalMg ?? -1) || a.localeCompare(b, 'en'));
    let rank = 0, totalMg: number | null = null, pendingCycles = 0;
    const result: ReportRow[] = sorted.map(([dishId, item]) => {
      if (item.totalMg !== null) totalMg = addMg(totalMg ?? 0, item.totalMg);
      pendingCycles += item.pending;
      const dishCoverage = coverage.filter(item => item.binding.dishId === dishId), expected = dishCoverage.reduce((sum, item) => sum + item.result.expected, 0);
      const observationCoverage = expected > 0 && dishCoverage.some(item => item.result.evidence) ? Math.min(1, dishCoverage.reduce((sum, item) => sum + item.result.observed, 0) / expected) : null;
      const cycleCoverage = item.comparable > 0 && !item.missingBoundary ? item.confirmed / item.comparable : null;
      const stockoutMinutes = wholeDishStockout(dishCoverage, intervals.filter(row => row.dish_id === dishId));
      const qualityReasons: ReportRow['qualityReasons'] = [];
      if (observationCoverage === null || cycleCoverage === null || stockoutMinutes === null) qualityReasons.push('UNKNOWN_COVERAGE');
      if (item.totalMg === null) qualityReasons.push('NO_DATA');
      if (observationCoverage !== 1 || cycleCoverage !== 1) qualityReasons.push('PARTIAL_COVERAGE');
      if (item.pending) qualityReasons.push('PENDING_CYCLES');
      if (item.crossDay) qualityReasons.push('CROSS_DAY');
      if (stockoutMinutes !== null && stockoutMinutes > 0) qualityReasons.push('STOCKOUT');
      const rankable = item.totalMg !== null && (item.totalMg > 0 || observationCoverage === 1 && cycleCoverage === 1);
      const suppliedDates = new Set<string>();
      for (const { span: [from, to] } of dishCoverage) if (to > from) {
        for (let time = Date.parse(day(new Date(from).toISOString()) + 'T00:00:00+08:00'); time < to; time += 86400000) suppliedDates.add(day(new Date(time).toISOString()));
      }
      const hasBindingEvidence = dishCoverage.length > 0;
      return { dishId, name: item.name, rank: rankable ? ++rank : null, confirmedTakeG: item.totalMg === null ? null : item.totalMg / 1000, pendingCycles: item.pending, observationCoverage, cycleCoverage, stockoutMinutes, recordedDays: item.dates.size, operatingDays: hasBindingEvidence ? suppliedDates.size : null, operatingDaysBasis: hasBindingEvidence ? 'binding_schedule' : 'unknown', qualityReasons };
    });
    const relevantJobs = jobs.filter(job => /^(projection|measurement)(:|$)/.test(job.scope));
    const projectionStatus = relevantJobs.some(job => job.status === 'failed') ? 'failed' : relevantJobs.length ? 'rebuilding' : 'ready';
    if (await store.revision() !== revision) continue;
    return reportResponseSchema.parse({ ...operationsMeta(store, now, revision), basis: 'cycle_balance_v2', scope: { startDate: input.startDate, endDate: input.endDate, timeZone: 'Asia/Shanghai', dateAttribution: 'cycle_end' }, projectionStatus, asOf: asOf ?? now, nextCursor: null, totals: { confirmedTakeG: totalMg === null ? null : totalMg / 1000, pendingCycles, dishCount: result.length }, rows: result }) as ConfirmedReport;
  }
  throw new OperationsError('UNAVAILABLE');
}
async function report(context: EndpointContext<'report'>) {
  requirePermission(context.principal, 'staff');
  let snapshotAt = context.now;
  if (context.query.cursor) {
    try { snapshotAt = timestamp.parse(JSON.parse(decodeURIComponent(context.query.cursor)).snapshotAt); }
    catch { throw new OperationsError('INVALID_REQUEST'); }
    if (Date.parse(snapshotAt) > Date.parse(context.now)) throw new OperationsError('INVALID_REQUEST');
  }
  const result = await buildConfirmedReport(context.store, context.query, snapshotAt), revision = Number(result.dataRevision.split(':').at(-1));
  const key = await tokenHash(JSON.stringify([context.store.generation, context.query.startDate, context.query.endDate, context.query.basis, context.query.dishId ?? null]));
  const offset = cursor(context.query.cursor, revision, key), selected = result.rows.slice(offset, offset + context.query.limit);
  return { ...result, rows: selected, nextCursor: offset + selected.length < result.rows.length ? encodeURIComponent(JSON.stringify({ revision, key, snapshotAt, offset: offset + selected.length })) : null };
}
export function csvCell(value: string | number | null) {
  let text = value === null ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
async function exportReport(context: EndpointContext<'exportReport'>) {
  requirePermission(context.principal, 'staff');
  if (Date.parse(context.query.snapshotAt) > Date.parse(context.now)) throw new OperationsError('INVALID_REQUEST');
  const result = await buildConfirmedReport(context.store, reportQuerySchema.parse({ startDate: context.query.startDate, endDate: context.query.endDate, basis: context.query.basis, dishId: context.query.dishId, sort: context.query.sort }), context.query.snapshotAt);
  if (result.projectionStatus !== 'ready') throw new OperationsError('REPORT_REBUILDING');
  if (result.dataRevision !== context.query.dataRevision) throw new OperationsError('REPORT_REVISION_CHANGED');
  const header = ['dataRevision', 'snapshotAt', 'basis', 'dateAttribution', 'timeZone', 'startDate', 'endDate', 'dishId', 'name', 'rank', 'confirmedTakeG', 'pendingCycles', 'observationCoverage', 'cycleCoverage', 'stockoutMinutes', 'recordedDays', 'operatingDays', 'operatingDaysBasis', 'qualityReasons'];
  const body = result.rows.map(row => [result.dataRevision, result.serverAt, result.basis, result.scope.dateAttribution, result.scope.timeZone, result.scope.startDate, result.scope.endDate, row.dishId, row.name, row.rank, row.confirmedTakeG, row.pendingCycles, row.observationCoverage, row.cycleCoverage, row.stockoutMinutes, row.recordedDays, row.operatingDays, row.operatingDaysBasis, row.qualityReasons.join('|')]);
  return '\uFEFF' + [header, ...body].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export const reportServices = { report, exportReport } satisfies OperationsServices;
