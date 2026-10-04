import { historyState } from './history-state';
import { realtime,readMinutes,readEvents } from '../scales/repository';
import type {Realtime,ScaleView,DishRealtime} from '../scales/types';
export async function scenarioContext(){const state=await historyState();return state?.phase==='ready'&&state.manifest.parameters.mode==='scenario'?{datasetId:state.datasetId,start:state.manifest.parameters.start,end:state.manifest.parameters.end,asOf:state.manifest.parameters.end+'T23:59:59+08:00'}:null;}
export async function dataAsOf(){return (await scenarioContext())?.asOf??new Date().toISOString();}
export async function scenarioRealtime():Promise<Realtime>{
 const context=await scenarioContext();if(!context)return realtime('live');
 // Replay the observed minute ledger. Never create new samples or fill observation gaps from truth.
 const at=new Date(Date.parse(context.end+'T19:00:00+08:00')+Date.now()%3600000).toISOString(),minute=new Date(Math.floor(Date.parse(at)/60000)*60000).toISOString();
 const [base,buckets,events]=await Promise.all([realtime('live',at),readMinutes('live',minute,new Date(Date.parse(minute)+60000).toISOString()),readEvents('live',context.end+'T00:00:00+08:00',at)]);
 const pending=events.filter(e=>e.kind==='pending'&&(!e.resolvedAt||e.resolvedAt>at));
 const dishes=base.dishes.map(d=>{
 const scales=d.scales.map(s=>{const b=buckets.find(b=>b.scaleId===s.id),net=b&&b.observedSeconds>0?b.remainingG:null,p=pending.find(p=>p.scaleId===s.id);return {...s,netG:net,percent:net===null?null:net/s.fullG*100,status:p?'anomaly':net===null?'offline':net<=s.noiseG?'empty':'active',lastAt:b?minute:null,...(p?{pendingId:p.id}:{})} as ScaleView;});
 const remainingG=scales.every(s=>s.netG!==null)?scales.reduce((n,s)=>n+s.netG!,0):null,percent=remainingG===null?null:remainingG/d.fullG*100;
 const status:DishRealtime['status']=scales.some(s=>s.status==='anomaly')?'anomaly':remainingG===null?'partial':scales.every(s=>s.status==='empty')?'empty':percent!<20?'low':'okay';
 return {...d,scales,remainingG,percent,status,overfull:scales.some(s=>s.percent!==null&&s.percent>100)};
 });return {...base,dishes,pending,simulation:{enabled:true,provider:'dataset-replay'},scenario:context};
}
