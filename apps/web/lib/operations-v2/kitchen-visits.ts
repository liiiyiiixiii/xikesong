import type { KitchenVisit } from '@zhishan/contracts/v2/kitchen';
import { effectiveOperations, gramsToMg, type MeasurementInput, type MeasurementEvent, type MeasurementSample } from './measurement.ts';
import { latestFault } from './fault-state.ts';
export type VisitRecord={current:KitchenVisit;revisions:KitchenVisit[]};
const at=(s:string)=>Date.parse(s);
/** Independent inference over a kitchen stay. Never injects food changes into a customer cycle. */
export function identifyKitchenVisits(input:MeasurementInput,enabledAt:string|null):KitchenVisit[]{
 if(!enabledAt)return [];
 const {binding,config}=input,now=at(input.asOf),end=binding.validTo?at(binding.validTo):Infinity;
 const validTime=(t:string)=>at(t)>=at(binding.validFrom)&&at(t)<end&&at(t)<=now;
 const events=input.events.filter(e=>e.event.scaleId===binding.scaleId&&validTime(e.event.occurredAt)&&at(e.receivedAt)<=now).sort((a,b)=>at(a.event.occurredAt)-at(b.event.occurredAt)||a.event.eventId.localeCompare(b.event.eventId));
 const samples=input.samples.filter(s=>s.sample.scaleId===binding.scaleId&&validTime(s.sample.sampledAt)&&at(s.receivedAt)<=now).sort((a,b)=>at(a.sample.sampledAt)-at(b.sample.sampledAt)||a.sample.sequence-b.sample.sequence);
 const operations=effectiveOperations([...input.operations].filter(o=>at(o.recordedAt)<=now));
 const boundaries=events.filter(e=>['enter_kitchen','exit_kitchen'].includes(e.event.type));
 const visits:KitchenVisit[]=[];let entry:MeasurementEvent|null=null;
 const make=(enter:MeasurementEvent,exit:MeasurementEvent|null,conflict=false)=>{
  if(at(enter.event.occurredAt)<at(enabledAt))return;
  const from=at(enter.event.occurredAt),to=exit?at(exit.event.occurredAt):Math.min(now,end);
  const visit:KitchenVisit={id:'visit:'+enter.event.eventId,bindingId:binding.id,enteredAt:enter.event.occurredAt,exitedAt:exit?.event.occurredAt??null,status:exit?'pending':'processing',refillG:null,evidenceIds:[enter.event.eventId,...(exit?[exit.event.eventId]:[])],reasonCodes:[],source:'system_inference',version:0};
  const reason=visit.reasonCodes;
  if(conflict||to<=from)reason.push('BOUNDARY_CONFLICT');
  const intervalOps=operations.filter(o=>at(o.input.occurredAt)>=from&&at(o.input.occurredAt)<=to);
  if(intervalOps.length)reason.push('REGISTERED_OPERATION');
  visit.evidenceIds.push(...operations.filter(o=>at(o.input.occurredAt)<=to&&(o.status!=='matched'||o.input.type!=='food_refill')).flatMap(o=>[o.id,...o.input.evidenceIds]));
  // Once unknown material was added, gross weight cannot recover food composition by itself.
  if(!binding.foodOnly||operations.some(o=>at(o.input.occurredAt)<=to&&(o.status!=='matched'||o.input.type!=='food_refill')))reason.push('UNKNOWN_COMPOSITION');
  const earlier=samples.filter(s=>at(s.sample.sampledAt)<=from);
  const unknownEarlier=earlier.some((s,i)=>{
   if(s.sample.grossG!==null&&s.sample.grossG<binding.tareG){visit.evidenceIds.push(s.id);return true;}
   if(!i||s.sample.measurementStatus!=='ok'||earlier[i-1].sample.measurementStatus!=='ok')return false;
   const previous=earlier[i-1],a=at(previous.sample.sampledAt),b=at(s.sample.sampledAt);
   if(visits.some(v=>v.status==='refill'&&v.exitedAt&&a>=at(v.enteredAt)&&b<=at(v.exitedAt)))return false;
   const explained=operations.filter(o=>o.status==='matched'&&o.input.type==='food_refill'&&at(o.input.occurredAt)>a&&at(o.input.occurredAt)<=b).reduce((sum,o)=>sum+(o.input.weightG??0),0);
   const unknown=s.sample.grossG!-previous.sample.grossG!-explained>config.stableToleranceG;if(unknown)visit.evidenceIds.push(previous.id,s.id);return unknown;
  });
  if(unknownEarlier)reason.push('UNKNOWN_PRIOR_COMPOSITION');
  const resolve=(event:MeasurementEvent)=>{
   const t=at(event.event.occurredAt),ref='sampleRef' in event.event?event.event.sampleRef:undefined;
   const candidates=samples.filter(s=>Math.abs(at(s.sample.sampledAt)-t)<=(config.boundaryWindowMs??0)&&(!ref||s.sample.bootId===ref.bootId&&s.sample.sequence===ref.sequence));
   candidates.sort((a,b)=>Math.abs(at(a.sample.sampledAt)-t)-Math.abs(at(b.sample.sampledAt)-t));
   if(!candidates.length||!ref&&candidates.length>1&&Math.abs(at(candidates[0].sample.sampledAt)-t)===Math.abs(at(candidates[1].sample.sampledAt)-t))return null;
   const chosen=candidates[0],q=at(chosen.sample.sampledAt);
   if('bootId' in event.event&&chosen.sample.bootId!==event.event.bootId)return null;
   const stable=samples.filter(s=>s.sample.bootId===chosen.sample.bootId&&at(s.sample.sampledAt)<=q&&at(s.sample.sampledAt)>=q-config.stableWindowMs-config.maxSampleGapMs);
   const tail:MeasurementSample[]=[];for(let i=stable.length-1;i>=0;i--){tail.unshift(stable[i]);if(q-at(stable[i].sample.sampledAt)>=config.stableWindowMs)break;}
   if(tail.length<config.stableMinSamples||!tail.length||q-at(tail[0].sample.sampledAt)<config.stableWindowMs||tail.some((s,i)=>s.sample.measurementStatus!=='ok'||s.sample.grossG<binding.tareG||i>0&&(s.sample.sequence!==tail[i-1].sample.sequence+1||at(s.sample.sampledAt)-at(tail[i-1].sample.sampledAt)>config.maxSampleGapMs)))return null;
   const values=tail.map(s=>s.sample.grossG!);if(Math.max(...values)-Math.min(...values)>config.stableToleranceG)return null;
   visit.evidenceIds.push(...tail.map(s=>s.id));return chosen;
  };
  const before=resolve(enter),after=exit?resolve(exit):null;
  if(!before||exit&&!after)reason.push('MISSING_STABLE_BOUNDARY');
  const a=before?Math.min(from,at(before.sample.sampledAt)):from,b=after?Math.max(to,at(after.sample.sampledAt)):to;
  const readings=samples.filter(s=>at(s.sample.sampledAt)>=a&&at(s.sample.sampledAt)<=b);
  visit.evidenceIds.push(...readings.map(s=>s.id),...intervalOps.flatMap(o=>[o.id,...o.input.evidenceIds]));
  visit.evidenceIds.push(...[...(input.priorFault?[input.priorFault]:[]),...events].filter(e=>e.event.type==='device_fault'&&at(e.event.occurredAt)<=b).map(e=>e.event.eventId));
  if(latestFault([...(input.priorFault?[input.priorFault]:[]),...events],a)?.event.type==='device_fault'||events.some(e=>e.event.type==='device_fault'&&at(e.event.occurredAt)>=a&&at(e.event.occurredAt)<=b))reason.push('DEVICE_FAULT');
  if(readings.some((s,i)=>s.sample.measurementStatus!=='ok'||s.sample.grossG<binding.tareG||i>0&&(s.sample.bootId!==readings[i-1].sample.bootId||s.sample.sequence!==readings[i-1].sample.sequence+1||at(s.sample.sampledAt)-at(readings[i-1].sample.sampledAt)>config.maxSampleGapMs)))reason.push('DATA_GAP');
  if(readings.some((s,i)=>i>0&&s.sample.grossG!==null&&readings[i-1].sample.grossG!==null&&readings[i-1].sample.grossG!-s.sample.grossG>config.stableToleranceG))reason.push('UNEXPLAINED_REMOVAL');
  if(exit&&before&&after&&before.sample.bootId!==after.sample.bootId)reason.push('BOOT_CHANGED');
  if(binding.validTo&&to>=end)reason.push('BINDING_CHANGED');
  if(intervalOps.length)visit.status='exception';
  else if(reason.length)visit.status='pending';
  else if(exit&&before&&after){const delta=gramsToMg(after.sample.grossG!)-gramsToMg(before.sample.grossG!);visit.status=delta>gramsToMg(config.stableToleranceG)?'refill':'unchanged';visit.refillG=visit.status==='refill'?delta/1000:0;}
  visit.evidenceIds=[...new Set(visit.evidenceIds)];visit.reasonCodes=[...new Set(reason)];visits.push(visit);
 };
 for(const boundary of boundaries){if(boundary.event.type==='enter_kitchen'){if(entry)make(entry,null,true);entry=boundary;}else if(entry){make(entry,boundary);entry=null;}}
 if(entry)make(entry,null);
 return visits;
}
