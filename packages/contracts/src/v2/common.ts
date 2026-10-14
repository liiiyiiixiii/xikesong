import { z } from 'zod';

export const CONTRACT_VERSION = 'operations-v2' as const;
export const CONTRACT_REVISION = '2.0.0-dev.5' as const;
export const limits = {
  samples: 1000, events: 100, sampleBytes: 1_000_000, eventBytes: 256_000,
  operationBytes: 100_000, clockAheadMs: 5000, sampleAgeMs: 86_400_000,
} as const;
export const id = z.string().trim().min(1).max(160);
export const scaleId = z.string().trim().min(1).max(80);
export const bootId = z.string().min(1).max(100);
export const uuid = z.string().uuid();
export const timestamp = z.string().datetime({ offset: true });
export const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const grams = z.number().finite().min(0).max(10_000_000).refine(
  n => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.00001, '重量最多三位小数',
);
export const positiveGrams = grams.refine(n => n > 0, '重量必须大于零');
export const ratio = z.number().finite().min(0).max(1);
export const note = z.string().trim().min(1).max(500);
export const evidenceIds = z.array(id).max(100).refine(a => new Set(a).size === a.length, '依据编号不能重复');
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}, '无效日期');
export const meta = {
  contractVersion: z.literal(CONTRACT_VERSION), serverAt: timestamp, dataRevision: id,
};
export const emptyQuery = z.object({}).strict();
export const itemParams = z.object({ id }).strict();
export const noParams = z.object({}).strict();
export const pagination = {
  cursor: z.string().min(1).max(500).optional(),
  limit: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(1).max(200)).default(50),
};
export const dateRange = { startDate: date, endDate: date };
export function checkDateRange(value: { startDate: string; endDate: string }, ctx: z.RefinementCtx) {
  const days = (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86_400_000;
  if (days < 0 || days > 30) ctx.addIssue({ code: 'custom', path: ['endDate'], message: '日期范围应为 1 至 31 天' });
}
export const environment = z.enum(['test', 'demo', 'live']);
export const environmentLabels = { test: '测试', demo: '演示', live: '实际运行' } satisfies Record<z.infer<typeof environment>, string>;
export const projectionStatus = z.enum(['ready', 'rebuilding', 'failed']);
export const projectionLabels = { ready: '已更新', rebuilding: '更新中', failed: '更新失败' } satisfies Record<z.infer<typeof projectionStatus>, string>;
export const quantityStatus = z.enum(['measured', 'estimated', 'unknown']);
export const quantityLabels = { measured: '已测量', estimated: '估计', unknown: '未知' } satisfies Record<z.infer<typeof quantityStatus>, string>;
export function checkQuantity(value: { quantityStatus: z.infer<typeof quantityStatus>; weightG: number | null }, ctx: z.RefinementCtx) {
  if ((value.quantityStatus === 'unknown') !== (value.weightG === null)) ctx.addIssue({ code: 'custom', path: ['weightG'], message: '未知重量必须为 null，已测量或估计重量必须提供数值' });
}
