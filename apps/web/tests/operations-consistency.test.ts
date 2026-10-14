import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { createOperationsApplication } from '../lib/operations-v2/application.ts';
import { decode, type Row, type DevicePayload } from '../lib/operations-v2/records.ts';
import type { Bowl, Cycle } from '@zhishan/contracts/operations-v2';
import { sampleId } from '../lib/operations-v2/telemetry.ts';

const at = (second: number) => new Date(Date.parse('2026-10-12T00:00:00Z') + second * 1000).toISOString();
async function setup(t: TestContext) {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("isolated consistency test")}}', compatibilityDate: '2026-05-15', d1Databases: { DB: crypto.randomUUID() } });
  t.after(() => mf.dispose());
  const manager = 'm'.repeat(48), device = 'd'.repeat(48); let now = at(0);
  const app = await createOperationsApplication(await mf.getD1Database('DB') as unknown as D1Database, { environment: 'test', bootstrapToken: manager, clock: () => now });
  async function request(path: string, body?: unknown, token = manager, method = body ? 'POST' : 'GET') {
    const response = await app.fetch(new Request('https://isolated.invalid' + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    const data = await response.json() as { device: { binding: { id: string } }; results: { code: string; processingStatus?: string | null }[]; bowls: Bowl[]; rows: Cycle[]; cycle: Cycle };
    assert.equal(response.status, 200, JSON.stringify(data)); return data;
  }
  const created = await request('/api/v2/devices/scale-1', { requestId: crypto.randomUUID(), expectedVersion: 0, scaleId: 'scale-1', name: 'Consistency test', enabled: true, positionOrder: 1,
    measurement: { boundaryWindowMs: 5000, maxSampleGapMs: 30000, freshMs: 60000, locationFreshMs: 60000, stableWindowMs: 0, stableMinSamples: 1, stableToleranceG: 0, negativeToleranceG: 0, maxStepG: null, timeZone: 'Asia/Shanghai', ruleVersion: 'consistency-test' },
    binding: { dishId: 'dish-1', dishName: 'Test dish', containerRef: null, tareG: 100, fullFoodG: 1000, foodOnly: true } }, manager, 'PUT');
  await request('/api/v2/access/credentials', { requestId: crypto.randomUUID(), id: 'device', token: device, role: 'device', actor: { id: 'device', kind: 'system', label: 'Test device' }, scaleIds: ['scale-1'], expiresAt: null });
  const sample = (sequence: number, second: number, grossG: number) => ({ scaleId: 'scale-1', bootId: 'boot-1', sequence, sampledAt: at(second), grossG, measurementStatus: 'ok' });
  const samples = (values: ReturnType<typeof sample>[]) => request('/api/v2/telemetry/samples', { version: 2, batchId: crypto.randomUUID(), samples: values }, device);
  const events = (values: unknown[], batchId: string = crypto.randomUUID()) => request('/api/v2/telemetry/events', { version: 2, batchId, events: values }, device);
  const event = (eventSequence: number, second: number, type: string) => ({ eventId: crypto.randomUUID(), scaleId: 'scale-1', bootId: 'boot-1', eventSequence, occurredAt: at(second), type });
  return { app, request, setNow: (second: number) => { now = at(second); }, samples, sample, events, event, bindingId: created.device.binding.id };
}

test('accepted near-future observation becomes current when its time arrives without another device packet', async t => {
  const f = await setup(t); f.setNow(10);
  const response = await f.samples([f.sample(1, 14, 600)]); assert.equal(response.results[0].code, 'STORED');
  assert.equal((await f.request('/api/v2/serving/state')).bowls[0].foodRemainingG, null, 'future observation is not current evidence');
  f.setNow(15); await f.app.jobs();
  assert.equal((await f.request('/api/v2/serving/state')).bowls[0].foodRemainingG, 500, 'scheduler must promote already accepted evidence after occurrence time');
});

test('late older fault cannot overwrite a more recent recovery in current device diagnostics', async t => {
  const f = await setup(t); f.setNow(30);
  await f.samples([f.sample(1, 10, 600), f.sample(2, 25, 600)]);
  await f.events([f.event(2, 20, 'device_recovered')]);
  await f.events([{ ...f.event(1, 15, 'device_fault'), reasonCode: 'sensor_fault' }]);
  const device = decode((await f.app.store.get<Row<DevicePayload>>('devices', 'scale-1'))!);
  assert.equal(device.diagnostics.fault, null, 'diagnostics must follow occurrence order, not receipt order');
});

test('two manager reviews at the same timestamp preserve the later version through projection rebuild', async t => {
  const f = await setup(t); f.setNow(30);
  await f.samples([f.sample(1, 10, 900), f.sample(2, 20, 700)]);
  await f.events([{ ...f.event(1, 10, 'exit_kitchen'), sampleRef: { bootId: 'boot-1', sequence: 1 } }, { ...f.event(2, 20, 'enter_kitchen'), sampleRef: { bootId: 'boot-1', sequence: 2 } }]);
  const original = (await f.request('/api/v2/cycles?startDate=2026-10-12&endDate=2026-10-12')).rows[0]; assert.equal(original.confirmedTakeG, 200);
  const pending = await f.request(`/api/v2/cycles/${encodeURIComponent(original.id)}/review`, { requestId: crypto.randomUUID(), expectedVersion: original.version, decision: 'keep_pending', evidenceIds: [], note: 'first decision' });
  await f.request(`/api/v2/cycles/${encodeURIComponent(original.id)}/review`, { requestId: crypto.randomUUID(), expectedVersion: pending.cycle.version, decision: 'confirm', evidenceIds: [original.evidenceIds[0]], note: 'later decision' });
  f.setNow(40); await f.samples([f.sample(3, 31, 700)]);
  const rebuilt = (await f.request(`/api/v2/cycles/${encodeURIComponent(original.id)}`)).cycle;
  assert.equal(rebuilt.status, 'confirmed'); assert.equal(rebuilt.confirmedTakeG, 200);
});

test('refill evidence cannot span a device fault/recovery even when endpoint weights match the claimed delta', async t => {
  const f = await setup(t); f.setNow(20);
  const before = f.sample(1, 10, 200), after = f.sample(2, 14, 1000);
  await f.samples([before, after]);
  await f.events([{ ...f.event(1, 11, 'device_fault'), reasonCode: 'sensor_fault' }, f.event(2, 13, 'device_recovered')]);
  await f.request('/api/v2/operations', { requestId: crypto.randomUUID(), bindingId: f.bindingId, type: 'food_refill', occurredAt: at(12), quantityStatus: 'measured', weightG: 800, evidenceIds: await Promise.all([before, after].map(sampleId)), note: 'must reject interrupted evidence' });
  const operation = JSON.parse((await f.app.store.list<{ payload: string }>('operations'))[0].payload);
  assert.equal(operation.status, 'pending_review', 'fault-interrupted delta is not measured refill attestation');
  assert.equal((await f.request('/api/v2/serving/state')).bowls[0].foodRemainingG, null);
});

test('a correction moving earlier with another timezone representation invalidates the earliest affected serving interval', async t => {
  const f = await setup(t); f.setNow(20);
  const input = { requestId: crypto.randomUUID(), bindingId: f.bindingId, type: 'food_refill', occurredAt: at(12), quantityStatus: 'unknown', weightG: null, evidenceIds: [], note: 'original event time' };
  await f.request('/api/v2/operations', input);
  const original = JSON.parse((await f.app.store.list<{ payload: string }>('operations'))[0].payload);
  await f.app.store.transact(await f.app.store.revision(), [{ type: 'insert', table: 'serving_intervals', values: { id: 'earlier-interval', binding_id: f.bindingId, dish_id: 'dish-1', started_at: at(10), ended_at: at(11.5), quality: 'good', empty: 0, rule_version: null, payload: '{}' } }]);
  await f.request('/api/v2/operations', { ...input, requestId: crypto.randomUUID(), occurredAt: '2026-10-12T08:00:11+08:00', correctsOperationId: original.id, expectedVersion: original.version, note: 'actual earlier occurrence' });
  const interval = await f.app.store.get<{ quality: string }>('serving_intervals', 'earlier-interval');
  assert.equal(interval!.quality, 'pending', 'use chronological minimum, not lexical comparison of ISO offset spellings');
});

test('third revision uses the same real evidence once and preserves both correction ancestors', async t => {
  const f = await setup(t); f.setNow(20);
  const before = f.sample(1, 10, 200), after = f.sample(2, 14, 1000); await f.samples([before, after]);
  const base = { bindingId: f.bindingId, type: 'food_refill', occurredAt: at(12), quantityStatus: 'measured', evidenceIds: await Promise.all([before, after].map(sampleId)), note: 'reconcile actual evidence' };
  let previous: { id: string; version: number } | null = null;
  for (const weightG of [700, 750, 800]) {
    const requestId = crypto.randomUUID();
    await f.request('/api/v2/operations', { ...base, requestId, weightG, ...(previous ? { correctsOperationId: previous.id, expectedVersion: previous.version } : {}) });
    const saved = (await f.app.store.list<{ payload: string }>('operations')).map(row => JSON.parse(row.payload));
    const next = saved.find(row => row.input.requestId === requestId);
    assert.equal(next.status, weightG === 800 ? 'matched' : 'pending_review'); previous = next;
  }
  const all = (await f.app.store.list<{ payload: string }>('operations')).map(row => JSON.parse(row.payload));
  assert.deepEqual(all.map(row => row.input.weightG).sort((a, b) => a - b), [700, 750, 800]);
  assert.equal((await f.request('/api/v2/serving/state')).bowls[0].foodRemainingG, 900);
});

test('operation attestation waits for future evidence to become current, then the scheduler completes it', async t => {
  const f = await setup(t); f.setNow(10);
  const before = f.sample(1, 8, 200), after = f.sample(2, 14, 1000); await f.samples([before, after]);
  await f.request('/api/v2/operations', { requestId: crypto.randomUUID(), bindingId: f.bindingId, type: 'food_refill', occurredAt: at(9), quantityStatus: 'measured', weightG: 800, evidenceIds: await Promise.all([before, after].map(sampleId)), note: 'time-aware evidence' });
  const operation = async () => JSON.parse((await f.app.store.list<{ payload: string }>('operations'))[0].payload);
  assert.equal((await operation()).status, 'pending_review');
  f.setNow(15); await f.app.jobs();
  assert.equal((await operation()).status, 'matched');
  assert.equal((await f.request('/api/v2/serving/state')).bowls[0].foodRemainingG, 900);
});

test('a duplicate event in a new batch returns persisted processing state while exact batch retry preserves its receipt', async t => {
  const f = await setup(t); f.setNow(30);
  await f.samples([f.sample(1, 10, 900), f.sample(2, 20, 700)]);
  const events = [{ ...f.event(1, 10, 'exit_kitchen'), sampleRef: { bootId: 'boot-1', sequence: 1 } }, { ...f.event(2, 20, 'enter_kitchen'), sampleRef: { bootId: 'boot-1', sequence: 2 } }];
  const batchId = crypto.randomUUID(), first = await f.events(events, batchId);
  assert.equal((await f.request('/api/v2/cycles?startDate=2026-10-12&endDate=2026-10-12')).rows[0].status, 'confirmed');
  assert.deepEqual(await f.events(events, batchId), first, 'same logical batch retains its original receipt');
  const duplicate = await f.events(events);
  assert.ok(duplicate.results.every(result => result.code === 'DUPLICATE'));
  assert.deepEqual(duplicate.results.map(result => result.processingStatus), ['applied', 'applied']);
});

test('fault/recovery receipts distinguish effective events from future events and preserve same-batch replies', async t => {
  const f = await setup(t); f.setNow(10);
  const fault = { ...f.event(1, 8, 'device_fault'), reasonCode: 'sensor_fault' };
  assert.equal((await f.events([fault])).results[0].processingStatus, 'applied');
  const future = f.event(2, 14, 'device_recovered'), batchId = crypto.randomUUID();
  const first = await f.events([future], batchId); assert.equal(first.results[0].processingStatus, 'pending_review');
  f.setNow(15); await f.app.jobs();
  assert.deepEqual(await f.events([future], batchId), first);
  const replay = await f.events([future]);
  assert.equal(replay.results[0].code, 'DUPLICATE'); assert.equal(replay.results[0].processingStatus, 'applied');
});
