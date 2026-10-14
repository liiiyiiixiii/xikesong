import { canonical, decode, operationsMeta, type BindingPayload, type Row } from './records.ts';
import type { MeasurementSample } from './measurement.ts';
import type { EndpointContext, OperationsServices } from './router.ts';
import { OperationsError } from './security.ts';
import { utc } from './telemetry.ts';
async function evidence(c: EndpointContext<'evidence'>) {
  const bindingRow = await c.store.get<Row<BindingPayload>>('bindings', c.params.id); if (!bindingRow) throw new OperationsError('NOT_FOUND');
  const binding = decode(bindingRow), filter = canonical({ generation: c.store.generation, binding: c.params.id, ...c.query, cursor: undefined });
  const revision = await c.store.revision(); let afterId: string | undefined;
  if (c.query.cursor) {
    try { const cursor = JSON.parse(decodeURIComponent(c.query.cursor)); if (cursor.filter !== filter || typeof cursor.id !== 'string') throw new OperationsError('INVALID_REQUEST'); afterId = cursor.id; }
    catch { throw new OperationsError('INVALID_REQUEST'); }
  }
  const from = new Date(Math.max(Date.parse(binding.validFrom), Date.parse(c.query.startAt))).toISOString();
  const to = new Date(Math.min(Date.parse(binding.validTo ?? c.now), Date.parse(c.query.endAt), Date.parse(c.now))).toISOString();
  const rows = from > to ? [] : await c.store.query<Row<MeasurementSample>>('samples', { where: { scale_id: binding.scaleId }, range: { column: 'sampled_at', from: utc(from), to: utc(to), toInclusive: !binding.validTo || Date.parse(binding.validTo) !== Date.parse(to) }, afterId, limit: c.query.limit + 1 });
  const selected = rows.slice(0, c.query.limit).map(decode);
  return { ...operationsMeta(c.store, c.now, revision), bindingId: binding.id, boundaryWindowMs: binding.measurement?.boundaryWindowMs ?? null, samples: selected,
    nextCursor: rows.length > c.query.limit ? encodeURIComponent(JSON.stringify({ filter, id: selected.at(-1)!.id })) : null };
}
export const evidenceServices = { evidence } satisfies OperationsServices;
