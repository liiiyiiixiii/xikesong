import {plateFreshness} from './freshness.ts';
export {demoFreshness} from './freshness.ts';
import type { Dataset, DemoState, EventsResponse, ManifestResponse, Metadata, Reports, SceneManifest } from '@zhishan/contracts/demo-v1';
import { CONTRACT_VERSION } from '@zhishan/contracts/demo-v1';
import { DemoError, project, position, type Projection } from './core.ts';
import { timeOf, type Session } from './session.ts';
export function cursor(s:Session,index:number){return btoa(JSON.stringify(['demo-v1',s.sessionId,s.generation,index]));}
export function cursorIndex(token:string,s:Session,max:number){
  let value:unknown;try{value=JSON.parse(atob(token));}catch{throw new DemoError('CURSOR_INVALID','无效事件游标');}
  if(!Array.isArray(value)||value.length!==4||value[0]!=='demo-v1'||typeof value[1]!=='string'||!Number.isSafeInteger(value[2])||!Number.isSafeInteger(value[3])||value[3]<0)throw new DemoError('CURSOR_INVALID','无效事件游标');
  if(value[1]!==s.sessionId||value[2]!==s.generation)throw new DemoError('CURSOR_EXPIRED','游标属于旧播放会话，请重新读取 state');
  if(value[3]>max)throw new DemoError('CURSOR_INVALID','游标超出当前事件范围');return value[3] as number;
}
// Business state changes only at discrete boundaries. Track coordinates still use the exact
// shared millisecond; the immutable event package is never advanced by a client clock.
const projectionCache=new WeakMap<Dataset,{boundaries:number[];frames:Map<number,Projection>}>();
function snapshot(scene:SceneManifest,dataset:Dataset,time:number,complete:Projection){
 if(!Object.isFrozen(dataset.events))return project(scene,dataset,time);
 let cache=projectionCache.get(dataset);if(!cache){cache={boundaries:[...new Set([0,dataset.durationMs,...complete.events.flatMap(e=>[e.startTimeMs,e.applyTimeMs,e.endTimeMs]),...complete.tasks.map(t=>t.preparationStartMs)])].sort((a,b)=>a-b),frames:new Map()};projectionCache.set(dataset,cache);}
 let lo=0,hi=cache.boundaries.length;while(lo+1<hi){const mid=(lo+hi)>>1;if(cache.boundaries[mid]<=time)lo=mid;else hi=mid;}const key=cache.boundaries[lo];
 let p=cache.frames.get(key);if(!p){p=project(scene,dataset,key);cache.frames.set(key,p);if(cache.frames.size>8)cache.frames.delete(cache.frames.keys().next().value!);}
 return {...p,plates:p.plates.map(p=>({...p,...position(scene,p.plateId,time),freshness:plateFreshness(scene,dataset,p.plateId,time)}))};
}
export function view(scene:SceneManifest,dataset:Dataset,s:Session,now:number,complete:Projection=project(scene,dataset,dataset.durationMs)){
  const simTimeMs=timeOf(s,now,dataset.durationMs),p=snapshot(scene,dataset,simTimeMs,complete);
  const events=complete.events.filter(e=>e.startTimeMs<=simTimeMs);
  const meta:Metadata={contractVersion:CONTRACT_VERSION,datasetId:dataset.datasetId,layoutVersion:dataset.layoutVersion,source:dataset.source,sessionId:s.sessionId,generation:s.generation,revision:s.controlRevision+p.appliedCount,simTimeMs};
  const day=(s.dayThroughMs??0)<=simTimeMs?p:snapshot(scene,dataset,s.dayThroughMs!,complete);
  const reports:Reports={...meta,current:{takenG:p.summary.takenG,refilledG:p.summary.refilledG,uncertainG:p.summary.uncertainG},simulatedDay:{date:dataset.simulatedBusinessDate,scope:'dataset-once',datasetId:dataset.datasetId,takenG:day.summary.takenG,refilledG:day.summary.refilledG,uncertainG:day.summary.uncertainG},byDish:p.byDish,history:{halfMonth:null,month:null},note:'模拟当日累计仅包含本数据包已经发生的事件，按事件计一次，重播保留已发生记录，不预记未来；取用量不等于吃掉重量、人数或营收。'};
  const state:DemoState={...meta,sceneDigest:scene.contentDigest,simulationWindow:dataset.simulationWindow,playback:{status:s.paused?'paused':simTimeMs>=dataset.durationMs?'completed':'running',durationMs:dataset.durationMs},plates:p.plates,customers:p.customers,staff:p.staff,tasks:p.tasks,summary:p.summary,eventCursor:cursor(s,events.length),activeEvents:events.filter(e=>e.endTimeMs>simTimeMs),dishes:dataset.dishes,rules:dataset.rules,reports};
  const manifest:ManifestResponse={...meta,scene,dishes:dataset.dishes,rules:dataset.rules,durationMs:dataset.durationMs,simulationWindow:dataset.simulationWindow,capacityLabel:'与模型一致的演示容量，非实测门店容量',provenance:dataset.provenance};
  return {state,reports,manifest,events:(after?:string):EventsResponse=>({...meta,events:events.slice(after?cursorIndex(after,s,events.length):0),eventCursor:state.eventCursor})};
}
