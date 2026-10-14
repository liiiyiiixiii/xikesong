import { z } from 'zod';
import { meta } from './common.ts';
import { exportQuerySchema, reportResponseSchema } from './reports.ts';

export const aiEvidenceQuerySchema = exportQuerySchema.superRefine((value, context) => {
  if (value.basis !== 'cycle_balance_v2') context.addIssue({ code: 'custom', path: ['basis'], message: '新账本证据不混入旧观测口径' });
});
export const aiEvidenceResponseSchema = z.object({
  ...meta,
  report: reportResponseSchema.refine(value => value.basis === 'cycle_balance_v2' && value.projectionStatus === 'ready' && value.nextCursor === null),
  training: z.object({ enabled: z.literal(false), reason: z.literal('SEPARATE_BASIS') }).strict(),
  externalModelCalled: z.literal(false),
}).strict().superRefine((value, context) => {
  if (value.dataRevision !== value.report.dataRevision) context.addIssue({ code: 'custom', path: ['report'], message: 'AI 证据与报表必须来自同一数据版本' });
});
export type AiEvidence = z.infer<typeof aiEvidenceResponseSchema>;
