import { z } from 'zod';
import { timestamp } from '@zhishan/contracts/v2/common';
import { retentionPolicySchema, retentionRunSchema } from '@zhishan/contracts/v2/system';
import { history } from './projection.ts';
import { decode, mutate, operationsMeta, type BindingPayload, type Row } from './records.ts';
import { OperationsError } from './security.ts';
import type { EndpointContext, OperationsServices } from './router.ts';
import type { OperationsStore, OperationsTable, Write } from './storage.ts';

type Policy = z.infer<typeof retentionPolicySchema>;
type Run = z.infer<typeof retentionRunSchema>;
type Lease = { id: string; policyVersion: number; startedAt: string; cutoffAt: string; leaseUntil: string;
  afterId?: string; deletedSamples: number; protectedSamples: number };
type State = { policy: Policy; lastRun: Run | null; lastRunPolicyVersion?: number; running?: Lease };
type SampleRow = { id: string; scale_id: string; boot_id: string; sequence: number; sampled_at: string; received_at: string; payload_hash: string; payload: string };
const freshState = (): State => ({ policy: { version: 0, updatedAt: null, config: { enabled: false, rawRetentionHours: 24 } }, lastRun: null });
const readState = async (store: OperationsStore): Promise<State> => {
  const row = await store.get<Row<State>>('system', 'retention');
  if (!row) return freshState();
  const state = decode(row);
  retentionPolicySchema.parse(state.policy);
  if (state.lastRun) retentionRunSchema.parse(state.lastRun);
  return state;
};
const stateWrite = (state: State, now: string): Write => ({ type: 'upsert', table: 'system', values: {
  id: 'retention', updated_at: now, payload: JSON.stringify(state),
} });
const snapshot = async (store: OperationsStore, now: string) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const revision = await store.revision(), state = await readState(store);
    if (revision === await store.revision()) return { ...operationsMeta(store, now, revision), policy: state.policy, lastRun: state.lastRun };
  }
  throw new OperationsError('UNAVAILABLE');
};

export const retentionServices = {
  retention: async (c: EndpointContext<'retention'>) => snapshot(c.store, c.now),
  saveRetention: async (c: EndpointContext<'saveRetention'>) => mutate(c, 'retention.save', c.body.requestId, c.body, async revision => {
    const state = await readState(c.store);
    if (state.policy.version !== c.body.expectedVersion) throw new OperationsError('VERSION_CONFLICT', state.policy.version);
    const policy = retentionPolicySchema.parse({ version: state.policy.version + 1, updatedAt: c.now, config: c.body.config });
    // Invalidate the old lease atomically. A worker rechecks policy + lease at
    // every bounded batch and cannot keep deleting after a manager disables it.
    const lastRun = state.running ? { ...completed(state.running, c.now), status: 'cancelled' as const } : state.lastRun;
    return { writes: [stateWrite({ policy, lastRun, lastRunPolicyVersion: state.running?.policyVersion ?? state.lastRunPolicyVersion }, c.now)], response: { ...operationsMeta(c.store, c.now, revision + 1), policy, lastRun } };
  }),
} satisfies OperationsServices;

function completed(run: Lease, now: string, failed = false): Run {
  return { startedAt: run.startedAt, completedAt: now, cutoffAt: run.cutoffAt, deletedSamples: run.deletedSamples,
    protectedSamples: run.protectedSamples, status: failed ? 'failed' : 'complete', errorCode: failed ? 'CLEANUP_FAILED' : null };
}

/** Evidence IDs can be nested in immutable ledger versions, cycle revisions,
 * calculation bundles, task actions or operation inputs. Do not truncate at the
 * public cycle's 100-ID bundle marker. Unknown formats fail closed below. */
function evidence(value: unknown, ids: Set<string>) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const child of value) evidence(child, ids); return; }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'evidenceIds') {
      if (!Array.isArray(child) || child.some(id => typeof id !== 'string')) throw new Error('Invalid evidence record');
      for (const id of child) ids.add(id);
    } else if (['sampleId', 'beforeSampleId', 'afterSampleId'].includes(key) && typeof child === 'string') ids.add(child);
    else evidence(child, ids);
  }
}

async function protection(store: OperationsStore) {
  const protectedIds = new Set<string>(), protectedBindings = new Set<string>(), sampleRefs = new Set<string>();
  const bindings = (await history<Row<BindingPayload>>(store, 'bindings')).map(decode);
  // The measurement core reconstructs composition/continuity over the whole
  // active binding. Keep that history until a future checkpoint protocol exists.
  for (const binding of bindings) if (binding.validTo === null || !binding.measurement) protectedBindings.add(binding.id);
  const tables: OperationsTable[] = ['kitchen_visits', 'cycles', 'ledger', 'operations', 'cycle_reviews', 'latest', 'weight_changes', 'serving_projection', 'serving_intervals', 'tasks', 'task_actions', 'freshness_actions', 'device_events', 'jobs'];
  for (const table of tables) {
    for (const row of await history<{ id: string; binding_id?: string; status?: string; payload: string }>(store, table)) {
      const payload = JSON.parse(row.payload);
      evidence(payload, protectedIds);
      if(table==='kitchen_visits'&&['processing','pending','exception'].includes(payload.current.status))protectedBindings.add(row.binding_id!);
      if (table === 'cycles' && ['pending', 'open'].includes(row.status ?? '')) protectedBindings.add(row.binding_id!);
      if (table === 'operations' && payload.status !== 'matched') protectedBindings.add(payload.input.bindingId);
      if (table === 'tasks' && !['resolved', 'cancelled'].includes(row.status ?? '')) protectedBindings.add(row.binding_id!);
      if (table === 'jobs' && row.status !== 'complete') protectedBindings.add(payload.bindingId);
      if (table === 'device_events' && payload.event?.sampleRef) {
        const e = payload.event;
        sampleRefs.add(JSON.stringify([e.scaleId, e.sampleRef.bootId, e.sampleRef.sequence]));
      }
    }
  }
  return (sample: SampleRow) => protectedIds.has(sample.id) || sampleRefs.has(JSON.stringify([sample.scale_id, sample.boot_id, sample.sequence])) || bindings.some(binding =>
    protectedBindings.has(binding.id) && sample.scale_id === binding.scaleId && Date.parse(sample.sampled_at) >= Date.parse(binding.validFrom) &&
    (binding.validTo === null || Date.parse(sample.sampled_at) < Date.parse(binding.validTo)));
}

/** Only explicitly initialized, environment-scoped OPS storage is accepted.
 * Disabled by default. Sample time AND receipt time must have expired. Each
 * bounded batch commits deletion, identity tombstones and progress under the
 * same revision CAS; normal transact also respects an incomplete restore lock.
 * No operation, boundary, cycle/ledger version or evidence summary is deleted. */
export async function runRetention(store: OperationsStore, now = new Date().toISOString()): Promise<Run | null> {
  timestamp.parse(now);
  const time = Date.parse(now), leaseId = crypto.randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const revision = await store.revision(), state = await readState(store);
    if (!state.policy.config.enabled) return state.lastRun;
    if (state.running && Date.parse(state.running.leaseUntil) > time) return state.lastRun;
    // A completed sweep runs at most hourly, even if serving ingestion schedules
    // jobs every few seconds. Policy changes remain immediately effective.
    if (!state.running && state.lastRun?.status === 'complete' && state.lastRunPolicyVersion === state.policy.version &&
      Date.parse(state.lastRun.completedAt ?? state.lastRun.startedAt) + 3600000 > time) return state.lastRun;
    const running: Lease = state.running?.policyVersion === state.policy.version ? { ...state.running, id: leaseId, leaseUntil: new Date(time + 60000).toISOString() } : { id: leaseId, policyVersion: state.policy.version, startedAt: now,
      cutoffAt: new Date(time - state.policy.config.rawRetentionHours * 3600000).toISOString(),
      leaseUntil: new Date(time + 60000).toISOString(), deletedSamples: 0, protectedSamples: 0 };
    if (await store.transact(revision, [stateWrite({ ...state, running }, now)])) { acquired = true; break; }
  }
  if (!acquired) throw new OperationsError('UNAVAILABLE');
  try {
    let retries = 0, batches = 0, protectedAtRevision = -1;
    let keep: ((sample: SampleRow) => boolean) | null = null;
    for (;;) {
      const revision = await store.revision(), state = await readState(store), run = state.running;
      if (!run || run.id !== leaseId || run.policyVersion !== state.policy.version || !state.policy.config.enabled) return state.lastRun;
      const page = await store.query<SampleRow>('samples', { ranges: [{ column: 'sampled_at', to: run.cutoffAt }, { column: 'received_at', to: run.cutoffAt }], afterId: run.afterId, limit: 50 });
      // Own progress writes never change evidence references. Reuse this read
      // only while the global revision proves nobody else has mutated them.
      if (!keep || protectedAtRevision !== revision) keep = await protection(store);
      const writes: Write[] = [];
      const progress = { ...run };
      for (const sample of page) {
        if (keep(sample)) { progress.protectedSamples++; continue; }
        // The tombstone deliberately excludes raw weight/measurement payload.
        writes.push({ type: 'insert', table: 'sample_tombstones', values: { id: sample.id, scale_id: sample.scale_id, boot_id: sample.boot_id,
          sequence: sample.sequence, sampled_at: sample.sampled_at, payload_hash: sample.payload_hash, payload: JSON.stringify({ purgedAt: now, receivedAt: sample.received_at }) } });
        writes.push({ type: 'delete', table: 'samples', id: sample.id });
        progress.deletedSamples++;
      }
      const done = page.length < 50;
      progress.afterId = page.at(-1)?.id ?? progress.afterId;
      const yieldRun = !done && batches + 1 >= 10;
      progress.leaseUntil = yieldRun ? now : new Date(time + 60000).toISOString();
      const lastRun = done ? completed(progress, now) : state.lastRun;
      writes.push(stateWrite({ policy: state.policy, lastRun, lastRunPolicyVersion: done ? run.policyVersion : state.lastRunPolicyVersion, ...(done ? {} : { running: progress }) }, now));
      if (!await store.transact(revision, writes)) {
        if (++retries >= 8) throw new Error('Retention contention');
        continue;
      }
      retries = 0; batches++; protectedAtRevision = revision + 1;
      if (done) return lastRun;
      if (yieldRun) return state.lastRun;
    }
  } catch (error) {
    // Retain the lease and prior counters if storage is unavailable or locked;
    // a later scheduler can detect an expired interrupted run and resume safely.
    for (let attempt = 0; attempt < 5; attempt++) {
      const revision = await store.revision(), state = await readState(store);
      if (!state.running || state.running.id !== leaseId) break;
      if (await store.transact(revision, [stateWrite({ policy: state.policy, lastRun: completed(state.running, now, true), lastRunPolicyVersion: state.running.policyVersion }, now)])) break;
    }
    throw error;
  }
}
