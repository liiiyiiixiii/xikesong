import type { EndpointContext, OperationsServices } from './router.ts';
import { operationsMeta } from './records.ts';
import { OperationsError } from './security.ts';
import { history } from './projection.ts';
import type { z } from 'zod';
import type { schedulerRunSchema } from '@zhishan/contracts/v2/system';
import type { OperationsStore } from './storage.ts';

export type SchedulerRun = z.infer<typeof schedulerRunSchema>;
const readHeartbeat = (store: OperationsStore) => store.db.prepare('SELECT payload FROM ops_v2_scheduler WHERE environment=?').bind(store.environment).first<{ payload: string }>();
export async function schedulerHeartbeat(store: OperationsStore, run: SchedulerRun) {
  // Runtime liveness is not a business mutation. Polling heartbeats must not
  // invalidate an unchanged report/CSV every five seconds. This environment-
  // scoped diagnostic is durable across restart but excluded from backups.
  await store.db.prepare(`INSERT INTO ops_v2_scheduler(environment,run_id,started_at,payload)
    SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM ops_v2_maintenance WHERE environment=? AND id='restore' AND COALESCE(json_extract(payload,'$.status'),'pending')<>'complete')
    ON CONFLICT(environment) DO UPDATE SET run_id=excluded.run_id,started_at=excluded.started_at,payload=excluded.payload
    WHERE excluded.started_at>=ops_v2_scheduler.started_at AND (?='running' OR excluded.run_id=ops_v2_scheduler.run_id)`)
    .bind(store.environment, run.runId, new Date(run.startedAt).toISOString(), JSON.stringify(run), store.environment, run.status).run();
}
async function runtime(c: EndpointContext<'runtime'>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const revision = await c.store.revision();
    const [rows, cycles, tasks, heartbeat] = await Promise.all([
      history<{ id: string; status: 'pending' | 'running' | 'complete' | 'failed'; attempts: number; payload: string }>(c.store, 'jobs'),
      history<{ id: string }>(c.store, 'cycles', { where: { status: 'pending' } }),
      history<{ id: string }>(c.store, 'tasks', { where: { status: ['open', 'claimed', 'verifying', 'deferred'] } }),
      readHeartbeat(c.store),
    ]);
    const counts = { pending: 0, running: 0, failed: 0, complete: 0 };
    for (const row of rows) counts[row.status]++;
    const failedJobs = rows.filter(row => row.status === 'failed').sort((a, b) => a.id.localeCompare(b.id)).slice(0, 50).map(row => {
      const payload = JSON.parse(row.payload) as { requestedAt: string; nextRunAt?: string };
      return { id: row.id, attempts: row.attempts, requestedAt: payload.requestedAt, nextRunAt: payload.nextRunAt ?? null, code: 'PROJECTION_FAILED' as const };
    });
    const pendingTimes = rows.filter(row => row.status !== 'complete').map(row => (JSON.parse(row.payload) as { requestedAt: string }).requestedAt).sort();
    if (revision !== await c.store.revision()) continue;
    return { ...operationsMeta(c.store, c.now, revision), scheduler: heartbeat ? JSON.parse(heartbeat.payload) as SchedulerRun : null,
      jobs: { ...counts, oldestPendingAt: pendingTimes[0] ?? null }, pendingCycles: cycles.length, activeTasks: tasks.length, failedJobs, failedJobsTruncated: counts.failed > failedJobs.length };
  }
  throw new OperationsError('UNAVAILABLE');
}
export const systemServices = { runtime } satisfies OperationsServices;
