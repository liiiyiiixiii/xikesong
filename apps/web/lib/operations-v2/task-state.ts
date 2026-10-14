import { rows } from './queries.ts';
import type { VisitRecord } from './kitchen-visits.ts';
import { readKitchenSettings } from './kitchen-settings.ts';
import { taskSchema, type RefillTask } from '@zhishan/contracts/v2/tasks';
import type { Bowl } from '@zhishan/contracts/v2/serving';
import type { OperationsStore, Write } from './storage.ts';
import type { Principal } from './security.ts';
import { canonical, decode, distinct, type BindingPayload, type LatestPayload, type OperationRecord, type Row, type Rule, type TaskPayload } from './records.ts';

const active = (task: RefillTask) => !['resolved', 'cancelled'].includes(task.status);
function systemEvent(payload: TaskPayload, at: string, event: NonNullable<TaskPayload['systemHistory']>[number]['event'], before: number | null, evidenceIds: string[] = []) {
  payload.systemHistory = [...(payload.systemHistory ?? []), { at, event, fromVersion: before, toVersion: payload.task.version, evidenceIds }];
}
export function taskWrite(payload: TaskPayload, insert: boolean): Write {
  const task = taskSchema.parse(payload.task);
  return { type: insert ? 'insert' : 'upsert', table: 'tasks', values: { id: task.id, binding_id: task.bindingId, status: task.status, version: task.version, defer_until: task.deferUntil, updated_at: task.updatedAt, payload: JSON.stringify(payload) } };
}
const responsible = (bowl: Bowl): RefillTask['responsibility'] => bowl.zone === 'customer' ? 'front' : bowl.zone === 'kitchen' ? 'kitchen' : 'unassigned';
export function capabilities(task: RefillTask, principal: Principal, manualAllowed: boolean, deferAllowed: boolean): RefillTask {
  const own = task.assignee?.id === principal.actor.id, manager = principal.role === 'manager';
  const allowed: RefillTask['allowedActions'] = [];
  if (active(task)) {
    if (task.status === 'open') allowed.push('claim');
    if ((task.status === 'open' || own || manager) && task.status !== 'verifying' && task.priority !== 'urgent' && deferAllowed) allowed.push('defer');
    if (own || manager) { allowed.push('handoff'); if (task.status === 'claimed') allowed.push('report_complete'); }
    if (manager && manualAllowed && task.status === 'verifying') allowed.push('verify_manual');
    if (manager) allowed.push('cancel');
  }
  return { ...task, allowedActions: allowed };
}
async function canVerify(store: OperationsStore, payload: TaskPayload, bowl: Bowl, now: string) {
  if (!payload.completionOperationId || bowl.quality !== 'good' || bowl.foodRemainingG === null || !bowl.observedAt || !bowl.confirmedAt || !['half', 'full'].includes(bowl.servingState)) return null;
  const row = await store.get<Row<OperationRecord>>('operations', payload.completionOperationId);
  if (!row) return null;
  const operation = decode(row), input = operation.input;
  if (input.type !== 'food_refill' || input.bindingId !== payload.task.bindingId || operation.status !== 'matched' || input.quantityStatus !== 'measured' || input.weightG === null || !input.evidenceIds.length || Date.parse(input.occurredAt) < Date.parse(payload.task.createdAt) || Date.parse(input.occurredAt) >= Date.parse(bowl.observedAt) || Date.parse(input.occurredAt) >= Date.parse(bowl.confirmedAt) || Date.parse(operation.recordedAt) > Date.parse(now)) return null;
  const corrections = await store.query<Row<OperationRecord>>('operations', { where: { corrects_id: operation.id }, limit: 1 });
  if (corrections.length) return null;
  const latest = await store.get<Row<LatestPayload>>('latest', bowl.scaleId);
  const observation = latest ? decode(latest).observation : null;
  if (!observation?.evidenceIds.length) return null;
  return distinct([operation.id, ...input.evidenceIds, ...observation.evidenceIds]);
}
/** Pure state decisions plus evidence reads. Caller commits task and serving projection together. */
export async function reconcileTask(store: OperationsStore, before: TaskPayload | null, bowl: Bowl | null, rule: Rule | null, now: string): Promise<TaskPayload | null> {
  if (!before && (!bowl || !['refill', 'urgent', 'verify'].includes(bowl.recommendation))) return null;
  if (!before) {
    const task: RefillTask = { id: crypto.randomUUID(), bindingId: bowl!.bindingId, status: 'open', priority: bowl!.recommendation === 'urgent' ? 'urgent' : bowl!.recommendation === 'refill' ? 'high' : 'normal', responsibility: responsible(bowl!), assignee: null, version: 0, deferUntil: null, verificationMethod: null, allowedActions: [], reasonCodes: bowl!.reasonCodes, createdAt: now, updatedAt: now };
    const payload: TaskPayload = { task, completionOperationId: null, evidenceIds: [], systemHistory: [] };
    systemEvent(payload, now, 'created', null); return payload;
  }
  if (!active(before.task)) return before;
  const payload: TaskPayload = structuredClone(before), task = payload.task;
  let event: NonNullable<TaskPayload['systemHistory']>[number]['event'] = 'reevaluated';
  let evidence: string[] = [];
  if (!bowl) { task.status = 'cancelled'; task.deferUntil = null; task.allowedActions = []; event = 'binding_closed'; }
  else {
    const urgent = bowl.recommendation === 'urgent';
    if (urgent && task.priority !== 'urgent') { task.priority = 'urgent'; event = 'upgraded'; }
    else if (bowl.recommendation === 'refill' && task.priority === 'normal') { task.priority = 'high'; event = 'upgraded'; }
    if (task.status === 'deferred' && (urgent || Date.parse(task.deferUntil!) <= Date.parse(now))) { task.status = task.assignee ? 'claimed' : 'open'; task.deferUntil = null; event = urgent ? 'upgraded' : 'defer_expired'; }
    task.reasonCodes = bowl.reasonCodes;
    if (!task.assignee && task.responsibility === 'unassigned') task.responsibility = responsible(bowl);
    const settings = await readKitchenSettings(store);
    if(settings.config.automaticRefillEnabled && bowl.quality==='good' && bowl.foodRemainingG!==null && ['half','full'].includes(bowl.servingState) && bowl.recommendation!=='refill' && bowl.recommendation!=='urgent'){
      const visits=(await rows<Row<VisitRecord>>(store,'kitchen_visits',{where:{binding_id:bowl.bindingId}})).map(decode).map(v=>v.current).filter(v=>v.status==='refill'&&v.exitedAt&&Date.parse(v.exitedAt)>=Date.parse(task.createdAt)&&bowl.confirmedAt&&Date.parse(bowl.confirmedAt)>=Date.parse(v.exitedAt)).sort((a,b)=>b.exitedAt!.localeCompare(a.exitedAt!));
      const visit=visits[0];
      if(visit){task.status='resolved';task.deferUntil=null;task.verificationMethod='automatic';task.allowedActions=[];payload.completionVisitId=visit.id;payload.completionVisitVersion=visit.version;payload.evidenceIds=distinct([...payload.evidenceIds,visit.id,...visit.evidenceIds]);event='auto_refill_verified';evidence=[visit.id];}
    }
    if (task.status === 'verifying') {
      const verified = await canVerify(store, payload, bowl, now);
      if (verified) { task.status = 'resolved'; task.verificationMethod = 'measurement'; task.allowedActions = []; evidence = verified; payload.evidenceIds = distinct([...payload.evidenceIds, ...verified]); event = 'measurement_verified'; }
    }
  }
  if (canonical(payload) === canonical(before)) return before;
  task.version++; task.updatedAt = now; systemEvent(payload, now, event, before.task.version, evidence);
  return payload;
}
export async function presented(store: OperationsStore, payload: TaskPayload, principal: Principal) {
  const binding = await store.get<Row<BindingPayload>>('bindings', payload.task.bindingId);
  const rule = binding ? await store.get<Row<Rule>>('rules', decode(binding).dishId) : null;
  const config = rule ? decode(rule).config : null;
  return capabilities(payload.task, principal, !!config?.manualVerificationAllowed, !!config?.enabled && !!config.halfPolicy);
}
