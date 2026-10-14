import { z } from 'zod';
import { environment, timestamp } from '@zhishan/contracts/v2/common';
import { canonical } from './records.ts';
import { history } from './projection.ts';
import { tokenHash } from './security.ts';
import { OperationsStore, operationsTables, type OperationsTable, type Write } from './storage.ts';

const cell = z.union([z.string(), z.number().finite(), z.null()]);
const backupData = z.object({ version: z.literal(1), environment, revision: z.number().int().nonnegative(), createdAt: timestamp,
  tables: z.array(z.object({ table: z.enum(operationsTables as [OperationsTable, ...OperationsTable[]]), rows: z.array(z.record(cell)) }).strict()),
}).strict();
const backupSchema = z.object({ data: backupData, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
/** Logical, environment-scoped snapshot. Retry if any concurrent write occurs. */
export async function createOperationsBackup(store: OperationsStore) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const revision = await store.revision();
    const restore = await store.get<{ payload: string }>('maintenance', 'restore');
    if (restore && JSON.parse(restore.payload).status !== 'complete') throw new Error('Cannot back up an incomplete restore');
    const tables = [];
    for (const table of operationsTables.filter(t => t !== 'maintenance')) {
      const rows = await history<Record<string, string | number | null> & { id: string }>(store, table);
      tables.push({ table, rows: rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'environment'))) });
    }
    if (revision !== await store.revision()) continue;
    const data = backupData.parse({ version: 1, environment: store.environment, revision, createdAt: new Date().toISOString(), tables });
    return { data, sha256: await tokenHash(canonical(data)) };
  }
  throw new Error('Backup could not obtain a stable revision; retry during a quiet interval');
}
/** Restore ONLY to a new empty database of the same environment. A partial
 * restore keeps a durable lock so it cannot accidentally be served as complete. */
export async function restoreOperationsBackup(store: OperationsStore, input: unknown) {
  const backup = backupSchema.parse(input);
  if (backup.data.environment !== store.environment || await tokenHash(canonical(backup.data)) !== backup.sha256) throw new Error('Backup environment or digest mismatch');
  const expected = operationsTables.filter(t => t !== 'maintenance');
  const listed=backup.data.tables.map(t=>t.table);
  const compatible=expected.filter(t=>!['kitchen_visits','conveyor_events'].includes(t));
  if (canonical([...listed].sort()) !== canonical([...expected].sort()) && canonical([...listed].sort()) !== canonical([...compatible].sort())) throw new Error('Backup table manifest mismatch');
  if (await store.revision() !== 0) throw new Error('Restore requires an empty database');
  for (const table of operationsTables) if ((await store.query(table, { limit: 1 })).length) throw new Error('Restore requires an empty database');
  const lock = { type: 'insert', table: 'maintenance', values: { id: 'restore', payload: JSON.stringify({ status: 'pending', sourceDigest: backup.sha256 }) } } as const;
  if (!await store.transact(0, [lock])) throw new Error('Restore target changed');
  for (const { table, rows } of backup.data.tables) {
    for (let offset = 0; offset < rows.length; offset += 50) {
      const writes: Write[] = rows.slice(offset, offset + 50).map(row => {
        if (typeof row.id !== 'string') throw new Error('Backup row lacks identity');
        return { type: 'insert', table, values: { ...row, id: row.id } };
      });
      if (!await store.transact(await store.revision(), writes, { maintenance: true })) throw new Error('Restore target changed');
    }
  }
  for (const { table, rows } of backup.data.tables) {
    const saved = (await history<Record<string, string | number | null> & { id: string }>(store, table)).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'environment')));
    if (canonical(saved) !== canonical(rows)) throw new Error('Restore verification failed');
  }
  if (!await store.transact(await store.revision(), [{ type: 'update', table: 'maintenance', id: 'restore', values: { payload: JSON.stringify({ status: 'complete', sourceDigest: backup.sha256, sourceRevision: backup.data.revision, restoredAt: new Date().toISOString() }) } }], { maintenance: true })) throw new Error('Restore target changed');
}
