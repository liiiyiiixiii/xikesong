import { kitchenConfigResponseSchema, kitchenConfigWriteSchema, motionRequestSchema, motionResponseSchema, calibrationSchema, conveyorStateSchema, kitchenBoardSchema, kitchenBoardQuerySchema, visitsResponseSchema, visitsQuerySchema } from './kitchen.ts';
import { freshnessRulesResponseSchema, freshnessRuleResponseSchema, freshnessRuleWriteSchema, freshnessBatchQuerySchema, freshnessBatchesResponseSchema, freshnessStartSchema, freshnessStartResponseSchema, freshnessRemovalsQuerySchema, freshnessRemovalsResponseSchema } from './freshness.ts';
import { z } from 'zod';
import { emptyQuery, noParams, itemParams, id, limits } from './common.ts';
import { samplesRequestSchema, samplesResponseSchema, eventsRequestSchema, eventsResponseSchema } from './telemetry.ts';
import { operationRequestSchema, operationResponseSchema, boundaryRequestSchema, boundaryResponseSchema, cycleQuerySchema, cyclesResponseSchema, cycleDetailResponseSchema, cycleReviewRequestSchema, cycleReviewResponseSchema } from './operations.ts';
import { servingResponseSchema, ruleWriteSchema, rulesResponseSchema, ruleResponseSchema, diagnosticsResponseSchema } from './serving.ts';
import { tasksQuerySchema, tasksResponseSchema, taskDetailResponseSchema, taskActionRequestSchema, taskResponseSchema } from './tasks.ts';
import { reportQuerySchema, reportResponseSchema, exportQuerySchema, csvResponseSchema } from './reports.ts';
import { deviceWriteSchema, deviceResponseSchema, devicesResponseSchema, credentialWriteSchema, credentialResponseSchema, credentialsResponseSchema, credentialRevokeSchema } from './configuration.ts';
import { evidenceQuerySchema, evidenceResponseSchema } from './evidence.ts';
import { operationHistoryQuerySchema, operationHistoryResponseSchema } from './operations.ts';
import { runtimeResponseSchema, retentionResponseSchema, retentionWriteSchema } from './system.ts';
import { aiEvidenceQuerySchema, aiEvidenceResponseSchema } from './intelligence.ts';

export interface EndpointContract {
  method: 'GET' | 'POST' | 'PUT'; path: string;
  permission: 'device' | 'staff' | 'manager';
  params: z.ZodTypeAny; query: z.ZodTypeAny; body: z.ZodTypeAny;
  response: z.ZodTypeAny; format: 'json' | 'csv'; maxBytes: number;
}
const read = { method: 'GET', permission: 'staff', params: noParams, query: emptyQuery, body: z.undefined(), format: 'json', maxBytes: 0 } as const;
const write = { method: 'POST', permission: 'staff', params: noParams, query: emptyQuery, format: 'json', maxBytes: limits.operationBytes } as const;
/** Single registry for route skeletons, client validation and contract fixtures. */
export const endpoints = {
  kitchenConfig: { ...read, path: '/api/v2/conveyor/config', permission: 'manager', response: kitchenConfigResponseSchema },
  saveKitchenConfig: { ...write, method: 'PUT', path: '/api/v2/conveyor/config', permission: 'manager', body: kitchenConfigWriteSchema, response: kitchenConfigResponseSchema },
  conveyorMotion: { ...write, path: '/api/v2/telemetry/conveyor', permission: 'device', body: motionRequestSchema, response: motionResponseSchema },
  calibrateConveyor: { ...write, path: '/api/v2/conveyor/calibrate', permission: 'manager', body: calibrationSchema, response: conveyorStateSchema },
  conveyorState: { ...read, path: '/api/v2/conveyor/state', response: conveyorStateSchema },
  kitchenBoard: { ...read, path: '/api/v2/kitchen/board', query: kitchenBoardQuerySchema, response: kitchenBoardSchema },
  kitchenVisits: { ...read, path: '/api/v2/kitchen/visits', query: visitsQuerySchema, response: visitsResponseSchema },
  aiEvidence: { ...read, path: '/api/v2/intelligence/evidence', query: aiEvidenceQuerySchema, response: aiEvidenceResponseSchema },
  runtime: { ...read, path: '/api/v2/system/diagnostics', permission: 'manager', response: runtimeResponseSchema },
  retention: { ...read, path: '/api/v2/system/retention', permission: 'manager', response: retentionResponseSchema },
  saveRetention: { ...write, method: 'PUT', path: '/api/v2/system/retention', permission: 'manager', body: retentionWriteSchema, response: retentionResponseSchema },
  operationHistory: { ...read, path: '/api/v2/operations', query: operationHistoryQuerySchema, response: operationHistoryResponseSchema },
  evidence: { ...read, path: '/api/v2/bindings/{id}/evidence', params: itemParams, query: evidenceQuerySchema, response: evidenceResponseSchema },
  freshnessRules: { ...read, path: '/api/v2/freshness/rules', response: freshnessRulesResponseSchema },
  saveFreshnessRule: { ...write, method: 'PUT', path: '/api/v2/freshness/rules/{dishId}', permission: 'manager', params: z.object({ dishId: id }).strict(), body: freshnessRuleWriteSchema, response: freshnessRuleResponseSchema },
  freshnessBatches: { ...read, path: '/api/v2/freshness/batches', query: freshnessBatchQuerySchema, response: freshnessBatchesResponseSchema },
  startFreshnessBatch: { ...write, path: '/api/v2/freshness/batches', body: freshnessStartSchema, response: freshnessStartResponseSchema },
  freshnessRemovals: { ...read, path: '/api/v2/freshness/removals', query: freshnessRemovalsQuerySchema, response: freshnessRemovalsResponseSchema },
  samples: { ...write, path: '/api/v2/telemetry/samples', permission: 'device', maxBytes: limits.sampleBytes, body: samplesRequestSchema, response: samplesResponseSchema },
  events: { ...write, path: '/api/v2/telemetry/events', permission: 'device', maxBytes: limits.eventBytes, body: eventsRequestSchema, response: eventsResponseSchema },
  operation: { ...write, path: '/api/v2/operations', body: operationRequestSchema, response: operationResponseSchema },
  boundary: { ...write, path: '/api/v2/operations/boundary', body: boundaryRequestSchema, response: boundaryResponseSchema },
  cycles: { ...read, path: '/api/v2/cycles', query: cycleQuerySchema, response: cyclesResponseSchema },
  cycle: { ...read, path: '/api/v2/cycles/{id}', params: itemParams, response: cycleDetailResponseSchema },
  reviewCycle: { ...write, path: '/api/v2/cycles/{id}/review', permission: 'manager', params: itemParams, body: cycleReviewRequestSchema, response: cycleReviewResponseSchema },
  serving: { ...read, path: '/api/v2/serving/state', response: servingResponseSchema },
  tasks: { ...read, path: '/api/v2/refill/tasks', query: tasksQuerySchema, response: tasksResponseSchema },
  task: { ...read, path: '/api/v2/refill/tasks/{id}', params: itemParams, response: taskDetailResponseSchema },
  taskAction: { ...write, path: '/api/v2/refill/tasks/{id}/actions', params: itemParams, body: taskActionRequestSchema, response: taskResponseSchema },
  rules: { ...read, path: '/api/v2/serving/rules', permission: 'manager', response: rulesResponseSchema },
  saveRule: { ...write, method: 'PUT', path: '/api/v2/serving/rules/{dishId}', permission: 'manager', params: z.object({ dishId: id }).strict(), body: ruleWriteSchema, response: ruleResponseSchema },
  diagnostics: { ...read, path: '/api/v2/devices/diagnostics', permission: 'manager', response: diagnosticsResponseSchema },
  report: { ...read, path: '/api/v2/reports/consumption', query: reportQuerySchema, response: reportResponseSchema },
  exportReport: { ...read, path: '/api/v2/reports/consumption/export', query: exportQuerySchema, response: csvResponseSchema, format: 'csv' },
  devices: { ...read, path: '/api/v2/devices', permission: 'manager', response: devicesResponseSchema },
  saveDevice: { ...write, method: 'PUT', path: '/api/v2/devices/{id}', permission: 'manager', params: itemParams, body: deviceWriteSchema, response: deviceResponseSchema },
  credentials: { ...read, path: '/api/v2/access/credentials', permission: 'manager', response: credentialsResponseSchema },
  issueCredential: { ...write, path: '/api/v2/access/credentials', permission: 'manager', body: credentialWriteSchema, response: credentialResponseSchema },
  revokeCredential: { ...write, path: '/api/v2/access/credentials/{id}/revoke', permission: 'manager', params: itemParams, body: credentialRevokeSchema, response: credentialResponseSchema },
} as const satisfies Record<string, EndpointContract>;
export type EndpointName = keyof typeof endpoints;
export type EndpointResult<K extends EndpointName> = z.output<(typeof endpoints)[K]['response']>;
export type EndpointInput<K extends EndpointName> = {
  params?: z.input<(typeof endpoints)[K]['params']>;
  query?: z.input<(typeof endpoints)[K]['query']>;
  body?: z.input<(typeof endpoints)[K]['body']>;
};

export function matchEndpoint(pathname: string, method: string) {
  const parts = pathname.replace(/\/$/, '').split('/');
  for (const [name, endpoint] of Object.entries(endpoints)) {
    if (endpoint.method !== method) continue;
    const pattern = endpoint.path.split('/');
    if (parts.length !== pattern.length) continue;
    const params: Record<string, string> = {};
    let matches = true;
    for (let i = 0; i < pattern.length; i++) {
      const segment = pattern[i];
      if (segment.startsWith('{')) {
        try { params[segment.slice(1, -1)] = decodeURIComponent(parts[i]); } catch { matches = false; }
      } else if (segment !== parts[i]) matches = false;
    }
    if (matches) return { name: name as EndpointName, endpoint, params };
  }
  return null;
}
