import { z } from 'zod';
import { id, uuid, timestamp, version, meta, environment, sequence, bootId } from './common.ts';
import { bowlSchema } from './serving.ts';
import { freshnessBatchSchema } from './freshness.ts';

export const trackConfigSchema = z.object({
  id, name: z.string().trim().min(1).max(80), lengthM: z.number().finite().positive().max(10000),
  direction: z.union([z.literal(1), z.literal(-1)]), freshMs: z.number().int().min(100).max(60000),
  carriers: z.array(z.object({ scaleId: id, offsetM: z.number().finite().nonnegative() }).strict()).min(1).max(1000),
  windows: z.array(z.object({ id, name: z.string().trim().min(1).max(80), enterM: z.number().finite().nonnegative(), exitM: z.number().finite().nonnegative() }).strict()).min(1).max(20),
}).strict().superRefine((v,c)=>{
  if(new Set(v.carriers.map(x=>x.scaleId)).size!==v.carriers.length || new Set(v.carriers.map(x=>x.offsetM)).size!==v.carriers.length) c.addIssue({code:'custom',message:'盘托身份与位置不能重复'});
  if(new Set(v.windows.map(x=>x.id)).size!==v.windows.length) c.addIssue({code:'custom',message:'窗口编号不能重复'});
  if(v.carriers.some(x=>x.offsetM>=v.lengthM)||v.windows.some(x=>x.enterM>=v.lengthM||x.exitM>=v.lengthM||x.enterM===x.exitM))c.addIssue({code:'custom',message:'位置必须在轨道范围内，入口出口不能重合'});
});
export const kitchenConfigSchema = z.object({ automaticRefillEnabled: z.boolean(), tracks: z.array(trackConfigSchema).max(20) }).strict().superRefine((v,c)=>{
  const ids=v.tracks.map(t=>t.id), carriers=v.tracks.flatMap(t=>t.carriers.map(x=>x.scaleId)), windows=v.tracks.flatMap(t=>t.windows.map(x=>x.id));
  if([ids,carriers,windows].some(a=>new Set(a).size!==a.length))c.addIssue({code:'custom',message:'轨道、窗口及盘托编号必须全局唯一'});
});
export const kitchenSettingsSchema = z.object({ version, updatedAt: timestamp.nullable(), enabledAt: timestamp.nullable(), config:kitchenConfigSchema }).strict();
export const kitchenConfigResponseSchema = z.object({...meta,settings:kitchenSettingsSchema}).strict();
export const kitchenConfigWriteSchema = z.object({requestId:uuid,expectedVersion:version,config:kitchenConfigSchema}).strict();
export const trackMotionSchema = z.object({trackId:id,bootId,sequence,occurredAt:timestamp,positionValid:z.boolean().optional(),running:z.boolean(),speedMps:z.number().finite().min(0).max(10),direction:z.union([z.literal(1),z.literal(-1)])}).strict().refine(v=>v.running?v.speedMps>0:v.speedMps===0,'停止时速度为零，运行时必须提供速度');
export const motionRequestSchema = z.object({requestId:uuid,motion:trackMotionSchema}).strict();
export const motionResponseSchema = z.object({...meta,status:z.enum(['stored','ignored'])}).strict();
export const calibrationSchema = z.object({requestId:uuid,expectedVersion:version,trackId:id,bootId,sequence,phaseM:z.number().finite().nonnegative()}).strict();
export const positionQualitySchema = z.enum(['estimated','unconfigured','stale','recalibration']);
export const conveyorTrackSchema = z.object({trackId:id,name:z.string(),lengthM:z.number(),direction:z.union([z.literal(1),z.literal(-1)]),quality:positionQualitySchema,bootId:bootId.nullable(),sequence:sequence.nullable(),running:z.boolean().nullable(),speedMps:z.number().nonnegative().nullable(),observedAt:timestamp.nullable(),validUntil:timestamp.nullable(),phaseM:z.number().nullable(),positions:z.array(z.object({scaleId:id,positionM:z.number()}).strict())}).strict();
export const conveyorStateSchema = z.object({...meta,environment,tracks:z.array(conveyorTrackSchema)}).strict();
export const kitchenCardSchema = z.object({bowl:bowlSchema,percent:z.number().finite().nonnegative().nullable(),estimated:z.boolean(),freshness:freshnessBatchSchema.nullable(),alert:z.enum(['none','refill','empty','warning','expired','unknown']),distanceM:z.number().nonnegative().nullable()}).strict();
export const kitchenBoardSchema = z.object({...meta,environment,automaticRefillEnabled:z.boolean().default(false),windowId:id.nullable(),quality:positionQualitySchema,
  windows:z.array(z.object({id,trackId:id,name:z.string(),pending:z.number().int().nonnegative()}).strict()),
  upcoming:z.array(kitchenCardSchema).max(10),processing:z.array(kitchenCardSchema),all:z.array(kitchenCardSchema),
}).strict();
export const kitchenBoardQuerySchema=z.object({windowId:id.optional()}).strict();
export const kitchenVisitSchema=z.object({id,bindingId:id,enteredAt:timestamp,exitedAt:timestamp.nullable(),status:z.enum(['processing','refill','unchanged','exception','pending','invalidated']),refillG:z.number().nonnegative().nullable(),evidenceIds:z.array(z.string()),reasonCodes:z.array(z.string()),source:z.literal('system_inference'),version}).strict();
export const visitsResponseSchema=z.object({...meta,visits:z.array(z.object({current:kitchenVisitSchema,revisions:z.array(kitchenVisitSchema)}).strict())}).strict();
export const visitsQuerySchema=z.object({bindingId:id}).strict();
export type KitchenSettings=z.infer<typeof kitchenSettingsSchema>;
export type TrackConfig=z.infer<typeof trackConfigSchema>;
export type TrackMotion=z.infer<typeof trackMotionSchema>;
export type KitchenVisit=z.infer<typeof kitchenVisitSchema>;
export type KitchenCard=z.infer<typeof kitchenCardSchema>;
