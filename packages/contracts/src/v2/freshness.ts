import { z } from 'zod';
import { id, timestamp, uuid, version, grams, meta, environment, pagination, dateRange, checkDateRange, quantityStatus } from './common.ts';
import { actorSchema, disposition, removalReason, operationStatus } from './operations.ts';

export const freshnessRuleConfigSchema = z.object({ enabled: z.boolean(), warnAfterMinutes: z.number().int().min(1).max(10080), expireAfterMinutes: z.number().int().min(1).max(10080) }).strict().refine(v => v.warnAfterMinutes < v.expireAfterMinutes, '提醒时限必须早于撤下时限');
export const freshnessRuleSchema = z.object({ dishId: id, version, updatedAt: timestamp, config: freshnessRuleConfigSchema }).strict();
export const freshnessRuleWriteSchema = z.object({ requestId: uuid, expectedVersion: version, config: freshnessRuleConfigSchema }).strict();
export const freshnessRulesResponseSchema = z.object({ ...meta, environment, source: z.literal('operations_v2'), rules: z.array(freshnessRuleSchema) }).strict();
export const freshnessRuleResponseSchema = z.object({ ...meta, rule: freshnessRuleSchema }).strict();
export const freshnessStartSchema = z.object({ requestId: uuid, bindingId: id, expectedBindingVersion: version, startedAt: timestamp, openingFoodG: grams.nullable() }).strict();
export const freshnessBatchQuerySchema = z.object({ ...pagination, status: z.enum(['active', 'closed', 'all']).default('active'), dishId: id.optional(), bindingId: id.optional() }).strict();
export const freshnessBatchSchema = z.object({
  id, bindingId: id, scaleId: id, dishId: id, dishName: z.string().min(1).max(100), startedAt: timestamp, closedAt: timestamp.nullable(), openingFoodG: grams.nullable(),
  status: z.enum(['active', 'closed']), state: z.enum(['unconfigured', 'fresh', 'warning', 'expired', 'closed']),
  elapsedMinutes: z.number().finite().nonnegative(), ruleVersion: version.nullable(), warningAt: timestamp.nullable(), expiresAt: timestamp.nullable(),
  origin: z.enum(['manual', 'replacement']),
}).strict();
export const freshnessBatchesResponseSchema = z.object({ ...meta, environment, source: z.literal('operations_v2'), batches: z.array(freshnessBatchSchema), nextCursor: z.string().nullable() }).strict();
export const freshnessStartResponseSchema = z.object({ ...meta, batch: freshnessBatchSchema, bindingVersion: version }).strict();
export const freshnessRemovalsQuerySchema = z.object({ ...dateRange, ...pagination, dishId: id.optional() }).strict().superRefine(checkDateRange);
export const freshnessRemovalSchema = z.object({
  id, operationId: id, bindingId: id, batchId: id.nullable(), dishId: id, dishName: z.string().min(1).max(100), occurredAt: timestamp,
  disposition, reason: removalReason, quantityStatus, weightG: grams.nullable(), actor: actorSchema, status: operationStatus,
  correctsOperationId: id.nullable(), effective: z.boolean(),
}).strict();
export const freshnessRemovalsResponseSchema = z.object({ ...meta, environment, source: z.literal('operations_v2'), rows: z.array(freshnessRemovalSchema), nextCursor: z.string().nullable() }).strict();
export type FreshnessRule = z.infer<typeof freshnessRuleSchema>;
export type FreshnessBatch = z.infer<typeof freshnessBatchSchema>;
export type FreshnessRemoval = z.infer<typeof freshnessRemovalSchema>;
