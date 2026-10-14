import { ruleSchema } from '@zhishan/contracts/v2/serving';
import type { EndpointContext, OperationsServices } from './router.ts';
import { OperationsError, requirePermission } from './security.ts';
import { decode, mutate, operationsMeta, type BindingPayload, type DevicePayload, type LatestPayload, type Row, type Rule } from './records.ts';
import { readLatestFault } from './fault-state.ts';
import { rows } from './queries.ts';
import { reconcileServing } from './serving-coordinator.ts';

async function serving(context: EndpointContext<'serving'>) {
  requirePermission(context.principal, 'staff');
  const result = await reconcileServing(context.store, context.now);
  return { ...operationsMeta(context.store, context.now, result.revision), environment: context.store.environment, bowls: result.bowls.sort((a, b) => (a.positionOrder ?? Infinity) - (b.positionOrder ?? Infinity) || a.scaleId.localeCompare(b.scaleId)) };
}
async function rules(context: EndpointContext<'rules'>) {
  requirePermission(context.principal, 'manager');
  return { ...operationsMeta(context.store, context.now, await context.store.revision()), rules: (await rows<Row<Rule>>(context.store, 'rules')).map(decode) };
}
async function saveRule(context: EndpointContext<'saveRule'>) {
  requirePermission(context.principal, 'manager');
  const result = await mutate(context, 'saveRule:' + context.params.dishId, context.body.requestId, context.body, async revision => {
    const old = await context.store.get<Row<Rule>>('rules', context.params.dishId), existing = old ? decode(old) : null;
    if ((existing?.version ?? 0) !== context.body.expectedVersion) throw new OperationsError('VERSION_CONFLICT', existing?.version ?? 0);
    const bindings = (await rows<Row<BindingPayload>>(context.store, 'bindings', { where: { dish_id: context.params.dishId, valid_to: null } })).map(decode);
    if (context.body.config.enabled && bindings.some(b => context.body.config.thresholds!.emptyG >= context.body.config.thresholds!.lowRatio * b.fullFoodG)) throw new OperationsError('INVALID_REQUEST');
    const rule = ruleSchema.parse({ dishId: context.params.dishId, version: (existing?.version ?? 0) + 1, updatedAt: context.now, config: context.body.config });
    return { writes: [{ type: 'upsert', table: 'rules', values: { id: rule.dishId, version: rule.version, updated_at: context.now, payload: JSON.stringify(rule) } }], response: { ...operationsMeta(context.store, context.now, revision + 1), rule } };
  });
  return result;
}
async function diagnostics(context: EndpointContext<'diagnostics'>) {
  requirePermission(context.principal, 'manager');
  for (let attempt = 0; attempt < 4; attempt++) {
    const revision = await context.store.revision();
    const [devices, latest] = await Promise.all([rows<Row<DevicePayload>>(context.store, 'devices'), rows<Row<LatestPayload> & { sampled_at: string; received_at: string }>(context.store, 'latest')]);
    const byId = new Map(latest.map(row => [row.id, row]));
    const result = await Promise.all(devices.map(async row => {
      const device = decode(row), last = byId.get(row.id);
      // A packet can arrive within the allowed clock skew before its event time.
      // Reception counters advance immediately; the fault takes effect at occurredAt.
      const event = (await readLatestFault(context.store, row.id, context.now, context.now, true))?.event ?? null;
      const fault = event?.type === 'device_fault' ? event.reasonCode : null;
      return { scaleId: row.id, enabled: device.enabled, lastSampledAt: last?.sampled_at ?? null, lastReceivedAt: last?.received_at ?? null, delayMs: last ? Math.max(0, Date.parse(last.received_at) - Date.parse(last.sampled_at)) : null, ...device.diagnostics, fault };
    }));
    if (await context.store.revision() !== revision) continue;
    return { ...operationsMeta(context.store, context.now, revision), devices: result };
  }
  throw new OperationsError('UNAVAILABLE');
}
export const servingServices = { serving, rules, saveRule, diagnostics } satisfies OperationsServices;
