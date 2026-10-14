import { cycleSchema, type Cycle } from '@zhishan/contracts/v2/operations';
import { canonical, decode, mutate, operationsMeta, type BindingPayload, type CyclePayload, type DevicePayload, type OperationRecord, type Row } from './records.ts';
import { OperationsError } from './security.ts';
import { projectionJob } from './configuration.ts';
import { history } from './projection.ts';
import { utc } from './telemetry.ts';
import type { EndpointContext, OperationsServices } from './router.ts';
import type { OperationsStore, Write } from './storage.ts';

async function bindingAt(store: OperationsStore, id: string, at: string) {
  const row = await store.get<Row<BindingPayload>>('bindings', id);
  if (!row) throw new OperationsError('NOT_FOUND');
  const binding = decode(row), time = Date.parse(at);
  if (time < Date.parse(binding.validFrom) || binding.validTo && time >= Date.parse(binding.validTo)) throw new OperationsError('INVALID_TRANSITION');
  return binding;
}
async function operation(c: EndpointContext<'operation'>) {
  return mutate(c, 'operation', c.body.requestId, c.body, async revision => {
    const input = c.body;
    if (Date.parse(input.occurredAt) > Date.parse(c.now)) throw new OperationsError('INVALID_REQUEST');
    const targetRow = input.correctsOperationId ? await c.store.get<Row<OperationRecord>>('operations', input.correctsOperationId) : null;
    const target = targetRow ? decode(targetRow) : null;
    if (input.correctsOperationId && !target) throw new OperationsError('NOT_FOUND');
    if (target && (target.version !== input.expectedVersion || (await c.store.query('operations', { where: { corrects_id: target.id }, limit: 1 })).length)) throw new OperationsError('VERSION_CONFLICT', target.version);
    if (target && (target.input.bindingId !== input.bindingId || target.input.type !== input.type)) throw new OperationsError('INVALID_REQUEST');
    const bindingRow = await c.store.get<Row<BindingPayload>>('bindings', input.bindingId);
    if (!bindingRow) throw new OperationsError('NOT_FOUND');
    const binding = decode(bindingRow);
    const physical = input.type === 'remove_container' || input.type === 'replace_container';
    if (target && physical) {
      const identity = (value: OperationRecord['input']) => Object.fromEntries(Object.entries(value).filter(([key]) => !['requestId', 'expectedVersion', 'correctsOperationId', 'quantityStatus', 'weightG', 'evidenceIds', 'note'].includes(key)));
      if (canonical(identity(input)) !== canonical(identity(target.input))) throw new OperationsError('INVALID_TRANSITION');
    } else await bindingAt(c.store, input.bindingId, input.occurredAt);
    const record: OperationRecord = { id: crypto.randomUUID(), version: target ? target.version + 1 : 0, input, actor: c.principal.actor, recordedAt: c.now, status: 'pending_review' };
    const writes: Write[] = [{ type: 'insert', table: 'operations', values: { id: record.id, binding_id: binding.id, occurred_at: utc(input.occurredAt), version: record.version, corrects_id: input.correctsOperationId ?? null, payload: JSON.stringify(record) } }];
    if ('expectedBindingVersion' in input) {
      if (!target && binding.version !== input.expectedBindingVersion) throw new OperationsError('VERSION_CONFLICT', binding.version);
      if (input.freshnessBatchId !== binding.freshnessBatchId) throw new OperationsError('INVALID_TRANSITION');
      writes.push({ type: 'insert', table: 'freshness_actions', values: { id: record.id, binding_id: binding.id, batch_id: binding.freshnessBatchId, operation_id: record.id, occurred_at: utc(input.occurredAt), payload: JSON.stringify({ operationId: record.id, correctsOperationId: input.correctsOperationId ?? null, disposition: input.disposition, reason: input.reason, quantityStatus: input.quantityStatus, weightG: input.weightG, actor: record.actor }) } });
      if (input.type === 'partial_remove' && !target) writes.push({ type: 'update', table: 'bindings', id: binding.id, values: { version: binding.version + 1, payload: JSON.stringify({ ...binding, version: binding.version + 1 }) } });
    }
    if (physical && !target) {
      if (binding.validTo || Date.parse(input.occurredAt) <= Date.parse(binding.validFrom)) throw new OperationsError('INVALID_TRANSITION');
      const closed = { ...binding, validTo: utc(input.occurredAt), version: binding.version + 1 };
      writes.push({ type: 'update', table: 'bindings', id: binding.id, values: { valid_to: closed.validTo, version: closed.version, payload: JSON.stringify(closed) } });
      if (binding.freshnessBatchId) writes.push({ type: 'update', table: 'freshness_batches', id: binding.freshnessBatchId, values: { closed_at: closed.validTo } });
      const deviceRow = await c.store.get<Row<DevicePayload & { version?: number }>>('devices', binding.scaleId);
      if (!deviceRow) throw new OperationsError('NOT_FOUND');
      const device = decode(deviceRow);
      if (device.bindingId !== binding.id) throw new OperationsError('INVALID_TRANSITION');
      device.bindingId = null; device.updatedAt = c.now; device.version = (device.version ?? 0) + 1;
      if (input.type === 'replace_container') {
        if (input.newBatch && Date.parse(input.newBatch.startedAt) > Date.parse(c.now)) throw new OperationsError('INVALID_REQUEST');
        const named = (await c.store.query<Row<BindingPayload>>('bindings', { where: { dish_id: input.newBinding.dishId }, limit: 1 }))[0];
        if (!named) throw new OperationsError('NOT_FOUND');
        const replacement: BindingPayload = { ...input.newBinding, id: crypto.randomUUID(), scaleId: binding.scaleId, dishName: decode(named).dishName, foodOnly: decode(named).foodOnly, measurement: device.measurement,
          validFrom: utc(input.occurredAt), validTo: null, version: 0, freshnessBatchId: input.newBatch ? crypto.randomUUID() : null };
        device.bindingId = replacement.id;
        writes.push({ type: 'insert', table: 'bindings', values: { id: replacement.id, scale_id: replacement.scaleId, dish_id: replacement.dishId, valid_from: replacement.validFrom, valid_to: null, version: 0, payload: JSON.stringify(replacement) } }, projectionJob(replacement.id, revision + 1, c.now));
        if (input.newBatch) {
          const freshnessRule = await c.store.get<Row<unknown>>('freshness_rules', replacement.dishId);
          writes.push({ type: 'insert', table: 'freshness_batches', values: { id: replacement.freshnessBatchId!, binding_id: replacement.id, started_at: utc(input.newBatch.startedAt), closed_at: null, payload: JSON.stringify({ ...input.newBatch, operationId: record.id, ruleSnapshot: freshnessRule ? decode(freshnessRule) : null }) } });
        }
      }
      writes.push({ type: 'update', table: 'devices', id: device.id, values: { updated_at: c.now, payload: JSON.stringify(device) } });
    }
    for (const interval of await history<{ id: string }>(c.store, 'serving_intervals', { where: { binding_id: binding.id }, range: { column: 'ended_at', from: utc(target && Date.parse(target.input.occurredAt) < Date.parse(input.occurredAt) ? target.input.occurredAt : input.occurredAt) } })) writes.push({ type: 'update', table: 'serving_intervals', id: interval.id, values: { quality: 'pending', empty: 0 } });
    writes.push(projectionJob(binding.id, revision + 1, c.now));
    const affected = await c.store.query<{ id: string }>('cycles', { where: { binding_id: binding.id }, limit: 100 });
    return { writes, response: { ...operationsMeta(c.store, c.now, revision + 1), operation: record, affectedCycleIds: affected.map(r => r.id), projectionStatus: 'rebuilding' as const } };
  });
}
async function boundary(c: EndpointContext<'boundary'>) {
  return mutate(c, 'manual.boundary', c.body.requestId, c.body, async revision => {
    if (Date.parse(c.body.occurredAt) > Date.parse(c.now)) throw new OperationsError('INVALID_REQUEST');
    const binding = await bindingAt(c.store, c.body.bindingId, c.body.occurredAt), eventId = crypto.randomUUID();
    const event = { eventId, scaleId: binding.scaleId, occurredAt: c.body.occurredAt, type: c.body.type };
    return { writes: [{ type: 'insert' as const, table: 'device_events' as const, values: { id: eventId, scale_id: binding.scaleId, boot_id: `manual:${eventId}`, event_sequence: 0, occurred_at: utc(event.occurredAt), received_at: c.now, type: event.type, payload_hash: canonical(event), payload: JSON.stringify({ event, receivedAt: c.now, origin: 'manual', actor: c.principal.actor, note: c.body.note }) } }, projectionJob(binding.id, revision + 1, c.now)],
      response: { ...operationsMeta(c.store, c.now, revision + 1), eventId, origin: 'manual' as const, cycleId: null, processingStatus: 'waiting_sample' as const } };
  });
}
async function cycle(c: EndpointContext<'cycle'>) {
  const row = await c.store.get<Row<CyclePayload>>('cycles', c.params.id); if (!row) throw new OperationsError('NOT_FOUND');
  const payload = decode(row), operations = await history<Row<OperationRecord>>(c.store, 'operations', { where: { binding_id: payload.cycle.bindingId } });
  return { ...operationsMeta(c.store, c.now, await c.store.revision()), cycle: payload.cycle, operations: operations.map(decode), revisions: payload.revisions };
}
async function cycles(c: EndpointContext<'cycles'>) {
  const revision = await c.store.revision(); let after = '';
  const filter = canonical({ generation: c.store.generation, ...c.query, cursor: undefined });
  if (c.query.cursor) { try { const cursor = JSON.parse(decodeURIComponent(c.query.cursor)); if (cursor.revision !== revision) throw new OperationsError('REPORT_REVISION_CHANGED'); if (typeof cursor.id !== 'string' || cursor.filter !== filter) throw new OperationsError('INVALID_REQUEST'); after = cursor.id; } catch (error) { if (error instanceof OperationsError) throw error; throw new OperationsError('INVALID_REQUEST'); } }
  const start = Date.parse(`${c.query.startDate}T00:00:00+08:00`), end = Date.parse(`${c.query.endDate}T00:00:00+08:00`) + 86400000;
  const rows = (await history<Row<CyclePayload>>(c.store, 'cycles')).map(decode).map(p => p.cycle).filter(v => v.id > after && (!c.query.dishId || v.dishId === c.query.dishId) && (!c.query.scaleId || v.scaleId === c.query.scaleId) && (!c.query.status || v.status === c.query.status) && Date.parse(v.returnedAt ?? v.exitedAt!) >= start && Date.parse(v.returnedAt ?? v.exitedAt!) < end);
  if (await c.store.revision() !== revision) throw new OperationsError('UNAVAILABLE');
  const selected = rows.slice(0, c.query.limit);
  return { ...operationsMeta(c.store, c.now, revision), rows: selected, nextCursor: rows.length > selected.length ? encodeURIComponent(JSON.stringify({ revision, id: selected.at(-1)!.id, filter })) : null };
}
async function operationHistory(c: EndpointContext<'operationHistory'>) {
  const filter = canonical({ generation: c.store.generation, ...c.query, cursor: undefined }), revision = await c.store.revision(); let offset = 0;
  if (c.query.cursor) { try { const cursor = JSON.parse(decodeURIComponent(c.query.cursor)); if (cursor.revision !== revision) throw new OperationsError('VERSION_CONFLICT'); if (cursor.filter !== filter || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new OperationsError('INVALID_REQUEST'); offset = cursor.offset; } catch (error) { if (error instanceof OperationsError) throw error; throw new OperationsError('INVALID_REQUEST'); } }
  const from = utc(c.query.startDate + 'T00:00:00+08:00'), to = new Date(Date.parse(c.query.endDate + 'T00:00:00+08:00') + 86400000).toISOString();
  const operations = (await history<Row<OperationRecord>>(c.store, 'operations', { where: c.query.bindingId ? { binding_id: c.query.bindingId } : {}, range: { column: 'occurred_at', from, to } })).map(decode).sort((a, b) => Date.parse(b.input.occurredAt) - Date.parse(a.input.occurredAt) || b.id.localeCompare(a.id));
  const records = await Promise.all(operations.slice(offset, offset + c.query.limit).map(async operation => ({ operation, effective: !(await c.store.query('operations', { where: { corrects_id: operation.id }, limit: 1 })).length })));
  if (await c.store.revision() !== revision) throw new OperationsError('UNAVAILABLE');
  return { ...operationsMeta(c.store, c.now, revision), records, nextCursor: offset + records.length < operations.length ? encodeURIComponent(JSON.stringify({ revision, filter, offset: offset + records.length })) : null };
}
async function reviewCycle(c: EndpointContext<'reviewCycle'>) {
  return mutate(c, 'cycle.review', c.body.requestId, { params: c.params, body: c.body }, async revision => {
    const row = await c.store.get<Row<CyclePayload>>('cycles', c.params.id); if (!row) throw new OperationsError('NOT_FOUND');
    const payload = decode(row), old = payload.cycle;
    if (old.version !== c.body.expectedVersion) throw new OperationsError('VERSION_CONFLICT', old.version);
    if (c.body.evidenceIds.some(id => !payload.calculation.evidenceIds.includes(id))) throw new OperationsError('INVALID_REQUEST');
    // Reviewing cannot manufacture missing boundary weights or quantity evidence.
    if (c.body.decision === 'confirm' && (payload.calculation.blockingReasons.length || payload.calculation.rawBalanceMg === null || !old.returnedAt || !old.exitedAt || old.outG === null || old.inG === null)) throw new OperationsError('INVALID_TRANSITION');
    const reviewed: Cycle = cycleSchema.parse({ ...old, version: old.version + 1, status: c.body.decision === 'invalidate' ? 'invalidated' : c.body.decision === 'keep_pending' ? 'pending' : 'confirmed',
      confirmedTakeG: c.body.decision === 'confirm' ? Math.max(0, payload.calculation.rawBalanceMg!) / 1000 : null, effectiveAt: c.body.decision === 'confirm' ? old.returnedAt : null });
    const writes: Write[] = [{ type: 'update', table: 'cycles', id: old.id, values: { version: reviewed.version, status: reviewed.status, effective_at: reviewed.returnedAt ? utc(reviewed.returnedAt) : null, payload: JSON.stringify({ ...payload, cycle: reviewed, revisions: [...payload.revisions, old] }) } },
      { type: 'insert', table: 'cycle_reviews', values: { id: crypto.randomUUID(), cycle_id: old.id, occurred_at: c.now, payload: JSON.stringify({ ...c.body, actor: c.principal.actor, reviewedVersion: reviewed.version }) } }];
    for (const row of await c.store.query<{ id: string }>('ledger', { where: { cycle_id: old.id, current: 1 } })) writes.push({ type: 'update', table: 'ledger', id: row.id, values: { current: 0 } });
    const binding = await c.store.get<Row<BindingPayload>>('bindings', old.bindingId);
    if (reviewed.returnedAt) writes.push({ type: 'insert', table: 'ledger', values: { id: `${reviewed.id}:v${reviewed.version}`, cycle_id: old.id, version: reviewed.version, current: 1, effective_at: utc(reviewed.returnedAt), weight_mg: reviewed.confirmedTakeG === null ? null : Math.round(reviewed.confirmedTakeG * 1000), payload: JSON.stringify({ cycle: reviewed, calculation: payload.calculation, dishName: binding ? decode(binding).dishName : old.dishId, recordedAt: c.now }) } });
    return { writes, response: { ...operationsMeta(c.store, c.now, revision + 1), cycle: reviewed, projectionStatus: 'ready' as const } };
  });
}
export const operationServices = { operation, boundary, cycle, cycles, reviewCycle, operationHistory } satisfies OperationsServices;
