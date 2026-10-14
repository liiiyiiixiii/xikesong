import type { ScaleConfig } from '../scales/types.ts';

export interface FreshnessRule { dishId:string; enabled:boolean; maxMinutes:number; warningMinutes:number; updatedAt:string }
export interface FreshnessBatch {
  id:string; scaleId:string; dishId:string; dishName:string; startedAt:string; deadlineAt:string; warningMinutes:number;
  openingG:number|null; status:'active'|'closed'; closedAt?:string; closeRequestId?:string;
  remainingG?:number; disposition?:'waste'|'retain'; reason?:'display_age'|'closing'|'other';
  partialWasteG?:number; partialRetainedG?:number; observedTakeG?:number; observedRefillG?:number; coverage?:number; quality?:'usable'|'incomplete';
}
export type TimerStatus='running'|'soon'|'overdue'|'unknown'|'waiting';
export interface FreshnessTimer { scaleId:string; dishId:string; name:string; status:TimerStatus; batch:FreshnessBatch|null; deviceEnabled:boolean }
export interface SupplySuggestion { dishId:string; name:string; period:string; level:'observe'|'reduce'|'review_pause'; message:string; batches:number; usableBatches:number; affectedDays:number; wasteG:number; remainingRatio:number|null; evidenceIds:string[] }
export interface SupplyDecision { id:string; dishId:string; period:string; choice:'reduce'|'trial_pause'|'keep'; note:string; at:string; evidenceIds:string[] }
export interface FreshnessRemoval { id:string; dishId:string; name:string; scaleId:string; at:string; weightG:number; disposition:'waste'|'retain'; reason?:string; batchId?:string; startedAt?:string; scope?:'partial'|'full' }
export interface FreshnessView { removals?:FreshnessRemoval[]; scope?:{from:string;to:string}; at:string; rules:FreshnessRule[]; timers:FreshnessTimer[]; feedback:FreshnessBatch[]; suggestions:SupplySuggestion[]; decisions:SupplyDecision[]; catalog:{id:string;name:string}[] }
export function timerStatus(batch:FreshnessBatch, now:string):TimerStatus {
  if(batch.status==='closed')return 'waiting';
  const left=Date.parse(batch.deadlineAt)-Date.parse(now);
  return left<=0?'overdue':left<=batch.warningMinutes*60000?'soon':'running';
}
export function makeBatch(id:string,config:ScaleConfig,rule:FreshnessRule,startedAt:string,openingG:number|null):FreshnessBatch {
  return {id,scaleId:config.id,dishId:config.dishId,dishName:config.dishName,startedAt,deadlineAt:new Date(Date.parse(startedAt)+rule.maxMinutes*60000).toISOString(),warningMinutes:rule.warningMinutes,openingG,status:'active'};
}
export const localDay=(at:string)=>new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);
export function supplyPeriod(at:string){const hour=new Date(Date.parse(at)+8*3600000).getUTCHours();return hour<11?'早间':hour<14?'午间':hour<17?'下午':hour<21?'晚间':'夜间';}
// Compare like periods, require observations across days, and expose the rule rather than presenting it as a prediction.
export function supplySuggestions(batches:FreshnessBatch[]):SupplySuggestion[] {
  const groups=new Map<string,FreshnessBatch[]>();
  for(const b of batches){if(b.status!=='closed')continue;const key=b.dishId+'|'+supplyPeriod(b.startedAt);groups.set(key,[...(groups.get(key)??[]),b]);}
  return [...groups.values()].map(rows=>{
    const usable=rows.filter(b=>b.quality==='usable'&&b.openingG!==null&&b.openingG+(b.observedRefillG??0)>0);
    const affected=usable.filter(b=>b.reason==='display_age'&&Date.parse(b.closedAt!)>=Date.parse(b.deadlineAt)&&(b.remainingG??0)/(b.openingG!+(b.observedRefillG??0))>=.3);
    const days=new Set(affected.map(b=>localDay(b.startedAt))).size;
    const supplied=usable.reduce((n,b)=>n+b.openingG!+(b.observedRefillG??0),0), remaining=usable.reduce((n,b)=>n+(b.remainingG??0),0);
    const ratio=supplied?remaining/supplied:null;
    const level=days>=7&&affected.length>=7&&affected.length/Math.max(1,usable.length)>=.7&&ratio!==null&&ratio>=.7?'review_pause':days>=3&&affected.length>=3&&affected.length/Math.max(1,usable.length)>=.5?'reduce':'observe';
    return {dishId:rows[0].dishId,name:rows[0].dishName,period:supplyPeriod(rows[0].startedAt),level,
      message:level==='review_pause'?'持续超时剩余较多：先减量，并由管理者评估缩短供应时段或试停供；不能据此认定无人需要。':level==='reduce'?'多个可比营业日出现超时剩余：建议减少该时段单盘上台量，采用少量多次补充。':'继续观察；单次超时或观测不足不能判定需求下降。可先核对单盘上台量。',
      batches:rows.length,usableBatches:usable.length,affectedDays:days,wasteG:rows.reduce((n,b)=>n+(b.partialWasteG??0)+(b.disposition==='waste'?(b.remainingG??0):0),0),remainingRatio:ratio,evidenceIds:rows.map(b=>b.id)};
  });
}
