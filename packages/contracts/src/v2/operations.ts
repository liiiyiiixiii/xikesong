import { z } from 'zod';
import { id, scaleId, timestamp, uuid, version, grams, positiveGrams, note, evidenceIds, quantityStatus, checkQuantity, meta, projectionStatus, pagination, dateRange, checkDateRange } from './common.ts';

export const disposition = z.enum(['waste', 'retain']);
export const dispositionLabels = { waste: '报损', retain: '撤下保留' } satisfies Record<z.infer<typeof disposition>, string>;
export const removalReason = z.enum(['display_age', 'closing', 'other']);
export const removalReasonLabels = { display_age: '放置过久', closing: '闭店剩余', other: '其他' } satisfies Record<z.infer<typeof removalReason>, string>;
export const actorSchema = z.object({ id, kind: z.enum(['workstation', 'user', 'system']), label: z.string().min(1).max(100) }).strict();
export const actorKindLabels = { workstation: '工作站', user: '员工', system: '系统' } satisfies Record<z.infer<typeof actorSchema>['kind'], string>;
export const newBindingSchema = z.object({ dishId: id, containerRef: id.nullable(), tareG: positiveGrams, fullFoodG: positiveGrams }).strict();
export const newBatchSchema = z.object({ startedAt: timestamp, openingFoodG: grams.nullable() }).strict();
const operationBase = {
  requestId: uuid, bindingId: id, occurredAt: timestamp, quantityStatus, weightG: grams.nullable(),
  evidenceIds, note,
  correctsOperationId: id.optional(), expectedVersion: version.optional(),
};
const removalFields = { disposition, reason: removalReason, expectedBindingVersion: version, freshnessBatchId: id.nullable() };
export const operationRequestSchema = z.discriminatedUnion('type', [
  z.object({ ...operationBase, type: z.literal('food_refill') }).strict(),
  z.object({ ...operationBase, type: z.literal('ice_add') }).strict(),
  z.object({ ...operationBase, type: z.literal('drain') }).strict(),
  z.object({ ...operationBase, type: z.literal('partial_remove'), ...removalFields }).strict(),
  z.object({ ...operationBase, type: z.literal('remove_container'), ...removalFields }).strict(),
  z.object({ ...operationBase, type: z.literal('replace_container'), ...removalFields, newBinding: newBindingSchema, newBatch: newBatchSchema.nullable() }).strict(),
]).superRefine((v, ctx) => {
  checkQuantity(v, ctx);
  if (!!v.correctsOperationId !== (v.expectedVersion !== undefined)) ctx.addIssue({ code: 'custom', path: ['expectedVersion'], message: '更正操作必须同时指定原操作和版本；新增操作不传原版本' });
  if (['food_refill', 'ice_add', 'drain', 'partial_remove'].includes(v.type) && v.weightG === 0) ctx.addIssue({ code: 'custom', path: ['weightG'], message: '该操作重量应大于零或明确未知' });
  if (v.type === 'replace_container' && v.newBatch && Date.parse(v.newBatch.startedAt) < Date.parse(v.occurredAt)) ctx.addIssue({ code: 'custom', path: ['newBatch', 'startedAt'], message: '新批次不得早于换盘操作' });
});
export const operationTypeLabels = { food_refill: '补菜', ice_add: '加冰', drain: '排水', partial_remove: '部分撤菜', remove_container: '整盘撤下', replace_container: '换盘' } satisfies Record<z.infer<typeof operationRequestSchema>['type'], string>;
export const operationStatus = z.enum(['recorded', 'matched', 'pending_review']);
export const operationStatusLabels = { recorded: '已登记', matched: '已匹配观测', pending_review: '待核实' } satisfies Record<z.infer<typeof operationStatus>, string>;
export const operationRecordSchema = z.object({
  id, version, input: operationRequestSchema, actor: actorSchema, recordedAt: timestamp, status: operationStatus,
}).strict();
export const operationResponseSchema = z.object({ ...meta, operation: operationRecordSchema, affectedCycleIds: z.array(id).max(100), projectionStatus }).strict();
export const operationHistoryQuerySchema = z.object({ ...pagination, ...dateRange, bindingId: id.optional() }).strict().superRefine(checkDateRange);
export const operationHistoryResponseSchema = z.object({ ...meta, records: z.array(z.object({ operation: operationRecordSchema, effective: z.boolean() }).strict()), nextCursor: z.string().nullable() }).strict();
export const boundaryRequestSchema = z.object({ requestId: uuid, bindingId: id, occurredAt: timestamp, type: z.enum(['exit_kitchen', 'enter_kitchen']), note }).strict();
export const boundaryResponseSchema = z.object({ ...meta, eventId: uuid, origin: z.literal('manual'), cycleId: id.nullable(), processingStatus: z.enum(['applied', 'waiting_sample', 'pending_review']) }).strict();
export const cycleStatus = z.enum(['open', 'pending', 'confirmed', 'invalidated']);
export const cycleStatusLabels = { open: '进行中', pending: '待核实', confirmed: '已确认', invalidated: '已作废' } satisfies Record<z.infer<typeof cycleStatus>, string>;
export const cycleReason = z.enum(['MISSING_EXIT', 'MISSING_RETURN', 'BOUNDARY_CONFLICT', 'MISSING_SAMPLE', 'DATA_GAP', 'BINDING_CHANGED', 'UNKNOWN_OPERATION', 'NEGATIVE_BALANCE', 'CROSS_DAY']);
export const cycleReasonLabels = { MISSING_EXIT: '缺少出口', MISSING_RETURN: '缺少入口', BOUNDARY_CONFLICT: '边界冲突', MISSING_SAMPLE: '缺少边界读数', DATA_GAP: '观测中断', BINDING_CHANGED: '绑定变化', UNKNOWN_OPERATION: '操作量未知', NEGATIVE_BALANCE: '质量平衡为负', CROSS_DAY: '跨日轮次' } satisfies Record<z.infer<typeof cycleReason>, string>;
export const cycleSchema = z.object({
  id, bindingId: id, scaleId, dishId: id, version, status: cycleStatus,
  exitEventId: uuid.nullable(), returnEventId: uuid.nullable(),
  exitedAt: timestamp.nullable(), returnedAt: timestamp.nullable(), outG: grams.nullable(), inG: grams.nullable(),
  confirmedTakeG: grams.nullable(), effectiveAt: timestamp.nullable(),
  method: z.literal('cycle_balance_v2'), qualityReasons: z.array(cycleReason), evidenceIds,
}).strict().superRefine((v, ctx) => {
  if (v.status === 'confirmed' && [v.exitEventId, v.returnEventId, v.exitedAt, v.returnedAt, v.outG, v.inG, v.confirmedTakeG, v.effectiveAt].some(x => x === null)) ctx.addIssue({ code: 'custom', message: '确认轮次需要完整边界与计量依据' });
  if (v.status !== 'confirmed' && v.confirmedTakeG !== null) ctx.addIssue({ code: 'custom', path: ['confirmedTakeG'], message: '未确认轮次不能返回确认取用量' });
  if (v.exitedAt && v.returnedAt && Date.parse(v.returnedAt) <= Date.parse(v.exitedAt)) ctx.addIssue({ code: 'custom', path: ['returnedAt'], message: '回后厨应晚于出后厨' });
});
export const cycleQuerySchema = z.object({ ...pagination, ...dateRange, scaleId: scaleId.optional(), dishId: id.optional(), status: cycleStatus.optional() }).strict().superRefine(checkDateRange);
export const cyclesResponseSchema = z.object({ ...meta, rows: z.array(cycleSchema), nextCursor: z.string().nullable() }).strict();
export const cycleDetailResponseSchema = z.object({ ...meta, cycle: cycleSchema, operations: z.array(operationRecordSchema), revisions: z.array(cycleSchema) }).strict();
export const cycleReviewDecision = z.enum(['confirm', 'keep_pending', 'invalidate']);
export const cycleReviewLabels = { confirm: '确认', keep_pending: '保留待核实', invalidate: '作废' } satisfies Record<z.infer<typeof cycleReviewDecision>, string>;
export const cycleReviewRequestSchema = z.object({ requestId: uuid, expectedVersion: version, decision: cycleReviewDecision, evidenceIds, note }).strict().superRefine((v, ctx) => {
  if (v.decision === 'confirm' && !v.evidenceIds.length) ctx.addIssue({ code: 'custom', path: ['evidenceIds'], message: '确认需要核对依据' });
});
export const cycleReviewResponseSchema = z.object({ ...meta, cycle: cycleSchema, projectionStatus }).strict();
export type OperationRequest = z.infer<typeof operationRequestSchema>;
export type Cycle = z.infer<typeof cycleSchema>;
