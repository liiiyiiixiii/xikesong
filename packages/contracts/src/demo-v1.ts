import { z } from 'zod';

export const CONTRACT_VERSION = '1.0.0' as const;
const id = z.string().min(1).max(160);
const ms = z.number().int().nonnegative().safe();
const positive = z.number().finite().positive();
export const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });
export const windowSchema = z.object({ trackId: id, centerSM: z.number().nonnegative(), halfWidthM: positive });
export const dishSchema = z.object({ dishId: id, name: id, displayOrder: z.number().int(), fullG: positive, tareG: z.number().nonnegative(), category:z.string().optional(), portionG:positive.optional(), preparationMs:ms.optional(), visual:z.object({shape:id,color:z.number().int(),variant:z.number().int()}).optional(), provenance:z.object({kind:z.enum(['brand-visit','buffet-reference']),sourceUrl:z.string(),note:z.string()}).optional() });
export const sceneSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), layoutVersion: id, contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  coordinateSystem: z.object({ unit: z.literal('m'), origin: z.string(), axes: z.object({ x: z.string(), y: z.string(), z: z.string() }), drawingScaleM: positive, measured: z.literal(false) }),
  layoutParameters: z.object({ leftGapPercent: z.literal(65), sauceLengthPercent: z.literal(180) }),
  tracks: z.array(z.object({ trackId: id, enabled: z.boolean(), lengthM: positive, direction: z.union([z.literal(1), z.literal(-1)]), speedMps: z.number().finite().nonnegative(), path: z.array(pointSchema).min(3), arcLengthLut: z.array(pointSchema.extend({ sM: z.number().nonnegative() })).min(3) })).min(1),
  slots: z.array(z.object({ slotId: id, trackId: id, s0M: z.number().finite().nonnegative(), usable: z.boolean() })),
  plates: z.array(z.object({ plateId: id, slotId: id, dishId: id, diameterM: positive, heightM: positive })),
  kitchen: z.object({ boundary: z.array(pointSchema).min(3) }),
  servingWindows: z.array(windowSchema.extend({ windowId: id, position: pointSchema, staffPosition: pointSchema.optional() })),
  seats: z.array(z.object({ seatId: id, usable: z.boolean(), position: pointSchema, takeWindow: windowSchema })),
});
export type SceneManifest = z.infer<typeof sceneSchema>;
export type Dish = z.infer<typeof dishSchema>;
export const rulesSchema = z.object({ label: z.literal('演示参数，非实测门店标准'), halfRatio: z.number().positive().max(1), lowRatio: z.number().positive().max(1), emptyG: z.number().nonnegative(), preparationMs: ms, actionMs: ms, staleAfterMs: ms, maxDeltaG: positive, displayWarnAfterMs:ms.optional(), displayExpireAfterMs:ms.optional() });
export type Rules = z.infer<typeof rulesSchema>;
export const qualitySchema = z.enum(['good', 'offline', 'stale', 'unknown', 'removed', 'uncertain']);
export type Quality = z.infer<typeof qualitySchema>;
const eventBase = z.object({ eventId: id, targetEntityId: id, startTimeMs: ms, applyTimeMs: ms, endTimeMs: ms });
const movementPath = z.array(pointSchema).min(2);
export const eventSchema = z.discriminatedUnion('eventType', [
  eventBase.extend({ eventType: z.literal('customer.enter'), layer: z.literal('action'), customerId: id }),
  eventBase.extend({ eventType: z.literal('customer.seat'), layer: z.literal('action'), customerId: id, seatId: id, path: movementPath.optional() }),
  eventBase.extend({ eventType: z.literal('customer.depart'), layer: z.literal('action'), customerId: id }),
  eventBase.extend({ eventType: z.literal('customer.leave'), layer: z.literal('action'), customerId: id, path: movementPath.optional() }),
  eventBase.extend({ eventType: z.literal('customer.take'), layer: z.literal('action'), customerId: id, seatId: id, plateId: id, operationId: id }),
  eventBase.extend({ eventType: z.literal('staff.refill'), layer: z.literal('action'), staffId: id, plateId: id, windowId: id, taskId: id, operationId: id }),
  eventBase.extend({ eventType: z.literal('weight.observed'), layer: z.literal('observation'), plateId: id, scaleId: id, bootId: id, sequence: ms, grossG: z.number().finite().nonnegative(), quality: qualitySchema, operationId: id.optional(), region: z.enum(['dining', 'kitchen', 'unknown']) }),
  eventBase.extend({ eventType: z.literal('quality.changed'), layer: z.literal('observation'), plateId: id, quality: qualitySchema }),
]);
export type InputEvent = z.infer<typeof eventSchema>;
export type DerivedEvent = { eventId: string; eventType: 'task.created'|'task.ready'|'task.completed'|'alert.changed'|'quality.expired'|'action.started'|'action.ended'|'playback.completed'; layer: 'derived'; targetEntityId: string; startTimeMs: number; applyTimeMs: number; endTimeMs: number; plateId?: string; taskId?: string; status: string };
export type DemoEvent = InputEvent | DerivedEvent;
const simulationWindowSchema=z.object({startLocal:z.literal('12:00:00'),endLocal:z.literal('12:10:00'),timeZone:z.literal('Asia/Shanghai')});
export const datasetSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION), datasetId: id, layoutVersion: id, sceneDigest: id, source: z.literal('simulation'),
  simulatedBusinessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), durationMs: ms, seed: z.number().int(), rules: rulesSchema,
  simulationWindow:simulationWindowSchema.optional(),
  initialCustomers:z.array(z.object({customerId:id,seatId:id,elapsedDiningMs:ms,profile:z.string()})).optional(),
  dishes: z.array(dishSchema).min(1), staff: z.array(z.object({ staffId: id, name: id, role:z.enum(['chef','supplier']).optional(), station:pointSchema.optional(), kitchenAction:z.enum(['chop','stir','plate']).optional() })).min(1),
  servingBatches:z.array(z.object({batchId:id,plateId:id,startedAtMs:z.number().int().safe(),endedAtMs:z.number().int().safe().nullable(),displayWarnAfterMs:ms,displayExpireAfterMs:ms})).optional(),
  initialWeights: z.array(z.object({ plateId: id, grossG: z.number().nonnegative(), bootId: id, sequence: ms })),
  events: z.array(eventSchema), provenance: z.object({ scenePath: z.string(), sceneDigest: id, generatorVersion: id }),
});
export type Dataset = z.infer<typeof datasetSchema>;
export type Metadata = { contractVersion: typeof CONTRACT_VERSION; datasetId: string; layoutVersion: string; sessionId: string; generation: number; revision: number; simTimeMs: number; source: 'simulation' };
export type PlateState = { plateId: string; slotId: string; dishId: string; trackId: string; sM: number; remainingG: number|null; fullG: number; quality: Quality; remainingStatus: 'full'|'half'|'low'|'empty'|'unknown'; lastObservedSimTimeMs: number|null; freshness?:{state:'unconfigured'|'fresh'|'warning'|'expired';batchId?:string|null;startedAtMs:number|null;warningAtMs:number|null;expiresAtMs:number|null} };
export type CustomerState = { customerId: string; status: 'walking'|'seated'|'left'; seatId: string|null; enteredAtMs: number; elapsedDiningBeforeStartMs?:number; profile?:string; leftAtMs: number|null; movement?: { path: {x:number;y:number;z:number}[]; startTimeMs:number; endTimeMs:number }; targetSeatId?:string };
export type TaskState = { taskId: string; plateId: string; dishId: string; staffId: string; status: 'preparing'|'waiting'|'completed'; createdAtMs: number; preparationStartMs: number; readyAtMs: number; completedAtMs: number|null; triggerEventId: string };
export type Summary = { carryingPositionCount: number; actualPlateCount: number; dishTypeCount: number; availableSeatCount: number; seatedCustomerCount: number; inStoreCustomerCount: number; sceneCustomerEntityCount: number; takenG: number; refilledG: number; uncertainG: number; qualityIssueCount: number };
export type DemoState = Metadata & { sceneDigest: string; simulationWindow?:Dataset['simulationWindow']; playback: { status: 'running'|'paused'|'completed'; durationMs: number }; plates: PlateState[]; customers: CustomerState[]; staff: { staffId: string; name: string; role?:'chef'|'supplier'; kitchenAction?:'chop'|'stir'|'plate'; action: 'idle'|'preparing'|'waiting'|'refilling'; taskId: string|null; position: {x:number;y:number;z:number} }[]; tasks: TaskState[]; summary: Summary; eventCursor: string; activeEvents: DemoEvent[]; dishes: Dish[]; rules: Rules; reports: Reports };
export type Reports = Metadata & { current: { takenG: number; refilledG: number; uncertainG: number }; simulatedDay: { date: string; scope: 'dataset-once'; datasetId: string; takenG: number; refilledG: number; uncertainG: number }; byDish: { dishId: string; takenG: number; refilledG: number; uncertainG: number }[]; history: { halfMonth: null; month: null }; note: string };
export const controlSchema = z.object({ action: z.enum(['pause','resume','restart']), requestId: z.string().uuid(), sessionId: id, generation: ms }).strict();
export type Control = z.infer<typeof controlSchema>;
export type ErrorCode = 'INVALID_REQUEST'|'SCENE_NOT_READY'|'SCHEMA_INVALID'|'REFERENCE_INVALID'|'CAPACITY_INVALID'|'SPATIAL_INVALID'|'PRECONDITION_FAILED'|'DATASET_MISMATCH'|'DIGEST_MISMATCH'|'CURSOR_INVALID'|'CURSOR_EXPIRED'|'SESSION_CONFLICT'|'STORAGE_UNAVAILABLE'|'NOT_FOUND'|'METHOD_NOT_ALLOWED'|'LEGACY_RETIRED'|'INTERNAL_ERROR';
export type ErrorEnvelope = { error: { code: ErrorCode; message: string; details?: unknown; requestId: string } };
export type ManifestResponse = Metadata & { scene: SceneManifest; dishes: Dish[]; rules: Rules; durationMs: number; simulationWindow?:Dataset['simulationWindow']; capacityLabel: string; provenance: Dataset['provenance'] };
export type EventsResponse = Metadata & { events: DemoEvent[]; eventCursor: string };
