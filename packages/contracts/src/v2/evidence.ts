import { z } from 'zod';
import { id, meta, pagination, timestamp } from './common.ts';
import { sampleSchema } from './telemetry.ts';
export const evidenceQuerySchema = z.object({ ...pagination, startAt: timestamp, endAt: timestamp }).strict().superRefine((v, ctx) => {
  const duration = Date.parse(v.endAt) - Date.parse(v.startAt);
  if (duration < 0 || duration > 600000) ctx.addIssue({ code: 'custom', path: ['endAt'], message: '称重依据查询范围应为 0 至 10 分钟' });
});
export const evidenceResponseSchema = z.object({ ...meta, bindingId: id, boundaryWindowMs: z.number().int().nonnegative().nullable(),
  samples: z.array(z.object({ id, sample: sampleSchema, receivedAt: timestamp }).strict()), nextCursor: z.string().nullable(),
}).strict();
