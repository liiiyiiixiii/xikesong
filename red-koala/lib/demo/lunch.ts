import snapshots from '../../data/lunch-demo/snapshots.json';
import events from '../../data/lunch-demo/events.json';
import manifest from '../../data/lunch-demo/manifest.json';
import {LunchClock} from "./lunch-clock";
const globalClock=globalThis as typeof globalThis & {lunchDemoClock?:LunchClock;lunchDemoSession?:string};
export function getLunchClock(){return globalClock.lunchDemoClock??=new LunchClock();}
export function lunchState(){
 const clock=getLunchClock();
 const sessionId=globalClock.lunchDemoSession??=crypto.randomUUID();
 const playback={...clock.read(),sessionId},frame=snapshots[playback.second];
 const dishes=Array.from(new Set(frame.plates.map(p=>p.dishId))).map(id=>{
  const items=frame.plates.filter(p=>p.dishId===id),remainingG=items.reduce((n,p)=>n+p.remainingG,0),fullG=items.length*1000;
  return {id,name:items[0].dishName,remainingG,fullG,percent:remainingG/fullG*100,status:remainingG===0?'empty':remainingG/fullG<.2?'low':'okay',coverage:1,overfull:false,rateGPerMinute:null,trend:[],scales:items.map(p=>({id:p.scaleId,dishId:id,dishName:p.dishName,position:p.slotId,enabled:true,tareG:300,noiseG:3,fullG:p.fullG,netG:p.remainingG,percent:p.remainingG/p.fullG*100,status:p.status,lastAt:frame.observedAt,updatedAt:frame.observedAt}))};
 });
 const visualization={history:snapshots.filter(f=>f.second<=playback.second&&(f.second%10===0||f.second===playback.second)).map(f=>({second:f.second,customers:f.customers.count,remainingG:f.plates.reduce((sum,p)=>sum+p.remainingG,0)})),events:events.filter(e=>e.second<=playback.second)};
 return {visualization,schemaVersion:2,revision:++clock.revision,generatedAt:new Date().toISOString(),observedAt:frame.observedAt,at:frame.observedAt,source:'lunch-demo',datasetId:manifest.id,customers:frame.customers,plates:frame.plates,playback,dishes,pending:[]};
}
