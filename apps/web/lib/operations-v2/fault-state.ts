import type { MeasurementEvent } from './measurement.ts';
import { decode, type Row } from './records.ts';
import type { OperationsStore } from './storage.ts';

/** Sequence numbers only order one boot stream. Across simultaneous boots a
 * fault remains authoritative until an unambiguously later recovery. */
export function latestFault(events: MeasurementEvent[], cutoff = Infinity): MeasurementEvent | null {
  const states = events.filter(e => ['device_fault', 'device_recovered'].includes(e.event.type) && Date.parse(e.event.occurredAt) <= cutoff);
  if (!states.length) return null;
  const time = Math.max(...states.map(e => Date.parse(e.event.occurredAt)));
  const simultaneous = states.filter(e => Date.parse(e.event.occurredAt) === time);
  const boots = new Set(simultaneous.map(e => 'bootId' in e.event ? e.event.bootId : null));
  if (boots.size > 1) return simultaneous.find(e => e.event.type === 'device_fault') ?? simultaneous[0];
  const sequence = (e: MeasurementEvent) => 'eventSequence' in e.event ? e.event.eventSequence : -1;
  const head = Math.max(...simultaneous.map(sequence)), heads = simultaneous.filter(e => sequence(e) === head);
  return heads.find(e => e.event.type === 'device_fault') ?? heads[0];
}

export async function readLatestFault(store: OperationsStore, scaleId: string, before: string, receivedBy: string, inclusive = false) {
  const where = { scale_id: scaleId, type: ['device_fault', 'device_recovered'] };
  const head = await store.query<Row<MeasurementEvent> & { occurred_at: string }>('device_events', { where,
    ranges: [{ column: 'occurred_at', to: new Date(before).toISOString(), toInclusive: inclusive }, { column: 'received_at', to: new Date(receivedBy).toISOString(), toInclusive: true }], orderBy: [{ column: 'occurred_at', direction: 'desc' }], limit: 1 });
  if (!head.length) return null;
  const events: MeasurementEvent[] = []; let afterId: string | undefined;
  for (;;) {
    const page = await store.query<Row<MeasurementEvent>>('device_events', { where: { ...where, occurred_at: head[0].occurred_at }, range: { column: 'received_at', to: new Date(receivedBy).toISOString(), toInclusive: true }, afterId, limit: 1000 });
    events.push(...page.map(decode)); if (page.length < 1000) break; afterId = page.at(-1)!.id;
  }
  return latestFault(events);
}
