import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { OperationsStore, type Write } from '../lib/operations-v2/storage.ts';
import { runRetention, retentionServices } from '../lib/operations-v2/retention.ts';
import { createOperationsRouter } from '../lib/operations-v2/router.ts';
import { telemetryServices, sampleId } from '../lib/operations-v2/telemetry.ts';
import { credentialRecord, tokenHash } from '../lib/operations-v2/security.ts';
import { canonical } from '../lib/operations-v2/records.ts';
import type { BindingPayload } from '../lib/operations-v2/records.ts';

const now = '2026-10-12T00:00:00.000Z';
const time = (hours: number) => new Date(Date.parse(now) + hours * 3600000).toISOString();
const measurement = { boundaryWindowMs: 1000, maxSampleGapMs: 10000, freshMs: 10000, locationFreshMs: 10000,
  stableWindowMs: 0, stableMinSamples: 1, stableToleranceG: 0, negativeToleranceG: 0, maxStepG: null, timeZone: 'Asia/Shanghai', ruleVersion: 'retention-test' };

async function setup(t: TestContext) {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("isolated retention test")}}', compatibilityDate: '2026-05-15', d1Databases: { DB: crypto.randomUUID() } });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB') as unknown as D1Database;
  const store = new OperationsStore(db, 'test'); await store.initialize();
  const put = async (writes: Write[]) => { assert.equal(await store.transact(await store.revision(), writes), true); };
  const enable = async (hours = 24) => put([{ type: 'upsert', table: 'system', values: { id: 'retention', updated_at: now,
    payload: JSON.stringify({ policy: { version: 1, updatedAt: now, config: { enabled: true, rawRetentionHours: hours } }, lastRun: null }) } }]);
  const raw = async (sequence: number, options: { scale?: string; sampledAt?: string; receivedAt?: string } = {}) => {
    const sample = { scaleId: options.scale ?? 'scale-1', bootId: 'boot-1', sequence, sampledAt: options.sampledAt ?? time(-48), grossG: 900, measurementStatus: 'ok' as const };
    const id = await sampleId(sample), receivedAt = options.receivedAt ?? time(-47);
    return { id, sample, write: { type: 'insert', table: 'samples', values: { id, scale_id: sample.scaleId, boot_id: sample.bootId, sequence,
      sampled_at: sample.sampledAt, received_at: receivedAt, payload_hash: await tokenHash(canonical(sample)), payload: JSON.stringify({ id, sample, receivedAt }) } } as Write };
  };
  const binding = (id: string, scaleId: string, open = false): Write => {
    const b: BindingPayload = { id, scaleId, dishId: 'dish-1', dishName: 'Test dish', containerRef: null, tareG: 100, fullFoodG: 1000, foodOnly: true,
      validFrom: time(-60), validTo: open ? null : time(-30), version: 0, freshnessBatchId: null, measurement };
    return { type: 'insert', table: 'bindings', values: { id, scale_id: scaleId, dish_id: b.dishId, valid_from: b.validFrom, valid_to: b.validTo, version: 0, payload: JSON.stringify(b) } };
  };
  return { mf, db, store, put, enable, raw, binding };
}

test('retention is disabled by default; configured cutoff expires both observation and receipt time and stays environment-scoped', async t => {
  const f = await setup(t);
  const expired = await f.raw(1), recentReceipt = await f.raw(2, { receivedAt: time(-1) }), boundary = await f.raw(3, { sampledAt: time(-24), receivedAt: time(-25) });
  await f.put([expired.write, recentReceipt.write, boundary.write]);
  const revision = await f.store.revision(); assert.equal(await runRetention(f.store, now), null); assert.equal(await f.store.revision(), revision);
  const live = new OperationsStore(f.db, 'live'); await live.initialize(); await live.transact(0, [expired.write]);
  await f.enable(); const run = await runRetention(f.store, now);
  assert.equal(run!.deletedSamples, 1); assert.equal(run!.status, 'complete'); assert.equal(run!.cutoffAt, time(-24));
  assert.equal(await f.store.get('samples', expired.id), null); assert.ok(await f.store.get('samples', recentReceipt.id)); assert.ok(await f.store.get('samples', boundary.id));
  assert.ok(await live.get('samples', expired.id), 'another environment is never cleaned');
  const tombstone = await f.store.get<{ payload: string }>('sample_tombstones', expired.id); assert.ok(tombstone); assert.equal(tombstone.payload.includes('grossG'), false);
  assert.deepEqual(await runRetention(f.store, now), run, 'same scheduler instant preserves useful last-run counts');
});

test('permanent nested ledger/calculation evidence, explicit boundary sampleRef, operations, latest and interval references survive', async t => {
  const f = await setup(t), samples = await Promise.all(Array.from({ length: 8 }, (_, i) => f.raw(i + 1)));
  await f.put(samples.map(s => s.write));
  const audit: Write[] = [
    { type: 'insert', table: 'ledger', values: { id: 'ledger-v1', cycle_id: 'cycle', version: 1, current: 0, effective_at: time(-40), weight_mg: 200000, payload: JSON.stringify({ cycle: { evidenceIds: ['evidence:bundle'] }, calculation: { evidenceIds: [...Array.from({ length: 200 }, (_, i) => `older-evidence-${i}`), samples[0].id], algorithmVersion: 'permanent-algorithm', rawBalanceMg: 200000 } }) } },
    { type: 'insert', table: 'device_events', values: { id: 'event', scale_id: 'scale-1', boot_id: 'boot-1', event_sequence: 1, occurred_at: time(-48), received_at: time(-47), type: 'exit_kitchen', payload_hash: 'test-hash', payload: JSON.stringify({ event: { type: 'exit_kitchen', scaleId: 'scale-1', sampleRef: { bootId: 'boot-1', sequence: 2 } } }) } },
    { type: 'insert', table: 'operations', values: { id: 'operation', binding_id: 'closed', occurred_at: time(-48), version: 0, corrects_id: null, payload: JSON.stringify({ status: 'matched', input: { bindingId: 'closed', evidenceIds: [samples[2].id] } }) } },
    { type: 'insert', table: 'latest', values: { id: 'scale-1', sampled_at: time(-48), received_at: time(-47), payload: JSON.stringify({ observation: { evidenceIds: [samples[3].id] } }) } },
    { type: 'insert', table: 'serving_intervals', values: { id: 'interval', binding_id: 'closed', dish_id: 'dish', started_at: time(-49), ended_at: time(-48), quality: 'good', empty: 0, rule_version: '1', payload: JSON.stringify({ evidenceIds: [samples[4].id] }) } },
    { type: 'insert', table: 'cycles', values: { id: 'cycle', binding_id: 'closed', exit_event_id: null, return_event_id: null, status: 'confirmed', version: 1, effective_at: time(-40), payload: JSON.stringify({ cycle: { evidenceIds: [] }, calculation: { evidenceIds: [] }, revisions: [{ evidenceIds: [samples[5].id] }] }) } },
    { type: 'insert', table: 'task_actions', values: { id: 'action', task_id: 'task', occurred_at: time(-48), payload: JSON.stringify({ evidenceIds: [samples[6].id] }) } },
  ];
  await f.put(audit); await f.enable();
  const run = await runRetention(f.store, now); assert.equal(run!.protectedSamples, 7); assert.equal(run!.deletedSamples, 1);
  for (const sample of samples.slice(0, 7)) assert.ok(await f.store.get('samples', sample.id));
  for (const write of audit) if (write.type === 'insert') assert.equal((await f.store.get<{ payload: string }>(write.table, write.values.id))!.payload, write.values.payload, 'immutable audit is unchanged');
});

test('active bindings and pending cycles, operations, jobs and tasks protect their complete sample history before references exist', async t => {
  const f = await setup(t), names = ['active', 'pending-cycle', 'pending-operation', 'pending-job', 'pending-task', 'finished'];
  const samples = await Promise.all(names.map((scale, i) => f.raw(i + 1, { scale })));
  await f.put([...samples.map(s => s.write), ...names.map(name => f.binding(name, name, name === 'active')),
    { type: 'insert', table: 'cycles', values: { id: 'pending-cycle', binding_id: 'pending-cycle', exit_event_id: null, return_event_id: null, status: 'pending', version: 0, effective_at: null, payload: '{}' } },
    { type: 'insert', table: 'operations', values: { id: 'pending-operation', binding_id: 'pending-operation', occurred_at: time(-48), version: 0, corrects_id: null, payload: JSON.stringify({ status: 'pending_review', input: { bindingId: 'pending-operation', evidenceIds: [] } }) } },
    { type: 'insert', table: 'jobs', values: { id: 'pending-job', scope: 'measurement', status: 'failed', desired_revision: 0, lease_until: null, attempts: 1, payload: JSON.stringify({ bindingId: 'pending-job' }) } },
    { type: 'insert', table: 'tasks', values: { id: 'pending-task', binding_id: 'pending-task', status: 'verifying', version: 0, defer_until: null, updated_at: now, payload: '{}' } },
  ]); await f.enable();
  const run = await runRetention(f.store, now); assert.equal(run!.protectedSamples, 5); assert.equal(run!.deletedSamples, 1);
  assert.equal(await f.store.get('samples', samples.at(-1)!.id), null);
});

test('reference added after planning invalidates CAS; retry protects it and bounded pages retain accurate counts', async t => {
  const f = await setup(t), samples = await Promise.all(Array.from({ length: 113 }, (_, i) => f.raw(i + 1)));
  await f.put(samples.map(s => s.write)); await f.enable();
  const original = f.store.transact.bind(f.store); let injected = false;
  f.store.transact = async (revision, writes, options) => {
    if (!injected && writes.some(w => w.type === 'delete')) {
      injected = true;
      await original(await f.store.revision(), [{ type: 'insert', table: 'operations', values: { id: 'concurrent-reference', binding_id: 'old', occurred_at: time(-48), version: 0, corrects_id: null,
        payload: JSON.stringify({ status: 'matched', input: { bindingId: 'old', evidenceIds: [samples[0].id] } }) } }]);
    }
    return original(revision, writes, options);
  };
  const run = await runRetention(f.store, now); assert.equal(run!.deletedSamples, 112); assert.equal(run!.protectedSamples, 1);
  assert.ok(await f.store.get('samples', samples[0].id)); assert.equal((await f.store.list('sample_tombstones')).length, 112);
});

test('restore maintenance lock blocks cleaning; invalid audit fails closed and records a safe failure', async t => {
  const f = await setup(t), sample = await f.raw(1); await f.put([sample.write]); await f.enable();
  await f.put([{ type: 'insert', table: 'maintenance', values: { id: 'restore', payload: JSON.stringify({ status: 'pending' }) } }]);
  await assert.rejects(runRetention(f.store, now)); assert.ok(await f.store.get('samples', sample.id)); assert.equal((await f.store.list('sample_tombstones')).length, 0);
  await f.store.transact(await f.store.revision(), [{ type: 'update', table: 'maintenance', id: 'restore', values: { payload: JSON.stringify({ status: 'complete' }) } }], { maintenance: true });
  await f.put([{ type: 'insert', table: 'ledger', values: { id: 'corrupt-audit', cycle_id: 'cycle', version: 0, current: 1, effective_at: time(-48), weight_mg: null, payload: '{invalid' } }]);
  await assert.rejects(runRetention(f.store, now)); assert.ok(await f.store.get('samples', sample.id));
  const state = JSON.parse((await f.store.get<{ payload: string }>('system', 'retention'))!.payload);
  assert.equal(state.lastRun.status, 'failed'); assert.equal(state.lastRun.errorCode, 'CLEANUP_FAILED'); assert.equal(state.running, undefined);
});

test('manager policy API validates version and permissions; purged sample identity still rejects conflicting retransmission', async t => {
  const f = await setup(t), sample = await f.raw(1), manager = 'm'.repeat(48), device = 'd'.repeat(48), staff = 's'.repeat(48);
  await f.put([sample.write, ...await Promise.all([['manager', manager], ['device', device], ['staff', staff]].map(async ([role, token]) => ({ type: 'insert' as const, table: 'credentials' as const, values: await credentialRecord({ id: role, token, role: role as 'manager' | 'staff' | 'device', actor: { id: role, kind: 'system', label: role }, scaleIds: role === 'device' ? ['scale-1'] : null }) }))),
    { type: 'insert', table: 'devices', values: { id: 'scale-1', enabled: 1, updated_at: now, payload: JSON.stringify({ id: 'scale-1', enabled: true, bindingId: null, diagnostics: { accepted: 0, duplicate: 0, rejected: 0, lastCode: null, fault: null } }) } },
  ]);
  const route = createOperationsRouter(f.store, { ...retentionServices, ...telemetryServices }, () => now);
  const request = async (method: string, path: string, body?: unknown, token = manager) => {
    const response = await route(new Request('https://isolated.invalid' + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: response.status, body: await response.json() as { policy: { config: { enabled: boolean } }; results: { code: string }[]; lastRun: { deletedSamples: number }; running?: unknown } };
  };
  assert.equal((await request('GET', '/api/v2/system/retention')).body.policy.config.enabled, false);
  const input = { requestId: crypto.randomUUID(), expectedVersion: 0, config: { enabled: true, rawRetentionHours: 24 } };
  assert.equal((await request('PUT', '/api/v2/system/retention', input, staff)).status, 403);
  assert.equal((await request('PUT', '/api/v2/system/retention', { ...input, config: { enabled: true, rawRetentionHours: 23 } })).status, 400);
  const first = await request('PUT', '/api/v2/system/retention', input); assert.equal(first.status, 200);
  assert.deepEqual(await request('PUT', '/api/v2/system/retention', input), first, 'exact policy retry preserves its response');
  assert.equal((await request('PUT', '/api/v2/system/retention', { ...input, requestId: crypto.randomUUID() })).status, 409);
  await runRetention(f.store, now);
  for (const [grossG, expected] of [[900, 'DUPLICATE'], [901, 'ID_CONFLICT']] as const) {
    const reply = await request('POST', '/api/v2/telemetry/samples', { version: 2, batchId: crypto.randomUUID(), samples: [{ ...sample.sample, grossG }] }, device);
    assert.equal(reply.status, 200); assert.equal(reply.body.results[0].code, expected);
    assert.equal(await f.store.get('samples', sample.id), null, 'retry never resurrects purged raw sample');
  }
  const get = await request('GET', '/api/v2/system/retention'); assert.equal(get.body.lastRun.deletedSamples, 1); assert.equal(get.body.running, undefined);
});

test('policy disable between chunks cancels the old cleaner before any further deletion', async t => {
  const f = await setup(t), samples = await Promise.all(Array.from({ length: 60 }, (_, i) => f.raw(i + 1)));
  await f.put(samples.map(s => s.write)); await f.enable();
  const original = f.store.transact.bind(f.store); let disabled = false;
  f.store.transact = async (revision, writes, options) => {
    if (!disabled && writes.some(w => w.type === 'delete')) {
      disabled = true;
      await original(await f.store.revision(), [{ type: 'upsert', table: 'system', values: { id: 'retention', updated_at: now,
        payload: JSON.stringify({ policy: { version: 2, updatedAt: now, config: { enabled: false, rawRetentionHours: 24 } }, lastRun: null }) } }]);
    }
    return original(revision, writes, options);
  };
  assert.equal(await runRetention(f.store, now), null); assert.equal((await f.store.list('samples')).length, 60); assert.equal((await f.store.list('sample_tombstones')).length, 0);
});

test('large sweep yields after 500 samples, survives process restart and throttles completed work for an hour', async t => {
  const f = await setup(t), samples = await Promise.all(Array.from({ length: 553 }, (_, i) => f.raw(i + 1)));
  await f.put(samples.map(s => s.write)); await f.enable();
  assert.equal(await runRetention(f.store, now), null, 'unfinished run does not claim completion');
  assert.equal((await f.store.list('samples')).length, 53);
  const state = JSON.parse((await f.store.get<{ payload: string }>('system', 'retention'))!.payload);
  assert.equal(state.running.deletedSamples, 500); assert.ok(state.running.afterId); assert.equal(state.running.leaseUntil, now);
  // Reconstruct the store as a fresh worker would, keeping only durable storage.
  const restarted = new OperationsStore(f.db, 'test'); await restarted.initialize();
  const result = await runRetention(restarted, time(1 / 60));
  assert.equal(result!.deletedSamples, 553); assert.equal(result!.startedAt, now); assert.equal(result!.status, 'complete');
  const newExpired = await f.raw(9999); await f.put([newExpired.write]);
  assert.deepEqual(await runRetention(restarted, time(0.5)), result);
  assert.ok(await restarted.get('samples', newExpired.id), 'completed same-policy sweeps are throttled');
  const next = await runRetention(restarted, time(2)); assert.equal(next!.deletedSamples, 1); assert.equal(await restarted.get('samples', newExpired.id), null);
});

test('expired cleanup lease resumes its durable progress rather than resetting the cutoff and counts', async t => {
  const f = await setup(t), sample = await f.raw(1); await f.put([sample.write]);
  await f.put([{ type: 'upsert', table: 'system', values: { id: 'retention', updated_at: time(-2), payload: JSON.stringify({
    policy: { version: 1, updatedAt: time(-2), config: { enabled: true, rawRetentionHours: 24 } }, lastRun: null,
    running: { id: 'crashed-worker', policyVersion: 1, startedAt: time(-2), cutoffAt: time(-26), leaseUntil: time(-1), deletedSamples: 37, protectedSamples: 4 },
  }) } }]);
  const run = await runRetention(f.store, now); assert.equal(run!.deletedSamples, 38); assert.equal(run!.protectedSamples, 4);
  assert.equal(run!.startedAt, time(-2)); assert.equal(run!.cutoffAt, time(-26));
});

test('manager disable records an unfinished sweep as cancelled and preserves prior deleted counts', async t => {
  const f = await setup(t), manager = 'm'.repeat(48);
  await f.put([{ type: 'insert', table: 'credentials', values: await credentialRecord({ id: 'manager', token: manager, role: 'manager', actor: { id: 'manager', kind: 'system', label: 'Manager' }, scaleIds: null }) },
    { type: 'upsert', table: 'system', values: { id: 'retention', updated_at: now, payload: JSON.stringify({ policy: { version: 1, updatedAt: time(-1), config: { enabled: true, rawRetentionHours: 24 } }, lastRun: null,
      running: { id: 'worker', policyVersion: 1, startedAt: time(-1), cutoffAt: time(-25), leaseUntil: time(1), deletedSamples: 50, protectedSamples: 2, afterId: 'processed' } }) } },
  ]);
  const route = createOperationsRouter(f.store, retentionServices, () => now);
  const response = await route(new Request('https://isolated.invalid/api/v2/system/retention', { method: 'PUT', headers: { Authorization: `Bearer ${manager}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), expectedVersion: 1, config: { enabled: false, rawRetentionHours: 24 } }) }));
  assert.equal(response.status, 200); const payload = await response.json() as { lastRun: { status: string; deletedSamples: number; errorCode: string | null } };
  assert.equal(payload.lastRun.status, 'cancelled'); assert.equal(payload.lastRun.deletedSamples, 50); assert.equal(payload.lastRun.errorCode, null);
  assert.equal(JSON.parse((await f.store.get<{ payload: string }>('system', 'retention'))!.payload).running, undefined);
});
