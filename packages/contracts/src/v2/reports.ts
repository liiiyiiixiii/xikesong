import { z } from 'zod';
import { id, dateRange, checkDateRange, pagination, grams, ratio, meta, timestamp, projectionStatus } from './common.ts';

export const reportBasis = z.enum(['cycle_balance_v2', 'legacy_delta_v1']);
export const basisLabels = { cycle_balance_v2: '按轮次确认取用', legacy_delta_v1: '旧口径观测下降' } satisfies Record<z.infer<typeof reportBasis>, string>;
export const reportQuality = z.enum(['PARTIAL_COVERAGE', 'PENDING_CYCLES', 'STOCKOUT', 'NO_DATA', 'LEGACY_BASIS', 'CROSS_DAY', 'UNKNOWN_COVERAGE']);
export const reportQualityLabels = { PARTIAL_COVERAGE: '部分观测', PENDING_CYCLES: '存在待核实轮次', STOCKOUT: '存在缺菜', NO_DATA: '无有效数据', LEGACY_BASIS: '旧计量口径', CROSS_DAY: '包含跨日轮次', UNKNOWN_COVERAGE: '覆盖率未知' } satisfies Record<z.infer<typeof reportQuality>, string>;
const filter = { ...dateRange, basis: reportBasis, dishId: id.optional(), sort: z.literal('weight_desc').default('weight_desc') };
export const reportQuerySchema = z.object({ ...filter, ...pagination }).strict().superRefine(checkDateRange);
export const exportQuerySchema = z.object({ ...filter, dataRevision: id, snapshotAt: timestamp }).strict().superRefine(checkDateRange);
const scopeSchema = z.object({ ...dateRange, timeZone: z.literal('Asia/Shanghai'), dateAttribution: z.enum(['cycle_end', 'observation_time']) }).strict().superRefine(checkDateRange);
// Aggregate limits intentionally differ from per-sample limits.
const totalGrams = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 1000);
const sharedRow = { dishId: id, name: z.string().min(1).max(100), rank: z.number().int().positive().nullable(), observationCoverage: ratio.nullable(), cycleCoverage: ratio.nullable(), stockoutMinutes: z.number().finite().min(0).max(31 * 1440).nullable(), recordedDays: z.number().int().min(0).max(31), operatingDays: z.number().int().min(0).max(31).nullable(), operatingDaysBasis: z.enum(['binding_schedule', 'unknown']), qualityReasons: z.array(reportQuality) };
export const confirmedReportRowSchema = z.object({ ...sharedRow, confirmedTakeG: totalGrams.nullable(), pendingCycles: z.number().int().nonnegative() }).strict().superRefine((v, ctx) => {
  if (v.confirmedTakeG === null && v.rank !== null) ctx.addIssue({ code: 'custom', path: ['rank'], message: '没有确认量不能排名' });
});
export const legacyReportRowSchema = z.object({ ...sharedRow, observedTakeG: totalGrams.nullable() }).strict().superRefine((v, ctx) => {
  if (v.observedTakeG === null && v.rank !== null) ctx.addIssue({ code: 'custom', path: ['rank'], message: '没有观测量不能排名' });
});
const base = { ...meta, scope: scopeSchema, projectionStatus, asOf: timestamp, nextCursor: z.string().nullable() };
export const reportResponseSchema = z.discriminatedUnion('basis', [
  z.object({ ...base, basis: z.literal('cycle_balance_v2'), totals: z.object({ confirmedTakeG: totalGrams.nullable(), pendingCycles: z.number().int().nonnegative(), dishCount: z.number().int().nonnegative() }).strict(), rows: z.array(confirmedReportRowSchema) }).strict(),
  z.object({ ...base, basis: z.literal('legacy_delta_v1'), totals: z.object({ observedTakeG: totalGrams.nullable(), dishCount: z.number().int().nonnegative() }).strict(), rows: z.array(legacyReportRowSchema) }).strict(),
]).superRefine((v, ctx) => {
  const attribution = v.basis === 'cycle_balance_v2' ? 'cycle_end' : 'observation_time';
  if (v.scope.dateAttribution !== attribution) ctx.addIssue({ code: 'custom', path: ['scope', 'dateAttribution'], message: '日期归属与统计口径不符' });
  if (new Set(v.rows.map(r => r.dishId)).size !== v.rows.length) ctx.addIssue({ code: 'custom', path: ['rows'], message: '报表每道菜只出现一次' });
});
export const csvResponseSchema = z.string().min(1);
export type ConsumptionReport = z.infer<typeof reportResponseSchema>;
export type ReportQuery = z.input<typeof reportQuerySchema>;

// Exported here for consumers that need per-operation weight rather than totals.
export { grams as operationGramsSchema };
