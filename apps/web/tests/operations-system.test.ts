import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { createOperationsApplication } from '../lib/operations-v2/application.ts';
import { runtimeResponseSchema } from '@zhishan/contracts/v2/system';
import { schedulerHeartbeat } from '../lib/operations-v2/system.ts';
import { credentialRecord } from '../lib/operations-v2/security.ts';

const now = '2026-10-12T04:00:00.000Z', token = 'system-test-manager-token-1234567890123456';
async function fixture(t: TestContext) {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}', compatibilityDate: '2026-05-15', d1Databases: { OPS_DB: crypto.randomUUID() } });
  t.after(() => mf.dispose());
  const app = await createOperationsApplication(await mf.getD1Database('OPS_DB') as unknown as D1Database, { environment: 'test', bootstrapToken: token, clock: () => now });
  const read = (credential = token) => app.fetch(new Request('http://localhost/api/v2/system/diagnostics', { headers: { Authorization: `Bearer ${credential}` } }));
  return { ...app, read };
}
test('runtime diagnostics persist no-browser scheduler execution and show failed work without leaking internal errors', async t => {
  const f = await fixture(t);
  assert.equal(runtimeResponseSchema.parse(await (await f.read()).json()).scheduler, null);
  const initialRevision = await f.store.revision();
  await f.jobs();
  assert.equal(await f.store.revision(), initialRevision, 'idle scheduler heartbeats do not invalidate report versions');
  await f.store.transact(await f.store.revision(), [{ type: 'insert', table: 'jobs', values: { id: 'project:missing-binding', scope: 'measurement', status: 'pending', desired_revision: 1, lease_until: null, attempts: 0, payload: JSON.stringify({ bindingId: 'missing-binding', requestedAt: now }) } }]);
  await f.jobs();
  const result = runtimeResponseSchema.parse(await (await f.read()).json());
  assert.equal(result.scheduler?.status, 'complete'); assert.equal(result.scheduler?.completedAt, now);
  assert.equal(result.jobs.failed, 1); assert.equal(result.jobs.oldestPendingAt, now);
  assert.deepEqual(result.failedJobs.map(job => [job.id, job.attempts, job.code]), [['project:missing-binding', 1, 'PROJECTION_FAILED']]);
  assert.equal(result.failedJobsTruncated, false);
  const staffToken = 'system-test-staff-token-1234567890123456789';
  const staff = await credentialRecord({ id: 'staff', token: staffToken, role: 'staff', actor: { id: 'staff', label: 'test staff', kind: 'workstation' }, scaleIds: null });
  await f.store.transact(await f.store.revision(), [{ type: 'insert', table: 'credentials', values: staff }]);
  assert.equal((await f.read(staffToken)).status, 403);
});
test('scheduler failure remains observable, and completion of an older concurrent run cannot replace the latest heartbeat', async t => {
  const f = await fixture(t), original = f.store.query.bind(f.store);
  f.store.query = async (table, query) => { if (table === 'jobs') throw new Error('private database failure'); return original(table, query); };
  await assert.rejects(() => f.jobs(), /private database failure/);
  f.store.query = original;
  const failed = runtimeResponseSchema.parse(await (await f.read()).json());
  assert.equal(failed.scheduler?.status, 'failed'); assert.equal(failed.scheduler?.errorCode, 'SCHEDULER_FAILED');
  assert.equal(JSON.stringify(failed).includes('private database failure'), false);
  const earlier = { runId: crypto.randomUUID(), startedAt: now, completedAt: null, status: 'running' as const, errorCode: null };
  const latest = { ...earlier, runId: crypto.randomUUID() };
  await schedulerHeartbeat(f.store, earlier); await schedulerHeartbeat(f.store, latest);
  await schedulerHeartbeat(f.store, { ...earlier, completedAt: now, status: 'complete' });
  const running = runtimeResponseSchema.parse(await (await f.read()).json());
  assert.equal(running.scheduler?.runId, latest.runId); assert.equal(running.scheduler?.status, 'running');
});
test('post-commit scheduler outage returns a structured retryable response and exact retry keeps one business write', async t => {
  const f = await fixture(t), original = f.store.query.bind(f.store);
  const body = { requestId: crypto.randomUUID(), expectedVersion: 0, scaleId: 'outage-scale', name: 'Outage test', enabled: true, positionOrder: null, measurement: null, binding: null };
  const send = () => f.fetch(new Request('http://localhost/api/v2/devices/outage-scale', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  f.store.query = async (table, query) => { if (table === 'jobs') throw new Error('temporary outage'); return original(table, query); };
  const unavailable = await send(); assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json() as { error: { code: string } }).error.code, 'UNAVAILABLE');
  assert.equal((await f.store.list('devices')).length, 1);
  f.store.query = original;
  const replay = await send(); assert.equal(replay.status, 200);
  assert.equal((await f.store.list('devices')).length, 1); assert.equal((await f.store.list('receipts')).length, 1);
});
