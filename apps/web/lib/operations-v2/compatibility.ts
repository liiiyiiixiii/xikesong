import { freshnessBatchSchema, freshnessRuleSchema, freshnessStartSchema, type FreshnessBatch, type FreshnessRemoval, type FreshnessRule } from '@zhishan/contracts/v2/freshness';
import type { Principal } from './security.ts';
import { OperationsError, requirePermission, tokenHash } from './security.ts';
import { decode, mutate, operationsMeta, type BindingPayload, type OperationRecord, type Row } from './records.ts';
import type { EndpointContext, OperationsServices } from './router.ts';
import type { Write } from './storage.ts';
import { rows } from './queries.ts';

export type FreshnessBatchPayload = { openingFoodG: number | null; ruleSnapshot: FreshnessRule | null; operationId?: string; actor?: Principal['actor']; requestId?: string };
type BatchRow = Row<FreshnessBatchPayload> & { binding_id: string; started_at: string; closed_at: string | null };
type ActionPayload = Pick<FreshnessRemoval, 'operationId' | 'correctsOperationId' | 'disposition' | 'reason' | 'quantityStatus' | 'weightG' | 'actor'>;
type ActionRow = Row<ActionPayload> & { binding_id: string; batch_id: string | null; operation_id: string; occurred_at: string };
const utc = (value: string) => new Date(value).toISOString();
export function freshnessBatchView(row: BatchRow, binding: BindingPayload, now: string): FreshnessBatch {
  const payload = decode(row), rule = payload.ruleSnapshot ?? null, end = row.closed_at ?? now;
  const elapsedMinutes = Math.max(0, (Date.parse(end) - Date.parse(row.started_at)) / 60000);
  const configured = !!rule?.config.enabled;
  const warningAt = configured ? new Date(Date.parse(row.started_at) + rule!.config.warnAfterMinutes * 60000).toISOString() : null;
  const expiresAt = configured ? new Date(Date.parse(row.started_at) + rule!.config.expireAfterMinutes * 60000).toISOString() : null;
  const state = row.closed_at ? 'closed' : !configured ? 'unconfigured' : Date.parse(now) >= Date.parse(expiresAt!) ? 'expired' : Date.parse(now) >= Date.parse(warningAt!) ? 'warning' : 'fresh';
  return freshnessBatchSchema.parse({ id: row.id, bindingId: binding.id, scaleId: binding.scaleId, dishId: binding.dishId, dishName: binding.dishName,
    startedAt: row.started_at, closedAt: row.closed_at, openingFoodG: payload.openingFoodG ?? null, status: row.closed_at ? 'closed' : 'active', state,
    elapsedMinutes, ruleVersion: rule?.version ?? null, warningAt, expiresAt, origin: payload.operationId ? 'replacement' : 'manual' });
}
function offsetFor(cursor: string | undefined, revision: number, filter: string) {
  if (!cursor) return 0;
  try { const parsed = JSON.parse(decodeURIComponent(cursor)); if (parsed.revision !== revision) throw new OperationsError('VERSION_CONFLICT'); if (parsed.filter !== filter || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0) throw new Error(); return parsed.offset as number; }
  catch (error) { if (error instanceof OperationsError) throw error; throw new OperationsError('INVALID_REQUEST'); }
}
function page<T>(items: T[], offset: number, limit: number, revision: number, filter: string) {
  return { selected: items.slice(offset, offset + limit), nextCursor: offset + limit < items.length ? encodeURIComponent(JSON.stringify({ revision, filter, offset: offset + limit })) : null };
}
async function freshnessRules(context: EndpointContext<'freshnessRules'>) {
  requirePermission(context.principal, 'staff');
  for (let attempt = 0; attempt < 4; attempt++) {
    const revision = await context.store.revision(), rules = (await rows<Row<FreshnessRule>>(context.store, 'freshness_rules')).map(decode);
    if (await context.store.revision() !== revision) continue;
    return { ...operationsMeta(context.store, context.now, revision), environment: context.store.environment, source: 'operations_v2' as const, rules };
  }
  throw new OperationsError('UNAVAILABLE');
}
async function saveFreshnessRule(context: EndpointContext<'saveFreshnessRule'>) {
  requirePermission(context.principal, 'manager');
  return mutate(context, 'saveFreshnessRule:' + context.params.dishId, context.body.requestId, context.body, async revision => {
    const previous = await context.store.get<Row<FreshnessRule>>('freshness_rules', context.params.dishId), old = previous ? decode(previous) : null;
    if ((old?.version ?? 0) !== context.body.expectedVersion) throw new OperationsError('VERSION_CONFLICT', old?.version ?? 0);
    const rule = freshnessRuleSchema.parse({ dishId: context.params.dishId, version: (old?.version ?? 0) + 1, updatedAt: context.now, config: context.body.config });
    return { writes: [{ type: 'upsert', table: 'freshness_rules', values: { id: rule.dishId, version: rule.version, updated_at: context.now, payload: JSON.stringify(rule) } }], response: { ...operationsMeta(context.store, context.now, revision + 1), rule } };
  });
}
async function startFreshnessBatch(context: EndpointContext<'startFreshnessBatch'>) {
  requirePermission(context.principal, 'staff');
  const input = freshnessStartSchema.parse(context.body);
  return mutate(context, 'startFreshnessBatch', input.requestId, input, async revision => {
    const row = await context.store.get<Row<BindingPayload>>('bindings', input.bindingId); if (!row) throw new OperationsError('NOT_FOUND');
    const binding = decode(row);
    if (binding.version !== input.expectedBindingVersion) throw new OperationsError('VERSION_CONFLICT', binding.version);
    if (binding.validTo !== null || Date.parse(input.startedAt) < Date.parse(binding.validFrom) || Date.parse(input.startedAt) > Date.parse(context.now)) throw new OperationsError('INVALID_TRANSITION');
    const active = await context.store.query<BatchRow>('freshness_batches', { where: { binding_id: binding.id, closed_at: null }, limit: 1 });
    if (active.length || binding.freshnessBatchId) throw new OperationsError('INVALID_TRANSITION');
    const ruleRow = await context.store.get<Row<FreshnessRule>>('freshness_rules', binding.dishId), ruleSnapshot = ruleRow ? decode(ruleRow) : null;
    const id = crypto.randomUUID(), payload: FreshnessBatchPayload = { openingFoodG: input.openingFoodG, ruleSnapshot, actor: context.principal.actor, requestId: input.requestId };
    const batch: BatchRow = { id, binding_id: binding.id, started_at: utc(input.startedAt), closed_at: null, payload: JSON.stringify(payload) };
    const updated = { ...binding, version: binding.version + 1, freshnessBatchId: id };
    const writes: Write[] = [{ type: 'insert', table: 'freshness_batches', values: { id: batch.id, binding_id: batch.binding_id, started_at: batch.started_at, closed_at: batch.closed_at, payload: batch.payload } }, { type: 'update', table: 'bindings', id: binding.id, values: { version: updated.version, payload: JSON.stringify(updated) } }];
    return { writes, response: { ...operationsMeta(context.store, context.now, revision + 1), batch: freshnessBatchView(batch, updated, context.now), bindingVersion: updated.version } };
  });
}
async function freshnessBatches(context: EndpointContext<'freshnessBatches'>) {
  requirePermission(context.principal, 'staff');
  const filter = await tokenHash(JSON.stringify({ generation: context.store.generation, ...context.query, cursor: undefined }));
  for (let attempt = 0; attempt < 4; attempt++) {
    const revision = await context.store.revision(), offset = offsetFor(context.query.cursor, revision, filter);
    const batchRows = await rows<BatchRow>(context.store, 'freshness_batches', { where: { ...(context.query.bindingId ? { binding_id: context.query.bindingId } : {}), ...(context.query.status === 'active' ? { closed_at: null } : {}) }, ...(context.query.status === 'closed' ? { notIn: { closed_at: [null] } } : {}) });
    const result: FreshnessBatch[] = [];
    for (const batch of batchRows) {
      const bindingRow = await context.store.get<Row<BindingPayload>>('bindings', batch.binding_id); if (!bindingRow) throw new OperationsError('INTERNAL_ERROR');
      const binding = decode(bindingRow); if (context.query.dishId && context.query.dishId !== binding.dishId) continue;
      result.push(freshnessBatchView(batch, binding, context.now));
    }
    result.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
    const selected = page(result, offset, context.query.limit, revision, filter);
    if (await context.store.revision() !== revision) continue;
    return { ...operationsMeta(context.store, context.now, revision), environment: context.store.environment, source: 'operations_v2' as const, batches: selected.selected, nextCursor: selected.nextCursor };
  }
  throw new OperationsError('UNAVAILABLE');
}
async function freshnessRemovals(context: EndpointContext<'freshnessRemovals'>) {
  requirePermission(context.principal, 'staff');
  const from = utc(context.query.startDate + 'T00:00:00+08:00'), to = new Date(Date.parse(context.query.endDate + 'T00:00:00+08:00') + 86400000).toISOString();
  const filter = await tokenHash(JSON.stringify({ generation: context.store.generation, ...context.query, cursor: undefined }));
  for (let attempt = 0; attempt < 4; attempt++) {
    const revision = await context.store.revision(), offset = offsetFor(context.query.cursor, revision, filter);
    const actionRows = await rows<ActionRow>(context.store, 'freshness_actions', { range: { column: 'occurred_at', from, to } });
    const bindings = new Map<string, BindingPayload>(), result: FreshnessRemoval[] = [];
    for (const actionRow of actionRows) {
      if (!bindings.has(actionRow.binding_id)) {
        const bindingRow = await context.store.get<Row<BindingPayload>>('bindings', actionRow.binding_id); if (!bindingRow) throw new OperationsError('INTERNAL_ERROR'); bindings.set(actionRow.binding_id, decode(bindingRow));
      }
      const binding = bindings.get(actionRow.binding_id)!; if (context.query.dishId && context.query.dishId !== binding.dishId) continue;
      const action = decode(actionRow), operationRow = await context.store.get<Row<OperationRecord>>('operations', actionRow.operation_id);
      if (!operationRow) throw new OperationsError('INTERNAL_ERROR');
      const corrections = await context.store.query<Row<OperationRecord>>('operations', { where: { corrects_id: actionRow.operation_id }, limit: 1 });
      result.push({ ...action, id: actionRow.id, operationId: actionRow.operation_id, bindingId: binding.id, batchId: actionRow.batch_id, dishId: binding.dishId, dishName: binding.dishName, occurredAt: actionRow.occurred_at, status: decode(operationRow).status, correctsOperationId: action.correctsOperationId ?? null, effective: corrections.length === 0 });
    }
    result.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
    const selected = page(result, offset, context.query.limit, revision, filter);
    if (await context.store.revision() !== revision) continue;
    return { ...operationsMeta(context.store, context.now, revision), environment: context.store.environment, source: 'operations_v2' as const, rows: selected.selected, nextCursor: selected.nextCursor };
  }
  throw new OperationsError('UNAVAILABLE');
}
export const compatibilityServices = { freshnessRules, saveFreshnessRule, startFreshnessBatch, freshnessBatches, freshnessRemovals } satisfies OperationsServices;
