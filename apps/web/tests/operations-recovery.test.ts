import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { OperationsStore } from '../lib/operations-v2/storage.ts';
import { createOperationsApplication, operationsServices } from '../lib/operations-v2/application.ts';
import { createOperationsRouter } from '../lib/operations-v2/router.ts';
import { createOperationsBackup, restoreOperationsBackup } from '../lib/operations-v2/backup.ts';
import { canonical } from '../lib/operations-v2/records.ts';
import { tokenHash } from '../lib/operations-v2/security.ts';

const token = 'recovery_' + 'r'.repeat(48), at = (second: number) => new Date(Date.parse('2026-10-12T00:00:00Z') + second * 1000).toISOString();
const instance = (directory: string) => new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("recovery test")}}', compatibilityDate: '2026-05-15', d1Databases: { DB: 'operations-recovery' }, d1Persist: directory });
test('T15: accepted inputs and expired job lease survive a real workerd restart without a browser', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'operations-recovery-')); let mf = instance(directory), now = at(0);
  try {
    const db = await mf.getD1Database('DB') as unknown as D1Database;
    let app = await createOperationsApplication(db, { environment: 'test', bootstrapToken: token, clock: () => now });
    const request = (pathname: string, body?: unknown, method = body ? 'POST' : 'GET', credential = token) => new Request('http://127.0.0.1' + pathname, { method, headers: { authorization: `Bearer ${credential}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    let response = await app.fetch(request('/api/v2/devices/recovery-scale', { requestId: crypto.randomUUID(), expectedVersion: 0, scaleId: 'recovery-scale', name: '恢复测试', enabled: true, positionOrder: 1, measurement: { boundaryWindowMs: 5000, maxSampleGapMs: 20000, freshMs: 60000, locationFreshMs: 60000, stableWindowMs: 0, stableMinSamples: 1, stableToleranceG: 0, negativeToleranceG: 0, maxStepG: null, timeZone: 'Asia/Shanghai', ruleVersion: 'recovery' }, binding: { dishId: 'dish', dishName: '测试菜', containerRef: null, tareG: 100, fullFoodG: 1000, foodOnly: true } }, 'PUT')); assert.equal(response.status, 200);
    const deviceToken = 'device_' + 's'.repeat(48);
    response = await app.fetch(request('/api/v2/access/credentials', { requestId: crypto.randomUUID(), id: 'recovery-device', token: deviceToken, role: 'device', actor: { id: 'gateway', kind: 'system', label: 'Gateway' }, scaleIds: ['recovery-scale'], expiresAt: null })); assert.equal(response.status, 200);
    now = at(2);
    // Use the same authenticated transport, but intentionally stop before the
    // application's job dispatch to simulate process loss after durable commit.
    const route = createOperationsRouter(app.store, operationsServices, () => now);
    response = await route(request('/api/v2/telemetry/samples', { version: 2, batchId: crypto.randomUUID(), samples: [{ scaleId: 'recovery-scale', bootId: 'boot', sequence: 1, sampledAt: at(1), grossG: 500, measurementStatus: 'ok' }] }, 'POST', deviceToken)); assert.equal(response.status, 200);
    const job = (await app.store.list<{ id: string; payload: string }>('jobs'))[0];
    await app.store.transact(await app.store.revision(), [{ type: 'update', table: 'jobs', id: job.id, values: { status: 'running', lease_until: at(3), attempts: 1, payload: JSON.stringify({ ...JSON.parse(job.payload), leaseId: 'dead-worker' }) } }]);
    assert.equal(await app.store.get('latest', 'recovery-scale'), null);
    await mf.dispose(); mf = instance(directory); now = at(5);
    app = await createOperationsApplication(await mf.getD1Database('DB') as unknown as D1Database, { environment: 'test', clock: () => now });
    await app.jobs();
    assert.equal((await app.store.get<{ status: string }>('jobs', job.id))!.status, 'complete');
    const latest = await app.store.get<{ payload: string }>('latest', 'recovery-scale'); assert.equal(JSON.parse(latest!.payload).observation.foodRemainingG, 400);
    response = await app.fetch(request('/api/v2/serving/state')); assert.equal(response.status, 200);
    assert.equal((await app.store.list('samples')).length, 1);
    // A second restart/run does not add raw records, cycles or ledger entries.
    await app.jobs(); assert.equal((await app.store.list('samples')).length, 1); assert.equal((await app.store.list('ledger')).length, 0);
  } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('D12: authenticated history backup restores to a new DB, checks digest/environment and refuses overwrite', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'operations-backup-')), source = instance(path.join(directory, 'source')), target = instance(path.join(directory, 'target')), broken = instance(path.join(directory, 'broken'));
  try {
    const app = await createOperationsApplication(await source.getD1Database('DB') as unknown as D1Database, { environment: 'test', bootstrapToken: token });
    await app.store.transact(await app.store.revision(), [{ type: 'insert', table: 'devices', values: { id: 'preserved', enabled: 0, updated_at: at(0), payload: '{"original":"kept"}' } }]);
    const backup = await createOperationsBackup(app.store), restored = new OperationsStore(await target.getD1Database('DB') as unknown as D1Database, 'test'); await restored.initialize();
    assert(!JSON.stringify(backup).includes(token));
    await assert.rejects(() => restoreOperationsBackup(restored, { ...backup, sha256: '0'.repeat(64) }), /digest mismatch/);
    const other = new OperationsStore(restored.db, 'live'); await other.initialize(); await assert.rejects(() => restoreOperationsBackup(other, backup), /environment or digest/);
    await restoreOperationsBackup(restored, backup);
    assert.deepEqual(await restored.get('devices', 'preserved'), await app.store.get('devices', 'preserved'));
    const resumed = await createOperationsApplication(restored.db, { environment: 'test' });
    const auth = await resumed.fetch(new Request('http://127.0.0.1/api/v2/access/credentials', { headers: { authorization: `Bearer ${token}` } })); assert.equal(auth.status, 200);
    await assert.rejects(() => restoreOperationsBackup(restored, backup), /empty database/);
    const damaged = structuredClone(backup); damaged.data.tables.find(t => t.table === 'devices')!.rows[0].unexpected_column = 'invalid'; damaged.sha256 = await tokenHash(canonical(damaged.data));
    const badStore = new OperationsStore(await broken.getD1Database('DB') as unknown as D1Database, 'test'); await badStore.initialize();
    await assert.rejects(() => restoreOperationsBackup(badStore, damaged), /Invalid operations columns/);
    const failed = await createOperationsApplication(badStore.db, { environment: 'test' }); assert.equal((await failed.fetch(new Request('http://127.0.0.1/api/v2/session'))).status, 503);
  } finally { await Promise.all([source.dispose(), target.dispose(), broken.dispose()]); await rm(directory, { recursive: true, force: true }); }
});
