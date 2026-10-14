import { z } from 'zod';
import { CONTRACT_VERSION } from '@zhishan/contracts/v2/common';
import { operationRecordSchema, type Cycle } from '@zhishan/contracts/v2/operations';
import { ruleSchema, diagnosticsResponseSchema } from '@zhishan/contracts/v2/serving';
import { taskDetailResponseSchema, type RefillTask } from '@zhishan/contracts/v2/tasks';
import type { MeasurementBinding, MeasurementConfig, MeasurementProjection, CycleCalculation } from './measurement.ts';
import { OperationsError, tokenHash, type Principal } from './security.ts';
import type { OperationsStore, Write } from './storage.ts';

export type Rule = z.infer<typeof ruleSchema>;
export type OperationRecord = z.infer<typeof operationRecordSchema>;
export type TaskHistory = z.infer<typeof taskDetailResponseSchema>['history'][number];
type Diagnostics = z.infer<typeof diagnosticsResponseSchema>['devices'][number];
export interface DevicePayload {
  id: string; name: string; enabled: boolean; positionOrder: number | null;
  bindingId: string | null; measurement: MeasurementConfig | null; createdAt: string; updatedAt: string;
  diagnostics: Pick<Diagnostics, 'countsSince' | 'accepted' | 'duplicate' | 'rejected' | 'lastCode' | 'fault'>;
}
export type BindingPayload = MeasurementBinding & { dishName: string; containerRef: string | null; version: number; freshnessBatchId: string | null; measurement?: MeasurementConfig | null };
export type LatestPayload = { bindingId: string; observation: MeasurementProjection['observation'] };
export type CyclePayload = { cycle: Cycle; calculation: CycleCalculation; revisions: Cycle[] };
export type LedgerPayload = { cycle: Cycle; calculation: CycleCalculation; dishName: string; recordedAt: string };
export type TaskPayload = { task: RefillTask; completionOperationId: string | null; completionVisitId?: string; completionVisitVersion?: number; evidenceIds: string[]; systemHistory?: z.infer<typeof taskDetailResponseSchema>['systemHistory'] };
export type Row<T> = { id: string; payload: string } & { readonly __payloadType?: T };
export type LatestRow = Row<LatestPayload> & { sampled_at: string; received_at: string };
export type LedgerRow = Row<LedgerPayload> & { cycle_id: string; version: number; current: number; effective_at: string; weight_mg: number | null };
export const decode = <T>(row: Row<T>): T => JSON.parse(row.payload) as T;
export const distinct = <T>(values: T[]) => [...new Set(values)];
export function operationsMeta(store: OperationsStore, now: string, revision: number) {
  return { contractVersion: CONTRACT_VERSION, serverAt: now, dataRevision: `${store.environment}:${store.generation}:${revision}` };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value);
}
type Receipt<T> = { caller_id: string; request_id: string; payload_hash: string; payload: string } & Row<T>;
export type MutationContext = { store: OperationsStore; principal: Principal; now: string };
/** Identity, body and response commit with the business mutation. A retry never reruns an already committed action. */
export async function mutate<T>(context: MutationContext, scope: string, requestId: string, input: unknown,
  prepare: (revision: number) => Promise<{ writes: Write[]; response: T }>): Promise<T> {
  const { store, principal, now } = context;
  if (principal.environment !== store.environment) throw new OperationsError('FORBIDDEN');
  const caller = { credentialId: principal.credentialId, environment: principal.environment, role: principal.role, actor: principal.actor, scaleIds: principal.scaleIds, ...(principal.trackIds?.length ? {trackIds:principal.trackIds} : {}) };
  const signature = await tokenHash(canonical({ scope, caller, input }));
  const id = `${principal.credentialId}:${requestId}`;
  const completed = async () => {
    const receipt = await store.get<Receipt<T>>('receipts', id);
    if (receipt) {
      if (receipt.caller_id !== principal.credentialId || receipt.request_id !== requestId || receipt.payload_hash !== signature) throw new OperationsError('ID_CONFLICT');
      return { response: (JSON.parse(receipt.payload) as { response: T }).response };
    }
    return null;
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const receipt = await completed();
    if (receipt) return receipt.response;
    const revision = await store.revision();
    try {
      const prepared = await prepare(revision);
      const receiptWrite: Write = { type: 'insert', table: 'receipts', values: {
        id, caller_id: principal.credentialId, request_id: requestId, payload_hash: signature, created_at: now,
        payload: JSON.stringify({ scope, caller, signature, response: prepared.response }),
      } };
      if (await store.transact(revision, [...prepared.writes, receiptWrite])) return prepared.response;
    } catch (error) {
      // Another copy can commit after our initial receipt read. Recheck before
      // reporting a now-stale object version or other preparation failure.
      const committed = await completed();
      if (committed) return committed.response;
      if (await store.revision() === revision) throw error;
    }
  }
  throw new OperationsError('UNAVAILABLE');
}
