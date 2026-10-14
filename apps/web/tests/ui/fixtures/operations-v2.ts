import {
  CONTRACT_VERSION, apiError, endpoints, servingResponseSchema, taskSchema, type EndpointInput,
  type EndpointName, type EndpointResult, type ServingView,
} from '@zhishan/contracts/operations-v2';

// Explicit development/test fixture. Never imported by a production API or client.
export const at = '2026-10-11T03:01:00Z';
export const requestId = '64bfe76d-14f0-427b-8da9-81e7e508190b';
export const eventId = '3c5de1ab-a0a8-4624-b590-bec344713c26';
export const batchId = '463b5c1b-9be2-47f5-9e96-fcf14fbf24a8';
const meta = { contractVersion: CONTRACT_VERSION, serverAt: at, dataRevision: 'fixture-1' };
const actor = { id: 'kitchen-station', kind: 'workstation' as const, label: '后厨工作站' };
const bowl = {
  scaleId: 'belt-01', bindingId: 'binding-01', dishId: 'dish-01', dishName: '示例菜', positionOrder: 1,
  bindingVersion: 1, freshnessBatchId: null, containerRef: 'container-01', tareG: 300,
  servingState: 'half', recommendation: 'defer', quality: 'good', reasonCodes: ['HALF_NO_CHANGE'],
  loadNetG: 500, foodRemainingG: 500, estimatedFoodG: 500, confirmedFoodG: 500, fullFoodG: 1000,
  observedAt: at, confirmedAt: at, zone: 'customer', locationQuality: 'verified', locationObservedAt: at,
  cycleId: 'cycle-01', taskId: null, ruleVersion: 1,
} as const;
export const normalServing = servingResponseSchema.parse({ ...meta, environment: 'test', bowls: [bowl] });
const unknownBowl = { ...bowl, servingState: 'unknown', recommendation: 'verify', quality: 'pending', reasonCodes: ['UNKNOWN_FOOD_WEIGHT'], foodRemainingG: null, estimatedFoodG: null, zone: 'unknown', locationQuality: 'unknown', locationObservedAt: null };
export const servingScenarios: Record<'normal' | 'empty' | 'unknown' | 'offline' | 'fourStates' | 'unstable' | 'stale' | 'removed' | 'estimated', ServingView> = {
  normal: normalServing,
  empty: servingResponseSchema.parse({ ...meta, environment: 'test', bowls: [] }),
  unknown: servingResponseSchema.parse({ ...meta, environment: 'test', bowls: [unknownBowl] }),
  offline: servingResponseSchema.parse({ ...meta, environment: 'test', bowls: [{ ...unknownBowl, quality: 'offline', reasonCodes: ['DEVICE_OFFLINE'], loadNetG: null, observedAt: null }] }),
  unstable: servingResponseSchema.parse({ ...meta, environment: 'test', bowls: [{ ...unknownBowl, quality: 'unstable', reasonCodes: ['UNSTABLE_READING'], estimatedFoodG: 370 }] }),
  stale: servingResponseSchema.parse({ ...meta, environment: 'test', bowls: [{ ...unknownBowl, quality: 'stale', reasonCodes: ['STALE_READING'] }] }),
  removed: servingResponseSchema.parse({ ...meta, environment: 'test', bowls: [{ ...unknownBowl, quality: 'removed', reasonCodes: ['CONTAINER_REMOVED'] }] }),
  estimated: servingResponseSchema.parse({ ...meta, environment: 'test', bowls: [{ ...bowl, quality: 'estimated', foodRemainingG: 450, estimatedFoodG: 450 }] }),
  fourStates: servingResponseSchema.parse({ ...meta, environment: 'test', bowls: [
    { ...bowl, servingState: 'full', recommendation: 'none', reasonCodes: [], foodRemainingG: 1000, loadNetG: 1000, confirmedFoodG: 1000, estimatedFoodG: 1000 },
    { ...bowl, scaleId: 'belt-02', bindingId: 'binding-02', positionOrder: 2 },
    { ...bowl, scaleId: 'belt-03', bindingId: 'binding-03', positionOrder: 3, servingState: 'low', recommendation: 'refill', reasonCodes: ['LOW_WEIGHT'], foodRemainingG: 120, loadNetG: 120, confirmedFoodG: 120, estimatedFoodG: 120 },
    { ...bowl, scaleId: 'belt-04', bindingId: 'binding-04', positionOrder: 4, servingState: 'empty', recommendation: 'urgent', reasonCodes: ['EMPTY_WEIGHT'], foodRemainingG: 0, loadNetG: 0, confirmedFoodG: 0, estimatedFoodG: 0 },
  ] }),
};
export const openTask = taskSchema.parse({ id: 'task-01', bindingId: 'binding-01', status: 'open', priority: 'high', responsibility: 'kitchen', assignee: null, version: 1, deferUntil: null, verificationMethod: null, allowedActions: ['claim', 'defer'], reasonCodes: ['LOW_WEIGHT'], createdAt: at, updatedAt: at });
export const verifyingTask = taskSchema.parse({ ...openTask, version: 2, status: 'verifying', assignee: actor, allowedActions: ['verify_manual'] });
const operationInput = { requestId, bindingId: 'binding-01', occurredAt: at, type: 'ice_add', quantityStatus: 'unknown', weightG: null, evidenceIds: [], note: '加冰重量尚未测量' } as const;
const operation = { id: 'operation-01', version: 1, input: operationInput, actor, recordedAt: at, status: 'pending_review' };
const cycle = { id: 'cycle-01', bindingId: 'binding-01', scaleId: 'belt-01', dishId: 'dish-01', version: 1, status: 'pending', exitEventId: eventId, returnEventId: null, exitedAt: at, returnedAt: null, outG: 800, inG: null, confirmedTakeG: null, effectiveAt: null, method: 'cycle_balance_v2', qualityReasons: ['MISSING_RETURN'], evidenceIds: [eventId] };
const config = { enabled: false, thresholds: null, halfPolicy: null, peakPeriods: [], manualVerificationAllowed: false };
const rule = { dishId: 'dish-01', version: 1, updatedAt: at, config };
const reportQuery = { startDate: '2026-10-01', endDate: '2026-10-11', basis: 'cycle_balance_v2' };
const sampleInput = { version: 2, batchId, samples: [{ scaleId: 'belt-01', bootId: 'startup-a', sequence: 123, sampledAt: at, grossG: 1100, measurementStatus: 'ok' }] };
const eventInput = { version: 2, batchId, events: [{ eventId, scaleId: 'belt-01', bootId: 'startup-a', eventSequence: 17, occurredAt: at, type: 'exit_kitchen', sampleRef: { bootId: 'startup-a', sequence: 123 } }] };
type Fixture = { input: { params?: unknown; query?: unknown; body?: unknown }; response: unknown };
const rawFixtures = {
  kitchenConfig: {input:{},response:{...meta,settings:{version:0,updatedAt:null,enabledAt:null,config:{automaticRefillEnabled:false,tracks:[]}}}},
  saveKitchenConfig: {input:{body:{requestId,expectedVersion:0,config:{automaticRefillEnabled:false,tracks:[]}}},response:{...meta,settings:{version:1,updatedAt:at,enabledAt:null,config:{automaticRefillEnabled:false,tracks:[]}}}},
  conveyorMotion:{input:{body:{requestId,motion:{trackId:'track-1',bootId:'boot',sequence:0,occurredAt:at,running:false,speedMps:0,direction:1}}},response:{...meta,status:'stored'}},
  calibrateConveyor:{input:{body:{requestId,expectedVersion:1,trackId:'track-1',bootId:'boot',sequence:0,phaseM:0}},response:{...meta,environment:'test',tracks:[]}},
  conveyorState:{input:{},response:{...meta,environment:'test',tracks:[]}},
  kitchenBoard:{input:{},response:{...meta,environment:'test',windowId:null,quality:'unconfigured',windows:[],upcoming:[],processing:[],all:[]}},
  kitchenVisits:{input:{query:{bindingId:'binding-01'}},response:{...meta,visits:[]}},
  aiEvidence: { input: { query: { ...reportQuery, dataRevision: meta.dataRevision, snapshotAt: meta.serverAt } }, response: { ...meta, report: { ...meta, basis: 'cycle_balance_v2', projectionStatus: 'ready', scope: { startDate: '2026-10-01', endDate: '2026-10-11', timeZone: 'Asia/Shanghai', dateAttribution: 'cycle_end' }, asOf: at, totals: { confirmedTakeG: null, pendingCycles: 0, dishCount: 0 }, rows: [], nextCursor: null }, training: { enabled: false, reason: 'SEPARATE_BASIS' }, externalModelCalled: false } },
  runtime: { input: {}, response: { ...meta, scheduler: null, jobs: { pending: 0, running: 0, failed: 0, complete: 0, oldestPendingAt: null }, pendingCycles: 0, activeTasks: 0, failedJobs: [], failedJobsTruncated: false } },
  retention: { input: {}, response: { ...meta, policy: { version: 0, updatedAt: null, config: { enabled: false, rawRetentionHours: 720 } }, lastRun: null } },
  saveRetention: { input: { body: { requestId, expectedVersion: 0, config: { enabled: false, rawRetentionHours: 720 } } }, response: { ...meta, policy: { version: 1, updatedAt: at, config: { enabled: false, rawRetentionHours: 720 } }, lastRun: null } },
  operationHistory: { input: { query: { startDate: '2026-10-01', endDate: '2026-10-11', bindingId: 'binding-01' } }, response: { ...meta, records: [{ operation, effective: true }], nextCursor: null } },
  evidence: { input: { params: { id: 'binding-01' }, query: { startAt: '2026-10-11T03:00:00Z', endAt: '2026-10-11T03:02:00Z' } }, response: { ...meta, bindingId: 'binding-01', boundaryWindowMs: 5000, samples: [{ id: 'sample-before', sample: { scaleId: 'belt-01', bootId: 'startup-a', sequence: 122, sampledAt: '2026-10-11T03:00:58Z', grossG: 800, measurementStatus: 'ok' }, receivedAt: '2026-10-11T03:00:58Z' }, { id: 'sample-after', sample: { scaleId: 'belt-01', bootId: 'startup-a', sequence: 123, sampledAt: '2026-10-11T03:01:02Z', grossG: 1100, measurementStatus: 'ok' }, receivedAt: '2026-10-11T03:01:02Z' }], nextCursor: null } },
  samples: { input: { body: sampleInput }, response: { contractVersion: CONTRACT_VERSION, batchId, serverAt: at, results: [{ index: 0, scaleId: 'belt-01', bootId: 'startup-a', sequence: 123, status: 'accepted', code: 'STORED', retryable: false }] } },
  events: { input: { body: eventInput }, response: { contractVersion: CONTRACT_VERSION, batchId, serverAt: at, results: [{ index: 0, eventId, status: 'accepted', code: 'STORED', retryable: false, processingStatus: 'waiting_sample' }] } },
  operation: { input: { body: operationInput }, response: { ...meta, operation, affectedCycleIds: ['cycle-01'], projectionStatus: 'rebuilding' } },
  boundary: { input: { body: { requestId, bindingId: 'binding-01', occurredAt: at, type: 'exit_kitchen', note: '人工记录经过后厨出口' } }, response: { ...meta, eventId, origin: 'manual', cycleId: 'cycle-01', processingStatus: 'waiting_sample' } },
  cycles: { input: { query: { startDate: '2026-10-01', endDate: '2026-10-11' } }, response: { ...meta, rows: [cycle], nextCursor: null } },
  cycle: { input: { params: { id: 'cycle-01' } }, response: { ...meta, cycle, operations: [operation], revisions: [] } },
  reviewCycle: { input: { params: { id: 'cycle-01' }, body: { requestId, expectedVersion: 1, decision: 'keep_pending', evidenceIds: [], note: '等待回后厨事件' } }, response: { ...meta, cycle: { ...cycle, version: 2 }, projectionStatus: 'ready' } },
  serving: { input: {}, response: normalServing },
  tasks: { input: {}, response: { ...meta, rows: [openTask], nextCursor: null } },
  task: { input: { params: { id: 'task-01' } }, response: { ...meta, task: openTask, deferLimitSeconds: 60, history: [], evidenceIds: [] } },
  taskAction: { input: { params: { id: 'task-01' }, body: { requestId, expectedVersion: 1, action: 'report_complete', operationId: 'operation-refill' } }, response: { ...meta, task: verifyingTask } },
  rules: { input: {}, response: { ...meta, rules: [rule] } },
  saveRule: { input: { params: { dishId: 'dish-01' }, body: { requestId, expectedVersion: 1, config } }, response: { ...meta, rule: { ...rule, version: 2 } } },
  diagnostics: { input: {}, response: { ...meta, devices: [{ scaleId: 'belt-01', enabled: true, lastSampledAt: null, lastReceivedAt: null, delayMs: null, fault: null, countsSince: at, accepted: 0, duplicate: 0, rejected: 0, lastCode: null }] } },
  report: { input: { query: reportQuery }, response: { ...meta, scope: { startDate: '2026-10-01', endDate: '2026-10-11', timeZone: 'Asia/Shanghai', dateAttribution: 'cycle_end' }, basis: 'cycle_balance_v2', projectionStatus: 'ready', asOf: at, totals: { confirmedTakeG: null, pendingCycles: 1, dishCount: 1 }, rows: [{ dishId: 'dish-01', name: '示例菜', rank: null, confirmedTakeG: null, pendingCycles: 1, observationCoverage: null, cycleCoverage: null, stockoutMinutes: null, recordedDays: 0, operatingDays: null, operatingDaysBasis: 'unknown', qualityReasons: ['NO_DATA', 'PENDING_CYCLES'] }], nextCursor: null } },
  exportReport: { input: { query: { ...reportQuery, dataRevision: meta.dataRevision, snapshotAt: meta.serverAt } }, response: '\uFEFF"菜品","确认取用克","数据版本","质量"\r\n"示例菜","","fixture-1","无有效数据"\r\n' },
  devices: { input: {}, response: { ...meta, devices: [] } },
  saveDevice: { input: { params: { id: 'new-scale' }, body: { requestId, expectedVersion: 0, scaleId: 'new-scale', name: '新设备', enabled: false, positionOrder: null, measurement: null, binding: null } }, response: { ...meta, device: { scaleId: 'new-scale', name: '新设备', enabled: false, positionOrder: null, version: 1, measurement: null, binding: null, createdAt: at, updatedAt: at } } },
  credentials: { input: {}, response: { ...meta, credentials: [] } },
  issueCredential: { input: { body: { requestId, id: 'staff-credential', token: 'fixture-token-not-a-secret-0123456789', role: 'staff', actor, scaleIds: null, expiresAt: null } }, response: { ...meta, credential: { id: 'staff-credential', role: 'staff', actor, scaleIds: null, disabled: false, expiresAt: null } } },
  revokeCredential: { input: { params: { id: 'staff-credential' }, body: { requestId } }, response: { ...meta, credential: { id: 'staff-credential', role: 'staff', actor, scaleIds: null, disabled: true, expiresAt: null } } },
  freshnessRules: { input: {}, response: { ...meta, environment: 'test', source: 'operations_v2', rules: [] } },
  saveFreshnessRule: { input: { params: { dishId: 'dish-01' }, body: { requestId, expectedVersion: 0, config: { enabled: true, warnAfterMinutes: 60, expireAfterMinutes: 90 } } }, response: { ...meta, rule: { dishId: 'dish-01', version: 1, updatedAt: at, config: { enabled: true, warnAfterMinutes: 60, expireAfterMinutes: 90 } } } },
  freshnessBatches: { input: {}, response: { ...meta, environment: 'test', source: 'operations_v2', batches: [], nextCursor: null } },
  startFreshnessBatch: { input: { body: { requestId, bindingId: 'binding-01', expectedBindingVersion: 1, startedAt: at, openingFoodG: null } }, response: { ...meta, batch: { id: 'batch-01', bindingId: 'binding-01', scaleId: 'belt-01', dishId: 'dish-01', dishName: '示例菜', startedAt: at, closedAt: null, openingFoodG: null, status: 'active', state: 'fresh', elapsedMinutes: 0, ruleVersion: 1, warningAt: '2026-10-11T04:01:00Z', expiresAt: '2026-10-11T04:31:00Z', origin: 'manual' }, bindingVersion: 2 } },
  freshnessRemovals: { input: { query: { startDate: '2026-10-01', endDate: '2026-10-11' } }, response: { ...meta, environment: 'test', source: 'operations_v2', rows: [], nextCursor: null } },
} satisfies Record<EndpointName, Fixture>;

// Validate both directions when fixtures load, not only during a screenshot test.
for (const [name, value] of Object.entries(rawFixtures)) {
  const endpoint = endpoints[name as EndpointName], fixture: Fixture = value;
  endpoint.params.parse(fixture.input.params ?? {});
  endpoint.query.parse(fixture.input.query ?? {});
  endpoint.body.parse(fixture.input.body);
  endpoint.response.parse(fixture.response);
}
export function fixture<K extends EndpointName>(name: K): { input: EndpointInput<K>; response: EndpointResult<K> } {
  return structuredClone(rawFixtures[name]) as { input: EndpointInput<K>; response: EndpointResult<K> };
}
export const errors = {
  conflict: apiError('VERSION_CONFLICT', requestId, { currentVersion: 5 }),
  unavailable: apiError('UNAVAILABLE'), notImplemented: apiError('NOT_IMPLEMENTED'),
};
