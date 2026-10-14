import { z } from 'zod';
import { id, scaleId, timestamp, version, uuid, grams, positiveGrams, ratio, meta, environment } from './common.ts';
import { receiptCode, deviceReason } from './telemetry.ts';

export const servingState = z.enum(['full', 'half', 'low', 'empty', 'unknown']);
export const servingLabels = { full: '满盘', half: '半盘', low: '少量', empty: '空盘', unknown: '待核实' } satisfies Record<z.infer<typeof servingState>, string>;
export const recommendation = z.enum(['none', 'watch', 'defer', 'refill', 'urgent', 'verify']);
export const recommendationLabels = { none: '无需处理', watch: '关注', defer: '暂缓补充', refill: '应补菜', urgent: '紧急处理', verify: '核实数据' } satisfies Record<z.infer<typeof recommendation>, string>;
export const quality = z.enum(['good', 'estimated', 'stale', 'offline', 'removed', 'unstable', 'pending']);
export const qualityLabels = { good: '正常', estimated: '估计', stale: '数据过期', offline: '设备离线', removed: '餐盘已拿走', unstable: '读数不稳定', pending: '待核实' } satisfies Record<z.infer<typeof quality>, string>;
export const zone = z.enum(['kitchen', 'customer', 'unknown']);
export const zoneLabels = { kitchen: '后厨', customer: '顾客区', unknown: '位置未知' } satisfies Record<z.infer<typeof zone>, string>;
export const locationQuality = z.enum(['verified', 'manual', 'stale', 'unknown']);
export const locationLabels = { verified: '边界已核实', manual: '人工登记', stale: '位置已过期', unknown: '位置未知' } satisfies Record<z.infer<typeof locationQuality>, string>;
export const servingReason = z.enum(['HALF_NO_CHANGE', 'HALF_ACTIVE', 'PEAK_PERIOD', 'LOW_WEIGHT', 'EMPTY_WEIGHT', 'RULE_NOT_CONFIGURED', 'STALE_READING', 'DEVICE_OFFLINE', 'CONTAINER_REMOVED', 'UNSTABLE_READING', 'UNKNOWN_FOOD_WEIGHT', 'PENDING_REVIEW', 'LOCATION_UNKNOWN']);
export const servingReasonLabels = { HALF_NO_CHANGE: '多轮余量未明显变化', HALF_ACTIVE: '持续取用', PEAK_PERIOD: '高峰时段', LOW_WEIGHT: '余量较少', EMPTY_WEIGHT: '已空盘', RULE_NOT_CONFIGURED: '尚未配置规则', STALE_READING: '读数已过期', DEVICE_OFFLINE: '设备离线', CONTAINER_REMOVED: '餐盘已拿走', UNSTABLE_READING: '等待稳定读数', UNKNOWN_FOOD_WEIGHT: '食物余量不明', PENDING_REVIEW: '存在待核实变化', LOCATION_UNKNOWN: '位置未知' } satisfies Record<z.infer<typeof servingReason>, string>;
export const bowlSchema = z.object({
  scaleId, bindingId: id, dishId: id, dishName: z.string().min(1).max(100), positionOrder: z.number().int().min(1).max(10000).nullable(),
  bindingVersion: version, freshnessBatchId: id.nullable(), containerRef: id.nullable(), tareG: positiveGrams,
  servingState, recommendation, quality, reasonCodes: z.array(servingReason),
  loadNetG: grams.nullable(), foodRemainingG: grams.nullable(), estimatedFoodG: grams.nullable(), confirmedFoodG: grams.nullable(), fullFoodG: positiveGrams,
  observedAt: timestamp.nullable(), confirmedAt: timestamp.nullable(),
  zone, locationQuality, locationObservedAt: timestamp.nullable(), cycleId: id.nullable(), taskId: id.nullable(), ruleVersion: version.nullable(),
}).strict().superRefine((v, ctx) => {
  if (['stale', 'offline', 'removed', 'unstable', 'pending'].includes(v.quality) && (v.servingState !== 'unknown' || v.foodRemainingG !== null)) ctx.addIssue({ code: 'custom', path: ['servingState'], message: '无可靠当前数据时不能返回确定供餐状态' });
  if (v.foodRemainingG === null && v.servingState !== 'unknown') ctx.addIssue({ code: 'custom', path: ['foodRemainingG'], message: '供餐状态需要可解释的当前食物余量' });
  if (v.servingState !== 'unknown' && (v.ruleVersion === null || v.observedAt === null)) ctx.addIssue({ code: 'custom', message: '确定供餐状态需要规则版本和观测时间' });
  if (v.confirmedFoodG !== null && !v.confirmedAt) ctx.addIssue({ code: 'custom', path: ['confirmedAt'], message: '确认余量需要确认时间' });
  if (['stale', 'unknown'].includes(v.locationQuality) && v.zone !== 'unknown') ctx.addIssue({ code: 'custom', path: ['zone'], message: '过期位置不能作为当前区域' });
  if (v.zone !== 'unknown' && v.locationObservedAt === null) ctx.addIssue({ code: 'custom', path: ['locationObservedAt'], message: '区域需要观测依据时间' });
});
export const servingResponseSchema = z.object({ ...meta, environment, bowls: z.array(bowlSchema) }).strict().superRefine((v, ctx) => {
  if (new Set(v.bowls.map(b => b.scaleId)).size !== v.bowls.length) ctx.addIssue({ code: 'custom', path: ['bowls'], message: '实时列表不得重复设备' });
});
const timeOfDay = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const thresholdsSchema = z.object({ emptyG: grams, lowRatio: ratio, fullRatio: ratio, hysteresisRatio: ratio, holdSeconds: z.number().int().min(0).max(120) }).strict().superRefine((v, ctx) => {
  if (v.lowRatio <= 0 || v.lowRatio >= v.fullRatio || v.hysteresisRatio >= v.lowRatio || v.hysteresisRatio >= v.fullRatio - v.lowRatio || v.fullRatio + v.hysteresisRatio > 1) ctx.addIssue({ code: 'custom', message: '阈值应有序，回滞不能跨越相邻区间或超过满盘比例' });
});
export const halfPolicySchema = z.object({ mode: z.enum(['cycles', 'time', 'disabled']), unchangedCycles: z.number().int().min(1).max(100).nullable(), observationSeconds: z.number().int().min(1).max(86400).nullable(), changeToleranceG: grams, deferSeconds: z.number().int().min(1).max(86400), refillDuringPeak: z.boolean() }).strict().superRefine((v, ctx) => {
  if ((v.mode === 'cycles') !== (v.unchangedCycles !== null) || (v.mode === 'time') !== (v.observationSeconds !== null)) ctx.addIssue({ code: 'custom', message: '轮次或时间模式只配置对应观察窗口，关闭模式两者均为 null' });
});
export const halfModeLabels = { cycles: '按真实轮次', time: '按观察时间', disabled: '关闭半盘暂缓规则' } satisfies Record<z.infer<typeof halfPolicySchema>['mode'], string>;
export const ruleConfigSchema = z.object({
  enabled: z.boolean(), thresholds: thresholdsSchema.nullable(), halfPolicy: halfPolicySchema.nullable(),
  peakPeriods: z.array(z.object({ start: timeOfDay, end: timeOfDay }).strict().refine(v => v.start < v.end, '时段需递增；跨午夜请拆为两个时段')).max(10),
  manualVerificationAllowed: z.boolean(),
}).strict().superRefine((v, ctx) => {
  if (v.enabled && (!v.thresholds || !v.halfPolicy)) ctx.addIssue({ code: 'custom', message: '启用规则前需填写阈值与半盘策略' });
  const periods = [...v.peakPeriods].sort((a, b) => a.start.localeCompare(b.start));
  if (periods.some((p, i) => i > 0 && periods[i - 1].end > p.start)) ctx.addIssue({ code: 'custom', path: ['peakPeriods'], message: '高峰时段不能重叠' });
});
export const ruleSchema = z.object({ dishId: id, version, updatedAt: timestamp, config: ruleConfigSchema }).strict();
export const ruleWriteSchema = z.object({ requestId: uuid, expectedVersion: version, config: ruleConfigSchema }).strict();
export const rulesResponseSchema = z.object({ ...meta, rules: z.array(ruleSchema) }).strict();
export const ruleResponseSchema = z.object({ ...meta, rule: ruleSchema }).strict();
export const diagnosticsResponseSchema = z.object({ ...meta, devices: z.array(z.object({
  scaleId, enabled: z.boolean(), lastSampledAt: timestamp.nullable(), lastReceivedAt: timestamp.nullable(),
  delayMs: z.number().finite().nonnegative().nullable(), fault: deviceReason.nullable(),
  countsSince: timestamp, accepted: z.number().int().nonnegative(), duplicate: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(),
  lastCode: receiptCode.nullable(),
}).strict()) }).strict();
export type ServingView = z.infer<typeof servingResponseSchema>;
export type Bowl = z.infer<typeof bowlSchema>;
