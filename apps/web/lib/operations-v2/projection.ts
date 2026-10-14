import { identifyKitchenVisits, type VisitRecord } from './kitchen-visits.ts';
import { readKitchenSettings } from './kitchen-settings.ts';
import { taskWrite } from './task-state.ts';
import type { TaskPayload } from './records.ts';
import { projectBindingMeasurement, gramsToMg, type MeasurementSample, type MeasurementEvent } from './measurement.ts';
import { canonical, decode, type BindingPayload, type CyclePayload, type OperationRecord, type Row, type DevicePayload } from './records.ts';
import { OperationsStore, type OperationsTable, type OperationsQuery, type Write } from './storage.ts';
import { reconcileServing } from './serving-coordinator.ts';
import { latestFault, readLatestFault } from './fault-state.ts';

export async function history<T extends { id: string }>(store: OperationsStore, table: OperationsTable, query: OperationsQuery = {}): Promise<T[]> {
  const result: T[] = []; let afterId: string | undefined;
  for (;;) { const page = await store.query<T>(table, { ...query, orderBy: [{ column: 'id', direction: 'asc' }], afterId, limit: 1000 }); result.push(...page); if (page.length < 1000) return result; afterId = page.at(-1)!.id; }
}
type Job = { id: string; status: string; desired_revision: number; lease_until: string | null; attempts: number; payload: string };
type JobPayload = { bindingId: string; requestedAt: string; leaseId?: string; completedAt?: string; error?: string; nextRunAt?: string };

/** Attestation requires two immutable, contemporaneous readings, same boot and
 * binding, with a measured delta. Merely typing evidence IDs is not evidence. */
export function attestOperation(operation: OperationRecord, samples: MeasurementSample[], binding: BindingPayload, operations: OperationRecord[], context: { events: MeasurementEvent[]; priorFault: MeasurementEvent | null; asOf: string }): OperationRecord {
  const input = operation.input, config = binding.measurement;
  if (input.quantityStatus !== 'measured' || input.weightG === null || !config || !['food_refill', 'ice_add', 'drain', 'partial_remove'].includes(input.type)) return { ...operation, status: 'pending_review' };
  const evidence = samples.filter(s => input.evidenceIds.includes(s.id) && s.sample.measurementStatus === 'ok');
  if (evidence.length !== 2 || input.evidenceIds.length !== 2) return { ...operation, status: 'pending_review' };
  evidence.sort((a, b) => Date.parse(a.sample.sampledAt) - Date.parse(b.sample.sampledAt));
  const [before, after] = evidence, at = Date.parse(input.occurredAt), a = Date.parse(before.sample.sampledAt), b = Date.parse(after.sample.sampledAt);
  const window = config.boundaryWindowMs ?? 0;
  if (b > Date.parse(context.asOf) || evidence.some(s => Date.parse(s.receivedAt) > Date.parse(context.asOf))) return { ...operation, status: 'pending_review' };
  const readings = samples.filter(s => Date.parse(s.sample.sampledAt) >= a && Date.parse(s.sample.sampledAt) <= b).sort((x, y) => Date.parse(x.sample.sampledAt) - Date.parse(y.sample.sampledAt));
  const events = [...(context.priorFault ? [context.priorFault] : []), ...context.events].filter(e => Date.parse(e.receivedAt) <= Date.parse(context.asOf)).sort((x, y) => Date.parse(x.event.occurredAt) - Date.parse(y.event.occurredAt) || ('eventSequence' in x.event && 'eventSequence' in y.event ? x.event.eventSequence - y.event.eventSequence : x.event.eventId.localeCompare(y.event.eventId)));
  const faultBefore = latestFault(events, a);
  const interrupted = faultBefore?.event.type === 'device_fault' || events.some(e => Date.parse(e.event.occurredAt) > a && Date.parse(e.event.occurredAt) <= b)
    || readings.some((s, i) => s.sample.measurementStatus !== 'ok' || s.sample.grossG < binding.tareG || s.sample.bootId !== before.sample.bootId || i > 0 && (s.sample.sequence <= readings[i - 1].sample.sequence || Date.parse(s.sample.sampledAt) - Date.parse(readings[i - 1].sample.sampledAt) > config.maxSampleGapMs));
  if (interrupted) return { ...operation, status: 'pending_review' };
  const lineage = new Set([operation.id]); let changed = true;
  while (changed) { changed = false; for (const item of operations) if (item.input.correctsOperationId && (lineage.has(item.id) || lineage.has(item.input.correctsOperationId))) {
    if (!lineage.has(item.id) || !lineage.has(item.input.correctsOperationId)) changed = true;
    lineage.add(item.id); lineage.add(item.input.correctsOperationId);
  } }
  const superseded = new Set(operations.flatMap(item => item.input.correctsOperationId ? [item.input.correctsOperationId] : []));
  const overlaps = operations.some(other => !lineage.has(other.id) && !superseded.has(other.id) && other.input.bindingId === input.bindingId && Date.parse(other.input.occurredAt) > a && Date.parse(other.input.occurredAt) <= b);
  if (!(a < at && at < b) || at - a > window || b - at > window || b - a > config.maxSampleGapMs || before.sample.bootId !== after.sample.bootId || before.sample.sequence >= after.sample.sequence || overlaps) return { ...operation, status: 'pending_review' };
  const delta = gramsToMg((after.sample as { grossG: number }).grossG) - gramsToMg((before.sample as { grossG: number }).grossG);
  const expected = gramsToMg(input.weightG) * (['food_refill', 'ice_add'].includes(input.type) ? 1 : -1);
  return { ...operation, status: Math.abs(delta - expected) <= gramsToMg(config.negativeToleranceG) ? 'matched' : 'pending_review' };
}
function semanticCycle(payload: CyclePayload) {
  const cycle = Object.fromEntries(Object.entries(payload.cycle).filter(([key]) => key !== 'version'));
  const calculation = Object.fromEntries(Object.entries(payload.calculation).filter(([key]) => !['asOf', 'evidenceBundleId'].includes(key)));
  return canonical({ cycle: { ...cycle, evidenceIds: payload.cycle.evidenceIds.map(id => id.startsWith('evidence:cycle:') ? id.replace(/:v\d+$/, '') : id) }, calculation });
}

async function projectJob(store: OperationsStore, id: string, leaseId: string, now: string) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const revision = await store.revision(), row = await store.get<Job>('jobs', id);
    if (!row || row.status !== 'running' || (JSON.parse(row.payload) as JobPayload).leaseId !== leaseId) return;
    const job = JSON.parse(row.payload) as JobPayload, bindingRow = await store.get<Row<BindingPayload>>('bindings', job.bindingId);
    if (!bindingRow) throw new Error('Missing binding');
    const binding = decode(bindingRow), deviceRow = await store.get<Row<DevicePayload>>('devices', binding.scaleId);
    const config = binding.measurement;
    // An unconfigured scale has no authoritative projection. Its UI remains unknown.
    if (!config) {
      if (await store.transact(revision, [{ type: 'update', table: 'jobs', id, values: { status: 'complete', lease_until: null, payload: JSON.stringify({ ...job, completedAt: now }) } }])) return;
      continue;
    }
    const [sampleRows, eventRows, operationRows, previousRows, priorFault] = await Promise.all([
      history<Row<MeasurementSample>>(store, 'samples', { where: { scale_id: binding.scaleId }, range: { column: 'sampled_at', from: binding.validFrom, ...(binding.validTo ? { to: binding.validTo } : {}) } }),
      history<Row<MeasurementEvent>>(store, 'device_events', { where: { scale_id: binding.scaleId }, range: { column: 'occurred_at', from: binding.validFrom, ...(binding.validTo ? { to: binding.validTo } : {}) } }),
      history<Row<OperationRecord>>(store, 'operations', { where: { binding_id: binding.id } }),
      history<Row<CyclePayload>>(store, 'cycles', { where: { binding_id: binding.id } }),
      readLatestFault(store, binding.scaleId, binding.validFrom, now),
    ]);
    const samples = sampleRows.map(decode), originalOperations = operationRows.map(decode);
    const events = eventRows.map(decode);
    const operations = originalOperations.map(op => attestOperation(op, samples, binding, originalOperations, { events, priorFault, asOf: now }));
    const previous = new Map(previousRows.map(row => [row.id, decode(row)]));
    const version = Math.max(-1, ...previousRows.map(r => decode(r).cycle.version)) + 1;
    const settings = await readKitchenSettings(store);
    const input = { binding, config, samples, events, operations, asOf: now, version, priorFault };
    const oldVisits = (await history<Row<VisitRecord>>(store, 'kitchen_visits', {where:{binding_id:binding.id}})).map(decode);
    // Keep re-evaluating existing history even while recognition is disabled. New visits
    // are admitted only after the current explicit activation, never backfilled.
    const starts = [...oldVisits.map(v=>v.current.enteredAt), ...(settings.enabledAt ? [settings.enabledAt] : [])].sort();
    const visits = identifyKitchenVisits(input, starts[0] ?? null).filter(v=>oldVisits.some(old=>old.current.id===v.id) || settings.config.automaticRefillEnabled && settings.enabledAt !== null && v.enteredAt >= settings.enabledAt);
    for(const prior of oldVisits)if(!visits.some(v=>v.id===prior.current.id))visits.push({...prior.current,status:'invalidated',refillG:null,reasonCodes:['BOUNDARY_REBUILT']});
    const projection = projectBindingMeasurement({ ...input, kitchenRefills: visits.filter(v=>v.status==='refill') });
    const writes: Write[] = [];
    {
      for(const current of visits){
        const old=oldVisits.find(v=>v.current.id===current.id);current.version=old?.current.version??0;
        if(old&&canonical(old.current)===canonical(current))continue;
        current.version=(old?.current.version??-1)+1;
        writes.push({type:'upsert',table:'kitchen_visits',values:{id:current.id,binding_id:binding.id,payload:JSON.stringify({current,revisions:old?[...old.revisions,old.current]:[]})}});
      }
      const taskRows=(await history<Row<TaskPayload>>(store,'tasks',{where:{binding_id:binding.id}})).map(decode);
      let hasActive=taskRows.some(t=>!['resolved','cancelled'].includes(t.task.status));
      for(const payload of taskRows){
        if(payload.task.status!=='resolved'||!payload.completionVisitId)continue;
        const current=visits.find(v=>v.id===payload.completionVisitId);
        if(!current||current.version===payload.completionVisitVersion)continue;
        const previousVersion=payload.task.version;
        payload.task={...payload.task,status:hasActive?'cancelled':'open',assignee:null,verificationMethod:null,allowedActions:[],version:previousVersion+1,updatedAt:now};hasActive=true;
        payload.systemHistory=[...(payload.systemHistory??[]),{at:now,event:'auto_evidence_invalidated',fromVersion:previousVersion,toVersion:payload.task.version,evidenceIds:[current.id]}];
        delete payload.completionVisitId;delete payload.completionVisitVersion;
        writes.push(taskWrite(payload,false));
      }
    }
    for (const operation of operations) if (originalOperations.find(o => o.id === operation.id)!.status !== operation.status) writes.push({ type: 'update', table: 'operations', id: operation.id, values: { payload: JSON.stringify(operation) } });
    for (const cycle of projection.cycles) {
      const old = previous.get(cycle.id), calculation = projection.cycleCalculations.find(c => c.cycleId === cycle.id)!;
      const reviews = await history<{ id: string; payload: string }>(store, 'cycle_reviews', { where: { cycle_id: cycle.id } });
      reviews.sort((a, b) => (JSON.parse(b.payload) as { reviewedVersion: number }).reviewedVersion - (JSON.parse(a.payload) as { reviewedVersion: number }).reviewedVersion);
      const decision = reviews[0] ? (JSON.parse(reviews[0].payload) as { decision: string }).decision : null;
      if (decision === 'invalidate' || decision === 'keep_pending') {
        cycle.status = decision === 'invalidate' ? 'invalidated' : 'pending'; cycle.confirmedTakeG = null; cycle.effectiveAt = null;
      }
      const payload: CyclePayload = { cycle, calculation, revisions: old ? [...old.revisions, old.cycle] : [] };
      if (old && semanticCycle(old) === semanticCycle(payload)) continue;
      writes.push({ type: 'upsert', table: 'cycles', values: { id: cycle.id, binding_id: binding.id, exit_event_id: cycle.exitEventId, return_event_id: cycle.returnEventId, status: cycle.status, version: cycle.version, effective_at: cycle.returnedAt ? new Date(cycle.returnedAt).toISOString() : null, payload: JSON.stringify(payload) } });
      const ledgerRows = await store.query<{ id: string }>('ledger', { where: { cycle_id: cycle.id, current: 1 } });
      writes.push(...ledgerRows.map(row => ({ type: 'update' as const, table: 'ledger' as const, id: row.id, values: { current: 0 } })));
      if (cycle.returnedAt) writes.push({ type: 'insert', table: 'ledger', values: { id: `${cycle.id}:v${cycle.version}`, cycle_id: cycle.id, version: cycle.version, current: 1,
        effective_at: new Date(cycle.returnedAt).toISOString(), weight_mg: cycle.confirmedTakeG === null ? null : gramsToMg(cycle.confirmedTakeG), payload: JSON.stringify({ cycle, calculation, dishName: binding.dishName, recordedAt: now }) } });
    }
    // A late boundary can replace an orphan cycle. Preserve it as an invalidated
    // historical revision before releasing unique boundary ownership.
    for (const [cycleId, old] of previous) if (!projection.cycles.some(c => c.id === cycleId) && old.cycle.status !== 'invalidated') {
      const cycle = { ...old.cycle, version, status: 'invalidated' as const, confirmedTakeG: null, effectiveAt: null };
      writes.unshift({ type: 'update', table: 'cycles', id: cycleId, values: { exit_event_id: null, return_event_id: null, status: 'invalidated', version, effective_at: null, payload: JSON.stringify({ ...old, cycle, revisions: [...old.revisions, old.cycle] }) } });
      for (const row of await store.query<{ id: string }>('ledger', { where: { cycle_id: cycleId, current: 1 } })) writes.unshift({ type: 'update', table: 'ledger', id: row.id, values: { current: 0 } });
    }
    if (deviceRow && decode(deviceRow).bindingId === binding.id && projection.observation.observedAt) writes.push({ type: 'upsert', table: 'latest', values: { id: binding.scaleId, sampled_at: new Date(projection.observation.observedAt).toISOString(), received_at: samples.find(s => s.sample.sampledAt === projection.observation.observedAt)?.receivedAt ?? now,
      payload: JSON.stringify({ bindingId: binding.id, observation: projection.observation }) } });
    const futureTimes = [...samples.filter(s => Date.parse(s.receivedAt) <= Date.parse(now)).map(s => s.sample.sampledAt), ...events.filter(e => Date.parse(e.receivedAt) <= Date.parse(now)).map(e => e.event.occurredAt)].filter(time => Date.parse(time) > Date.parse(now));
    const nextRunAt = futureTimes.length ? new Date(Math.min(...futureTimes.map(Date.parse))).toISOString() : undefined;
    writes.push({ type: 'update', table: 'jobs', id, values: { status: nextRunAt ? 'pending' : 'complete', lease_until: null, payload: JSON.stringify({ ...job, nextRunAt, completedAt: nextRunAt ? undefined : now }) } });
    if (await store.transact(revision, writes)) return;
  }
  throw new Error('Projection contention');
}

/** Also called by the Worker scheduler, so browser closure is not a job runner. */
export async function runOperationsJobs(store: OperationsStore, now = new Date().toISOString(), limit = 100) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid job limit');
  const candidates = (await history<Job>(store, 'jobs', { where: { scope: 'measurement', status: ['pending', 'running', 'failed'] } }))
    .filter(row => !(row.status === 'running' && row.lease_until && row.lease_until > now) && !((JSON.parse(row.payload) as JobPayload).nextRunAt && (JSON.parse(row.payload) as JobPayload).nextRunAt! > now))
    .sort((a, b) => a.attempts - b.attempts || ((JSON.parse(a.payload) as JobPayload).requestedAt ?? '').localeCompare((JSON.parse(b.payload) as JobPayload).requestedAt ?? '') || a.id.localeCompare(b.id)).slice(0, limit);
  let completed = 0;
  for (const candidate of candidates) {
    if (candidate.status === 'running' && candidate.lease_until && candidate.lease_until > now) continue;
    const revision = await store.revision(), row = await store.get<Job>('jobs', candidate.id);
    if (!row || row.status === 'complete' || row.status === 'running' && row.lease_until && row.lease_until > now) continue;
    const leaseId = crypto.randomUUID(), payload = { ...JSON.parse(row.payload), leaseId } as JobPayload;
    if (!await store.transact(revision, [{ type: 'update', table: 'jobs', id: row.id, values: { status: 'running', lease_until: new Date(Date.parse(now) + 60000).toISOString(), attempts: row.attempts + 1, payload: JSON.stringify(payload) } }])) continue;
    try { await projectJob(store, row.id, leaseId, now); completed++; }
    catch {
      const rev = await store.revision(), current = await store.get<Job>('jobs', row.id);
      if (current && (JSON.parse(current.payload) as JobPayload).leaseId === leaseId) await store.transact(rev, [{ type: 'update', table: 'jobs', id: row.id, values: { status: 'failed', lease_until: null, payload: JSON.stringify({ ...payload, error: 'PROJECTION_FAILED', nextRunAt: new Date(Date.parse(now) + Math.min(60000, 1000 * 2 ** Math.min(row.attempts, 6))).toISOString() }) } }]);
    }
  }
  await reconcileServing(store, now);
  return { completed };
}
