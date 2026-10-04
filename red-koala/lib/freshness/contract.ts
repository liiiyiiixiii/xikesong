import { z } from 'zod';
const id=z.string().min(1).max(160), grams=z.number().finite().min(0).max(1e7);
export const freshnessAction=z.discriminatedUnion('action',[
  z.object({action:z.literal('rule'),dishId:id,enabled:z.boolean(),maxMinutes:z.number().int().min(1).max(1440),warningMinutes:z.number().int().min(0).max(1439)}),
  z.object({action:z.literal('start'),requestId:z.string().uuid(),scaleId:id,startedAt:z.string().datetime({offset:true}),openingG:grams.nullable(),confirmed:z.literal(true)}),
  z.object({action:z.literal('close'),requestId:z.string().uuid(),batchId:id,remainingG:grams,disposition:z.enum(['waste','retain']),reason:z.enum(['display_age','closing','other']),replace:z.boolean(),newOpeningG:grams.nullable(),confirmed:z.literal(true)}),
  z.object({action:z.literal('partial'),requestId:z.string().uuid(),batchId:id,weightG:grams.positive(),eventId:id.optional(),disposition:z.enum(['waste','retain']),reason:z.enum(['display_age','closing','other']),confirmed:z.literal(true)}),
  z.object({action:z.literal('decision'),requestId:z.string().uuid(),dishId:id,period:z.enum(['早间','午间','下午','晚间','夜间']),choice:z.enum(['reduce','trial_pause','keep']),note:z.string().trim().min(1).max(500),evidenceIds:z.array(id).min(1).max(1000)}),
]);
export type FreshnessAction=z.infer<typeof freshnessAction>;
