import { z } from 'zod';
import { id, scaleId, timestamp, uuid, version, grams, positiveGrams, meta } from './common.ts';
import { actorSchema } from './operations.ts';

const milliseconds = z.number().int().positive().max(86_400_000);
export const measurementConfigSchema = z.object({
  boundaryWindowMs: z.number().int().min(0).max(60_000).nullable(),
  maxSampleGapMs: milliseconds, freshMs: milliseconds,
  stableWindowMs: z.number().int().min(0).max(60_000), stableMinSamples: z.number().int().min(1).max(1000),
  stableToleranceG: grams, negativeToleranceG: grams, maxStepG: positiveGrams.nullable(),
  locationFreshMs: milliseconds.nullable(), timeZone: z.literal('Asia/Shanghai'), ruleVersion: id,
}).strict();
export const bindingConfigSchema = z.object({
  dishId: id, dishName: z.string().trim().min(1).max(100), containerRef: id.nullable(),
  tareG: positiveGrams, fullFoodG: positiveGrams, foodOnly: z.boolean(),
}).strict();
export const deviceViewSchema = z.object({
  scaleId, name: z.string().min(1).max(100), enabled: z.boolean(), positionOrder: z.number().int().min(1).max(10000).nullable(),
  version, measurement: measurementConfigSchema.nullable(), binding: bindingConfigSchema.extend({
    id, version, validFrom: timestamp, validTo: timestamp.nullable(), freshnessBatchId: id.nullable(),
  }).nullable(), createdAt: timestamp, updatedAt: timestamp,
}).strict();
export const deviceWriteSchema = z.object({
  requestId: uuid, expectedVersion: version, scaleId, name: z.string().trim().min(1).max(100),
  enabled: z.boolean(), positionOrder: z.number().int().min(1).max(10000).nullable(),
  measurement: measurementConfigSchema.nullable(), binding: bindingConfigSchema.nullable(),
}).strict();
export const devicesResponseSchema = z.object({ ...meta, devices: z.array(deviceViewSchema) }).strict();
export const deviceResponseSchema = z.object({ ...meta, device: deviceViewSchema }).strict();
export const credentialViewSchema = z.object({ id, role: z.enum(['device', 'staff', 'manager']), actor: actorSchema,
  scaleIds: z.array(scaleId).nullable(), trackIds: z.array(id).max(20).default([]), disabled: z.boolean(), expiresAt: timestamp.nullable(),
}).strict();
export const credentialWriteSchema = z.object({
  requestId: uuid, id, token: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  role: z.enum(['device', 'staff', 'manager']), actor: actorSchema, scaleIds: z.array(scaleId).max(1000).nullable(), trackIds: z.array(id).max(20).default([]), expiresAt: timestamp.nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.role === 'device' && (!(v.scaleIds?.length || v.trackIds.length) || v.actor.kind !== 'system')) ctx.addIssue({ code: 'custom', path: ['scaleIds'], message: '设备凭证需要明确设备范围与系统身份' });
  if (new Set(v.trackIds).size !== v.trackIds.length) ctx.addIssue({ code: 'custom', path: ['trackIds'], message: '轨道编号不能重复' });
  if (v.scaleIds && new Set(v.scaleIds).size !== v.scaleIds.length) ctx.addIssue({ code: 'custom', path: ['scaleIds'], message: '设备编号不能重复' });
});
export const credentialRevokeSchema = z.object({ requestId: uuid }).strict();
export const credentialsResponseSchema = z.object({ ...meta, credentials: z.array(credentialViewSchema) }).strict();
export const credentialResponseSchema = z.object({ ...meta, credential: credentialViewSchema }).strict();
