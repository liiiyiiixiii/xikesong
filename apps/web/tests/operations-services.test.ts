import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { OperationsStore, type Write } from '../lib/operations-v2/storage.ts';
import { MEASUREMENT_ALGORITHM } from '../lib/operations-v2/measurement.ts';
import { servingServices } from '../lib/operations-v2/serving.ts';
import { reconcileServing } from '../lib/operations-v2/serving-coordinator.ts';
import { projectServing } from '../lib/operations-v2/serving-projection.ts';
import { taskServices } from '../lib/operations-v2/tasks.ts';
import { reportServices } from '../lib/operations-v2/reports.ts';
import { decode, type BindingPayload, type CyclePayload, type DevicePayload, type LatestPayload, type Row, type Rule, type TaskPayload } from '../lib/operations-v2/records.ts';
import type { EndpointContext } from '../lib/operations-v2/router.ts';
import type { EndpointName } from '@zhishan/contracts/operations-v2';
import type { Principal } from '../lib/operations-v2/security.ts';
import { servingResponseSchema } from '@zhishan/contracts/v2/serving';
import { taskDetailResponseSchema } from '@zhishan/contracts/v2/tasks';

const at = (seconds = 0) => new Date(Date.parse('2026-10-12T00:00:00Z') + seconds * 1000).toISOString();
const manager: Principal = { credentialId: 'manager', role: 'manager', environment: 'test', actor: { id: 'manager', kind: 'user', label: 'Manager' }, scaleIds: null };
const staff = (id: string): Principal => ({ ...manager, credentialId: id, role: 'staff', actor: { id, kind: 'workstation', label: id } });
function context<K extends EndpointName>(store: OperationsStore, input: Partial<EndpointContext<K>> = {}) {
  return { store, principal: manager, now: at(), params: {}, query: {}, body: undefined, ...input } as EndpointContext<K>;
}
async function database(t: TestContext) {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("isolated services test")}}', compatibilityDate: '2026-05-15', d1Databases: { DB: crypto.randomUUID() } });
  t.after(() => mf.dispose());
  const store = new OperationsStore(await mf.getD1Database('DB') as unknown as D1Database, 'test');
  await store.initialize(); return store;
}
const measurement = { boundaryWindowMs: 1000, maxSampleGapMs: 30000, freshMs: 60000, stableWindowMs: 0, stableMinSamples: 1, stableToleranceG: 0, negativeToleranceG: 0, maxStepG: null, locationFreshMs: 60000, timeZone: 'Asia/Shanghai', ruleVersion: 'test' };
const binding: BindingPayload = { id: 'binding-1', scaleId: 'scale-1', dishId: 'dish-1', dishName: 'Dish', validFrom: at(-10), validTo: null, tareG: 100, fullFoodG: 1000, foodOnly: true, containerRef: null, freshnessBatchId: null, version: 0, measurement };
const device: DevicePayload = { id: 'scale-1', name: 'Scale', enabled: true, positionOrder: 1, bindingId: binding.id, measurement, createdAt: at(-10), updatedAt: at(-10), diagnostics: { countsSince: at(-10), accepted: 1, duplicate: 0, rejected: 0, lastCode: 'STORED', fault: null } };
const rule: Rule = { dishId: 'dish-1', version: 1, updatedAt: at(-10), config: { enabled: true, thresholds: { emptyG: 5, lowRatio: .2, fullRatio: .8, hysteresisRatio: .02, holdSeconds: 0 }, halfPolicy: { mode: 'cycles', unchangedCycles: 2, observationSeconds: null, changeToleranceG: 2, deferSeconds: 60, refillDuringPeak: false }, peakPeriods: [], manualVerificationAllowed: false } };
function latest(g: number, second = 0, quality: LatestPayload['observation']['quality'] = 'good'): LatestPayload {
  return { bindingId: binding.id, observation: { loadNetG: g, foodRemainingG: ['good', 'estimated'].includes(quality) ? g : null, estimatedFoodG: g, confirmedFoodG: g, observedAt: at(second), confirmedAt: at(second), quality, evidenceIds: ['sample-' + second], zone: 'customer', locationQuality: 'verified', locationObservedAt: at(second) } };
}
async function writeLatest(store: OperationsStore, g: number, second = 0, quality: LatestPayload['observation']['quality'] = 'good') {
  await store.transact(await store.revision(), [{ type: 'upsert', table: 'latest', values: { id: device.id, sampled_at: at(second), received_at: at(second), payload: JSON.stringify(latest(g, second, quality)) } }]);
}
async function seed(store: OperationsStore, g = 100, configured = true, customRule = rule) {
  const writes: Write[] = [
    { type: 'insert', table: 'devices', values: { id: device.id, enabled: 1, updated_at: at(-10), payload: JSON.stringify(device) } },
    { type: 'insert', table: 'bindings', values: { id: binding.id, scale_id: binding.scaleId, dish_id: binding.dishId, valid_from: binding.validFrom, valid_to: null, version: 0, payload: JSON.stringify(binding) } },
  ];
  if (configured) writes.push({ type: 'insert', table: 'rules', values: { id: rule.dishId, version: 1, updated_at: customRule.updatedAt, payload: JSON.stringify(customRule) } });
  await store.transact(await store.revision(), writes); await writeLatest(store, g);
}
async function currentTask(store: OperationsStore) { return decode((await store.list<Row<TaskPayload>>('tasks'))[0]); }
function actionContext(store: OperationsStore, id: string, body: EndpointContext<'taskAction'>['body'], principal = staff('front-1'), seconds = 0) { return context<'taskAction'>(store, { params: { id }, body, principal, now: at(seconds) }); }

test('D06: missing rule, stale data and estimated empty remain unknown rather than empty', async t => {
  const store = await database(t); await seed(store, 0, false);
  const state = servingResponseSchema.parse(await servingServices.serving(context<'serving'>(store)));
  assert.equal(state.bowls[0].servingState, 'unknown'); assert(state.bowls[0].reasonCodes.includes('RULE_NOT_CONFIGURED'));
  const estimated = projectServing(device, binding, latest(0, 0, 'estimated'), rule, null, [], at());
  assert.equal(estimated.bowl.servingState, 'unknown'); assert.equal(estimated.bowl.recommendation, 'verify');
  const stale = projectServing(device, binding, latest(0), rule, null, [], at(61));
  assert.equal(stale.bowl.quality, 'stale'); assert.equal(stale.bowl.foodRemainingG, null); assert.equal(stale.bowl.servingState, 'unknown');
});

test('T06/T15: one low task upgrades through deferral, persists, and expiry reopens without browser actions', async t => {
  const store = await database(t); await seed(store); await reconcileServing(store, at());
  const original = await currentTask(store); assert.equal(original.task.priority, 'high');
  await taskServices.taskAction(actionContext(store, original.task.id, { requestId: crypto.randomUUID(), expectedVersion: original.task.version, action: 'defer', until: at(30), reason: 'wait' }));
  await writeLatest(store, 0, 5); await reconcileServing(store, at(5));
  const upgraded = await currentTask(store); assert.equal(upgraded.task.id, original.task.id); assert.equal(upgraded.task.priority, 'urgent'); assert.equal(upgraded.task.status, 'open'); assert.equal(upgraded.task.deferUntil, null);
  const recovered = new OperationsStore(store.db, 'test'); assert.equal((await currentTask(recovered)).task.id, original.task.id);
  assert(upgraded.systemHistory?.some(event => event.event === 'upgraded'));
});

test('T07: concurrent claims, exact retry and conflicting request content use durable receipts', async t => {
  const store = await database(t); await seed(store); await reconcileServing(store, at());
  const original = await currentTask(store), body = { requestId: crypto.randomUUID(), expectedVersion: original.task.version, action: 'claim' as const };
  const a = actionContext(store, original.task.id, body, staff('a')), b = actionContext(store, original.task.id, { ...body, requestId: crypto.randomUUID() }, staff('b'));
  const results = await Promise.allSettled([taskServices.taskAction(a), taskServices.taskAction(b)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winning = results[0].status === 'fulfilled' ? a : b, response = results[0].status === 'fulfilled' ? results[0].value : (results[1] as PromiseFulfilledResult<unknown>).value;
  assert.deepEqual(await taskServices.taskAction(winning), response);
  await assert.rejects(() => taskServices.taskAction({ ...winning, body: { ...winning.body, expectedVersion: 99 } }), /ID_CONFLICT/);
  assert.equal((await store.list('task_actions')).length, 1);
});

test('T08: ice is rejected; report complete waits for matched refill and a later good recovery', async t => {
  const store = await database(t); await seed(store); await reconcileServing(store, at());
  let p = await currentTask(store);
  await taskServices.taskAction(actionContext(store, p.task.id, { requestId: crypto.randomUUID(), expectedVersion: p.task.version, action: 'claim' }));
  p = await currentTask(store);
  const operation = { id: 'refill-1', version: 0, status: 'recorded', actor: staff('front-1').actor, recordedAt: at(1), input: { requestId: crypto.randomUUID(), bindingId: binding.id, type: 'ice_add', occurredAt: at(1), quantityStatus: 'measured', weightG: 800, evidenceIds: ['refill-sample'], note: 'work' } };
  const save = async () => store.transact(await store.revision(), [{ type: 'upsert', table: 'operations', values: { id: operation.id, binding_id: binding.id, occurred_at: at(1), version: 0, corrects_id: null, payload: JSON.stringify(operation) } }]);
  await save();
  await assert.rejects(() => taskServices.taskAction(actionContext(store, p.task.id, { requestId: crypto.randomUUID(), expectedVersion: p.task.version, action: 'report_complete', operationId: operation.id }, staff('front-1'), 2)), /INVALID_REQUEST/);
  operation.input.type = 'food_refill'; await save();
  await taskServices.taskAction(actionContext(store, p.task.id, { requestId: crypto.randomUUID(), expectedVersion: p.task.version, action: 'report_complete', operationId: operation.id }, staff('front-1'), 2));
  await writeLatest(store, 900, 3); await reconcileServing(store, at(3)); assert.equal((await currentTask(store)).task.status, 'verifying');
  operation.status = 'matched'; await save();
  await writeLatest(store, 900, 4, 'pending'); await reconcileServing(store, at(4)); assert.equal((await currentTask(store)).task.status, 'verifying');
  await writeLatest(store, 900, 5); await reconcileServing(store, at(5));
  const final = await currentTask(store); assert.equal(final.task.status, 'resolved'); assert.equal(final.task.verificationMethod, 'measurement');
  const detail = taskDetailResponseSchema.parse(await taskServices.task(context<'task'>(store, { params: { id: final.task.id }, now: at(5) })));
  assert(detail.evidenceIds.includes(operation.id)); assert(detail.systemHistory.some(item => item.event === 'measurement_verified'));
});

function cycle(second: number, take = 0, id = crypto.randomUUID()): CyclePayload {
  const cycle = { id, bindingId: binding.id, scaleId: binding.scaleId, dishId: binding.dishId, version: 0, status: 'confirmed' as const, exitEventId: crypto.randomUUID(), returnEventId: crypto.randomUUID(), exitedAt: at(second - 1), returnedAt: at(second), outG: 500 + take, inG: 500, confirmedTakeG: take, effectiveAt: at(second), method: 'cycle_balance_v2' as const, qualityReasons: [], evidenceIds: ['sample'] };
  return { cycle, revisions: [], calculation: { cycleId: id, evidenceBundleId: 'bundle', evidenceIds: ['sample'], operationIds: [], rawBalanceMg: take * 1000, toleranceMg: 0, appliedToleranceMg: 0, increaseMg: 0, nonCustomerDecreaseMg: 0, foodRefillMg: 0, blockingReasons: [], closingDate: '2026-10-12', crossDay: false, algorithmVersion: MEASUREMENT_ALGORITHM, ruleVersion: 'test', asOf: at(second) } };
}

test('T05: half deferral requires configured true cycles or advancing observation window', () => {
  assert.equal(projectServing(device, binding, latest(500), rule, null, [cycle(-1)], at()).bowl.recommendation, 'watch');
  assert.equal(projectServing(device, binding, latest(500), rule, null, [cycle(-1), cycle(-2)], at()).bowl.recommendation, 'defer');
  const timed: Rule = { ...rule, config: { ...rule.config, halfPolicy: { ...rule.config.halfPolicy!, mode: 'time', unchangedCycles: null, observationSeconds: 5 } } };
  const first = projectServing(device, binding, latest(500), timed, null, [], at());
  assert.equal(projectServing(device, binding, latest(500), timed, first, [], at(10)).bowl.recommendation, 'watch');
  assert.equal(projectServing(device, binding, latest(500, 5), timed, first, [], at(5)).bowl.recommendation, 'defer');
});

test('T12/T14: ledger revision, real zero, pending and no-data stay distinct; CSV is same revision and escaped', async t => {
  const store = await database(t); await seed(store, 500);
  const zero = cycle(0, 0), pending = cycle(1, 20); pending.cycle.status = 'pending' as never; pending.cycle.confirmedTakeG = null as never;
  const payload = (p: CyclePayload) => JSON.stringify({ cycle: p.cycle, calculation: p.calculation, dishName: '=unsafe', recordedAt: at(2) });
  await store.transact(await store.revision(), [
    { type: 'insert', table: 'ledger', values: { id: 'old', cycle_id: zero.cycle.id, version: 0, current: 0, effective_at: at(), weight_mg: 100000, payload: payload({ ...zero, cycle: { ...zero.cycle, confirmedTakeG: 100 } }) } },
    { type: 'insert', table: 'ledger', values: { id: 'current', cycle_id: zero.cycle.id, version: 1, current: 1, effective_at: at(), weight_mg: 0, payload: payload(zero) } },
    { type: 'insert', table: 'ledger', values: { id: 'pending', cycle_id: pending.cycle.id, version: 0, current: 1, effective_at: at(1), weight_mg: null, payload: payload(pending) } },
  ]);
  const query = { startDate: '2026-10-12', endDate: '2026-10-12', basis: 'cycle_balance_v2' as const, sort: 'weight_desc' as const, limit: 50 };
  const report = await reportServices.report(context<'report'>(store, { now: at(2), query }));
  assert.equal(report.rows[0].confirmedTakeG, 0); assert.equal(report.rows[0].rank, null); assert.equal(report.rows[0].pendingCycles, 1); assert.equal(report.rows[0].observationCoverage, null);
  const csv = await reportServices.exportReport(context<'exportReport'>(store, { now: at(2), query: { startDate: query.startDate, endDate: query.endDate, basis: query.basis, sort: query.sort, dataRevision: report.dataRevision, snapshotAt: report.serverAt } }));
  assert(csv.includes("'=unsafe")); assert(csv.includes(report.dataRevision));
  await writeLatest(store, 510, 2);
  await assert.rejects(() => reportServices.exportReport(context<'exportReport'>(store, { now: at(2), query: { startDate: query.startDate, endDate: query.endDate, basis: query.basis, sort: query.sort, dataRevision: report.dataRevision, snapshotAt: report.serverAt } })), /REPORT_REVISION_CHANGED/);
  await assert.rejects(() => reportServices.report(context<'report'>(store, { now: at(2), query: { ...query, basis: 'legacy_delta_v1' } })), /UNAVAILABLE/);
});

async function sampleWrites(store: OperationsStore, scaleId: string, values: { seconds: number; food: number; fault?: boolean }[]) {
  const writes: Write[] = values.map(({ seconds, food, fault }) => {
    const sample = { scaleId, bootId: 'boot-' + scaleId, sequence: seconds + 1, sampledAt: at(seconds), grossG: fault ? null : food + 100, measurementStatus: fault ? 'fault' : 'ok' };
    const id = scaleId + ':' + seconds;
    return { type: 'insert', table: 'samples', values: { id, scale_id: scaleId, boot_id: sample.bootId, sequence: sample.sequence, sampled_at: sample.sampledAt, received_at: sample.sampledAt, payload_hash: id, payload: JSON.stringify({ id, sample, receivedAt: sample.sampledAt }) } };
  });
  await store.transact(await store.revision(), writes);
}

test('T11/D09: production intervals give weighted coverage and whole-dish empty intersection; offline remains unknown', async t => {
  for (const state of ['food', 'empty', 'offline'] as const) {
    const store = await database(t); await seed(store, 0);
    const firstBinding = { ...binding, validFrom: at() }, secondBinding = { ...firstBinding, id: 'binding-2', scaleId: 'scale-2' }, secondDevice = { ...device, id: 'scale-2', positionOrder: 2, bindingId: 'binding-2' };
    await store.transact(await store.revision(), [
      { type: 'update', table: 'bindings', id: binding.id, values: { valid_from: at(), payload: JSON.stringify(firstBinding) } },
      { type: 'insert', table: 'bindings', values: { id: secondBinding.id, scale_id: secondBinding.scaleId, dish_id: binding.dishId, valid_from: at(), valid_to: null, version: 0, payload: JSON.stringify(secondBinding) } },
      { type: 'insert', table: 'devices', values: { id: secondDevice.id, enabled: 1, updated_at: at(), payload: JSON.stringify(secondDevice) } },
      { type: 'insert', table: 'latest', values: { id: secondDevice.id, sampled_at: at(), received_at: at(), payload: JSON.stringify({ ...latest(state === 'food' ? 500 : 0), bindingId: secondBinding.id }) } },
    ]);
    await sampleWrites(store, device.id, [{ seconds: 0, food: 0 }]);
    await sampleWrites(store, secondDevice.id, [{ seconds: 0, food: state === 'food' ? 500 : 0 }]);
    await reconcileServing(store, at());
    await sampleWrites(store, device.id, [{ seconds: 10, food: 0 }]);
    await sampleWrites(store, secondDevice.id, [{ seconds: 10, food: state === 'food' ? 500 : 0, fault: state === 'offline' }]);
    await writeLatest(store, 0, 10);
    await store.transact(await store.revision(), [{ type: 'update', table: 'latest', id: secondDevice.id, values: { sampled_at: at(10), received_at: at(10), payload: JSON.stringify({ ...latest(state === 'food' ? 500 : 0, 10, state === 'offline' ? 'offline' : 'good'), bindingId: secondBinding.id }) } }]);
    await reconcileServing(store, at(10));
    assert.equal((await store.list('serving_intervals')).length, 2);
    const result = await reportServices.report(context<'report'>(store, { now: at(10), query: { startDate: '2026-10-12', endDate: '2026-10-12', basis: 'cycle_balance_v2', sort: 'weight_desc', limit: 50 } }));
    assert.equal(result.rows[0].observationCoverage, state === 'offline' ? .5 : 1);
    assert.equal(result.rows[0].stockoutMinutes, state === 'empty' ? 10 / 60 : state === 'food' ? 0 : null);
    assert.equal(result.rows[0].confirmedTakeG, null); assert.equal(result.rows[0].rank, null);
  }
});

test('T15: deferred task expires through scheduler reconciliation; missing data does not close it', async t => {
  const store = await database(t); await seed(store); await reconcileServing(store, at());
  const p = await currentTask(store);
  await taskServices.taskAction(actionContext(store, p.task.id, { requestId: crypto.randomUUID(), expectedVersion: p.task.version, action: 'defer', until: at(10), reason: 'planned return' }));
  await reconcileServing(store, at(11));
  const expired = await currentTask(store); assert.equal(expired.task.status, 'open'); assert(expired.systemHistory?.some(item => item.event === 'defer_expired'));
  await reconcileServing(store, at(61)); assert.equal((await currentTask(store)).task.status, 'open');
});

test('D06: threshold hold needs advancing evidence and hysteresis avoids flapping', () => {
  const held: Rule = { ...rule, config: { ...rule.config, thresholds: { ...rule.config.thresholds!, holdSeconds: 5 } } };
  const low = projectServing(device, binding, latest(100), held, null, [], at());
  const candidate = projectServing(device, binding, latest(500, 1), held, low, [], at(1));
  assert.equal(candidate.bowl.servingState, 'low');
  assert.equal(projectServing(device, binding, latest(500, 1), held, candidate, [], at(10)).bowl.servingState, 'low');
  assert.equal(projectServing(device, binding, latest(500, 6), held, candidate, [], at(6)).bowl.servingState, 'half');
  assert.equal(projectServing(device, binding, latest(210, 1), rule, low, [], at(1)).bowl.servingState, 'low');
});

test('T12: cross-month attribution uses returnedAt, stopped dishes retain names, rebuilding blocks export', async t => {
  const store = await database(t); await seed(store);
  const p = cycle(1, 200), returnedAt = '2026-11-01T00:00:01+08:00';
  p.cycle.exitedAt = '2026-10-31T23:59:59+08:00'; p.cycle.returnedAt = returnedAt; p.cycle.effectiveAt = returnedAt; p.cycle.qualityReasons = ['CROSS_DAY'] as never; p.calculation.crossDay = true;
  const stopped = { ...binding, validTo: '2026-11-01T00:00:02+08:00' };
  await store.transact(await store.revision(), [
    { type: 'update', table: 'devices', id: device.id, values: { enabled: 0, payload: JSON.stringify({ ...device, enabled: false }) } },
    { type: 'update', table: 'bindings', id: binding.id, values: { valid_to: new Date(stopped.validTo).toISOString(), payload: JSON.stringify(stopped) } },
    { type: 'insert', table: 'ledger', values: { id: 'cross-month', cycle_id: p.cycle.id, version: 0, current: 1, effective_at: new Date(returnedAt).toISOString(), weight_mg: 200000, payload: JSON.stringify({ cycle: p.cycle, calculation: p.calculation, dishName: 'Historical dish', recordedAt: returnedAt }) } },
  ]);
  const query = (date: string) => ({ startDate: date, endDate: date, basis: 'cycle_balance_v2' as const, sort: 'weight_desc' as const, limit: 50 });
  const october = await reportServices.report(context<'report'>(store, { now: '2026-11-02T00:00:00Z', query: query('2026-10-31') }));
  assert.equal(october.totals.confirmedTakeG, null);
  const november = await reportServices.report(context<'report'>(store, { now: '2026-11-02T00:00:00Z', query: query('2026-11-01') }));
  assert.equal(november.rows[0].confirmedTakeG, 200); assert.equal(november.rows[0].name, 'Historical dish'); assert(november.rows[0].qualityReasons.includes('CROSS_DAY'));
  await store.transact(await store.revision(), [{ type: 'insert', table: 'jobs', values: { id: 'project:' + binding.id, scope: 'measurement', status: 'pending', desired_revision: 1, lease_until: null, attempts: 0, payload: '{}' } }]);
  const pending = await reportServices.report(context<'report'>(store, { now: '2026-11-02T00:00:00Z', query: query('2026-11-01') }));
  assert.equal(pending.projectionStatus, 'rebuilding');
  await assert.rejects(() => reportServices.exportReport(context<'exportReport'>(store, { now: '2026-11-02T00:00:00Z', query: { startDate: '2026-11-01', endDate: '2026-11-01', basis: 'cycle_balance_v2', sort: 'weight_desc', dataRevision: pending.dataRevision, snapshotAt: pending.serverAt } })), /REPORT_REBUILDING/);
});

test('D07: manual verification requires configured manager permission and a refill, handoff has explicit history', async t => {
  const store = await database(t); const manualRule = { ...rule, config: { ...rule.config, manualVerificationAllowed: true } };
  await seed(store, 100, true, manualRule); await reconcileServing(store, at());
  let p = await currentTask(store);
  await taskServices.taskAction(actionContext(store, p.task.id, { requestId: crypto.randomUUID(), expectedVersion: p.task.version, action: 'claim' }));
  p = await currentTask(store);
  await taskServices.taskAction(actionContext(store, p.task.id, { requestId: crypto.randomUUID(), expectedVersion: p.task.version, action: 'handoff', responsibility: 'kitchen', reason: 'kitchen accepts' }));
  p = await currentTask(store); assert.equal(p.task.status, 'open'); assert.equal(p.task.assignee, null); assert.equal(p.task.responsibility, 'kitchen');
  await taskServices.taskAction(actionContext(store, p.task.id, { requestId: crypto.randomUUID(), expectedVersion: p.task.version, action: 'claim' }, staff('kitchen-1')));
  p = await currentTask(store);
  const operation = { id: 'manual-refill', version: 0, status: 'pending_review', actor: staff('kitchen-1').actor, recordedAt: at(1), input: { requestId: crypto.randomUUID(), bindingId: binding.id, type: 'food_refill', occurredAt: at(1), quantityStatus: 'unknown', weightG: null, evidenceIds: [], note: 'reported' } };
  await store.transact(await store.revision(), [{ type: 'insert', table: 'operations', values: { id: operation.id, binding_id: binding.id, occurred_at: at(1), version: 0, corrects_id: null, payload: JSON.stringify(operation) } }]);
  await taskServices.taskAction(actionContext(store, p.task.id, { requestId: crypto.randomUUID(), expectedVersion: p.task.version, action: 'report_complete', operationId: operation.id }, staff('kitchen-1'), 2));
  p = await currentTask(store);
  const input = { requestId: crypto.randomUUID(), expectedVersion: p.task.version, action: 'verify_manual' as const, reason: 'Manager inspected dish', evidenceIds: ['inspection-1'] };
  await assert.rejects(() => taskServices.taskAction(actionContext(store, p.task.id, input, staff('kitchen-1'), 3)), /FORBIDDEN/);
  const result = await taskServices.taskAction(actionContext(store, p.task.id, input, manager, 3));
  assert.equal(result.task.status, 'resolved'); assert.equal(result.task.verificationMethod, 'manual');
  const detail = await taskServices.task(context<'task'>(store, { params: { id: p.task.id }, now: at(3) }));
  assert(detail.history.some(item => item.input.action === 'handoff')); assert(detail.evidenceIds.includes('inspection-1'));
});

test('D06/D07: rule writes enforce manager version/idempotency; binding end cancels active task once', async t => {
  const store = await database(t); await seed(store); await reconcileServing(store, at());
  const input = { requestId: crypto.randomUUID(), expectedVersion: 1, config: { ...rule.config, halfPolicy: { ...rule.config.halfPolicy!, deferSeconds: 25 } } };
  const request = context<'saveRule'>(store, { params: { dishId: binding.dishId }, body: input });
  await assert.rejects(() => servingServices.saveRule({ ...request, principal: staff('front') }), /FORBIDDEN/);
  const saved = await servingServices.saveRule(request); assert.equal(saved.rule.version, 2); assert.deepEqual(await servingServices.saveRule(request), saved);
  await assert.rejects(() => servingServices.saveRule({ ...request, body: { ...input, requestId: crypto.randomUUID() } }), /VERSION_CONFLICT/);
  const p = await currentTask(store), detail = await taskServices.task(context<'task'>(store, { params: { id: p.task.id } })); assert.equal(detail.deferLimitSeconds, 25);
  await store.transact(await store.revision(), [{ type: 'update', table: 'bindings', id: binding.id, values: { valid_to: at(1), payload: JSON.stringify({ ...binding, validTo: at(1) }) } }]);
  await reconcileServing(store, at(1)); const cancelled = await currentTask(store); assert.equal(cancelled.task.status, 'cancelled'); assert(cancelled.systemHistory?.some(item => item.event === 'binding_closed'));
  await reconcileServing(store, at(2)); assert.equal((await currentTask(store)).task.version, cancelled.task.version);
});

test('D11: first freshness batch is idempotent, warns/expires from its rule snapshot, and refill never resets it', async t => {
  const { compatibilityServices } = await import('../lib/operations-v2/compatibility.ts');
  const { operationServices } = await import('../lib/operations-v2/operations.ts');
  const store = await database(t); await seed(store);
  const ruleRequest = context<'saveFreshnessRule'>(store, { params: { dishId: binding.dishId }, body: { requestId: crypto.randomUUID(), expectedVersion: 0, config: { enabled: true, warnAfterMinutes: 1, expireAfterMinutes: 2 } } });
  await assert.rejects(() => compatibilityServices.saveFreshnessRule({ ...ruleRequest, principal: staff('front') }), /FORBIDDEN/);
  await compatibilityServices.saveFreshnessRule(ruleRequest);
  const start = context<'startFreshnessBatch'>(store, { body: { requestId: crypto.randomUUID(), bindingId: binding.id, expectedBindingVersion: 0, startedAt: at(), openingFoodG: 100 } });
  const saved = await compatibilityServices.startFreshnessBatch(start); assert.equal(saved.batch.state, 'fresh'); assert.equal(saved.bindingVersion, 1);
  assert.deepEqual(await compatibilityServices.startFreshnessBatch(start), saved);
  await assert.rejects(() => compatibilityServices.startFreshnessBatch({ ...start, body: { ...start.body, requestId: crypto.randomUUID(), expectedBindingVersion: 1 } }), /INVALID_TRANSITION/);
  await compatibilityServices.saveFreshnessRule({ ...ruleRequest, body: { ...ruleRequest.body, requestId: crypto.randomUUID(), expectedVersion: 1, config: { enabled: true, warnAfterMinutes: 10, expireAfterMinutes: 20 } } });
  const read = (seconds: number) => compatibilityServices.freshnessBatches(context<'freshnessBatches'>(store, { now: at(seconds), query: { status: 'active', limit: 50 } }));
  assert.equal((await read(61)).batches[0].state, 'warning'); assert.equal((await read(121)).batches[0].state, 'expired');
  await operationServices.operation(context<'operation'>(store, { now: at(5), body: { requestId: crypto.randomUUID(), bindingId: binding.id, occurredAt: at(5), type: 'food_refill', quantityStatus: 'unknown', weightG: null, evidenceIds: [], note: 'refill' } }));
  assert.equal((await read(121)).batches[0].startedAt, at()); assert.equal((await read(121)).batches[0].ruleVersion, 1);
});

test('D11: disposal/correction history and full removal share one transaction without double-counting or legacy writes', async t => {
  const { compatibilityServices } = await import('../lib/operations-v2/compatibility.ts');
  const { operationServices } = await import('../lib/operations-v2/operations.ts');
  const store = await database(t); await seed(store);
  const batch = await compatibilityServices.startFreshnessBatch(context<'startFreshnessBatch'>(store, { body: { requestId: crypto.randomUUID(), bindingId: binding.id, expectedBindingVersion: 0, startedAt: at(), openingFoodG: 100 } }));
  assert.equal(batch.batch.state, 'unconfigured');
  const input = { requestId: crypto.randomUUID(), bindingId: binding.id, type: 'partial_remove' as const, occurredAt: at(1), quantityStatus: 'measured' as const, weightG: 20, evidenceIds: [], note: 'partial disposal', disposition: 'waste' as const, reason: 'display_age' as const, expectedBindingVersion: 1, freshnessBatchId: batch.batch.id };
  const original = await operationServices.operation(context<'operation'>(store, { now: at(1), body: input }));
  assert.deepEqual(await operationServices.operation(context<'operation'>(store, { now: at(2), body: input })), original);
  await operationServices.operation(context<'operation'>(store, { now: at(2), body: { ...input, requestId: crypto.randomUUID(), weightG: 10, correctsOperationId: original.operation.id, expectedVersion: original.operation.version } }));
  const removals = await compatibilityServices.freshnessRemovals(context<'freshnessRemovals'>(store, { query: { startDate: '2026-10-12', endDate: '2026-10-12', limit: 50 }, now: at(2) }));
  assert.equal(removals.rows.length, 2); assert.equal(removals.rows.filter(row => row.effective).length, 1); assert.equal(removals.rows.find(row => row.effective)!.weightG, 10);
  const updated = decode((await store.get<Row<BindingPayload>>('bindings', binding.id))!);
  await operationServices.operation(context<'operation'>(store, { now: at(3), body: { ...input, requestId: crypto.randomUUID(), type: 'remove_container', occurredAt: at(3), disposition: 'retain', weightG: 80, expectedBindingVersion: updated.version } }));
  const closed = await compatibilityServices.freshnessBatches(context<'freshnessBatches'>(store, { query: { status: 'closed', limit: 50 }, now: at(4) }));
  assert.equal(closed.batches.length, 1); assert.equal(closed.batches[0].closedAt, at(3));
  assert.equal((await store.query('freshness_batches', { where: { binding_id: binding.id, closed_at: null } })).length, 0);
  const legacy = await store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('freshness_batches','scale_events','weight_plans')").all(); assert.equal(legacy.results.length, 0);
});

test('D09: raw observation coverage excludes fault spans even when endpoint samples are valid', async t => {
  const store = await database(t); await seed(store, 500);
  await store.transact(await store.revision(), [{ type: 'update', table: 'bindings', id: binding.id, values: { valid_from: at(), payload: JSON.stringify({ ...binding, validFrom: at() }) } }]);
  await sampleWrites(store, binding.scaleId, [0, 10, 20, 30].map(seconds => ({ seconds, food: 500 })));
  const events = [{ second: 5, type: 'device_fault' }, { second: 15, type: 'device_recovered' }];
  const writes: Write[] = events.map(({ second, type }, index) => {
    const id = 'event-' + index, event = { scaleId: binding.scaleId, bootId: 'boot', eventSequence: index, type, occurredAt: at(second) };
    return { type: 'insert', table: 'device_events', values: { id, scale_id: binding.scaleId, boot_id: 'boot', event_sequence: index, occurred_at: at(second), received_at: at(second), type, payload_hash: id, payload: JSON.stringify({ id, event, receivedAt: at(second) }) } };
  });
  await store.transact(await store.revision(), writes);
  const result = await reportServices.report(context<'report'>(store, { now: at(30), query: { startDate: '2026-10-12', endDate: '2026-10-12', basis: 'cycle_balance_v2', sort: 'weight_desc', limit: 50 } }));
  assert.equal(result.rows[0].observationCoverage, 1 / 3); assert.equal(result.rows[0].stockoutMinutes, null);
});

test('D07: task pagination is tied to its filter and detail history matches the returned revision', async t => {
  const store = await database(t); await seed(store);
  const secondBinding = { ...binding, id: 'binding-2', scaleId: 'scale-2' }, secondDevice = { ...device, id: 'scale-2', bindingId: secondBinding.id };
  await store.transact(await store.revision(), [
    { type: 'insert', table: 'bindings', values: { id: secondBinding.id, scale_id: secondBinding.scaleId, dish_id: binding.dishId, valid_from: binding.validFrom, valid_to: null, version: 0, payload: JSON.stringify(secondBinding) } },
    { type: 'insert', table: 'devices', values: { id: secondDevice.id, enabled: 1, updated_at: at(), payload: JSON.stringify(secondDevice) } },
  ]);
  const first = await taskServices.tasks(context<'tasks'>(store, { query: { limit: 1 } })); assert(first.nextCursor);
  const next = await taskServices.tasks(context<'tasks'>(store, { query: { limit: 1, cursor: first.nextCursor } }));
  assert.equal(next.rows.length, 1); assert.notEqual(next.rows[0].id, first.rows[0].id);
  await assert.rejects(() => taskServices.tasks(context<'tasks'>(store, { query: { limit: 1, cursor: first.nextCursor!, priority: 'urgent' } })), /INVALID_REQUEST/);
  const detail = await taskServices.task(context<'task'>(store, { params: { id: first.rows[0].id } }));
  assert.equal(detail.systemHistory.at(-1)!.toVersion, detail.task.version); assert.equal(Number(detail.dataRevision.split(':').at(-1)), await store.revision());
});


test('D09 binding supply dates are distinct from cycle recorded days and never fabricate an operating calendar', async t => {
  const store = await database(t);
  const first: BindingPayload = { ...binding, id: 'first', validFrom: '2026-10-10T16:00:00.000Z', validTo: '2026-10-11T16:00:00.000Z' };
  const second: BindingPayload = { ...binding, id: 'second', scaleId: 'scale-2', validFrom: '2026-10-11T15:00:00.000Z' };
  const orphan = cycle(0, 100); orphan.cycle.dishId = 'historical'; orphan.cycle.bindingId = 'missing-history';
  await store.transact(await store.revision(), [
    ...[first, second].map(item => ({ type: 'insert' as const, table: 'bindings' as const, values: { id: item.id, scale_id: item.scaleId, dish_id: item.dishId, valid_from: item.validFrom, valid_to: item.validTo, version: 0, payload: JSON.stringify(item) } })),
    { type: 'insert', table: 'ledger', values: { id: 'historical', cycle_id: orphan.cycle.id, version: 0, current: 1, effective_at: at(), weight_mg: 100000, payload: JSON.stringify({ ...orphan, dishName: 'Disabled historical', recordedAt: at() }) } },
  ]);
  const result = await reportServices.report(context<'report'>(store, { query: { startDate: '2026-10-11', endDate: '2026-10-12', basis: 'cycle_balance_v2', sort: 'weight_desc', limit: 50 } }));
  const supplied = result.rows.find(r => r.dishId === binding.dishId)!;
  assert.equal(supplied.operatingDays, 2); assert.equal(supplied.operatingDaysBasis, 'binding_schedule'); assert.equal(supplied.recordedDays, 0);
  const missing = result.rows.find(r => r.dishId === 'historical')!;
  assert.equal(missing.operatingDays, null); assert.equal(missing.operatingDaysBasis, 'unknown'); assert.equal(missing.recordedDays, 1);
  const boundary = await reportServices.report(context<'report'>(store, { query: { startDate: '2026-10-12', endDate: '2026-10-12', basis: 'cycle_balance_v2', sort: 'weight_desc', limit: 50 } }));
  assert.equal(boundary.rows.find(r => r.dishId === binding.dishId)!.operatingDays, 1);
});
