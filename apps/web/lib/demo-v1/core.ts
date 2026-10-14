import {plateFreshness} from './freshness.ts';
import { CONTRACT_VERSION, datasetSchema, sceneSchema, type Dataset, type SceneManifest, type InputEvent, type DemoEvent, type PlateState, type CustomerState, type TaskState, type Summary, type ErrorCode, type Rules } from '@zhishan/contracts/demo-v1';

export class DemoError extends Error {
  code: ErrorCode; details: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) { super(message); this.code = code; this.details = details; }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return 'sha256:' + [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function sceneDigest(scene: unknown) { const value = {...scene as Record<string,unknown>}; delete value.contentDigest; return digest(value); }
export const wrap = (s: number, length: number) => ((s % length) + length) % length;
export function position(scene: SceneManifest, plateId: string, timeMs: number) {
  const plate = scene.plates.find(p=>p.plateId===plateId)!;
  const slot = scene.slots.find(s=>s.slotId===plate.slotId)!;
  const track = scene.tracks.find(t=>t.trackId===slot.trackId)!;
  return { trackId: track.trackId, sM: wrap(slot.s0M + (track.enabled ? track.direction * track.speedMps * timeMs / 1000 : 0), track.lengthM) };
}
export function pointAt(scene:SceneManifest,trackId:string,sM:number){
  const track=scene.tracks.find(t=>t.trackId===trackId)!,lut=track.arcLengthLut,s=wrap(sM,track.lengthM);let lo=0,hi=lut.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(lut[mid].sM<=s)lo=mid;else hi=mid;}
  const a=lut[lo],b=lut[hi],f=(s-a.sM)/(b.sM-a.sM);return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f};
}
export function inWindow(scene: SceneManifest, plateId: string, time: number, window: {trackId:string;centerSM:number;halfWidthM:number}) {
  const p=position(scene,plateId,time), track=scene.tracks.find(t=>t.trackId===p.trackId)!;
  const distance=Math.abs(p.sM-window.centerSM);
  return track.enabled && p.trackId===window.trackId && Math.min(distance,track.lengthM-distance)<=window.halfWidthM+1e-7;
}
export function nextPass(scene: SceneManifest, plateId: string, centerSM: number, afterMs: number) {
  const p=position(scene,plateId,afterMs), track=scene.tracks.find(t=>t.trackId===p.trackId)!;
  if(!track.enabled||track.speedMps<=0) throw new DemoError('PRECONDITION_FAILED','停用轨道不能调度动作',{plateId});
  return Math.ceil(afterMs + wrap((centerSM-p.sM)*track.direction,track.lengthM)/track.speedMps*1000);
}
function unique<T>(rows:T[], key:(row:T)=>string, kind:string) {
  const ids=new Set<string>(); for(const row of rows){const id=key(row);if(ids.has(id))throw new DemoError('REFERENCE_INVALID',`${kind} ID 重复`,{id});ids.add(id);}return ids;
}
function inside(x:number,z:number,polygon:{x:number;z:number}[]) { let result=false; for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {const a=polygon[i],b=polygon[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)result=!result;}return result; }
export async function validateScene(raw: unknown): Promise<SceneManifest> {
  const parsed=sceneSchema.safeParse(raw); if(!parsed.success)throw new DemoError('SCHEMA_INVALID','场景格式不符合 demo-v1',{issues:parsed.error.issues});
  // Preserve every source geometry field when verifying and returning the signed source.
  const scene=raw as SceneManifest;
  if(await sceneDigest(scene)!==scene.contentDigest)throw new DemoError('DIGEST_MISMATCH','场景内容摘要不匹配');
  const tracks=unique(scene.tracks,t=>t.trackId,'轨道'),slots=unique(scene.slots,s=>s.slotId,'承载位置');
  unique(scene.plates,p=>p.plateId,'餐盘');unique(scene.seats,s=>s.seatId,'座位');unique(scene.servingWindows,w=>w.windowId,'供餐口');unique(scene.plates,p=>p.slotId,'餐盘承载位置');
  for(const track of scene.tracks){
    const lut=track.arcLengthLut,first=lut[0],last=lut.at(-1)!;
    if(track.enabled&&track.speedMps<=0)throw new DemoError('SPATIAL_INVALID','启用轨道必须恒速运行',{trackId:track.trackId});
    if(first.sM!==0||Math.abs(last.sM-track.lengthM)>1e-5||Math.hypot(first.x-last.x,first.y-last.y,first.z-last.z)>1e-4)throw new DemoError('SPATIAL_INVALID','弧长查找表必须完整闭合',{trackId:track.trackId});
    for(let i=1;i<lut.length;i++)if(lut[i].sM<=lut[i-1].sM||Math.abs(Math.hypot(lut[i].x-lut[i-1].x,lut[i].y-lut[i-1].y,lut[i].z-lut[i-1].z)-(lut[i].sM-lut[i-1].sM))>.025)throw new DemoError('SPATIAL_INVALID','弧长与坐标不一致',{trackId:track.trackId,index:i});
  }
  for(const slot of scene.slots)if(!tracks.has(slot.trackId)||slot.s0M>=scene.tracks.find(t=>t.trackId===slot.trackId)!.lengthM)throw new DemoError('REFERENCE_INVALID','承载位置的轨道或弧长无效',{slotId:slot.slotId});
  for(const plate of scene.plates)if(!slots.has(plate.slotId)||!scene.slots.find(s=>s.slotId===plate.slotId)!.usable)throw new DemoError('REFERENCE_INVALID','餐盘绑定无效承载位置',{plateId:plate.plateId});
  for(const window of [...scene.seats.map(s=>s.takeWindow),...scene.servingWindows])if(!tracks.has(window.trackId)||window.centerSM>=scene.tracks.find(t=>t.trackId===window.trackId)!.lengthM||window.halfWidthM>=scene.tracks.find(t=>t.trackId===window.trackId)!.lengthM/2)throw new DemoError('SPATIAL_INVALID','动作窗口无效',{window});
  // Window y is the serving surface (0.98m in the source); LUT y is its floor projection.
  // Kitchen containment and arc-to-window alignment are horizontal x/z constraints.
  for(const window of scene.servingWindows){const p=pointAt(scene,window.trackId,window.centerSM);if(window.position.y<0||!inside(p.x,p.z,scene.kitchen.boundary)||Math.hypot(p.x-window.position.x,p.z-window.position.z)>.025)throw new DemoError('SPATIAL_INVALID','供餐口必须在厨房内且匹配轨道弧长位置',{windowId:window.windowId});}
  return scene;
}
export const priorities: Record<InputEvent['eventType'],number>={'customer.enter':0,'customer.seat':1,'customer.take':2,'staff.refill':3,'weight.observed':4,'quality.changed':5,'customer.depart':6,'customer.leave':7};
const sortedCache=new WeakMap<InputEvent[],InputEvent[]>();
export function ordered(events: InputEvent[]) {
  const cached=sortedCache.get(events);if(cached)return cached;
  const map=new Map<string,InputEvent>();
  for(const event of events){const old=map.get(event.eventId);if(old&&canonical(old)!==canonical(event))throw new DemoError('INVALID_REQUEST','重复事件 ID 内容冲突',{eventId:event.eventId});map.set(event.eventId,event);}
  const sorted=[...map.values()].sort((a,b)=>a.applyTimeMs-b.applyTimeMs||priorities[a.eventType]-priorities[b.eventType]||a.eventId.localeCompare(b.eventId,'en'));if(Object.isFrozen(events))sortedCache.set(events,sorted);return sorted;
}
export function remainingStatus(net:number|null,full:number,quality:string,rules:Rules): PlateState['remainingStatus'] {
  if(quality!=='good'||net===null)return 'unknown';if(net<=rules.emptyG)return 'empty';if(net/full<=rules.lowRatio)return 'low';if(net/full<=rules.halfRatio)return 'half';return 'full';
}
export type Projection = ReturnType<typeof project>;
export function project(scene: SceneManifest, dataset: Dataset, simTimeMs: number) {
  const time=Math.min(dataset.durationMs,Math.max(0,simTimeMs));
  const dishes=new Map(dataset.dishes.map(d=>[d.dishId,d]));
  const devices=new Map<string,{bootId:string;sequence:number;seenBoots:Set<string>;scaleId:string|null}>();
  const plates:PlateState[]=scene.plates.map(p=>{const d=dishes.get(p.dishId)!,w=dataset.initialWeights.find(w=>w.plateId===p.plateId)!;devices.set(p.plateId,{bootId:w.bootId,sequence:w.sequence,seenBoots:new Set([w.bootId]),scaleId:null});const net=w.grossG-d.tareG,quality=net<0?'removed' as const:net>d.fullG*1.2?'uncertain' as const:'good' as const;return {...p,...position(scene,p.plateId,time),remainingG:net<0?null:net,fullG:d.fullG,quality,remainingStatus:remainingStatus(net<0?null:net,d.fullG,quality,dataset.rules),lastObservedSimTimeMs:0};});
  const plateMap=new Map(plates.map(p=>[p.plateId,p]));
  let acceptedEvents=0;
  const customers:CustomerState[]=(dataset.initialCustomers??[]).map(c=>({customerId:c.customerId,status:'seated',seatId:c.seatId,enteredAtMs:0,elapsedDiningBeforeStartMs:c.elapsedDiningMs,profile:c.profile,leftAtMs:null})), tasks:TaskState[]=[], derived:DemoEvent[]=[];
  const operations=new Map<string,Extract<InputEvent,{eventType:'customer.take'|'staff.refill'}>>(),consumed=new Set<string>();
  const byDish=dataset.dishes.map(d=>({dishId:d.dishId,takenG:0,refilledG:0,uncertainG:0}));
  const counters=new Map(byDish.map(d=>[d.dishId,d]));
  const fail=(code:ErrorCode,message:string,event:InputEvent)=>{throw new DemoError(code,message,{eventId:event.eventId,targetEntityId:event.targetEntityId,simTimeMs:event.applyTimeMs,reason:message});};
  const emit=(event:DemoEvent)=>derived.push(event);
  let nextExpiry=dataset.rules.staleAfterMs+1;
  function refresh(at:number) {
    for(const task of tasks)if(task.status==='preparing'&&task.readyAtMs<=at){task.status='waiting';emit({eventId:`${task.taskId}:ready`,eventType:'task.ready',layer:'derived',targetEntityId:task.staffId,plateId:task.plateId,taskId:task.taskId,startTimeMs:task.readyAtMs,applyTimeMs:task.readyAtMs,endTimeMs:task.readyAtMs,status:'waiting'});}
    if(at>=nextExpiry){for(const p of plates)if(p.quality==='good'&&p.lastObservedSimTimeMs!==null&&at-p.lastObservedSimTimeMs>dataset.rules.staleAfterMs){const expiry=p.lastObservedSimTimeMs+dataset.rules.staleAfterMs+1;p.quality='stale';p.remainingStatus='unknown';emit({eventId:`quality:${p.plateId}:${expiry}`,eventType:'quality.expired',layer:'derived',targetEntityId:p.plateId,plateId:p.plateId,startTimeMs:expiry,applyTimeMs:expiry,endTimeMs:expiry,status:'stale'});}
    nextExpiry=Math.min(Infinity,...plates.filter(p=>p.quality==='good'&&p.lastObservedSimTimeMs!==null).map(p=>p.lastObservedSimTimeMs!+dataset.rules.staleAfterMs+1));}
  }
  function alert(p:PlateState, e:InputEvent) {
    const before=p.remainingStatus;p.remainingStatus=remainingStatus(p.remainingG,p.fullG,p.quality,dataset.rules);
    if(before!==p.remainingStatus)emit({eventId:`${e.eventId}:alert`,eventType:'alert.changed',layer:'derived',targetEntityId:p.plateId,plateId:p.plateId,startTimeMs:e.applyTimeMs,applyTimeMs:e.applyTimeMs,endTimeMs:e.applyTimeMs,status:p.remainingStatus});
    if(!scene.tracks.some(t=>t.trackId===p.trackId&&t.enabled)||!['half','low','empty'].includes(p.remainingStatus)||tasks.some(t=>t.plateId===p.plateId&&t.status!=='completed'))return;
    // One worker cannot prepare two dishes simultaneously; queue on first free worker.
    const staff=dataset.staff.filter(s=>s.role!=='supplier').map(s=>({...s,freeAt:Math.max(e.applyTimeMs,...tasks.filter(t=>t.staffId===s.staffId).map(t=>t.readyAtMs))})).sort((a,b)=>a.freeAt-b.freeAt||a.staffId.localeCompare(b.staffId))[0];
    const task:TaskState={taskId:`task:${e.eventId}`,plateId:p.plateId,dishId:p.dishId,staffId:staff.staffId,status:'preparing',createdAtMs:e.applyTimeMs,preparationStartMs:staff.freeAt,readyAtMs:staff.freeAt+(dishes.get(p.dishId)?.preparationMs??dataset.rules.preparationMs),completedAtMs:null,triggerEventId:e.eventId};tasks.push(task);
    emit({eventId:`${task.taskId}:created`,eventType:'task.created',layer:'derived',targetEntityId:staff.staffId,plateId:p.plateId,taskId:task.taskId,startTimeMs:e.applyTimeMs,applyTimeMs:e.applyTimeMs,endTimeMs:task.readyAtMs,status:'preparing'});
  }
  for(const p of plates){const w=dataset.initialWeights.find(w=>w.plateId===p.plateId)!;alert(p,{eventId:`initial:${p.plateId}`,targetEntityId:p.plateId,eventType:'weight.observed',layer:'observation',plateId:p.plateId,scaleId:`scale:${p.plateId}`,bootId:w.bootId,sequence:w.sequence,grossG:w.grossG,quality:'good',region:'unknown',startTimeMs:0,applyTimeMs:0,endTimeMs:0});}
  for(const event of ordered(dataset.events)) {
    if(event.applyTimeMs>time)break;refresh(event.applyTimeMs);acceptedEvents++;
    if(event.eventType==='customer.enter'){if(customers.some(c=>c.customerId===event.customerId))fail('PRECONDITION_FAILED','顾客重复进店',event);customers.push({customerId:event.customerId,status:'walking',seatId:null,enteredAtMs:event.applyTimeMs,leftAtMs:null});}
    else if(event.eventType==='customer.seat'){
      const c=customers.find(c=>c.customerId===event.customerId),seat=scene.seats.find(s=>s.seatId===event.seatId&&s.usable);
      if(!seat)fail('REFERENCE_INVALID','无效座位',event);if(!c||c.status!=='walking')fail('PRECONDITION_FAILED','顾客必须先入店且尚未入座',event);
      if(customers.some(c=>c.status==='seated'&&c.seatId===event.seatId))fail('CAPACITY_INVALID','座位重复占用',event);c!.seatId=event.seatId;c!.status='seated';
    } else if(event.eventType==='customer.depart') {const c=customers.find(c=>c.customerId===event.customerId);if(!c||c.status!=='seated')fail('PRECONDITION_FAILED','顾客必须入座后开始离席',event);c!.status='walking';c!.seatId=null;} else if(event.eventType==='customer.leave') {const c=customers.find(c=>c.customerId===event.customerId);if(!c||c.status==='left')fail('PRECONDITION_FAILED','顾客尚未进店或已经离店',event);c!.status='left';c!.seatId=null;c!.leftAtMs=event.applyTimeMs;}
    else {
      const p=plateMap.get(event.plateId);if(!p)fail('REFERENCE_INVALID','无效餐盘',event);
      if(event.eventType==='customer.take'){
        const c=customers.find(c=>c.customerId===event.customerId),seat=scene.seats.find(s=>s.seatId===event.seatId&&s.usable);
        if(!c||c.status!=='seated'||c.seatId!==event.seatId||!seat)fail('PRECONDITION_FAILED','顾客不在有效座位上',event);
        if(!inWindow(scene,event.plateId,event.applyTimeMs,seat!.takeWindow))fail('SPATIAL_INVALID','取菜时餐盘不在座位可达窗口',event);const arc=position(scene,event.plateId,event.applyTimeMs),point=pointAt(scene,arc.trackId,arc.sM);if(inside(point.x,point.z,scene.kitchen.boundary))fail('SPATIAL_INVALID','厨房内的重量下降不能记为顾客取菜',event);
        if(operations.has(event.operationId))fail('INVALID_REQUEST','操作 ID 重复',event);operations.set(event.operationId,event);
      } else if(event.eventType==='staff.refill'){
        const task=tasks.find(t=>t.taskId===event.taskId&&t.plateId===event.plateId),window=scene.servingWindows.find(w=>w.windowId===event.windowId);
        if(!window)fail('REFERENCE_INVALID','无效供餐口',event);
        if(!inWindow(scene,event.plateId,event.applyTimeMs,window!))fail('SPATIAL_INVALID','餐盘尚未到达厨房供餐口',event);const arc=position(scene,event.plateId,event.applyTimeMs),point=pointAt(scene,arc.trackId,arc.sM);if(!inside(point.x,point.z,scene.kitchen.boundary))fail('SPATIAL_INVALID','实际餐盘尚未进入厨房边界',event);
        if(!task||task.status!=='waiting'||(task.staffId!==event.staffId&&!dataset.staff.some(s=>s.staffId===event.staffId&&s.role==='supplier'))||task.readyAtMs>event.startTimeMs)fail('PRECONDITION_FAILED','补菜任务尚未准备完成或员工不匹配',event);
        if(tasks.some(t=>t.staffId===event.staffId&&t.taskId!==event.taskId&&t.preparationStartMs<event.endTimeMs&&t.readyAtMs>event.startTimeMs))fail('PRECONDITION_FAILED','员工补菜与另一备菜任务冲突',event);
        if(operations.has(event.operationId))fail('INVALID_REQUEST','操作 ID 重复',event);operations.set(event.operationId,event);
      } else if(event.eventType==='quality.changed'){p!.quality=event.quality;alert(p!,event);}
      else {
        const device=devices.get(p!.plateId)!,dish=dishes.get(p!.dishId)!,counter=counters.get(p!.dishId)!;
        if(device.scaleId&&device.scaleId!==event.scaleId)fail('REFERENCE_INVALID','餐盘称重单元映射变化需要重新绑定',event);
        device.scaleId=event.scaleId;
        if(device.bootId===event.bootId&&event.sequence<=device.sequence){acceptedEvents--;continue;}
        const reboot=device.bootId!==event.bootId;
        if(reboot&&device.seenBoots.has(event.bootId)){acceptedEvents--;continue;}
        device.bootId=event.bootId;device.sequence=event.sequence;device.seenBoots.add(event.bootId);
        const net=event.grossG-dish.tareG,previous=p!.remainingG,delta=previous===null?0:net-previous;
        const valid=event.quality==='good'&&p!.quality==='good'&&!reboot&&previous!==null&&Math.abs(delta)<=dataset.rules.maxDeltaG&&net>=0&&net<=dish.fullG*1.2;
        const op=event.operationId?operations.get(event.operationId):undefined;
        if(event.operationId&&(!op||op.plateId!==p!.plateId||op.applyTimeMs!==event.applyTimeMs))fail('PRECONDITION_FAILED','重量观测没有同刻匹配的来源操作',event);
        if(op&&consumed.has(op.operationId))fail('PRECONDITION_FAILED','操作已经关联过重量观测',event);
        let explained=delta===0;
        if(valid&&op?.eventType==='customer.take'&&event.region==='dining'&&delta<0){counter.takenG-=delta;explained=true;}
        if(valid&&op?.eventType==='staff.refill'&&event.region==='kitchen'&&delta>0){counter.refilledG+=delta;explained=true;const task=tasks.find(t=>t.taskId===op.taskId)!;task.status='completed';task.completedAtMs=event.applyTimeMs;emit({eventId:`${task.taskId}:completed`,eventType:'task.completed',layer:'derived',targetEntityId:op.staffId,plateId:p!.plateId,taskId:task.taskId,startTimeMs:event.applyTimeMs,applyTimeMs:event.applyTimeMs,endTimeMs:event.applyTimeMs,status:'completed'});}
        if(op){consumed.add(op.operationId);if(op.eventType==='staff.refill'&&!explained)fail('PRECONDITION_FAILED','补菜没有可验证的有效增重，不能标记成功',event);}
        if(!explained)counter.uncertainG+=Math.abs(delta);
        p!.remainingG=net>=0?net:null;p!.lastObservedSimTimeMs=event.applyTimeMs;p!.quality=event.quality;
        if(event.quality==='good'&&(!explained||net<0||net>dish.fullG*1.2))p!.quality='uncertain';
        if(p!.quality==='good')nextExpiry=Math.min(nextExpiry,event.applyTimeMs+dataset.rules.staleAfterMs+1);
        alert(p!,event);
      }
    }
  }
  refresh(time);
  for(const c of customers){const moving=dataset.events.find(e=>(e.eventType==='customer.seat'||e.eventType==='customer.leave')&&e.customerId===c.customerId&&e.startTimeMs<=time&&e.applyTimeMs>time);if(moving&&(moving.eventType==='customer.seat'||moving.eventType==='customer.leave')&&moving.path){c.movement={path:moving.path,startTimeMs:moving.startTimeMs,endTimeMs:moving.applyTimeMs};if(moving.eventType==='customer.seat')c.targetSeatId=moving.seatId;}}
  const summary:Summary={carryingPositionCount:scene.slots.filter(s=>s.usable).length,actualPlateCount:plates.length,dishTypeCount:new Set(plates.map(p=>p.dishId)).size,availableSeatCount:scene.seats.filter(s=>s.usable).length,seatedCustomerCount:customers.filter(c=>c.status==='seated').length,inStoreCustomerCount:customers.filter(c=>c.status!=='left').length,sceneCustomerEntityCount:customers.filter(c=>c.status!=='left').length,takenG:byDish.reduce((n,d)=>n+d.takenG,0),refilledG:byDish.reduce((n,d)=>n+d.refilledG,0),uncertainG:byDish.reduce((n,d)=>n+d.uncertainG,0),qualityIssueCount:plates.filter(p=>p.quality!=='good').length};
  for(const e of ordered(dataset.events).filter(e=>e.layer==='action')){if(e.startTimeMs<e.applyTimeMs&&e.startTimeMs<=time)emit({eventId:`${e.eventId}:started`,eventType:'action.started',layer:'derived',targetEntityId:e.targetEntityId,...('plateId'in e?{plateId:e.plateId}:{}),...('taskId'in e?{taskId:e.taskId}:{}),startTimeMs:e.startTimeMs,applyTimeMs:e.startTimeMs,endTimeMs:e.startTimeMs,status:e.eventType});if(e.endTimeMs>e.applyTimeMs&&e.endTimeMs<=time)emit({eventId:`${e.eventId}:ended`,eventType:'action.ended',layer:'derived',targetEntityId:e.targetEntityId,...('plateId'in e?{plateId:e.plateId}:{}),...('taskId'in e?{taskId:e.taskId}:{}),startTimeMs:e.endTimeMs,applyTimeMs:e.endTimeMs,endTimeMs:e.endTimeMs,status:e.eventType});}
  if(time===dataset.durationMs)emit({eventId:'playback:completed',eventType:'playback.completed',layer:'derived',targetEntityId:dataset.datasetId,startTimeMs:time,applyTimeMs:time,endTimeMs:time,status:'completed'});
  const events:DemoEvent[]=[...ordered(dataset.events).filter(e=>e.startTimeMs<=time),...derived].sort((a,b)=>a.startTimeMs-b.startTimeMs||a.applyTimeMs-b.applyTimeMs||a.eventId.localeCompare(b.eventId,'en'));
  // Derived events are keyed to their actual creation time, so the prefix never shifts on future reads.
  return {plates:plates.map(p=>({...p,freshness:plateFreshness(scene,dataset,p.plateId,time)})),customers,tasks,summary,byDish,events,appliedCount:acceptedEvents+derived.length,staff:dataset.staff.map(s=>{const refilling=events.find(e=>e.eventType==='staff.refill'&&e.staffId===s.staffId&&e.startTimeMs<=time&&e.endTimeMs>time);const task=tasks.find(t=>t.staffId===s.staffId&&t.status==='preparing'&&t.preparationStartMs<=time)??tasks.find(t=>t.staffId===s.staffId&&t.status==='waiting');const stationTask=refilling&&refilling.eventType==='staff.refill'?tasks.find(t=>t.taskId===refilling.taskId):task;const station=scene.servingWindows.find(w=>w.trackId===(stationTask?plateMap.get(stationTask.plateId)?.trackId:scene.tracks.find(t=>t.enabled)?.trackId))??scene.servingWindows[0];return {...s,position:s.station??station.staffPosition!,action:refilling?'refilling' as const:task?.status==='preparing'?'preparing' as const:task?'waiting' as const:'idle' as const,taskId:refilling&&refilling.eventType==='staff.refill'?refilling.taskId:task?.taskId??null};})};
}
export async function validatePackage(rawScene:unknown, rawDataset:unknown) {
  const scene=await validateScene(rawScene),parsed=datasetSchema.safeParse(rawDataset);
  if(!parsed.success)throw new DemoError('SCHEMA_INVALID','数据包格式无效',{issues:parsed.error.issues});const dataset=parsed.data;
  if(dataset.contractVersion!==CONTRACT_VERSION||dataset.layoutVersion!==scene.layoutVersion||dataset.sceneDigest!==scene.contentDigest||dataset.provenance.sceneDigest!==scene.contentDigest)throw new DemoError('DATASET_MISMATCH','数据包布局或摘要不一致');
  if(!(dataset.rules.halfRatio>dataset.rules.lowRatio)||dataset.rules.preparationMs===0||dataset.rules.staleAfterMs===0)throw new DemoError('SCHEMA_INVALID','演示阈值或时间配置无效');
  for(const d of dataset.dishes)if(dataset.rules.emptyG>=d.fullG*dataset.rules.lowRatio)throw new DemoError('SCHEMA_INVALID','空盘阈值不能大于少量阈值',{dishId:d.dishId});
  const dishIds=unique(dataset.dishes,d=>d.dishId,'菜品');unique(dataset.staff,s=>s.staffId,'员工');unique(dataset.initialWeights,w=>w.plateId,'初始重量');
  if(dataset.initialWeights.length!==scene.plates.length)throw new DemoError('CAPACITY_INVALID','初始重量必须覆盖全部实际餐盘');
  for(const plate of scene.plates)if(!dishIds.has(plate.dishId)||!dataset.initialWeights.some(w=>w.plateId===plate.plateId))throw new DemoError('REFERENCE_INVALID','餐盘菜品或初始观测缺失',{plateId:plate.plateId});
  for(const w of scene.servingWindows.filter(w=>scene.tracks.find(t=>t.trackId===w.trackId)?.enabled))if(!w.staffPosition||!inside(w.staffPosition.x,w.staffPosition.z,scene.kitchen.boundary)||Math.hypot(w.staffPosition.x-w.position.x,w.staffPosition.z-w.position.z)>.85)throw new DemoError('SPATIAL_INVALID','启用供餐口缺少有效的员工地面站位',{windowId:w.windowId});
  unique(dataset.servingBatches??[],b=>b.batchId,'上台批次');
  const batches=new Map<string,NonNullable<Dataset['servingBatches']>>();
  for(const b of dataset.servingBatches??[]){
    if(!scene.plates.some(p=>p.plateId===b.plateId))throw new DemoError('REFERENCE_INVALID','批次餐盘不存在');
    if(b.startedAtMs>dataset.durationMs||(b.endedAtMs!==null&&(b.endedAtMs<=b.startedAtMs||b.endedAtMs>dataset.durationMs))||b.displayWarnAfterMs>=b.displayExpireAfterMs)throw new DemoError('SCHEMA_INVALID','批次时间或时限无效');
    const list=batches.get(b.plateId)??[];list.push(b);batches.set(b.plateId,list);
  }
  for(const list of batches.values()){list.sort((a,b)=>a.startedAtMs-b.startedAtMs);for(let i=1;i<list.length;i++)if((list[i-1].endedAtMs??Infinity)>list[i].startedAtMs)throw new DemoError('SCHEMA_INVALID','同盘批次不可重叠');}
  const initial=dataset.initialCustomers??[];
  unique(initial,c=>c.customerId,'初始顾客');unique(initial,c=>c.seatId,'初始占位');
  for(const c of initial)if(!scene.seats.some(s=>s.seatId===c.seatId&&s.usable&&scene.tracks.some(t=>t.trackId===s.takeWindow.trackId&&t.enabled)))throw new DemoError('REFERENCE_INVALID','初始顾客座位无效');
  if(dataset.staff.every(s=>s.role==='supplier'))throw new DemoError('REFERENCE_INVALID','缺少备菜员工');
  if(dataset.simulationWindow&&dataset.durationMs!==600000)throw new DemoError('SCHEMA_INVALID','午高峰窗口必须为十分钟');
  const events=ordered(dataset.events);
  for(const e of events){
    if(e.startTimeMs>e.applyTimeMs||e.applyTimeMs>e.endTimeMs||e.endTimeMs>dataset.durationMs)throw new DemoError('SCHEMA_INVALID','事件时间顺序无效',{eventId:e.eventId});
    const target='plateId'in e?e.plateId:e.customerId;if(e.targetEntityId!==target)throw new DemoError('REFERENCE_INVALID','事件目标与实体不匹配',{eventId:e.eventId});
  }
  const busy=new Map<string,InputEvent[]>();
  for(const e of events)if(e.eventType==='staff.refill'||e.eventType==='customer.take'){
    const key=e.eventType==='staff.refill'?`staff:${e.staffId}`:`customer:${e.customerId}`;
    const previous=busy.get(key)??[];if(previous.some(p=>p.startTimeMs<e.endTimeMs&&p.endTimeMs>e.startTimeMs))throw new DemoError('PRECONDITION_FAILED','同一人物的取餐或补菜动作重叠',{eventId:e.eventId});previous.push(e);busy.set(key,previous);
  }
  const result=project(scene,dataset,dataset.durationMs);
  for(const e of events)if(e.eventType==='customer.take'||e.eventType==='staff.refill')if(!events.some(o=>o.eventType==='weight.observed'&&o.operationId===e.operationId))throw new DemoError('PRECONDITION_FAILED','动作缺少重量观测',{eventId:e.eventId});
  return {scene,dataset,result};
}
