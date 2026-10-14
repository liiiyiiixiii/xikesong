import type { TrackConfig, TrackMotion, KitchenCard } from '@zhishan/contracts/v2/kitchen';
import { conveyorTrackSchema } from '@zhishan/contracts/v2/kitchen';
import { readKitchenSettings } from './kitchen-settings.ts';
import { canonical, decode, mutate, operationsMeta, type Row, type BindingPayload } from './records.ts';
import { OperationsError } from './security.ts';
import { rows } from './queries.ts';
import { reconcileServing } from './serving-coordinator.ts';
import { freshnessBatchView, type FreshnessBatchPayload } from './compatibility.ts';
import { projectionJob } from './configuration.ts';
import type { OperationsStore, Write } from './storage.ts';
import type { EndpointContext, OperationsServices } from './router.ts';

type MotionState={generation:string;motion:TrackMotion;phaseM:number|null;fingerprint:string;invalid:boolean};
export const wrap=(n:number,length:number)=>((n%length)+length)%length;
const stateId=(id:string)=>'conveyor:'+id;
const readMotion=async(store:OperationsStore,id:string)=>{const row=await store.get<Row<MotionState>>('system',stateId(id));if(!row)return null;const state=decode(row);return {...state,invalid:state.invalid||state.generation!==store.generation};};
const writeMotion=(id:string,state:MotionState,now:string):Write=>({type:'upsert',table:'system',values:{id:stateId(id),updated_at:now,payload:JSON.stringify(state)}});
export function projectTrack(track:TrackConfig,state:MotionState|null,now:string){
 const delta=state?Date.parse(now)-Date.parse(state.motion.occurredAt):Infinity;
 const quality=!state?'unconfigured':state.invalid||state.phaseM===null||state.fingerprint!==canonical(track)||state.motion.direction!==track.direction?'recalibration':delta<0||delta>track.freshMs?'stale':'estimated';
 const phaseM=quality==='estimated'?wrap(state!.phaseM!+state!.motion.direction*state!.motion.speedMps*delta/1000,track.lengthM):null;
 return conveyorTrackSchema.parse({trackId:track.id,name:track.name,lengthM:track.lengthM,direction:track.direction,quality,bootId:state?.motion.bootId??null,sequence:state?.motion.sequence??null,running:state?.motion.running??null,speedMps:state?.motion.speedMps??null,observedAt:state?.motion.occurredAt??null,validUntil:state?new Date(Date.parse(state.motion.occurredAt)+track.freshMs).toISOString():null,phaseM,positions:phaseM===null?[]:track.carriers.map(c=>({scaleId:c.scaleId,positionM:wrap(c.offsetM+phaseM,track.lengthM)}))});
}
export async function conveyorSnapshot(store:OperationsStore,now:string){
 const settings=await readKitchenSettings(store);
 return {settings,tracks:await Promise.all(settings.config.tracks.map(async t=>projectTrack(t,await readMotion(store,t.id),now)))};
}
async function state(c:EndpointContext<'conveyorState'>){
 for(let i=0;i<5;i++){const rev=await c.store.revision(),s=await conveyorSnapshot(c.store,c.now);if(rev===await c.store.revision())return {...operationsMeta(c.store,c.now,rev),environment:c.store.environment,tracks:s.tracks};}
 throw new OperationsError('UNAVAILABLE');
}
async function save(c:EndpointContext<'saveKitchenConfig'>){
 return mutate(c,'kitchen.config',c.body.requestId,c.body,async revision=>{
  const old=await readKitchenSettings(c.store);if(old.version!==c.body.expectedVersion)throw new OperationsError('VERSION_CONFLICT',old.version);
  for(const t of c.body.config.tracks)for(const carrier of t.carriers)if(!await c.store.get('devices',carrier.scaleId))throw new OperationsError('NOT_FOUND');
  const settings={version:old.version+1,updatedAt:c.now,enabledAt:c.body.config.automaticRefillEnabled?(old.config.automaticRefillEnabled?old.enabledAt:c.now):null,config:c.body.config};
  const writes:Write[]=[{type:'upsert',table:'system',values:{id:'kitchen-settings',updated_at:c.now,payload:JSON.stringify(settings)}}];
  for(const b of await rows<Row<BindingPayload>>(c.store,'bindings',{where:{valid_to:null}}))writes.push(projectionJob(b.id,revision+1,c.now));
  return {writes,response:{...operationsMeta(c.store,c.now,revision+1),settings}};
 });
}
async function motion(c:EndpointContext<'conveyorMotion'>){
 const m=c.body.motion;
 if(!c.principal.trackIds?.includes(m.trackId))throw new OperationsError('FORBIDDEN');
 if(Date.parse(m.occurredAt)>Date.parse(c.now)||Date.parse(c.now)-Date.parse(m.occurredAt)>86400000)throw new OperationsError('INVALID_REQUEST');
 return mutate(c,'conveyor.motion',c.body.requestId,c.body,async revision=>{
  const settings=await readKitchenSettings(c.store),track=settings.config.tracks.find(t=>t.id===m.trackId);if(!track)throw new OperationsError('NOT_FOUND');
  const id=JSON.stringify([m.trackId,m.bootId,m.sequence]),existing=await c.store.get<{payload:string}>('conveyor_events',id);
  if(existing){if(canonical(JSON.parse(existing.payload))!==canonical(m))throw new OperationsError('ID_CONFLICT');return {writes:[],response:{...operationsMeta(c.store,c.now,revision+1),status:'ignored' as const}};}
  const old=await readMotion(c.store,m.trackId),seenBoot=(await c.store.query('conveyor_events',{where:{track_id:m.trackId,boot_id:m.bootId},limit:1})).length>0;
  const obsolete=old&&(m.bootId===old.motion.bootId?(m.sequence<=old.motion.sequence||Date.parse(m.occurredAt)<Date.parse(old.motion.occurredAt)):seenBoot);
  const writes:Write[]=[{type:'insert',table:'conveyor_events',values:{id,track_id:m.trackId,boot_id:m.bootId,sequence:m.sequence,occurred_at:m.occurredAt,payload:JSON.stringify(m)}}];
  if(!obsolete){
   const dt=old?Date.parse(m.occurredAt)-Date.parse(old.motion.occurredAt):Infinity;
   const valid=m.positionValid!==false&&old&&!old.invalid&&old.phaseM!==null&&old.fingerprint===canonical(track)&&old.motion.bootId===m.bootId&&m.sequence===old.motion.sequence+1&&dt>=0&&dt<=track.freshMs&&m.direction===track.direction;
   const phaseM=valid?wrap(old.phaseM!+old.motion.direction*old.motion.speedMps*dt/1000,track.lengthM):null;
   writes.push(writeMotion(m.trackId,{generation:c.store.generation,motion:m,phaseM,invalid:!valid,fingerprint:canonical(track)},c.now));
  }
  return {writes,response:{...operationsMeta(c.store,c.now,revision+1),status:obsolete?'ignored' as const:'stored' as const}};
 });
}
async function calibrate(c:EndpointContext<'calibrateConveyor'>){
 return mutate(c,'conveyor.calibrate',c.body.requestId,c.body,async revision=>{
  const settings=await readKitchenSettings(c.store);if(settings.version!==c.body.expectedVersion)throw new OperationsError('VERSION_CONFLICT',settings.version);
  const track=settings.config.tracks.find(t=>t.id===c.body.trackId),current=await readMotion(c.store,c.body.trackId);
  if(!track||!current)throw new OperationsError('NOT_FOUND');
  if(current.motion.positionValid===false||current.motion.running||c.body.phaseM>=track.lengthM||current.motion.bootId!==c.body.bootId||current.motion.sequence!==c.body.sequence||current.motion.direction!==track.direction||Date.parse(c.now)<Date.parse(current.motion.occurredAt)||Date.parse(c.now)-Date.parse(current.motion.occurredAt)>track.freshMs)throw new OperationsError('INVALID_TRANSITION');
  const next={...current,generation:c.store.generation,phaseM:c.body.phaseM,invalid:false,fingerprint:canonical(track)};
  const tracks=await Promise.all(settings.config.tracks.map(async t=>projectTrack(t,t.id===track.id?next:await readMotion(c.store,t.id),c.now)));
  return {writes:[writeMotion(track.id,next,c.now)],response:{...operationsMeta(c.store,c.now,revision+1),environment:c.store.environment,tracks}};
 });
}
export function cardAlert(b:KitchenCard['bowl'],freshness:KitchenCard['freshness']):KitchenCard['alert']{
 if(freshness?.state==='expired')return 'expired';
 if(b.servingState==='empty')return 'empty';
 if(b.recommendation==='refill'||b.recommendation==='urgent')return 'refill';
 if(freshness?.state==='warning')return 'warning';
 return b.foodRemainingG===null||!['good','estimated'].includes(b.quality)?'unknown':'none';
}
async function board(c:EndpointContext<'kitchenBoard'>){
 for(let attempt=0;attempt<5;attempt++){
  const result=await reconcileServing(c.store,c.now),rev=result.revision,{settings,tracks}=await conveyorSnapshot(c.store,c.now);
  const bindings=new Map((await rows<Row<BindingPayload>>(c.store,'bindings',{where:{valid_to:null}})).map(r=>[r.id,decode(r)]));
  const batches=await rows<Row<FreshnessBatchPayload>&{binding_id:string;started_at:string;closed_at:string|null}>(c.store,'freshness_batches',{where:{closed_at:null}});
  const all:KitchenCard[]=result.bowls.map(b=>{const binding=bindings.get(b.bindingId),row=batches.find(x=>x.binding_id===b.bindingId),freshness=row&&binding?freshnessBatchView(row,binding,c.now):null;const known=['good','estimated'].includes(b.quality)&&b.foodRemainingG!==null;return {bowl:b,percent:known?Math.round(b.foodRemainingG!/b.fullFoodG*100):null,estimated:b.quality==='estimated',freshness,alert:cardAlert(b,freshness),distanceM:null};});
  const windows=settings.config.tracks.flatMap(t=>t.windows.map(w=>({id:w.id,name:w.name,trackId:t.id,pending:all.filter(x=>t.carriers.some(p=>p.scaleId===x.bowl.scaleId)&&x.alert!=='none').length})));
  const selected=windows.find(w=>w.id===c.query.windowId)??(c.query.windowId?null:windows[0]);
  if(c.query.windowId&&!selected)throw new OperationsError('NOT_FOUND');
  const track=settings.config.tracks.find(t=>t.id===selected?.trackId),live=tracks.find(t=>t.trackId===selected?.trackId),window=track?.windows.find(w=>w.id===selected?.id);
  const processing:KitchenCard[]=[],upcoming:KitchenCard[]=[];
  if(track&&live&&window){
   for(const item of all.filter(x=>track.carriers.some(p=>p.scaleId===x.bowl.scaleId))){
    const pos=live.positions.find(p=>p.scaleId===item.bowl.scaleId),inside=pos&&wrap((pos.positionM-window.enterM)*track.direction,track.lengthM)<wrap((window.exitM-window.enterM)*track.direction,track.lengthM);
    if(item.bowl.zone==='kitchen'||inside){if(item.alert!=='none')processing.push(item);continue;}
    if(pos)upcoming.push({...item,distanceM:wrap((window.enterM-pos.positionM)*track.direction,track.lengthM)});
   }
  }
  upcoming.sort((a,b)=>a.distanceM!-b.distanceM!||a.bowl.scaleId.localeCompare(b.bowl.scaleId));
  if(rev===await c.store.revision())return {...operationsMeta(c.store,c.now,rev),environment:c.store.environment,automaticRefillEnabled:settings.config.automaticRefillEnabled,windowId:selected?.id??null,quality:live?.quality??'unconfigured',windows,upcoming:upcoming.slice(0,10),processing,all};
 }
 throw new OperationsError('UNAVAILABLE');
}
async function stableRead<T>(store:OperationsStore,read:()=>Promise<T>){
 for(let i=0;i<5;i++){const revision=await store.revision(),value=await read();if(revision===await store.revision())return {revision,value};}
 throw new OperationsError('UNAVAILABLE');
}
export const conveyorServices={
 kitchenConfig:async(c:EndpointContext<'kitchenConfig'>)=>{const s=await stableRead(c.store,()=>readKitchenSettings(c.store));return {...operationsMeta(c.store,c.now,s.revision),settings:s.value};},
 saveKitchenConfig:save,conveyorMotion:motion,calibrateConveyor:calibrate,conveyorState:state,kitchenBoard:board,
 kitchenVisits:async(c:EndpointContext<'kitchenVisits'>)=>{const s=await stableRead(c.store,()=>rows<{id:string;payload:string}>(c.store,'kitchen_visits',{where:{binding_id:c.query.bindingId}}));return {...operationsMeta(c.store,c.now,s.revision),visits:s.value.map(r=>JSON.parse(r.payload))};},
} satisfies OperationsServices;
