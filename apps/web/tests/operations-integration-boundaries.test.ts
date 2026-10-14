import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Miniflare } from 'miniflare';
import { createOperationsApplication, operationsServices } from '../lib/operations-v2/application.ts';
import { createOperationsRouter } from '../lib/operations-v2/router.ts';
import { OperationsStore, type Write } from '../lib/operations-v2/storage.ts';
import { createOperationsBackup, restoreOperationsBackup } from '../lib/operations-v2/backup.ts';
import { canonical } from '../lib/operations-v2/records.ts';
import { tokenHash } from '../lib/operations-v2/security.ts';
import type { ServingView, ConsumptionReport, SampleV2, DeviceEventV2, Cycle } from '@zhishan/contracts/operations-v2';

const at = (second = 0) => new Date(Date.parse('2026-10-12T00:00:00Z') + second * 1000).toISOString();
const managerToken = 'manager_' + 'a'.repeat(48), deviceToken = 'device_' + 'b'.repeat(48);
const ruleConfig = { enabled: true, thresholds: { emptyG: 5, lowRatio: .2, fullRatio: .8, hysteresisRatio: .02, holdSeconds: 0 }, halfPolicy: { mode: 'cycles' as const, unchangedCycles: 2, observationSeconds: null, changeToleranceG: 2, deferSeconds: 60, refillDuringPeak: false }, peakPeriods: [], manualVerificationAllowed: false };
const measurement = { boundaryWindowMs: 1000, maxSampleGapMs: 30000, freshMs: 60000, locationFreshMs: 60000, stableWindowMs: 0, stableMinSamples: 1, stableToleranceG: 0, negativeToleranceG: 0, maxStepG: null, timeZone: 'Asia/Shanghai', ruleVersion: 'integration-test' };
async function database(t: TestContext) {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("isolated boundaries")}}', compatibilityDate: '2026-05-15', d1Databases: { DB: crypto.randomUUID() } });
  t.after(() => mf.dispose()); return await mf.getD1Database('DB') as unknown as D1Database;
}
function request(path: string, body?: unknown, token = managerToken, method = body ? 'POST' : 'GET') {
  return new Request('http://local' + path, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function fixture(t: TestContext) {
  const db = await database(t); let now = at();
  const app = await createOperationsApplication(db, { environment: 'test', bootstrapToken: managerToken, clock: () => now });
  const call = async <T = Record<string, unknown>>(path: string, body?: unknown, token = managerToken, method = body ? 'POST' : 'GET') => {
    const response = await app.fetch(request(path, body, token, method));
    const data = await response.json() as T; assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  const created = await call<{ device: { binding: { id: string } } }>('/api/v2/devices/scale', { requestId: crypto.randomUUID(), expectedVersion: 0, scaleId: 'scale', name: '测试盘', enabled: true, positionOrder: 1, measurement, binding: { dishId: 'dish', dishName: '测试菜', containerRef: null, tareG: 100, fullFoodG: 1000, foodOnly: true } }, managerToken, 'PUT');
  await call('/api/v2/serving/rules/dish', { requestId: crypto.randomUUID(), expectedVersion: 0, config: ruleConfig }, managerToken, 'PUT');
  await call('/api/v2/access/credentials', { requestId: crypto.randomUUID(), id: 'device', token: deviceToken, role: 'device', actor: { id: 'gateway', kind: 'system', label: 'Gateway' }, scaleIds: ['scale'], expiresAt: null });
  return { app, db, bindingId: created.device.binding.id, call, advance: (second: number) => { now = at(second); },
    rawRoute: createOperationsRouter(app.store, operationsServices, () => now),
    sample: (second: number, food: number): SampleV2 => ({ scaleId: 'scale', bootId: 'boot', sequence: second, sampledAt: at(second), grossG: food + 100, measurementStatus: 'ok' }),
  };
}
const sampleBody = (samples: SampleV2[]) => ({ version: 2, batchId: crypto.randomUUID(), samples });
const eventBody = (events: DeviceEventV2[]) => ({ version: 2, batchId: crypto.randomUUID(), events });
const reportPath = '/api/v2/reports/consumption?startDate=2026-10-12&endDate=2026-10-12&basis=cycle_balance_v2';

test('T09 integration: simultaneous fault and recovery from different boots cannot clear a fault inherited by a new binding', async t => {
  const f = await fixture(t);
  const events: DeviceEventV2[] = [
    { eventId: crypto.randomUUID(), scaleId: 'scale', bootId: 'boot-a', eventSequence: 1, occurredAt: at(-1), type: 'device_fault', reasonCode: 'sensor_fault' },
    { eventId: crypto.randomUUID(), scaleId: 'scale', bootId: 'boot-b', eventSequence: 99, occurredAt: at(-1), type: 'device_recovered', reasonCode: 'sensor_fault' },
  ];
  // Immutable pre-binding history, persisted in real D1. Event sequences from
  // different boot streams are deliberately incomparable.
  const writes: Write[] = events.map(event => ({ type: 'insert', table: 'device_events', values: { id: event.eventId, scale_id: event.scaleId, boot_id: event.bootId, event_sequence: event.eventSequence, occurred_at: event.occurredAt, received_at: at(), type: event.type, payload_hash: 'test', payload: JSON.stringify({ event, receivedAt: at(), origin: 'device' }) } }));
  assert(await f.app.store.transact(await f.app.store.revision(), writes));
  f.advance(1); await f.call('/api/v2/telemetry/samples', sampleBody([f.sample(1, 500)]), deviceToken);
  assert.equal((await f.call<ServingView>('/api/v2/serving/state')).bowls[0].quality, 'offline');
  assert.equal((await f.call<{ devices: { fault: string | null }[] }>('/api/v2/devices/diagnostics')).devices[0].fault, 'sensor_fault');
  f.advance(3);
  await f.call('/api/v2/telemetry/events', eventBody([{ eventId: crypto.randomUUID(), scaleId: 'scale', bootId: 'boot', eventSequence: 1, occurredAt: at(2), type: 'device_recovered', reasonCode: 'sensor_fault' }]), deviceToken);
  await f.call('/api/v2/telemetry/samples', sampleBody([f.sample(3, 500)]), deviceToken);
  assert.equal((await f.call<ServingView>('/api/v2/serving/state')).bowls[0].quality, 'good');
});

test('D10 integration: late raw weight and late fault invalidate existing empty intervals in their acceptance transaction', async t => {
  for (const kind of ['sample', 'fault'] as const) {
    const f = await fixture(t);
    await f.call('/api/v2/telemetry/samples', sampleBody([f.sample(0, 0)]), deviceToken);
    f.advance(10); await f.call('/api/v2/telemetry/samples', sampleBody([f.sample(10, 0)]), deviceToken);
    let before = await f.call<ConsumptionReport>(reportPath);
    assert.equal(before.rows[0].stockoutMinutes, 10 / 60);
    const intervals = await f.app.store.list<{ id: string; quality: string; empty: number }>('serving_intervals'); assert.equal(intervals.length, 1); assert.equal(intervals[0].quality, 'good'); assert.equal(intervals[0].empty, 1);
    f.advance(11);
    const path = kind === 'sample' ? '/api/v2/telemetry/samples' : '/api/v2/telemetry/events';
    const body = kind === 'sample' ? sampleBody([f.sample(5, 500)]) : eventBody([{ eventId: crypto.randomUUID(), scaleId: 'scale', bootId: 'boot', eventSequence: 1, occurredAt: at(5), type: 'device_fault', reasonCode: 'sensor_fault' }]);
    // Stop before asynchronous projection: invalidation must already be committed.
    const accepted = await f.rawRoute(request(path, body, deviceToken)); assert.equal(accepted.status, 200);
    const receipt = await accepted.json() as { results: { code: string }[] }; assert.equal(receipt.results[0].code, kind === 'sample' ? 'LATE_SAMPLE' : 'STORED');
    const invalid = await f.app.store.get<{ quality: string; empty: number }>('serving_intervals', intervals[0].id); assert.equal(invalid?.quality, 'pending'); assert.equal(invalid?.empty, 0);
    before = await f.call<ConsumptionReport>(reportPath); assert.equal(before.projectionStatus, 'rebuilding'); assert.equal(before.rows[0].stockoutMinutes, null);
    await f.app.jobs();
    const after = await f.call<ConsumptionReport>(reportPath); assert.equal(after.projectionStatus, 'ready'); assert.equal(after.rows[0].stockoutMinutes, null);
  }
});

test('T05 integration: latest pending cycle is ordered by return time and blocks older confirmed half-plate deferral', async t => {
  const f = await fixture(t); f.advance(6);
  await f.call('/api/v2/telemetry/samples', sampleBody([1, 2, 3, 4, 5, 6].map(second => f.sample(second, 500))), deviceToken);
  const boundary = (second: number, type: 'exit_kitchen' | 'enter_kitchen', sequence = second): DeviceEventV2 => ({ eventId: crypto.randomUUID(), scaleId: 'scale', bootId: 'boot', eventSequence: second, occurredAt: at(second), type, sampleRef: { bootId: 'boot', sequence } });
  const first = [boundary(1, 'exit_kitchen'), boundary(2, 'enter_kitchen'), boundary(3, 'exit_kitchen'), boundary(4, 'enter_kitchen')];
  await f.call('/api/v2/telemetry/events', eventBody(first), deviceToken);
  assert.equal((await f.call<ServingView>('/api/v2/serving/state')).bowls[0].recommendation, 'defer');
  const third = [boundary(5, 'exit_kitchen'), boundary(6, 'enter_kitchen', 999)];
  await f.call('/api/v2/telemetry/events', eventBody(third), deviceToken);
  const sorted = await f.app.store.query<{ status: string; effective_at: string; payload: string }>('cycles', { where: { binding_id: f.bindingId }, orderBy: [{ column: 'effective_at', direction: 'desc' }], limit: 2 });
  assert.equal(sorted[0].status, 'pending'); assert.equal(sorted[0].effective_at, at(6)); assert.equal((JSON.parse(sorted[0].payload) as { cycle: Cycle }).cycle.effectiveAt, null);
  const view = (await f.call<ServingView>('/api/v2/serving/state')).bowls[0]; assert.equal(view.quality, 'good'); assert.equal(view.servingState, 'half'); assert.equal(view.recommendation, 'watch'); assert(!view.reasonCodes.includes('HALF_NO_CHANGE'));
  const reviewed = (JSON.parse(sorted[1].payload) as { cycle: Cycle }).cycle;
  await f.call(`/api/v2/cycles/${encodeURIComponent(reviewed.id)}/review`, { requestId: crypto.randomUUID(), expectedVersion: reviewed.version, decision: 'keep_pending', evidenceIds: [], note: '复核' });
  assert.equal((await f.app.store.get<{ effective_at: string }>('cycles', reviewed.id))!.effective_at, at(4));
});

test('D12 integration: incomplete restore stays unavailable to requests/jobs and cannot be laundered through another backup', async t => {
  const f = await fixture(t), source = await createOperationsBackup(f.app.store);
  const bad = structuredClone(source); bad.data.tables.find(table => table.table === 'devices')!.rows[0].not_a_column = 'broken'; bad.sha256 = await tokenHash(canonical(bad.data));
  const target = new OperationsStore(await database(t), 'test'); await target.initialize();
  await assert.rejects(() => restoreOperationsBackup(target, bad), /Invalid operations columns/);
  const app = await createOperationsApplication(target.db, { environment: 'test' });
  assert.equal((await app.fetch(request('/api/v2/serving/state'))).status, 503);
  await assert.rejects(() => app.jobs(), /UNAVAILABLE/);
  await assert.rejects(() => createOperationsBackup(target), /restore|maintenance|incomplete|unavailable/i);
});

test('D12 integration: same physical D1 isolates credentials, queries, mutations and backups by environment', async t => {
  const f = await fixture(t), liveToken = 'live_' + 'z'.repeat(48);
  const live = await createOperationsApplication(f.db, { environment: 'live', bootstrapToken: liveToken, clock: () => at() });
  assert.equal((await live.fetch(request('/api/v2/devices'))).status, 401);
  assert.equal((await f.app.fetch(request('/api/v2/devices', undefined, liveToken))).status, 401);
  assert.equal((await live.store.query('devices')).length, 0);
  const testRevision = await f.app.store.revision();
  await live.store.transact(await live.store.revision(), [{ type: 'update', table: 'devices', id: 'scale', values: { enabled: 0 } }]);
  assert.equal((await f.app.store.get<{ enabled: number }>('devices', 'scale'))!.enabled, 1); assert.equal(await f.app.store.revision(), testRevision);
  const backup = await createOperationsBackup(live.store); assert.equal(backup.data.environment, 'live'); assert.equal(backup.data.tables.find(table => table.table === 'devices')!.rows.length, 0);
  const blankTest = new OperationsStore(await database(t), 'test'); await blankTest.initialize(); await assert.rejects(() => restoreOperationsBackup(blankTest, backup), /environment/);
});

test('D12 scheduler: running jobs do not starve pending work at the default batch limit', async t => {
  const f = await fixture(t); f.advance(1);
  assert.equal((await f.rawRoute(request('/api/v2/telemetry/samples', sampleBody([f.sample(1, 100)]), deviceToken))).status, 200);
  const writes: Write[] = Array.from({ length: 100 }, (_, index) => ({ type: 'insert', table: 'jobs', values: { id: 'aaa-' + index.toString().padStart(3, '0'), scope: 'measurement', status: 'running', desired_revision: 0, lease_until: at(60), attempts: 1, payload: JSON.stringify({ bindingId: 'other-' + index, requestedAt: at(), leaseId: 'other-worker' }) } }));
  await f.app.store.transact(await f.app.store.revision(), writes);
  await f.app.jobs();
  assert.equal((await f.app.store.get<{ status: string }>('jobs', 'project:' + f.bindingId))!.status, 'complete');
  assert.equal((await f.app.store.get<{ payload: string }>('latest', 'scale')) !== null, true);
});

test('D12 runtime: the exported Worker scheduled handler reconciles queued work without a triggering fetch or open browser', async t => {
  const f = await fixture(t); f.advance(1);
  assert.equal((await f.rawRoute(request('/api/v2/telemetry/samples', sampleBody([f.sample(1, 100)]), deviceToken))).status, 200);
  assert.equal(await f.app.store.get('latest', 'scale'), null);
  const runtimeEnv = { OPS_DB: f.db, OPS_V2_ENVIRONMENT: 'test' };
  Object.assign(globalThis, { operationsBoundaryRuntimeEnv: runtimeEnv });
  const hooks = registerHooks({ resolve(specifier, context, next) { return specifier === 'cloudflare:workers' ? { url: 'data:text/javascript,export const env=globalThis.operationsBoundaryRuntimeEnv;export const waitUntil=(job)=>job;', shortCircuit: true } : next(specifier, context); } });
  t.after(() => { hooks.deregister(); Reflect.deleteProperty(globalThis, 'operationsBoundaryRuntimeEnv'); });
  const worker = (await import('../build/operations-worker.ts')).default;
  const pending: Promise<unknown>[] = [];
  await worker.scheduled({} as ScheduledController, runtimeEnv as Cloudflare.Env, { waitUntil: (job: Promise<unknown>) => pending.push(job) } as unknown as ExecutionContext);
  assert.equal(pending.length, 1); await Promise.all(pending);
  assert.equal((await f.app.store.get<{ status: string }>('jobs', 'project:' + f.bindingId))!.status, 'complete');
  assert.notEqual(await f.app.store.get('latest', 'scale'), null);
});


test('D06 diagnostics: tolerated future fault/recovery applies at event time while reception counters update immediately', async t => {
  const f = await fixture(t); f.advance(1);
  await f.call('/api/v2/telemetry/samples', sampleBody([f.sample(1, 100)]), deviceToken);
  const event = (second: number, type: 'device_fault' | 'device_recovered', eventSequence: number): DeviceEventV2 => ({ eventId: crypto.randomUUID(), scaleId: 'scale', bootId: 'boot', eventSequence, occurredAt: at(second), type, reasonCode: 'sensor_fault' });
  const diagnostics = async () => (await f.call<{ devices: { fault: string | null; accepted: number; duplicate: number; rejected: number; lastCode: string }[] }>('/api/v2/devices/diagnostics')).devices[0];
  await f.call('/api/v2/telemetry/events', eventBody([event(4, 'device_fault', 1)]), deviceToken);
  assert.equal((await diagnostics()).fault, null); assert.equal((await diagnostics()).accepted, 2);
  f.advance(4); assert.equal((await diagnostics()).fault, 'sensor_fault');
  await f.call('/api/v2/telemetry/events', eventBody([event(7, 'device_recovered', 2)]), deviceToken);
  assert.equal((await diagnostics()).fault, 'sensor_fault');
  f.advance(7); assert.equal((await diagnostics()).fault, null);
  await f.call('/api/v2/telemetry/events', eventBody([event(8, 'device_fault', 3), event(8, 'device_recovered', 4)]), deviceToken);
  f.advance(8); const final = await diagnostics();
  assert.equal(final.fault, null); assert.equal(final.accepted, 5); assert.equal(final.rejected, 0); assert.equal(final.duplicate, 0); assert.equal(final.lastCode, 'STORED');
});

test('D12 backup: a restore lock acquired between lock-read and revision-read cannot yield a complete backup', async t => {
  class RestoreRaceStore extends OperationsStore {
    locked = false;
    override async get<T>(...args: Parameters<OperationsStore['get']>): Promise<T | null> {
      const found = await super.get<T>(...args);
      if (args[0] === 'maintenance' && args[1] === 'restore' && !this.locked) {
        this.locked = true;
        // Deterministic D1 interleaving: another worker acquires the lock after
        // this caller read no lock, before its next database read.
        assert.equal(await this.transact(await this.revision(), [{ type: 'insert', table: 'maintenance', values: { id: 'restore', payload: JSON.stringify({ status: 'pending', sourceDigest: 'in-flight' }) } }]), true);
      }
      return found;
    }
  }
  const store = new RestoreRaceStore(await database(t), 'test'); await store.initialize();
  await assert.rejects(() => createOperationsBackup(store), /restore|maintenance|incomplete|unavailable/i);
});

test('D12 application: a restore beginning after readiness check cannot expose partially restored credentials', async t => {
  const f = await fixture(t), sourceCredential = (await f.app.store.query<Record<string, string | number | null> & { id: string }>('credentials', { where: { id: 'bootstrap-manager' } }))[0];
  const values = Object.fromEntries(Object.entries(sourceCredential).filter(([key]) => key !== 'environment')) as Record<string, string | number | null> & { id: string };
  for (const path of ['/api/v2/access/credentials', '/api/v2/session']) {
  const app = await createOperationsApplication(await database(t), { environment: 'test', clock: () => at() });
  const originalGet = app.store.get.bind(app.store); let locked = false;
  app.store.get = async <T>(...args: Parameters<OperationsStore['get']>): Promise<T | null> => {
    const found = await originalGet<T>(...args);
    if (args[0] === 'maintenance' && args[1] === 'restore' && !locked) {
      locked = true;
      assert.equal(await app.store.transact(await app.store.revision(), [
        { type: 'insert', table: 'maintenance', values: { id: 'restore', payload: JSON.stringify({ status: 'pending', sourceDigest: 'in-flight' }) } },
        { type: 'insert', table: 'credentials', values },
      ], { maintenance: true }), true);
    }
    return found;
  };
  const response = await app.fetch(request(path));
  assert.equal(response.status, 503, 'A response from an incomplete restore must not be presented as ready');
  }
});


test('D12 storage: pending restore atomically rejects ordinary writes and preserves their revision', async t => {
  const store = new OperationsStore(await database(t), 'test'); await store.initialize();
  await store.transact(0, [{ type: 'insert', table: 'maintenance', values: { id: 'restore', payload: '{"status":"pending"}' } }]);
  const revision = await store.revision();
  const writes: Write[] = [{ type: 'insert', table: 'freshness_rules', values: { id: 'blocked-rule', version: 0, updated_at: at(), payload: '{}' } }];
  assert.equal(await store.transact(revision, writes), false); assert.equal(await store.revision(), revision); assert.equal(await store.get('freshness_rules', 'blocked-rule'), null);
  assert.equal(await store.transact(revision, writes, { maintenance: true }), true);
  assert.notEqual(await store.get('freshness_rules', 'blocked-rule'), null);
});

test('D12 restore generation: report/task/freshness cursors and revision tags cannot collide with the source database', async t => {
  const f = await fixture(t);
  const second = await f.call<{ device: { binding: { id: string } } }>('/api/v2/devices/scale2', { requestId: crypto.randomUUID(), expectedVersion: 0, scaleId: 'scale2', name: '第二盘', enabled: true, positionOrder: 2, measurement, binding: { dishId: 'dish2', dishName: '第二菜', containerRef: null, tareG: 100, fullFoodG: 1000, foodOnly: true } }, managerToken, 'PUT');
  for (const bindingId of [f.bindingId, second.device.binding.id]) await f.call('/api/v2/freshness/batches', { requestId: crypto.randomUUID(), bindingId, expectedBindingVersion: 0, startedAt: at(), openingFoodG: null });
  const paths = ['/api/v2/refill/tasks?limit=1', reportPath + '&limit=1', '/api/v2/freshness/batches?status=all&limit=1'];
  const cursors = [];
  for (const path of paths) { const result = await f.call<{ nextCursor: string | null; dataRevision: string }>(path); assert(result.nextCursor); cursors.push({ path, cursor: result.nextCursor, revision: result.dataRevision }); }
  const sourceRevision = await f.app.store.revision(), backup = await createOperationsBackup(f.app.store);
  const restored = new OperationsStore(await database(t), 'test'); await restored.initialize(); await restoreOperationsBackup(restored, backup);
  assert.notEqual(restored.generation, f.app.store.generation);
  // Force equal numeric counters to exercise the otherwise accidental collision.
  await restored.db.prepare('UPDATE ops_v2_meta SET revision=? WHERE environment=?').bind(sourceRevision, 'test').run();
  const app = await createOperationsApplication(restored.db, { environment: 'test', clock: () => at() });
  for (const item of cursors) {
    const response = await app.fetch(request(item.path)); assert.equal(response.status, 200);
    const current = await response.json() as { dataRevision: string }; assert.notEqual(current.dataRevision, item.revision);
    const rejected = await app.fetch(request(item.path + '&cursor=' + encodeURIComponent(item.cursor))); assert.equal(rejected.status, 400, await rejected.text());
  }
  const oldReport = cursors[1];
  const exported = await app.fetch(request(reportPath.replace('/consumption?', '/consumption/export?') + '&dataRevision=' + encodeURIComponent(oldReport.revision) + '&snapshotAt=' + encodeURIComponent(at())));
  assert.equal(exported.status, 409, 'An old database generation cannot authorize an export from the restored instance');
});


test('D10 AI evidence uses the exact report revision without legacy training or external completion', async t => {
  const f = await fixture(t); f.advance(1);
  await f.call('/api/v2/telemetry/samples', sampleBody([f.sample(1, 500)]), deviceToken);
  const report = await f.call<ConsumptionReport>(reportPath);
  const evidencePath = reportPath.replace('/reports/consumption', '/intelligence/evidence') + '&dataRevision=' + encodeURIComponent(report.dataRevision) + '&snapshotAt=' + encodeURIComponent(report.serverAt);
  const revision = await f.app.store.revision();
  const evidence = await f.call<{ dataRevision: string; report: ConsumptionReport; training: { enabled: boolean }; externalModelCalled: boolean }>(evidencePath);
  assert.equal(evidence.dataRevision, report.dataRevision); assert.deepEqual(evidence.report, report);
  assert.equal(evidence.training.enabled, false); assert.equal(evidence.externalModelCalled, false); assert.equal(await f.app.store.revision(), revision);
  const exportPath = reportPath.replace('/consumption?', '/consumption/export?') + '&dataRevision=' + encodeURIComponent(report.dataRevision) + '&snapshotAt=' + encodeURIComponent(report.serverAt);
  const firstCsv = await f.app.fetch(request(exportPath)); assert.equal(firstCsv.status, 200); const csv = await firstCsv.text();
  f.advance(40); // No database write: coverage denominators must still match the displayed snapshot.
  const laterEvidence = await f.call<{ report: ConsumptionReport }>(evidencePath); assert.deepEqual(laterEvidence.report, report);
  assert.equal(await (await f.app.fetch(request(exportPath))).text(), csv);
  assert.equal((await f.app.fetch(request(evidencePath.replace(encodeURIComponent(report.serverAt), encodeURIComponent(at(100)))))).status, 400);
  assert.equal((await f.app.fetch(request(evidencePath, undefined, deviceToken))).status, 403);
  assert.equal((await f.app.fetch(request(evidencePath.replace('cycle_balance_v2', 'legacy_delta_v1')))).status, 400);
  f.advance(2); await f.call('/api/v2/telemetry/samples', sampleBody([f.sample(2, 490)]), deviceToken);
  const stale = await f.app.fetch(request(evidencePath)); assert.equal(stale.status, 409);
  assert.equal((await stale.json() as { error: { code: string } }).error.code, 'REPORT_REVISION_CHANGED');
});

test('D09 paginated report retains the first-page snapshot time while the clock advances without new writes', async t => {
  const f = await fixture(t);
  await f.call('/api/v2/devices/scale2', { requestId: crypto.randomUUID(), expectedVersion: 0, scaleId: 'scale2', name: '第二盘', enabled: true, positionOrder: 2, measurement, binding: { dishId: 'dish2', dishName: '第二菜', containerRef: null, tareG: 100, fullFoodG: 1000, foodOnly: true } }, managerToken, 'PUT');
  f.advance(1); await f.call('/api/v2/telemetry/samples', sampleBody([f.sample(1, 500)]), deviceToken);
  f.advance(2); await f.call('/api/v2/telemetry/samples', sampleBody([f.sample(2, 490)]), deviceToken);
  const full = await f.call<ConsumptionReport>(reportPath), first = await f.call<ConsumptionReport>(reportPath + '&limit=1');
  assert(first.nextCursor); f.advance(40);
  const next = await f.call<ConsumptionReport>(reportPath + '&limit=1&cursor=' + encodeURIComponent(first.nextCursor));
  assert.equal(next.serverAt, first.serverAt); assert.equal(next.dataRevision, first.dataRevision);
  assert.deepEqual([...first.rows, ...next.rows], full.rows); assert.deepEqual(next.totals, full.totals);
});
