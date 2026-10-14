import { z } from 'zod';
import { CONTRACT_VERSION, limits, scaleId, bootId, sequence, timestamp, grams, uuid } from './common.ts';

const identity = { scaleId, bootId, sequence, sampledAt: timestamp };
export const measurementLabels = { ok: '正常', fault: '故障', overload: '超载' } as const;
export const sampleSchema = z.discriminatedUnion('measurementStatus', [
  z.object({ ...identity, measurementStatus: z.literal('ok'), grossG: grams }).strict(),
  z.object({ ...identity, measurementStatus: z.literal('fault'), grossG: z.null() }).strict(),
  z.object({ ...identity, measurementStatus: z.literal('overload'), grossG: z.null() }).strict(),
]);
export const samplesRequestSchema = z.object({ version: z.literal(2), batchId: uuid, samples: z.array(sampleSchema).min(1).max(limits.samples) }).strict();
export const sampleRefSchema = z.object({ bootId, sequence }).strict();
export const deviceReason = z.enum(['sensor_fault', 'overload', 'clock_unsynced', 'other']);
export const deviceReasonLabels = { sensor_fault: '读数故障', overload: '超载', clock_unsynced: '时钟未同步', other: '其他' } satisfies Record<z.infer<typeof deviceReason>, string>;
const eventBase = { eventId: uuid, scaleId, bootId, eventSequence: sequence, occurredAt: timestamp };
export const deviceEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('exit_kitchen'), sampleRef: sampleRefSchema.optional() }).strict(),
  z.object({ ...eventBase, type: z.literal('enter_kitchen'), sampleRef: sampleRefSchema.optional() }).strict(),
  z.object({ ...eventBase, type: z.literal('device_fault'), reasonCode: deviceReason }).strict(),
  z.object({ ...eventBase, type: z.literal('device_recovered'), reasonCode: deviceReason.optional() }).strict(),
]);
export const deviceEventLabels = { exit_kitchen: '出后厨', enter_kitchen: '回后厨', device_fault: '设备故障', device_recovered: '设备恢复' } satisfies Record<z.infer<typeof deviceEventSchema>['type'], string>;
export const eventsRequestSchema = z.object({ version: z.literal(2), batchId: uuid, events: z.array(deviceEventSchema).min(1).max(limits.events) }).strict();
export const receiptDefinitions = {
  STORED: { status: 'accepted', retryable: false, label: '已保存' },
  DUPLICATE: { status: 'duplicate', retryable: false, label: '重复报文' },
  OLD_SEQUENCE: { status: 'ignored', retryable: false, label: '旧序号' },
  OLD_BOOT: { status: 'ignored', retryable: false, label: '旧启动' },
  LATE_SAMPLE: { status: 'accepted', retryable: false, label: '已保存迟到观测' },
  UNKNOWN_DEVICE: { status: 'rejected', retryable: false, label: '设备未配置' },
  DEVICE_DISABLED: { status: 'rejected', retryable: false, label: '设备已停用' },
  CLOCK_AHEAD: { status: 'rejected', retryable: false, label: '设备时间超前' },
  TOO_OLD: { status: 'rejected', retryable: false, label: '观测时间过旧' },
  ID_CONFLICT: { status: 'rejected', retryable: false, label: '编号与内容冲突' },
  BUSY: { status: 'rejected', retryable: true, label: '写入繁忙' },
} as const;
type ReceiptCode = keyof typeof receiptDefinitions;
export const receiptCode = z.enum(Object.keys(receiptDefinitions) as [ReceiptCode, ...ReceiptCode[]]);
export const processingStatus = z.enum(['applied', 'waiting_sample', 'pending_review']);
export const processingLabels = { applied: '已关联处理', waiting_sample: '等待关联读数', pending_review: '待核实' } satisfies Record<z.infer<typeof processingStatus>, string>;
export const receiptStatusLabels = { accepted: '已接收', duplicate: '重复', ignored: '已忽略', rejected: '已拒绝' } as const;
const receiptFields = { index: z.number().int().nonnegative(), status: z.enum(['accepted', 'duplicate', 'ignored', 'rejected']), code: receiptCode, retryable: z.boolean() };
function checkReceipt(v: { code: ReceiptCode; status: string; retryable: boolean }, ctx: z.RefinementCtx) {
  const rule = receiptDefinitions[v.code];
  if (v.status !== rule.status || v.retryable !== rule.retryable) ctx.addIssue({ code: 'custom', message: '逐项状态、错误码和重试标记不一致' });
}
export const sampleReceiptSchema = z.object({ ...receiptFields, scaleId, bootId, sequence }).strict().superRefine(checkReceipt);
export const eventReceiptSchema = z.object({ ...receiptFields, eventId: uuid, processingStatus: processingStatus.nullable() }).strict().superRefine((v, ctx) => {
  checkReceipt(v, ctx);
  if ((v.status === 'accepted' || v.status === 'duplicate') !== (v.processingStatus !== null)) ctx.addIssue({ code: 'custom', path: ['processingStatus'], message: '仅已保存或重复事件提供处理状态' });
});
const responseMeta = { contractVersion: z.literal(CONTRACT_VERSION), batchId: uuid, serverAt: timestamp };
function uniqueIndices(v: { results: { index: number }[] }, ctx: z.RefinementCtx) {
  if (v.results.some((r, i) => r.index !== i)) ctx.addIssue({ code: 'custom', path: ['results'], message: '回执须按输入顺序完整排列' });
}
export const samplesResponseSchema = z.object({ ...responseMeta, results: z.array(sampleReceiptSchema).min(1).max(limits.samples) }).strict().superRefine(uniqueIndices);
export const eventsResponseSchema = z.object({ ...responseMeta, results: z.array(eventReceiptSchema).min(1).max(limits.events) }).strict().superRefine(uniqueIndices);
export type SampleV2 = z.infer<typeof sampleSchema>;
export type DeviceEventV2 = z.infer<typeof deviceEventSchema>;
export type SamplesRequest = z.infer<typeof samplesRequestSchema>;
export type EventsRequest = z.infer<typeof eventsRequestSchema>;

/** Pure validation only. Persistence and replay policy belong to M1. */
export function sampleTimeCode(sampledAt: string, receivedAt: string): 'CLOCK_AHEAD' | 'TOO_OLD' | null {
  const at = Date.parse(timestamp.parse(sampledAt)), now = Date.parse(timestamp.parse(receivedAt));
  return at > now + limits.clockAheadMs ? 'CLOCK_AHEAD' : at < now - limits.sampleAgeMs ? 'TOO_OLD' : null;
}
