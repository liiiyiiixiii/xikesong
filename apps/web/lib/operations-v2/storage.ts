import { z } from 'zod';
import { environment as environmentSchema } from '@zhishan/contracts/v2/common';

export type OperationsEnvironment = z.infer<typeof environmentSchema>;
type Value = string | number | null;

// Separate tables and explicit environment keys keep imported legacy history out of v2.
// Migrations are additive and only run when an operations instance explicitly initializes.
const definitions = {
  kitchen_visits: 'binding_id TEXT NOT NULL, payload TEXT NOT NULL',
  conveyor_events: 'track_id TEXT NOT NULL, boot_id TEXT NOT NULL, sequence INTEGER NOT NULL, occurred_at TEXT NOT NULL, payload TEXT NOT NULL',
  credentials: 'token_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN (\'device\',\'staff\',\'manager\')), disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)), expires_at TEXT, payload TEXT NOT NULL',
  devices: 'enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), updated_at TEXT NOT NULL, payload TEXT NOT NULL',
  bindings: 'scale_id TEXT NOT NULL, dish_id TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, version INTEGER NOT NULL CHECK(version>=0), payload TEXT NOT NULL, CHECK(valid_to IS NULL OR valid_to>valid_from)',
  samples: 'scale_id TEXT NOT NULL, boot_id TEXT NOT NULL, sequence INTEGER NOT NULL, sampled_at TEXT NOT NULL, received_at TEXT NOT NULL, payload_hash TEXT NOT NULL, payload TEXT NOT NULL',
  sample_tombstones: 'scale_id TEXT NOT NULL, boot_id TEXT NOT NULL, sequence INTEGER NOT NULL, sampled_at TEXT NOT NULL, payload_hash TEXT NOT NULL, payload TEXT NOT NULL',
  device_events: 'scale_id TEXT NOT NULL, boot_id TEXT NOT NULL, event_sequence INTEGER NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL, type TEXT NOT NULL, payload_hash TEXT NOT NULL, payload TEXT NOT NULL',
  latest: 'sampled_at TEXT NOT NULL, received_at TEXT NOT NULL, payload TEXT NOT NULL',
  weight_changes: 'binding_id TEXT NOT NULL, occurred_at TEXT NOT NULL, algorithm_version TEXT NOT NULL, payload TEXT NOT NULL',
  cycles: 'binding_id TEXT NOT NULL, exit_event_id TEXT, return_event_id TEXT, status TEXT NOT NULL CHECK(status IN (\'open\',\'pending\',\'confirmed\',\'invalidated\')), version INTEGER NOT NULL CHECK(version>=0), effective_at TEXT, payload TEXT NOT NULL',
  operations: 'binding_id TEXT NOT NULL, occurred_at TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=0), corrects_id TEXT, payload TEXT NOT NULL',
  cycle_reviews: 'cycle_id TEXT NOT NULL, occurred_at TEXT NOT NULL, payload TEXT NOT NULL',
  freshness_rules: 'version INTEGER NOT NULL CHECK(version>=0), updated_at TEXT NOT NULL, payload TEXT NOT NULL',
  freshness_batches: 'binding_id TEXT NOT NULL, started_at TEXT NOT NULL, closed_at TEXT, payload TEXT NOT NULL',
  freshness_actions: 'binding_id TEXT NOT NULL, batch_id TEXT, operation_id TEXT NOT NULL, occurred_at TEXT NOT NULL, payload TEXT NOT NULL',
  ledger: 'cycle_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=0), current INTEGER NOT NULL CHECK(current IN (0,1)), effective_at TEXT NOT NULL, weight_mg INTEGER CHECK(weight_mg IS NULL OR weight_mg>=0), payload TEXT NOT NULL',
  rules: 'version INTEGER NOT NULL CHECK(version>=0), updated_at TEXT NOT NULL, payload TEXT NOT NULL',
  serving_projection: 'updated_at TEXT NOT NULL, payload TEXT NOT NULL',
  serving_intervals: 'binding_id TEXT NOT NULL, dish_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, quality TEXT NOT NULL, empty INTEGER NOT NULL CHECK(empty IN (0,1)), rule_version TEXT, payload TEXT NOT NULL',
  tasks: 'binding_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN (\'open\',\'claimed\',\'verifying\',\'resolved\',\'deferred\',\'cancelled\')), version INTEGER NOT NULL CHECK(version>=0), defer_until TEXT, updated_at TEXT NOT NULL, payload TEXT NOT NULL',
  task_actions: 'task_id TEXT NOT NULL, occurred_at TEXT NOT NULL, payload TEXT NOT NULL',
  jobs: 'scope TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN (\'pending\',\'running\',\'complete\',\'failed\')), desired_revision INTEGER NOT NULL, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL',
  receipts: 'caller_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL',
  maintenance: 'payload TEXT NOT NULL',
  system: 'updated_at TEXT NOT NULL, payload TEXT NOT NULL',
} as const;

export type OperationsTable = keyof typeof definitions;
export const operationsTables = Object.keys(definitions) as OperationsTable[];
const tableName = (table: OperationsTable) => {
  if (!Object.hasOwn(definitions, table)) throw new Error('Unknown operations table');
  return `ops_v2_${table}`;
};
const columns = Object.fromEntries(Object.entries(definitions).map(([table, ddl]) => [
  table, new Set(['id', ...Array.from(ddl.matchAll(/(?:^|, )([a-z_]+) (?:TEXT|INTEGER)/g), match => match[1])]),
])) as Record<OperationsTable, Set<string>>;

export const operationsMigrations = [
  "CREATE TABLE IF NOT EXISTS ops_v2_meta (environment TEXT PRIMARY KEY CHECK(environment IN ('test','demo','live')), revision INTEGER NOT NULL DEFAULT 0, operation_id TEXT NOT NULL DEFAULT '', schema_version INTEGER NOT NULL DEFAULT 1)",
  "CREATE TABLE IF NOT EXISTS ops_v2_identity (environment TEXT PRIMARY KEY CHECK(environment IN ('test','demo','live')), generation TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS ops_v2_scheduler (environment TEXT PRIMARY KEY CHECK(environment IN ('test','demo','live')), run_id TEXT NOT NULL, started_at TEXT NOT NULL, payload TEXT NOT NULL)",
  ...Object.entries(definitions).map(([table, ddl]) => `CREATE TABLE IF NOT EXISTS ops_v2_${table} (environment TEXT NOT NULL CHECK(environment IN ('test','demo','live')), id TEXT NOT NULL, ${ddl}, PRIMARY KEY(environment,id))`),
  'CREATE INDEX IF NOT EXISTS ops_v2_conveyor_boot ON ops_v2_conveyor_events(environment,track_id,boot_id)',
  'CREATE INDEX IF NOT EXISTS ops_v2_kitchen_binding ON ops_v2_kitchen_visits(environment,binding_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ops_v2_credentials_hash ON ops_v2_credentials(environment,token_hash)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ops_v2_binding_active ON ops_v2_bindings(environment,scale_id) WHERE valid_to IS NULL',
  'CREATE INDEX IF NOT EXISTS ops_v2_binding_history ON ops_v2_bindings(environment,scale_id,valid_from)',
  ...['INSERT', 'UPDATE'].map(action => `CREATE TRIGGER IF NOT EXISTS ops_v2_binding_interval_${action.toLowerCase()} BEFORE ${action} ON ops_v2_bindings BEGIN
    SELECT CASE WHEN julianday(NEW.valid_from) IS NULL OR (NEW.valid_to IS NOT NULL AND (julianday(NEW.valid_to) IS NULL OR julianday(NEW.valid_to)<=julianday(NEW.valid_from))) THEN RAISE(ABORT,'Invalid binding interval') END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM ops_v2_bindings b WHERE b.environment=NEW.environment AND b.scale_id=NEW.scale_id AND b.id<>NEW.id AND (b.valid_to IS NULL OR julianday(NEW.valid_from)<julianday(b.valid_to)) AND (NEW.valid_to IS NULL OR julianday(b.valid_from)<julianday(NEW.valid_to))) THEN RAISE(ABORT,'Overlapping binding interval') END;
  END`),
  'CREATE UNIQUE INDEX IF NOT EXISTS ops_v2_freshness_batch_active ON ops_v2_freshness_batches(environment,binding_id) WHERE closed_at IS NULL',
  'CREATE INDEX IF NOT EXISTS ops_v2_freshness_actions_time ON ops_v2_freshness_actions(environment,occurred_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ops_v2_sample_identity ON ops_v2_samples(environment,scale_id,boot_id,sequence)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ops_v2_sample_tombstone_identity ON ops_v2_sample_tombstones(environment,scale_id,boot_id,sequence)',
  'CREATE INDEX IF NOT EXISTS ops_v2_sample_time ON ops_v2_samples(environment,scale_id,sampled_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ops_v2_event_identity ON ops_v2_device_events(environment,scale_id,boot_id,event_sequence)',
  'CREATE INDEX IF NOT EXISTS ops_v2_event_time ON ops_v2_device_events(environment,scale_id,occurred_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ops_v2_cycle_exit ON ops_v2_cycles(environment,exit_event_id) WHERE exit_event_id IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS ops_v2_cycle_return ON ops_v2_cycles(environment,return_event_id) WHERE return_event_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS ops_v2_cycle_binding ON ops_v2_cycles(environment,binding_id,effective_at)',
  'CREATE INDEX IF NOT EXISTS ops_v2_operation_time ON ops_v2_operations(environment,binding_id,occurred_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ops_v2_operation_correction ON ops_v2_operations(environment,corrects_id) WHERE corrects_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS ops_v2_cycle_review_time ON ops_v2_cycle_reviews(environment,cycle_id,occurred_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ops_v2_ledger_version ON ops_v2_ledger(environment,cycle_id,version)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ops_v2_ledger_current ON ops_v2_ledger(environment,cycle_id) WHERE current=1',
  'CREATE INDEX IF NOT EXISTS ops_v2_ledger_date ON ops_v2_ledger(environment,current,effective_at)',
  "CREATE UNIQUE INDEX IF NOT EXISTS ops_v2_task_active ON ops_v2_tasks(environment,binding_id) WHERE status NOT IN ('resolved','cancelled')",
  'CREATE INDEX IF NOT EXISTS ops_v2_task_due ON ops_v2_tasks(environment,status,defer_until)',
  'CREATE INDEX IF NOT EXISTS ops_v2_job_due ON ops_v2_jobs(environment,status,lease_until)',
  'CREATE INDEX IF NOT EXISTS ops_v2_serving_interval_time ON ops_v2_serving_intervals(environment,dish_id,started_at,ended_at)',
  'CREATE INDEX IF NOT EXISTS ops_v2_serving_interval_binding ON ops_v2_serving_intervals(environment,binding_id,started_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ops_v2_receipt_identity ON ops_v2_receipts(environment,caller_id,request_id)',
] as const;

export type Write =
  | { type: 'insert' | 'upsert'; table: OperationsTable; values: Record<string, Value> & { id: string } }
  | { type: 'update'; table: OperationsTable; id: string; values: Record<string, Value> }
  | { type: 'delete'; table: OperationsTable; id: string };

export type QueryRange = { column: string; from?: string | number; to?: string | number; fromInclusive?: boolean; toInclusive?: boolean };
export type OperationsQuery = {
  where?: Record<string, Value | readonly Value[]>;
  notIn?: Record<string, readonly Value[]>;
  range?: QueryRange; ranges?: QueryRange[];
  orderBy?: { column: string; direction: 'asc' | 'desc' }[];
  limit?: number; afterId?: string;
};

function fields(table: OperationsTable, values: Record<string, Value>, allowId = true) {
  const entries = Object.entries(values);
  if (!entries.length || entries.some(([key, value]) => !columns[table].has(key) || (!allowId && key === 'id') ||
    !(value === null || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)))) {
    throw new Error('Invalid operations columns or values');
  }
  return entries;
}

/** A D1 batch is a transaction. Its first statement claims the expected revision;
 * every subsequent mutation has the same SQL guard, so a losing writer cannot
 * partially modify a binding, ledger, task or request receipt. Unique indexes
 * enforce invariants even if an application service misses a check. */
export class OperationsStore {
  readonly environment: OperationsEnvironment;
  readonly db: D1Database;
  generation = '';
  constructor(db: D1Database, environment: OperationsEnvironment) {
    this.db = db;
    this.environment = environmentSchema.parse(environment);
  }

  async initialize() {
    await this.db.batch(operationsMigrations.map(sql => this.db.prepare(sql)));
    await this.db.prepare('INSERT OR IGNORE INTO ops_v2_meta(environment) VALUES (?)').bind(this.environment).run();
    await this.db.prepare('INSERT OR IGNORE INTO ops_v2_identity(environment,generation) VALUES (?,?)').bind(this.environment, crypto.randomUUID()).run();
    this.generation = (await this.db.prepare('SELECT generation FROM ops_v2_identity WHERE environment=?').bind(this.environment).first<{ generation: string }>())!.generation;
  }

  async revision() {
    const row = await this.db.prepare('SELECT revision FROM ops_v2_meta WHERE environment=?').bind(this.environment).first<{ revision: number }>();
    if (!row) throw new Error('Operations storage has not been initialized');
    return row.revision;
  }

  async get<T>(table: OperationsTable, id: string): Promise<T | null> {
    return this.db.prepare(`SELECT * FROM ${tableName(table)} WHERE environment=? AND id=?`).bind(this.environment, id).first<T>();
  }

  async list<T>(table: OperationsTable, where: Record<string, Value> = {}): Promise<T[]> {
    const entries = Object.keys(where).length ? fields(table, where) : [];
    const filters = entries.map(([key, value]) => `${key} ${value === null ? 'IS NULL' : '= ?'}`);
    const result = await this.db.prepare(`SELECT * FROM ${tableName(table)} WHERE environment=?${filters.length ? ' AND ' + filters.join(' AND ') : ''} ORDER BY id`)
      .bind(this.environment, ...entries.filter(([, value]) => value !== null).map(([, value]) => value)).all<T>();
    return result.results;
  }

  async query<T>(table: OperationsTable, query: OperationsQuery = {}): Promise<T[]> {
    const filters = ['environment=?'], values: Value[] = [this.environment];
    const column = (name: string) => { if (!columns[table]?.has(name)) throw new Error('Invalid operations query column'); return name; };
    const value = (v: Value) => { if (v !== null && typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) throw new Error('Invalid operations query value'); values.push(v); return '?'; };
    for (const [name, v] of Object.entries(query.where ?? {})) {
      const key = column(name);
      if (Array.isArray(v)) {
        const nonNull = v.filter(x => x !== null);
        const parts = [...(nonNull.length ? [`${key} IN (${nonNull.map(value).join(',')})`] : []), ...(v.includes(null) ? [`${key} IS NULL`] : [])];
        filters.push(parts.length ? `(${parts.join(' OR ')})` : '0');
      } else filters.push(v === null ? `${key} IS NULL` : `${key}=${value(v as Value)}`);
    }
    for (const [name, list] of Object.entries(query.notIn ?? {})) {
      const key = column(name), nonNull = list.filter(x => x !== null);
      if (nonNull.length) filters.push(`(${key} NOT IN (${nonNull.map(value).join(',')})${list.includes(null) ? '' : ` OR ${key} IS NULL`})`);
      if (list.includes(null)) filters.push(`${key} IS NOT NULL`);
    }
    for (const range of [...(query.range ? [query.range] : []), ...query.ranges ?? []]) {
      const key = column(range.column);
      if (range.from !== undefined) filters.push(`${key}${range.fromInclusive === false ? '>' : '>='}${value(range.from)}`);
      if (range.to !== undefined) filters.push(`${key}${range.toInclusive === true ? '<=' : '<'}${value(range.to)}`);
    }
    const order = query.orderBy?.length ? query.orderBy : [{ column: 'id', direction: 'asc' as const }];
    if (query.afterId !== undefined) {
      if (order.length !== 1 || order[0].column !== 'id' || order[0].direction !== 'asc') throw new Error('ID cursor requires ascending ID order');
      filters.push(`id>${value(query.afterId)}`);
    }
    const limit = query.limit ?? 1000;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error('Invalid operations query limit');
    const orderSql = order.map(item => { if (!['asc', 'desc'].includes(item.direction)) throw new Error('Invalid operations query order'); return `${column(item.column)} ${item.direction.toUpperCase()}`; });
    if (!order.some(item => item.column === 'id')) orderSql.push('id ASC');
    const result = await this.db.prepare(`SELECT * FROM ${tableName(table)} WHERE ${filters.join(' AND ')} ORDER BY ${orderSql.join(',')} LIMIT ?`).bind(...values, limit).all<T>();
    return result.results;
  }

  async transact(expectedRevision: number, writes: Write[], options: { maintenance?: boolean } = {}): Promise<boolean> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Invalid expected revision');
    if (!writes.length) throw new Error('A transaction must contain a mutation');
    const operationId = crypto.randomUUID();
    const guard = 'EXISTS(SELECT 1 FROM ops_v2_meta WHERE environment=? AND operation_id=?)';
    const statements = [this.db.prepare("UPDATE ops_v2_meta SET revision=revision+1,operation_id=? WHERE environment=? AND revision=? AND (?=1 OR NOT EXISTS(SELECT 1 FROM ops_v2_maintenance WHERE environment=? AND id='restore' AND COALESCE(json_extract(payload,'$.status'),'pending')<>'complete'))")
      .bind(operationId, this.environment, expectedRevision, options.maintenance ? 1 : 0, this.environment)];
    for (const write of writes) {
      const table = tableName(write.table);
      if (write.type === 'delete') {
        statements.push(this.db.prepare(`DELETE FROM ${table} WHERE environment=? AND id=? AND ${guard}`)
          .bind(this.environment, write.id, this.environment, operationId));
      } else if (write.type === 'update') {
        const entries = fields(write.table, write.values, false);
        statements.push(this.db.prepare(`UPDATE ${table} SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE environment=? AND id=? AND ${guard}`)
          .bind(...entries.map(([, value]) => value), this.environment, write.id, this.environment, operationId));
      } else {
        const entries = fields(write.table, write.values);
        const updates = entries.filter(([key]) => key !== 'id').map(([key]) => `${key}=excluded.${key}`);
        const conflict = write.type === 'upsert' ? ` ON CONFLICT(environment,id) DO UPDATE SET ${updates.join(',')}` : '';
        if (write.type === 'upsert' && !updates.length) throw new Error('An upsert needs data columns');
        statements.push(this.db.prepare(`INSERT INTO ${table}(environment,${entries.map(([key]) => key).join(',')}) SELECT ${entries.map(() => '?').join(',')},? WHERE ${guard}${conflict}`)
          .bind(this.environment, ...entries.map(([, value]) => value), this.environment, operationId));
      }
    }
    const result = await this.db.batch(statements);
    return result[0].meta.changes === 1;
  }
}
