import type { Bowl } from '@zhishan/contracts/v2/serving';
import type { OperationsStore, Write } from './storage.ts';
import { OperationsError } from './security.ts';
import { canonical, decode, type BindingPayload, type CyclePayload, type DevicePayload, type LatestPayload, type Row, type Rule, type TaskPayload } from './records.ts';
import { rows } from './queries.ts';
import { projectServing, intervalWrite, type ServingProjection } from './serving-projection.ts';
import { reconcileTask, taskWrite } from './task-state.ts';
const closed = new Set(['resolved', 'cancelled']);

/** Invoked after ingestion and by the durable scheduler, independently of browsers. */
export async function reconcileServing(store: OperationsStore, now: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const revision = await store.revision();
    const [deviceRows, bindingRows, latestRows, ruleRows, projectionRows, taskRows] = await Promise.all([
      rows<Row<DevicePayload>>(store, 'devices'), rows<Row<BindingPayload>>(store, 'bindings', { where: { valid_to: null } }),
      rows<Row<LatestPayload>>(store, 'latest'), rows<Row<Rule>>(store, 'rules'), rows<Row<ServingProjection>>(store, 'serving_projection'),
      rows<Row<TaskPayload>>(store, 'tasks', { notIn: { status: ['resolved', 'cancelled'] } }),
    ]);
    const bindings = new Map(bindingRows.map(r => [r.id, decode(r)])), latest = new Map(latestRows.map(r => [r.id, decode(r)]));
    const rules = new Map(ruleRows.map(r => [r.id, decode(r)])), previous = new Map(projectionRows.map(r => [r.id, decode(r)]));
    const tasks = new Map(taskRows.map(r => { const p = decode(r); return [p.task.bindingId, p] as const; }));
    const writes: Write[] = [], bowls: Bowl[] = [], activeBindings = new Set<string>();
    for (const row of deviceRows) {
      const device = decode(row), binding = device.bindingId ? bindings.get(device.bindingId) : null;
      if (!device.enabled || !binding || Date.parse(binding.validFrom) > Date.parse(now)) continue;
      activeBindings.add(binding.id);
      const rule = rules.get(binding.dishId) ?? null, count = rule?.config.halfPolicy?.unchangedCycles ?? 1;
      const cycles = (await store.query<Row<CyclePayload>>('cycles', { where: { binding_id: binding.id }, orderBy: [{ column: 'effective_at', direction: 'desc' }], limit: Math.max(1, count) })).map(decode);
      const projection = projectServing(device, binding, latest.get(device.id) ?? null, rule, previous.get(binding.id) ?? null, cycles, now);
      const interval = await intervalWrite(store, device, binding, previous.get(binding.id) ?? null, projection, rule);
      if (interval) writes.push(interval);
      const before = tasks.get(binding.id) ?? null;
      const after = await reconcileTask(store, before, projection.bowl, rule, now);
      if (after) { projection.bowl.taskId = closed.has(after.task.status) ? null : after.task.id; if (!before || canonical(before) !== canonical(after)) writes.push(taskWrite(after, !before)); }
      if (canonical(previous.get(binding.id)) !== canonical(projection)) writes.push({ type: 'upsert', table: 'serving_projection', values: { id: binding.id, updated_at: now, payload: JSON.stringify(projection) } });
      bowls.push(projection.bowl);
    }
    for (const payload of tasks.values()) if (!activeBindings.has(payload.task.bindingId)) {
      const updated = await reconcileTask(store, payload, null, null, now);
      if (updated && canonical(updated) !== canonical(payload)) writes.push(taskWrite(updated, false));
    }
    if (!writes.length) { if (await store.revision() === revision) return { revision, bowls }; }
    else if (await store.transact(revision, writes)) return { revision: revision + 1, bowls };
  }
  throw new OperationsError('UNAVAILABLE');
}
