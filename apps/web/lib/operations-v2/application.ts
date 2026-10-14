import { conveyorServices } from './conveyor.ts';
import { OperationsStore } from './storage.ts';
import { configuredEnvironment, credentialRecord, OperationsError } from './security.ts';
import { createOperationsRouter, operationsFailure } from './router.ts';
import { createSessionHandler } from './session.ts';
import { configurationServices } from './configuration.ts';
import { telemetryServices } from './telemetry.ts';
import { operationServices } from './operations.ts';
import { servingServices } from './serving.ts';
import { taskServices } from './tasks.ts';
import { reportServices } from './reports.ts';
import { compatibilityServices } from './compatibility.ts';
import { evidenceServices } from './evidence.ts';
import { runOperationsJobs } from './projection.ts';
import { systemServices, schedulerHeartbeat } from './system.ts';
import { retentionServices, runRetention } from './retention.ts';
import { aiEvidenceServices } from './intelligence.ts';

export const operationsServices = { ...conveyorServices, ...configurationServices, ...telemetryServices, ...operationServices, ...servingServices, ...taskServices, ...reportServices, ...compatibilityServices, ...evidenceServices, ...systemServices, ...retentionServices, ...aiEvidenceServices };
export async function createOperationsApplication(db: D1Database, options: { environment: unknown; bootstrapToken?: string; clock?: () => string }) {
  const store = new OperationsStore(db, configuredEnvironment(options.environment));
  await store.initialize();
  if (options.bootstrapToken) {
    const record = await credentialRecord({ id: 'bootstrap-manager', token: options.bootstrapToken, role: 'manager', actor: { id: 'bootstrap-manager', kind: 'workstation', label: '初始管理工作站' }, scaleIds: null });
    for (let attempt = 0; attempt < 5; attempt++) {
      const revision = await store.revision();
      if (await store.get('credentials', record.id)) break;
      if (await store.transact(revision, [{ type: 'insert', table: 'credentials', values: record }])) break;
    }
  }
  const clock = options.clock ?? (() => new Date().toISOString()), router = createOperationsRouter(store, operationsServices, clock), session = createSessionHandler(store, clock);
  const ready = async () => { const lock = await store.get<{ payload: string }>('maintenance', 'restore'); return !lock || JSON.parse(lock.payload).status === 'complete'; };
  const jobs = async () => {
    if (!await ready()) throw new OperationsError('UNAVAILABLE');
    const run = { runId: crypto.randomUUID(), startedAt: clock(), completedAt: null, status: 'running' as const, errorCode: null };
    await schedulerHeartbeat(store, run);
    try {
      const result = await runOperationsJobs(store, clock());
      await runRetention(store, clock());
      if (!await ready()) throw new OperationsError('UNAVAILABLE');
      await schedulerHeartbeat(store, { ...run, completedAt: clock(), status: 'complete' });
      return result;
    } catch (error) {
      if (await ready()) await schedulerHeartbeat(store, { ...run, completedAt: clock(), status: 'failed', errorCode: 'SCHEDULER_FAILED' });
      throw error;
    }
  };
  return { store, jobs, async fetch(request: Request, waitUntil?: (job: Promise<unknown>) => void) {
    if (!await ready()) return operationsUnavailable();
    if (new URL(request.url).pathname === '/api/v2/session') { const response = await session(request); return await ready() ? response : operationsUnavailable(); }
    const response = await router(request);
    if (!await ready()) return operationsUnavailable();
    if (response.ok && request.method !== 'GET') {
      const job = jobs();
      if (waitUntil) waitUntil(job);
      else { try { await job; } catch { return operationsUnavailable(); } }
    }
    return await ready() ? response : operationsUnavailable();
  } };
}
export function operationsUnavailable() { return operationsFailure(new OperationsError('UNAVAILABLE')); }
