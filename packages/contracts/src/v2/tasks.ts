import { z } from 'zod';
import { id, timestamp, version, uuid, note, meta, pagination, evidenceIds } from './common.ts';
import { actorSchema } from './operations.ts';
import { servingReason } from './serving.ts';

export const taskStatus = z.enum(['open', 'claimed', 'verifying', 'resolved', 'deferred', 'cancelled']);
export const taskStatusLabels = { open: '待处理', claimed: '已接手', verifying: '等待核验', resolved: '已完成', deferred: '已暂缓', cancelled: '已取消' } satisfies Record<z.infer<typeof taskStatus>, string>;
export const responsibility = z.enum(['kitchen', 'front', 'unassigned']);
export const responsibilityLabels = { kitchen: '后厨', front: '前厅', unassigned: '待分派' } satisfies Record<z.infer<typeof responsibility>, string>;
export const priority = z.enum(['normal', 'high', 'urgent']);
export const priorityLabels = { normal: '普通', high: '优先', urgent: '紧急' } satisfies Record<z.infer<typeof priority>, string>;
export const verificationMethod = z.enum(['measurement', 'manual', 'automatic']);
export const verificationLabels = { measurement: '称重及操作核验', manual: '人工核实', automatic: '后厨处理段自动核验' } satisfies Record<z.infer<typeof verificationMethod>, string>;
export const taskAction = z.enum(['claim', 'defer', 'handoff', 'report_complete', 'verify_manual', 'cancel']);
export const taskActionLabels = { claim: '接手', defer: '暂缓', handoff: '交接', report_complete: '报告完成', verify_manual: '人工核实完成', cancel: '取消' } satisfies Record<z.infer<typeof taskAction>, string>;
const actionBase = { requestId: uuid, expectedVersion: version };
export const taskActionRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...actionBase, action: z.literal('claim') }).strict(),
  z.object({ ...actionBase, action: z.literal('defer'), until: timestamp, reason: note }).strict(),
  z.object({ ...actionBase, action: z.literal('handoff'), responsibility: z.enum(['kitchen', 'front']), reason: note }).strict(),
  z.object({ ...actionBase, action: z.literal('report_complete'), operationId: id }).strict(),
  z.object({ ...actionBase, action: z.literal('verify_manual'), reason: note, evidenceIds }).strict(),
  z.object({ ...actionBase, action: z.literal('cancel'), reason: note }).strict(),
]);
export const taskSchema = z.object({
  id, bindingId: id, status: taskStatus, priority, responsibility, assignee: actorSchema.nullable(),
  version, deferUntil: timestamp.nullable(), verificationMethod: verificationMethod.nullable(),
  allowedActions: z.array(taskAction).refine(a => new Set(a).size === a.length, '动作不能重复'),
  reasonCodes: z.array(servingReason), createdAt: timestamp, updatedAt: timestamp,
}).strict().superRefine((v, ctx) => {
  if ((v.status === 'deferred') !== (v.deferUntil !== null)) ctx.addIssue({ code: 'custom', path: ['deferUntil'], message: '仅暂缓任务需要暂缓到期时间' });
  if ((v.status === 'resolved') !== (v.verificationMethod !== null)) ctx.addIssue({ code: 'custom', path: ['verificationMethod'], message: '仅完成任务需要核验方式' });
  if (['resolved', 'cancelled'].includes(v.status) && v.allowedActions.length) ctx.addIssue({ code: 'custom', path: ['allowedActions'], message: '已关闭任务不能继续操作' });
  if (['claimed', 'verifying'].includes(v.status) && !v.assignee) ctx.addIssue({ code: 'custom', path: ['assignee'], message: '已接手任务需要接手身份' });
  if (Date.parse(v.updatedAt) < Date.parse(v.createdAt)) ctx.addIssue({ code: 'custom', path: ['updatedAt'], message: '更新时间不能早于创建时间' });
});
export const tasksQuerySchema = z.object({ ...pagination, responsibility: responsibility.optional(), status: taskStatus.optional(), priority: priority.optional(), bindingId: id.optional() }).strict();
export const tasksResponseSchema = z.object({ ...meta, rows: z.array(taskSchema), nextCursor: z.string().nullable() }).strict();
export const taskResponseSchema = z.object({ ...meta, task: taskSchema }).strict();
export const taskSystemHistorySchema = z.object({
  at: timestamp, event: z.enum(['auto_refill_verified', 'auto_evidence_invalidated', 'created', 'upgraded', 'defer_expired', 'measurement_verified', 'binding_closed', 'reevaluated']),
  fromVersion: version.nullable(), toVersion: version, evidenceIds,
}).strict();
export const taskDetailResponseSchema = z.object({ ...meta, task: taskSchema, history: z.array(z.object({
  requestId: uuid, actor: actorSchema, at: timestamp, input: taskActionRequestSchema, beforeVersion: version, afterVersion: version,
}).strict()), evidenceIds, deferLimitSeconds: z.number().int().positive().max(86400).nullable().default(null), systemHistory: z.array(taskSystemHistorySchema).default([]) }).strict();
export type RefillTask = z.infer<typeof taskSchema>;
export type TaskActionRequest = z.infer<typeof taskActionRequestSchema>;
