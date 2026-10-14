import { taskActionRequestSchema, type RefillTask } from '@zhishan/contracts/v2/tasks';
import type { EndpointContext, OperationsServices } from './router.ts';
import { OperationsError, requirePermission, tokenHash } from './security.ts';
import { decode, distinct, mutate, operationsMeta, type BindingPayload, type OperationRecord, type Row, type Rule, type TaskHistory, type TaskPayload } from './records.ts';
import { reconcileServing } from './serving-coordinator.ts';
import { rows } from './queries.ts';
import { taskWrite, capabilities, presented } from './task-state.ts';

function decodeCursor(cursor: string | undefined, revision: number, filter: string): string | undefined {
  if (!cursor) return undefined;
  try { const value = JSON.parse(decodeURIComponent(cursor)); if (value.revision !== revision) throw new OperationsError('VERSION_CONFLICT'); if (typeof value.id !== 'string' || value.filter !== filter) throw new Error(); return value.id; }
  catch (error) { if (error instanceof OperationsError) throw error; throw new OperationsError('INVALID_REQUEST'); }
}
async function tasks(context: EndpointContext<'tasks'>) {
  requirePermission(context.principal, 'staff');
  await reconcileServing(context.store, context.now);
  const filter = await tokenHash(JSON.stringify({ generation: context.store.generation, ...context.query, cursor: undefined, limit: undefined }));
  for (let attempt = 0; attempt < 4; attempt++) {
    const revision = await context.store.revision(), after = decodeCursor(context.query.cursor, revision, filter);
    const found = await rows<Row<TaskPayload>>(context.store, 'tasks', { where: { ...(context.query.status ? { status: context.query.status } : {}), ...(context.query.bindingId ? { binding_id: context.query.bindingId } : {}) }, ...(!context.query.status ? { notIn: { status: ['resolved', 'cancelled'] } } : {}) });
    const filtered = found.filter(row => (!after || row.id > after)).map(decode).filter(p => (!context.query.responsibility || p.task.responsibility === context.query.responsibility) && (!context.query.priority || p.task.priority === context.query.priority));
    const selected = filtered.slice(0, context.query.limit), result = await Promise.all(selected.map(p => presented(context.store, p, context.principal)));
    if (await context.store.revision() !== revision) continue;
    return { ...operationsMeta(context.store, context.now, revision), rows: result, nextCursor: filtered.length > selected.length ? encodeURIComponent(JSON.stringify({ revision, filter, id: selected.at(-1)!.task.id })) : null };
  }
  throw new OperationsError('UNAVAILABLE');
}
async function task(context: EndpointContext<'task'>) {
  requirePermission(context.principal, 'staff');
  await reconcileServing(context.store, context.now);
  for (let attempt = 0; attempt < 4; attempt++) {
    const revision = await context.store.revision(), row = await context.store.get<Row<TaskPayload>>('tasks', context.params.id); if (!row) throw new OperationsError('NOT_FOUND');
    const payload = decode(row), history = (await rows<Row<TaskHistory>>(context.store, 'task_actions', { where: { task_id: context.params.id } })).map(decode).sort((a, b) => a.afterVersion - b.afterVersion);
    const view = await presented(context.store, payload, context.principal);
    const binding = await context.store.get<Row<BindingPayload>>('bindings', payload.task.bindingId);
    const ruleRow = binding ? await context.store.get<Row<Rule>>('rules', decode(binding).dishId) : null;
    const deferLimitSeconds = view.allowedActions.includes('defer') && ruleRow ? decode(ruleRow).config.halfPolicy?.deferSeconds ?? null : null;
    if (await context.store.revision() !== revision) continue;
    return { ...operationsMeta(context.store, context.now, revision), task: view, history, evidenceIds: payload.evidenceIds, systemHistory: payload.systemHistory ?? [], deferLimitSeconds };
  }
  throw new OperationsError('UNAVAILABLE');
}
async function taskAction(context: EndpointContext<'taskAction'>) {
  requirePermission(context.principal, 'staff');
  return mutate(context, 'taskAction:' + context.params.id, context.body.requestId, context.body, async revision => {
    const row = await context.store.get<Row<TaskPayload>>('tasks', context.params.id); if (!row) throw new OperationsError('NOT_FOUND');
    const payload = decode(row), before = payload.task, input = taskActionRequestSchema.parse(context.body);
    if (before.version !== input.expectedVersion) throw new OperationsError('VERSION_CONFLICT', before.version);
    const bindingRow = await context.store.get<Row<BindingPayload>>('bindings', before.bindingId); if (!bindingRow) throw new OperationsError('NOT_FOUND');
    const binding = decode(bindingRow), ruleRow = await context.store.get<Row<Rule>>('rules', binding.dishId), rule = ruleRow ? decode(ruleRow) : null;
    const allowed = capabilities(before, context.principal, !!rule?.config.manualVerificationAllowed, !!rule?.config.enabled && !!rule.config.halfPolicy).allowedActions;
    if (!allowed.includes(input.action)) throw new OperationsError('FORBIDDEN');
    if (binding.validTo !== null || Date.parse(binding.validFrom) > Date.parse(context.now)) throw new OperationsError('VERSION_CONFLICT', before.version);
    const next: RefillTask = { ...before, allowedActions: [], version: before.version + 1, updatedAt: context.now };
    if (input.action === 'claim') { next.status = 'claimed'; next.assignee = context.principal.actor; }
    if (input.action === 'defer') {
      const seconds = rule?.config.halfPolicy?.deferSeconds;
      if (!seconds || Date.parse(input.until) <= Date.parse(context.now) || Date.parse(input.until) > Date.parse(context.now) + seconds * 1000) throw new OperationsError('INVALID_REQUEST');
      next.status = 'deferred'; next.deferUntil = input.until;
    }
    if (input.action === 'handoff') { next.status = 'open'; next.assignee = null; next.responsibility = input.responsibility; next.deferUntil = null; }
    if (input.action === 'report_complete') {
      const operationRow = await context.store.get<Row<OperationRecord>>('operations', input.operationId); if (!operationRow) throw new OperationsError('NOT_FOUND');
      const operation = decode(operationRow);
      if (operation.input.bindingId !== next.bindingId || operation.input.type !== 'food_refill' || Date.parse(operation.input.occurredAt) < Date.parse(next.createdAt)) throw new OperationsError('INVALID_REQUEST');
      next.status = 'verifying'; if (!next.assignee) next.assignee = context.principal.actor; payload.completionOperationId = operation.id;
    }
    if (input.action === 'verify_manual') {
      if (!input.evidenceIds.length || !payload.completionOperationId) throw new OperationsError('INVALID_REQUEST');
      const operationRow = await context.store.get<Row<OperationRecord>>('operations', payload.completionOperationId), operation = operationRow ? decode(operationRow) : null;
      if (!operation || operation.input.type !== 'food_refill' || operation.input.bindingId !== before.bindingId) throw new OperationsError('INVALID_REQUEST');
      next.status = 'resolved'; next.verificationMethod = 'manual'; payload.evidenceIds = distinct([...payload.evidenceIds, operation.id, ...input.evidenceIds]);
    }
    if (input.action === 'cancel') { next.status = 'cancelled'; next.deferUntil = null; }
    payload.task = next;
    const history: TaskHistory = { requestId: input.requestId, actor: context.principal.actor, at: context.now, input, beforeVersion: before.version, afterVersion: next.version };
    return { writes: [taskWrite(payload, false), { type: 'insert', table: 'task_actions', values: { id: context.principal.credentialId + ':' + input.requestId, task_id: next.id, occurred_at: context.now, payload: JSON.stringify(history) } }], response: { ...operationsMeta(context.store, context.now, revision + 1), task: capabilities(next, context.principal, !!rule?.config.manualVerificationAllowed, !!rule?.config.enabled && !!rule.config.halfPolicy) } };
  });
}
export const taskServices = { tasks, task, taskAction } satisfies OperationsServices;
