import { CONTRACT_VERSION } from '@zhishan/contracts/v2/common';
import { receiptDefinitions, sampleTimeCode, type SampleV2 } from '@zhishan/contracts/v2/telemetry';
import { canonical, decode, mutate, type DevicePayload, type BindingPayload, type CyclePayload, type Row } from './records.ts';
import { requireDeviceScope, tokenHash } from './security.ts';
import { projectionJob } from './configuration.ts';
import type { EndpointContext, OperationsServices } from './router.ts';
import type { Write } from './storage.ts';

type Code = keyof typeof receiptDefinitions;
type Device = DevicePayload & { boot?: { id: string; at: string; previous: string[] }; sampleHead?: { bootId: string; sampledAt: string; sequence: number }; faultHead?: { occurredAt: string; eventSequence: number; bootId: string } };
export const utc = (time: string) => new Date(time).toISOString();
export const sampleId = async (sample: Pick<SampleV2, 'scaleId' | 'bootId' | 'sequence'>) => 'sample:' + await tokenHash(canonical([sample.scaleId, sample.bootId, sample.sequence]));

async function ingest(c: EndpointContext<'samples'> | EndpointContext<'events'>, kind: 'samples' | 'events') {
  const samples = 'samples' in c.body ? c.body.samples : null, events = 'events' in c.body ? c.body.events : null;
  const items = samples ?? events!;
  requireDeviceScope(c.principal, items.map(item => item.scaleId));
  const prepared = await Promise.all(items.map(async item => ({ item, id: 'sampledAt' in item ? await sampleId(item) : item.eventId, hash: await tokenHash(canonical(item)) })));
  return mutate(c, `telemetry.${kind}`, c.body.batchId, c.body, async revision => {
    const writes: Write[] = [], devices = new Map<string, Device | null>(), identities = new Map<string, string>();
    const existing = new Map<string, string>(), bindingsByScale = new Map<string, BindingPayload[]>();
    const scaleIds = [...new Set(items.map(item => item.scaleId))], table = kind === 'samples' ? 'samples' : 'device_events';
    for (let offset = 0; offset < prepared.length; offset += 50) {
      for (const row of await c.store.query<{ id: string; payload_hash: string }>(table, { where: { id: prepared.slice(offset, offset + 50).map(p => p.id) }, limit: 50 })) existing.set(row.id, row.payload_hash);
      // Purging an unreferenced waveform must not release its immutable device
      // identity. A new batch still receives DUPLICATE / ID_CONFLICT and cannot
      // resurrect or replace a previously accepted sample.
      if (kind === 'samples') for (const row of await c.store.query<{ id: string; payload_hash: string }>('sample_tombstones', { where: { id: prepared.slice(offset, offset + 50).map(p => p.id) }, limit: 50 })) existing.set(row.id, row.payload_hash);
    }
    for (let offset = 0; offset < scaleIds.length; offset += 50) {
      const ids = scaleIds.slice(offset, offset + 50);
      for (const id of ids) devices.set(id, null);
      for (const row of await c.store.query<Row<Device>>('devices', { where: { id: ids }, limit: 50 })) devices.set(row.id, decode(row));
      let afterId: string | undefined;
      for (;;) {
        const rows = await c.store.query<Row<BindingPayload>>('bindings', { where: { scale_id: ids }, afterId, limit: 1000 });
        for (const row of rows) { const binding = decode(row); bindingsByScale.set(binding.scaleId, [...(bindingsByScale.get(binding.scaleId) ?? []), binding]); }
        if (rows.length < 1000) break; afterId = rows.at(-1)!.id;
      }
    }
    const jobs = new Map<string, Write>();
    const dirtyFrom = new Map<string, string>();
    const results = [];
    for (const [index, { item, id, hash }] of prepared.entries()) {
      const sample = 'sampledAt' in item ? item : null, event = 'eventId' in item ? item : null;
      const time = sample?.sampledAt ?? event!.occurredAt;
      const identity = canonical([table, item.scaleId, item.bootId, sample?.sequence ?? event!.eventSequence]);
      const device = devices.get(item.scaleId)!;
      const old = existing.get(id);
      const sequenceRow = event ? (await c.store.query<{ id: string; payload_hash: string }>('device_events', { where: { scale_id: item.scaleId, boot_id: item.bootId, event_sequence: event.eventSequence }, limit: 1 }))[0] : null;
      const seen = identities.get(identity), seenId = identities.get(`${table}:${id}`);
      let code: Code = old || seenId ? (old ?? seenId) === hash ? 'DUPLICATE' : 'ID_CONFLICT'
        : sequenceRow || seen ? 'ID_CONFLICT' : !device ? 'UNKNOWN_DEVICE' : !device.enabled ? 'DEVICE_DISABLED' : sampleTimeCode(time, c.now) ?? 'STORED';
      if (code === 'STORED' && device) {
        if (device.boot && device.boot.id !== item.bootId && (device.boot.previous.includes(item.bootId) || Date.parse(time) < Date.parse(device.boot.at))) code = 'OLD_BOOT';
        else {
          if (!device.boot || device.boot.id !== item.bootId) device.boot = { id: item.bootId, at: utc(time), previous: [...(device.boot?.previous ?? []), ...(device.boot ? [device.boot.id] : [])] };
          const latest = sample && device.sampleHead?.bootId === item.bootId ? device.sampleHead : null;
          if (latest && (utc(time) < latest.sampledAt || sample!.sequence < latest.sequence)) code = 'LATE_SAMPLE';
          if (sample && (!latest || utc(time) > latest.sampledAt)) device.sampleHead = { bootId: item.bootId, sampledAt: utc(time), sequence: sample.sequence };
          identities.set(identity, hash); identities.set(`${table}:${id}`, hash);
          writes.push({ type: 'insert', table, values: sample ? {
            id, scale_id: item.scaleId, boot_id: item.bootId, sequence: sample.sequence, sampled_at: utc(time), received_at: c.now, payload_hash: hash,
            payload: JSON.stringify({ id, sample, receivedAt: c.now }),
          } : { id, scale_id: item.scaleId, boot_id: item.bootId, event_sequence: event!.eventSequence, occurred_at: utc(time), received_at: c.now, type: event!.type, payload_hash: hash,
            payload: JSON.stringify({ event, receivedAt: c.now, origin: 'device' }),
          } });
          // Historical packets rebuild the binding active at observation time.
          for (const binding of bindingsByScale.get(item.scaleId) ?? []) if (Date.parse(time) >= Date.parse(binding.validFrom) && (!binding.validTo || Date.parse(time) < Date.parse(binding.validTo))) {
            jobs.set(binding.id, projectionJob(binding.id, revision + 1, c.now));
            dirtyFrom.set(binding.id, dirtyFrom.has(binding.id) && dirtyFrom.get(binding.id)! < utc(time) ? dirtyFrom.get(binding.id)! : utc(time));
          }
          if (event?.type === 'device_fault' || event?.type === 'device_recovered') {
            const head = device.faultHead;
            if (!head || Date.parse(event.occurredAt) > Date.parse(head.occurredAt) || Date.parse(event.occurredAt) === Date.parse(head.occurredAt) && event.bootId === head.bootId && event.eventSequence > head.eventSequence) {
              device.diagnostics.fault = event.type === 'device_fault' ? event.reasonCode : null;
              device.faultHead = { occurredAt: event.occurredAt, eventSequence: event.eventSequence, bootId: event.bootId };
            }
          }
        }
      }
      const rule = receiptDefinitions[code];
      if (device) {
        if (rule.status === 'accepted') device.diagnostics.accepted++;
        else if (rule.status === 'duplicate') device.diagnostics.duplicate++;
        else device.diagnostics.rejected++;
        device.diagnostics.lastCode = code;
      }
      const receipt = { code, status: rule.status, retryable: rule.retryable };
      let processingStatus: 'applied' | 'waiting_sample' | 'pending_review' | null = null;
      if (event && (rule.status === 'accepted' || rule.status === 'duplicate')) {
        processingStatus = 'waiting_sample';
        if (event.type === 'device_fault' || event.type === 'device_recovered') processingStatus = Date.parse(time) <= Date.parse(c.now) ? 'applied' : 'pending_review';
        else if (rule.status === 'duplicate') {
          // A new batch can inspect the latest persisted result. Retrying the
          // same batch still returns its original atomic receipt via mutate().
          const row = (await c.store.query<Row<CyclePayload>>('cycles', { where: { [event.type === 'exit_kitchen' ? 'exit_event_id' : 'return_event_id']: event.eventId }, limit: 1 }))[0];
          if (row) {
            const { cycle, calculation } = decode(row);
            const blocked = calculation.blockingReasons.some(reason => reason !== 'MISSING_SAMPLE') || cycle.status === 'invalidated' || cycle.status === 'pending' && calculation.blockingReasons.length === 0;
            processingStatus = blocked ? 'pending_review' : (event.type === 'exit_kitchen' ? cycle.outG : cycle.inG) === null ? 'waiting_sample' : 'applied';
          }
        }
      }
      results.push(sample ? { index, scaleId: item.scaleId, bootId: item.bootId, sequence: sample.sequence, ...receipt }
        : { index, eventId: event!.eventId, ...receipt, processingStatus });
    }
    for (const [id, device] of devices) if (device) writes.push({ type: 'update', table: 'devices', id, values: { payload: JSON.stringify(device) } });
    for (const [bindingId, from] of dirtyFrom) {
      let afterId: string | undefined;
      for (;;) {
        const intervals = await c.store.query<{ id: string; quality: string }>('serving_intervals', { where: { binding_id: bindingId }, range: { column: 'ended_at', from }, afterId, limit: 1000 });
        for (const interval of intervals) if (interval.quality !== 'pending') writes.push({ type: 'update', table: 'serving_intervals', id: interval.id, values: { quality: 'pending', empty: 0 } });
        if (intervals.length < 1000) break; afterId = intervals.at(-1)!.id;
      }
    }
    writes.push(...jobs.values());
    return { writes, response: { contractVersion: CONTRACT_VERSION, batchId: c.body.batchId, serverAt: c.now, results } };
  });
}
export const telemetryServices = {
  samples: async (c: EndpointContext<'samples'>) => ingest(c, 'samples') as Promise<import('@zhishan/contracts/operations-v2').EndpointResult<'samples'>>,
  events: async (c: EndpointContext<'events'>) => ingest(c, 'events') as Promise<import('@zhishan/contracts/operations-v2').EndpointResult<'events'>>,
} satisfies OperationsServices;
