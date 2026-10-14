import { z } from 'zod';
import { id, meta, timestamp, uuid, version } from './common.ts';

const count = z.number().int().nonnegative();
export const retentionConfigSchema = z.object({ enabled: z.boolean(), rawRetentionHours: z.number().int().min(24).max(8760) }).strict();
export const retentionPolicySchema = z.object({ version, updatedAt: timestamp.nullable(), config: retentionConfigSchema }).strict();
export const retentionRunSchema = z.object({ startedAt: timestamp, completedAt: timestamp.nullable(), cutoffAt: timestamp, deletedSamples: count, protectedSamples: count, status: z.enum(['complete', 'failed', 'cancelled']), errorCode: z.enum(['CLEANUP_FAILED']).nullable() }).strict();
export const retentionResponseSchema = z.object({ ...meta, policy: retentionPolicySchema, lastRun: retentionRunSchema.nullable() }).strict();
export const retentionWriteSchema = z.object({ requestId: uuid, expectedVersion: version, config: retentionConfigSchema }).strict();
export const schedulerRunSchema = z.object({ runId: uuid, startedAt: timestamp, completedAt: timestamp.nullable(), status: z.enum(['running', 'complete', 'failed']), errorCode: z.enum(['SCHEDULER_FAILED']).nullable() }).strict();
export const runtimeResponseSchema = z.object({
  ...meta,
  scheduler: schedulerRunSchema.nullable(),
  jobs: z.object({ pending: count, running: count, failed: count, complete: count, oldestPendingAt: timestamp.nullable() }).strict(),
  pendingCycles: count, activeTasks: count,
  failedJobs: z.array(z.object({ id, attempts: count, requestedAt: timestamp, nextRunAt: timestamp.nullable(), code: z.literal('PROJECTION_FAILED') }).strict()).max(50),
  failedJobsTruncated: z.boolean(),
}).strict();
