import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Miniflare } from 'miniflare';
import { createOperationsApplication } from '../lib/operations-v2/application.ts';
import { sampleId } from '../lib/operations-v2/telemetry.ts';
import { endpoints, type Bowl, type Cycle } from '@zhishan/contracts/operations-v2';
import type { OperationRecord } from '../lib/operations-v2/records.ts';

const managerToken = 'm'.repeat(48), deviceToken = 'd'.repeat(48);
const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}', compatibilityDate: '2026-05-15', d1Databases: { DB: 'operations-http-test' } });
let app: Awaited<ReturnType<typeof createOperationsApplication>>, server: http.Server, base: string;
let now = '2026-10-12T00:00:00.000Z', bindingId: string;
const at = (second: number) => new Date(Date.parse('2026-10-12T00:00:00Z') + second * 1000).toISOString();
const sample = (sequence: number, second: number, grossG: number) => ({ scaleId: 'scale-1', bootId: 'boot-1', sequence, sampledAt: at(second), grossG, measurementStatus: 'ok' as const });
type TestBody = { device: { binding: { id: string } }; results: { code: string }[]; rows: Cycle[]; bowls: Bowl[]; environment: string; operation: OperationRecord };
async function request(path: string, body?: unknown, token = managerToken, method = body ? 'POST' : 'GET') {
  const response = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() as TestBody };
}
const postSamples = (samples: ReturnType<typeof sample>[], batchId = crypto.randomUUID()) => request('/api/v2/telemetry/samples', { version: 2, batchId, samples }, deviceToken);
before(async () => {
  app = await createOperationsApplication(await mf.getD1Database('DB') as unknown as D1Database, { environment: 'test', bootstrapToken: managerToken, clock: () => now });
  server = http.createServer(async (req, res) => { try { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk); const result = await app.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers as HeadersInit, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) })); res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(Buffer.from(await result.arrayBuffer())); } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: String(error) })); } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await mf.dispose(); });

test('HTTP runtime exposes every registered service and initializes isolated configuration', async () => {
  const denied = await request('/api/v2/devices', undefined, 'x'.repeat(48)); assert.equal(denied.status, 401);
  const result = await request('/api/v2/devices/scale-1', { requestId: crypto.randomUUID(), expectedVersion: 0, scaleId: 'scale-1', name: '独立测试秤', enabled: true, positionOrder: 1,
    measurement: { boundaryWindowMs: 5000, maxSampleGapMs: 30000, freshMs: 60000, locationFreshMs: 60000, stableWindowMs: 0, stableMinSamples: 1, stableToleranceG: 0, negativeToleranceG: 0, maxStepG: null, timeZone: 'Asia/Shanghai', ruleVersion: 'test-rule' },
    binding: { dishId: 'dish-1', dishName: '测试菜品', containerRef: 'bowl-1', tareG: 100, fullFoodG: 1000, foodOnly: true } }, managerToken, 'PUT');
  assert.equal(result.status, 200, JSON.stringify(result.body)); bindingId = result.body.device.binding.id;
  const credential = await request('/api/v2/access/credentials', { requestId: crypto.randomUUID(), id: 'gateway-1', token: deviceToken, role: 'device', actor: { id: 'gateway-1', kind: 'system', label: 'Test gateway' }, scaleIds: ['scale-1'], expiresAt: null });
  assert.equal(credential.status, 200, JSON.stringify(credential.body));
  assert(!JSON.stringify(credential.body).includes(deviceToken));
  for (const name of Object.keys(endpoints)) assert(name in (await import('../lib/operations-v2/application.ts')).operationsServices, name);
  const untouched = new (await import('../lib/operations-v2/storage.ts')).OperationsStore(app.store.db, 'live'); await untouched.initialize(); assert.equal((await untouched.list('devices')).length, 0);
});

test('T01 raw HTTP samples + boundaries persist a 200g cycle, retries do not duplicate ledger', async () => {
  now = at(20);
  const batchId = crypto.randomUUID(), packet = [sample(1, 1, 900), sample(2, 10, 700)];
  const accepted = await postSamples(packet, batchId); assert.equal(accepted.status, 200, JSON.stringify(accepted.body)); assert(accepted.body.results.every((r: { code: string }) => r.code === 'STORED'));
  const replay = await postSamples(packet, batchId); assert.deepEqual(replay, accepted);
  const conflict = await postSamples([sample(1, 1, 901)], batchId); assert.equal(conflict.status, 409);
  const duplicate = await postSamples(packet); assert(duplicate.body.results.every((r: { code: string }) => r.code === 'DUPLICATE'));
  const events = [{ eventId: crypto.randomUUID(), scaleId: 'scale-1', bootId: 'boot-1', eventSequence: 1, occurredAt: at(1), type: 'exit_kitchen', sampleRef: { bootId: 'boot-1', sequence: 1 } }, { eventId: crypto.randomUUID(), scaleId: 'scale-1', bootId: 'boot-1', eventSequence: 2, occurredAt: at(10), type: 'enter_kitchen', sampleRef: { bootId: 'boot-1', sequence: 2 } }];
  const boundaries = await request('/api/v2/telemetry/events', { version: 2, batchId: crypto.randomUUID(), events }, deviceToken); assert.equal(boundaries.status, 200, JSON.stringify(boundaries.body));
  const jobs = await app.store.list<{ status: string; payload: string }>('jobs'); assert(jobs.every(j => j.status === 'complete'), JSON.stringify(jobs));
  const cycles = await request('/api/v2/cycles?startDate=2026-10-12&endDate=2026-10-12'); assert.equal(cycles.status, 200, JSON.stringify(cycles.body)); assert.equal(cycles.body.rows.length, 1); assert.equal(cycles.body.rows[0].status, 'confirmed'); assert.equal(cycles.body.rows[0].confirmedTakeG, 200);
  const ledger = await app.store.list<{ weight_mg: number }>('ledger', { current: 1 }); assert.equal(ledger.length, 1); assert.equal(ledger[0].weight_mg, 200000);
  const serving = await request('/api/v2/serving/state'); assert.equal(serving.status, 200, JSON.stringify(serving.body)); assert.equal(serving.body.bowls[0].foodRemainingG, 600); assert.equal(serving.body.environment, 'test');
});

test('HTTP malformed/auth/scope/clock failures remain failures with no raw-data mutation', async () => {
  const count = (await app.store.list('samples')).length;
  const wrongRole = await request('/api/v2/telemetry/samples', { version: 2, batchId: crypto.randomUUID(), samples: [sample(3, 11, 600)] }); assert.equal(wrongRole.status, 403);
  const wrongScale = await request('/api/v2/telemetry/samples', { version: 2, batchId: crypto.randomUUID(), samples: [{ ...sample(3, 11, 600), scaleId: 'other-scale' }] }, deviceToken); assert.equal(wrongScale.status, 403);
  const future = await postSamples([sample(3, 30, 600)]); assert.equal(future.body.results[0].code, 'CLOCK_AHEAD');
  const corrupt = await request('/api/v2/telemetry/samples', { version: 2, batchId: crypto.randomUUID(), samples: [{ ...sample(3, 11, 600), extra: 'bad' }] }, deviceToken); assert.equal(corrupt.status, 400);
  assert.equal((await app.store.list('samples')).length, count);
});

test('T02/T13 HTTP operation evidence is checked, correcting a fabricated quantity preserves original', async () => {
  now = at(50);
  await postSamples([sample(3, 30, 700), sample(4, 32, 800)]);
  const ids = await Promise.all([sample(3, 30, 700), sample(4, 32, 800)].map(sampleId));
  const body = { requestId: crypto.randomUUID(), bindingId, occurredAt: at(31), type: 'ice_add', quantityStatus: 'measured', weightG: 150, evidenceIds: ids, note: '测试读数核对' };
  const operation = await request('/api/v2/operations', body); assert.equal(operation.status, 200, JSON.stringify(operation.body));
  let original = await app.store.get<{ payload: string }>('operations', operation.body.operation.id); assert.equal(JSON.parse(original!.payload).status, 'pending_review');
  const correction = await request('/api/v2/operations', { ...body, requestId: crypto.randomUUID(), weightG: 100, correctsOperationId: operation.body.operation.id, expectedVersion: 0 }); assert.equal(correction.status, 200, JSON.stringify(correction.body));
  const corrected = await app.store.get<{ payload: string }>('operations', correction.body.operation.id); assert.equal(JSON.parse(corrected!.payload).status, 'matched');
  original = await app.store.get<{ payload: string }>('operations', operation.body.operation.id); assert.equal(JSON.parse(original!.payload).input.weightG, 150);
  const serving = await request('/api/v2/serving/state'); assert.equal(serving.body.bowls[0].foodRemainingG, null, 'ice means food composition is no longer known');
});

test('HTTP sessions use environment-scoped HttpOnly cookies and reject cross-origin writes', async () => {
  const login = await fetch(base + '/api/v2/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ token: managerToken }) }); assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!; assert(cookie.includes('HttpOnly')); assert(cookie.includes('ops_v2_session_test=')); assert(!JSON.stringify(await login.json()).includes(managerToken));
  const session = await fetch(base + '/api/v2/session', { headers: { cookie: cookie.split(';')[0] } }); assert.equal((await session.json() as { authenticated: boolean }).authenticated, true);
  const cross = await fetch(base + '/api/v2/access/credentials', { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie.split(';')[0], origin: 'https://other.invalid' }, body: '{}' }); assert.equal(cross.status, 403);
});

test('T10: return-first delivery is rebuilt after a late exit without double-counting an orphan', async () => {
  now = at(70);
  await postSamples([sample(5, 60, 600), sample(6, 65, 500)]);
  const enter = { eventId: crypto.randomUUID(), scaleId: 'scale-1', bootId: 'boot-1', eventSequence: 4, occurredAt: at(65), type: 'enter_kitchen', sampleRef: { bootId: 'boot-1', sequence: 6 } };
  const post = (events: unknown[]) => request('/api/v2/telemetry/events', { version: 2, batchId: crypto.randomUUID(), events }, deviceToken);
  assert.equal((await post([enter])).status, 200);
  const exit = { ...enter, eventId: crypto.randomUUID(), eventSequence: 3, occurredAt: at(60), type: 'exit_kitchen', sampleRef: { bootId: 'boot-1', sequence: 5 } };
  assert.equal((await post([exit])).status, 200);
  const jobs = await app.store.list<{ status: string }>('jobs'); assert(jobs.every(j => j.status === 'complete'));
  const ledger = await app.store.list<{ current: number; cycle_id: string; weight_mg: number | null }>('ledger', { current: 1 });
  assert(!ledger.some(row => row.cycle_id === 'cycle:' + enter.eventId));
  assert.equal(ledger.find(row => row.cycle_id === 'cycle:' + exit.eventId)!.weight_mg, 100000);
  const old = await app.store.get<{ payload: string }>('cycles', 'cycle:' + enter.eventId); assert.equal(JSON.parse(old!.payload).cycle.status, 'invalidated');
});

test('T13: manager pending review survives projection refresh and cannot invent missing measurements', async () => {
  now = at(80);
  const cycles = await request('/api/v2/cycles?startDate=2026-10-12&endDate=2026-10-12');
  const first = cycles.body.rows.find(c => c.status === 'confirmed')!;
  const pending = await request(`/api/v2/cycles/${encodeURIComponent(first.id)}/review`, { requestId: crypto.randomUUID(), expectedVersion: first.version, decision: 'keep_pending', evidenceIds: [], note: '管理复核' }); assert.equal(pending.status, 200);
  await postSamples([sample(7, 75, 500)]);
  const detail = await request('/api/v2/cycles/' + encodeURIComponent(first.id));
  const actual = (detail.body as unknown as { cycle: Cycle }).cycle;
  assert.equal(actual.status, 'pending'); assert.equal(actual.confirmedTakeG, null);
  const review = await request(`/api/v2/cycles/${encodeURIComponent(first.id)}/review`, { requestId: crypto.randomUUID(), expectedVersion: actual.version, decision: 'confirm', evidenceIds: [first.evidenceIds[0]], note: '完整依据核对' }); assert.equal(review.status, 200);
  const saved = await app.store.get<{ payload: string }>('cycles', first.id); assert.equal(JSON.parse(saved!.payload).cycle.confirmedTakeG, first.confirmedTakeG);
});

test('H09: 42 independently configured scales accept a 1000-sample raw batch and preserve all identities', async t => {
  now = at(90);
  const ids = Array.from({ length: 42 }, (_, i) => `load-${String(i).padStart(2, '0')}`);
  for (const [i, scaleId] of ids.entries()) {
    const created = await request(`/api/v2/devices/${scaleId}`, { requestId: crypto.randomUUID(), expectedVersion: 0, scaleId, name: `负载测试${i}`, enabled: true, positionOrder: i + 2,
      measurement: { boundaryWindowMs: 3000, maxSampleGapMs: 30000, freshMs: 60000, locationFreshMs: 60000, stableWindowMs: 0, stableMinSamples: 1, stableToleranceG: 0, negativeToleranceG: 0, maxStepG: null, timeZone: 'Asia/Shanghai', ruleVersion: 'load-test' },
      binding: { dishId: 'load-dish-' + i, dishName: '独立负载测试菜', containerRef: null, tareG: 100, fullFoodG: 1000, foodOnly: true } }, managerToken, 'PUT');
    assert.equal(created.status, 200, JSON.stringify(created.body));
  }
  const gateway = 'load_' + 'g'.repeat(48);
  assert.equal((await request('/api/v2/access/credentials', { requestId: crypto.randomUUID(), id: 'load-gateway', token: gateway, role: 'device', actor: { id: 'load-gateway', kind: 'system', label: 'Load test' }, scaleIds: ids, expiresAt: null })).status, 200);
  const samples = Array.from({ length: 1000 }, (_, i) => ({ scaleId: ids[i % 42], bootId: 'load-boot', sequence: Math.floor(i / 42), sampledAt: at(91 + Math.floor(i / 42)), grossG: 1100 - Math.floor(i / 42), measurementStatus: 'ok' }));
  now = at(120); const started = performance.now(), batchId = crypto.randomUUID();
  const result = await request('/api/v2/telemetry/samples', { version: 2, batchId, samples }, gateway);
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.results.length, 1000); assert(result.body.results.every(r => r.code === 'STORED'));
  t.diagnostic(`42 scales / 1000 readings / durable projection: ${Math.round(performance.now() - started)} ms on isolated local D1`);
  assert.equal((await app.store.query('samples', { where: { scale_id: ids }, limit: 2000 })).length, 1000);
  const replay = await request('/api/v2/telemetry/samples', { version: 2, batchId, samples }, gateway); assert.deepEqual(replay.body, result.body);
  assert.equal((await app.store.query('samples', { where: { scale_id: ids }, limit: 2000 })).length, 1000);
  const view = await request('/api/v2/serving/state'); assert.equal(view.status, 200);
  for (const [i, id] of ids.entries()) { const lastIndex = i + Math.floor((999 - i) / 42) * 42; assert.equal(view.body.bowls.find(b => b.scaleId === id)!.foodRemainingG, 1000 - Math.floor(lastIndex / 42)); }
});

test('T02: raw HTTP 800 out + 100 ice - 600 return - 50 drain confirms exactly 250g', async () => {
  now = at(130);
  const config = await request('/api/v2/devices/balance-scale', { requestId: crypto.randomUUID(), expectedVersion: 0, scaleId: 'balance-scale', name: '质量平衡验证', enabled: true, positionOrder: 100,
    measurement: { boundaryWindowMs: 5000, maxSampleGapMs: 30000, freshMs: 60000, locationFreshMs: 60000, stableWindowMs: 0, stableMinSamples: 1, stableToleranceG: 0, negativeToleranceG: 0, maxStepG: null, timeZone: 'Asia/Shanghai', ruleVersion: 'balance-test' },
    binding: { dishId: 'balance-dish', dishName: '平衡测试菜', containerRef: null, tareG: 100, fullFoodG: 1000, foodOnly: true } }, managerToken, 'PUT'); assert.equal(config.status, 200);
  const binding = config.body.device.binding.id, token = 'balance_' + 'b'.repeat(48);
  assert.equal((await request('/api/v2/access/credentials', { requestId: crypto.randomUUID(), id: 'balance-gateway', token, role: 'device', actor: { id: 'balance-gateway', kind: 'system', label: 'Balance test' }, scaleIds: ['balance-scale'], expiresAt: null })).status, 200);
  const samples = [[131, 900], [135, 900], [137, 1000], [138, 1000], [140, 950], [145, 700]].map(([time, grossG], i) => ({ scaleId: 'balance-scale', bootId: 'balance-boot', sequence: i, sampledAt: at(time), measurementStatus: 'ok' as const, grossG }));
  now = at(150);
  assert.equal((await request('/api/v2/telemetry/samples', { version: 2, batchId: crypto.randomUUID(), samples }, token)).status, 200);
  const events = [{ eventId: crypto.randomUUID(), scaleId: 'balance-scale', bootId: 'balance-boot', eventSequence: 0, occurredAt: at(131), type: 'exit_kitchen', sampleRef: { bootId: 'balance-boot', sequence: 0 } }, { eventId: crypto.randomUUID(), scaleId: 'balance-scale', bootId: 'balance-boot', eventSequence: 1, occurredAt: at(145), type: 'enter_kitchen', sampleRef: { bootId: 'balance-boot', sequence: 5 } }];
  assert.equal((await request('/api/v2/telemetry/events', { version: 2, batchId: crypto.randomUUID(), events }, token)).status, 200);
  for (const [type, time, weightG, a, b] of [['ice_add', 136, 100, 1, 2], ['drain', 139, 50, 3, 4]] as const) {
    const operation = await request('/api/v2/operations', { requestId: crypto.randomUUID(), bindingId: binding, type, occurredAt: at(time), weightG, quantityStatus: 'measured', note: '原始读数核对', evidenceIds: await Promise.all([samples[a], samples[b]].map(sampleId)) }); assert.equal(operation.status, 200, JSON.stringify(operation.body));
  }
  const cycles = await request('/api/v2/cycles?startDate=2026-10-12&endDate=2026-10-12&dishId=balance-dish'); assert.equal(cycles.body.rows.length, 1); assert.equal(cycles.body.rows[0].confirmedTakeG, 250); assert.equal(cycles.body.rows[0].status, 'confirmed');
  const view = await request('/api/v2/serving/state'); assert.equal(view.body.bowls.find(b => b.bindingId === binding)!.foodRemainingG, null);
  const evidence = await request(`/api/v2/bindings/${binding}/evidence?startAt=${encodeURIComponent(at(134))}&endAt=${encodeURIComponent(at(141))}`); assert.equal(evidence.status, 200); assert.equal((evidence.body as unknown as { samples: unknown[] }).samples.length, 4);
});
