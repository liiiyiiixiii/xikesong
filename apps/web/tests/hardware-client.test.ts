import assert from 'node:assert/strict';
import test from 'node:test';
import { apiError, type ErrorCode } from '@zhishan/contracts/v2/errors';
import { receiptDefinitions } from '@zhishan/contracts/v2/telemetry';
import { parseHardwareJsonl, parseHardwareArgs, normalizeHardwareBase, sendHardwareBatches } from '../scripts/send-hardware-jsonl.ts';
import { probeHardwareContracts } from '../scripts/probe-hardware-contracts.ts';

const batchId = '463b5c1b-9be2-47f5-9e96-fcf14fbf24a8', eventId = '3c5de1ab-a0a8-4624-b590-bec344713c26';
const sample = { scaleId: 'hardware-test', bootId: 'boot-a', sequence: 1, sampledAt: '2026-10-12T03:00:00Z', measurementStatus: 'ok', grossG: 100.125 };
const samples = { version: 2, batchId, samples: [sample] };
const events = { version: 2, batchId: '80e54dc0-a131-490f-a74e-9e4d16f87c1f', events: [{ eventId, scaleId: sample.scaleId, bootId: sample.bootId, eventSequence: 1, occurredAt: sample.sampledAt, type: 'exit_kitchen', sampleRef: { bootId: sample.bootId, sequence: sample.sequence } }] };
const options = { base: 'https://hardware.example', token: 'test_only_'.repeat(5), maxAttempts: 3, timeoutMs: 1000 };
const parse = (value: unknown) => parseHardwareJsonl(JSON.stringify(value));
function sampleResponse(code: keyof typeof receiptDefinitions = 'STORED', overrides: Record<string, unknown> = {}) {
  const { status, retryable } = receiptDefinitions[code];
  return { contractVersion: 'operations-v2', batchId, serverAt: '2026-10-12T03:00:01Z', results: [{ index: 0, scaleId: sample.scaleId, bootId: sample.bootId, sequence: sample.sequence, status, retryable, code }], ...overrides };
}
const jsonError = (code: ErrorCode, status: number, seconds?: number) => Response.json(apiError(code, null, seconds ? { retryAfterSeconds: seconds } : {}), { status });

test('raw JSONL preserves IDs, event order, 0, null and original occurrence times', () => {
  const raw = [samples, events, { ...samples, batchId: 'a63b5c1b-9be2-47f5-9e96-fcf14fbf24a8', samples: [{ ...sample, sequence: 2, measurementStatus: 'fault', grossG: null }] }, { ...samples, batchId: 'b63b5c1b-9be2-47f5-9e96-fcf14fbf24a8', samples: [{ ...sample, sequence: 3, grossG: 0 }] }];
  const batches = parseHardwareJsonl(raw.map(v => JSON.stringify(v)).join('\r\n'));
  assert.deepEqual(batches.map(b => JSON.parse(b.body)), raw);
  assert.deepEqual(batches.map(b => b.kind), ['samples', 'events', 'samples', 'samples']);
});

test('whole-file validation rejects truth, unknown fields, bad JSON, invalid weights/times and duplicate batch conflicts', () => {
  for (const bad of [{ ...samples, truth: { takeG: 20 } }, { ...samples, samples: [{ ...sample, foodRemainingG: 100 }] }, { ...samples, samples: [{ ...sample, grossG: -1 }] }, { ...samples, samples: [{ ...sample, sampledAt: '2026-10-12 11:00' }] }, { ...events, events: [{ ...events.events[0], type: 'take' }] }]) assert.throws(() => parseHardwareJsonl(JSON.stringify(samples) + '\n' + JSON.stringify(bad)), /第 2 行/);
  assert.throws(() => parseHardwareJsonl('{}\n{'), /第 1 行/);
  assert.throws(() => parseHardwareJsonl(JSON.stringify(samples) + '\n{'), /第 2 行/);
  assert.throws(() => parseHardwareJsonl(JSON.stringify(samples) + '\n' + JSON.stringify({ ...samples, samples: [{ ...sample, grossG: 200 }] })), /批次编号/);
  assert.throws(() => parseHardwareJsonl(JSON.stringify(samples) + '\n' + JSON.stringify({ ...events, batchId })), /批次编号/);
  assert.throws(() => parseHardwareJsonl(' \n'), /没有报文/);
  assert.throws(() => parse({ ...samples, samples: Array.from({ length: 1001 }, () => sample) }));
});

test('CLI requires explicit address, credential source and input; no default secrets or plaintext token arguments', () => {
  assert.throws(() => parseHardwareArgs([]));
  assert.throws(() => parseHardwareArgs(['--input', 'raw.jsonl']));
  assert.throws(() => parseHardwareArgs(['--base', options.base, '--token', options.token, '--input', 'raw.jsonl']));
  assert.throws(() => parseHardwareArgs(['--base', options.base, '--token-env', 'TOKEN', '--token-file', 'token', '--input', 'raw.jsonl']));
  assert.throws(() => parseHardwareArgs(['--validate-only', '--input', 'a', '--input', 'b']));
  assert.equal(parseHardwareArgs(['--validate-only', '--input', 'raw.jsonl']).validateOnly, true);
  assert.equal(parseHardwareArgs(['--base', options.base, '--token-env', 'DEVICE_TOKEN', '--input', 'raw.jsonl']).maxAttempts, 3);
  for (const bad of ['http://hardware.example', 'https://token@example.com', 'https://hardware.example/path', 'https://hardware.example?token=x', 'https://hardware.example#x']) assert.throws(() => normalizeHardwareBase(bad));
  assert.equal(normalizeHardwareBase('http://127.0.0.1:5183/'), 'http://127.0.0.1:5183');
});

test('network ambiguity retries byte-identical body and batch IDs, with bounded attempts', async () => {
  const bodies: unknown[] = [], reports: unknown[] = [], waits: number[] = [];
  let calls = 0;
  const ok = await sendHardwareBatches(parse(samples), options, { fetcher: (async (_url, init) => {
    bodies.push(init?.body); assert.equal(init?.redirect, 'manual');
    if (++calls < 3) throw new Error('network');
    return Response.json(sampleResponse('DUPLICATE'));
  }) as typeof fetch, sleep: async ms => { waits.push(ms); }, report: value => reports.push(value) });
  assert.equal(ok, true); assert.equal(new Set(bodies).size, 1); assert.equal(calls, 3); assert.deepEqual(waits, [1000, 2000]);
  assert.ok(!JSON.stringify(reports).includes(options.token));
  calls = 0;
  assert.equal(await sendHardwareBatches(parseHardwareJsonl(JSON.stringify(samples) + '\n' + JSON.stringify(events)), { ...options, maxAttempts: 2 }, { fetcher: (async () => { calls++; throw new Error('network'); }) as typeof fetch, sleep: async () => {} }), false);
  assert.equal(calls, 2, 'stop subsequent events after sample delivery remains unknown');
});

test('BUSY retries the same full batch, prints every receipt and accepts eventual duplicate/stored outcomes', async () => {
  const payload = { ...samples, samples: [sample, { ...sample, sequence: 2 }] }, bodies: unknown[] = [], reports: Record<string, unknown>[] = [];
  const ok = await sendHardwareBatches(parse(payload), options, { fetcher: (async (_url, init) => {
    bodies.push(init?.body);
    const reply = sampleResponse(bodies.length === 1 ? 'STORED' : 'DUPLICATE');
    const code = bodies.length === 1 ? 'BUSY' : 'STORED', { status, retryable } = receiptDefinitions[code];
    reply.results.push({ ...reply.results[0], index: 1, sequence: 2, status, retryable, code });
    return Response.json(reply);
  }) as typeof fetch, sleep: async () => {}, report: value => reports.push(value) });
  assert.equal(ok, true); assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]);
  assert.equal(reports.filter(r => r.outcome === 'receipt').length, 4);
});

test('connection loss while reading a receipt is ambiguous and uses the same bounded retry', async () => {
  let calls = 0; const bodies: unknown[] = [];
  const interrupted = new Response(); interrupted.json = async () => { throw new DOMException('aborted', 'AbortError'); };
  const ok = await sendHardwareBatches(parse(samples), options, { fetcher: (async (_url, init) => { bodies.push(init?.body); return ++calls === 1 ? interrupted : Response.json(sampleResponse()); }) as typeof fetch, sleep: async () => {} });
  assert.equal(ok, true); assert.equal(calls, 2); assert.equal(bodies[0], bodies[1]);
});

test('known 429/503 respect retry delay; excessive retry-after stops without early retry', async () => {
  const waits: number[] = []; let calls = 0;
  assert.equal(await sendHardwareBatches(parse(samples), options, { fetcher: (async () => ++calls === 1 ? jsonError('RATE_LIMITED', 429, 2) : Response.json(sampleResponse())) as typeof fetch, sleep: async ms => { waits.push(ms); } }), true);
  assert.deepEqual(waits, [2000]);
  calls = 0;
  assert.equal(await sendHardwareBatches(parse(samples), options, { fetcher: (async () => { calls++; return jsonError('UNAVAILABLE', 503, 120); }) as typeof fetch, sleep: async () => assert.fail('must not wait/retry early') }), false);
  assert.equal(calls, 1);
});

test('401/403/unknown HTTP/redirect errors never retry or send later lines', async () => {
  for (const response of [() => jsonError('UNAUTHENTICATED', 401), () => jsonError('FORBIDDEN', 403), () => jsonError('ID_CONFLICT', 409), () => Response.json({ unexpected: true }, { status: 503 }), () => new Response('', { status: 307, headers: { Location: 'https://elsewhere.example' } })]) {
    let calls = 0;
    assert.equal(await sendHardwareBatches(parseHardwareJsonl(JSON.stringify(samples) + '\n' + JSON.stringify(events)), options, { fetcher: (async () => { calls++; return response(); }) as typeof fetch, sleep: async () => assert.fail('must not retry') }), false);
    assert.equal(calls, 1);
  }
});

test('a 200 with rejection/ignored item is incomplete, while event waiting_sample is stored but not confirmed', async () => {
  for (const code of ['UNKNOWN_DEVICE', 'CLOCK_AHEAD', 'OLD_BOOT', 'ID_CONFLICT'] as const) {
    assert.equal(await sendHardwareBatches(parse(samples), options, { fetcher: (async () => Response.json(sampleResponse(code))) as typeof fetch }), false);
  }
  const reports: Record<string, unknown>[] = [];
  const response = { contractVersion: 'operations-v2', batchId: events.batchId, serverAt: '2026-10-12T03:00:01Z', results: [{ index: 0, eventId, status: 'accepted', code: 'STORED', retryable: false, processingStatus: 'waiting_sample' }] };
  assert.equal(await sendHardwareBatches(parse(events), options, { fetcher: (async url => { assert.ok(String(url).endsWith('/events')); return Response.json(response); }) as typeof fetch, report: value => reports.push(value) }), true);
  assert.equal(reports[0].processingStatus, 'waiting_sample');
});

test('success requires schema-valid complete ordered receipts matching batch and sample identity', async () => {
  const valid = sampleResponse();
  for (const bad of [{ ...valid, batchId: eventId }, { ...valid, results: [] }, { ...valid, results: [{ ...valid.results[0], sequence: 99 }] }, { ...valid, results: [{ ...valid.results[0], retryable: true }] }, { ...valid, results: [{ ...valid.results[0], index: 1 }] }]) {
    let calls = 0;
    assert.equal(await sendHardwareBatches(parse(samples), options, { fetcher: (async () => { calls++; return Response.json(bad); }) as typeof fetch }), false);
    assert.equal(calls, 1);
  }
});

test('invalid sender options and tampered raw input perform no network requests', async () => {
  for (const bad of [{ ...options, maxAttempts: 0 }, { ...options, maxAttempts: 6 }, { ...options, timeoutMs: NaN }, { ...options, token: '' }]) await assert.rejects(sendHardwareBatches(parse(samples), bad, { fetcher: (async () => assert.fail('must not send')) as typeof fetch }));
  const batches = parse(samples); batches[0].body = JSON.stringify({ ...samples, truth: 1 });
  await assert.rejects(sendHardwareBatches(batches, options, { fetcher: (async () => assert.fail('must not send')) as typeof fetch }));
});

test('authentication probe only GETs protected reads without credentials and accepts 401/503, never 501 or 200', async () => {
  for (const [status, code] of [[401, 'UNAUTHENTICATED'], [503, 'UNAVAILABLE']] as const) {
    const calls: string[] = [];
    const results = await probeHardwareContracts(options.base, (async (url, init) => { calls.push(String(url)); assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined); assert.equal(new Headers(init?.headers).get('authorization'), null); return jsonError(code, status); }) as typeof fetch);
    assert.equal(calls.length, 2); assert.equal(results[0].status, status);
  }
  for (const status of [200, 403, 501]) await assert.rejects(probeHardwareContracts(options.base, (async () => jsonError('NOT_IMPLEMENTED', status)) as typeof fetch));
});
