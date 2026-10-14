import {z} from 'zod';
// Existing wire contract: do not add operation/boundary fields to this strict v1 body.
export const legacyScaleSampleSchema=z.object({scaleId:z.string().min(1).max(80),bootId:z.string().min(1).max(100),sequence:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),sampledAt:z.string().datetime({offset:true}),grossG:z.number().finite().min(0).max(1e7)}).strict();
export const legacyScaleRequestSchema=z.object({samples:z.array(legacyScaleSampleSchema).min(1).max(1000)}).strict();
