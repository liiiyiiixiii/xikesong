import type { Dataset } from '../preferences/types.ts';
import { localDate } from '../preferences/types.ts';
import { buildOverallProfile,type OverallMeal } from './overall.ts';
export interface CurrentObservation {date:string;lastObservedAt:string|null;elapsedMinutes:number;open:boolean;error:string|null;dishes:{dishId:string;takeG:number;coverage:number;emptyMinutes:number;unresolved:number;missingIntervals:number;fresh:boolean}[];}
export function buildCurrentProfile(data:Dataset,asOf:string,meals:OverallMeal[]=[],periodWindow?:{startDate:string;endDate:string;error:string|null},live?:CurrentObservation,includeClosedDay=false){
 const today=localDate(asOf),weekday=(new Date(today+'T00:00:00Z').getUTCDay()+6)%7;
 // Today's partial/final readings must not enter both the prior and its live update.
 const historical={...data,days:data.days.filter(d=>d.date<today||(includeClosedDay&&d.date===today&&Date.parse(d.finalAt)<=Date.parse(asOf)))};
 const base=buildOverallProfile(historical,asOf,meals,periodWindow);
 const open=new Set(data.stores.filter(s=>s.status==='open'&&Date.parse(s.finalAt)<=Date.parse(asOf)).map(s=>s.date));
 const dishes=base.dishes.map(d=>{
  const launch=data.catalog.find(c=>c.id===d.dishId)!.launchDate;
  const rows=historical.days.filter(r=>r.dishId===d.dishId&&r.date>=launch&&open.has(r.date)&&Date.parse(r.finalAt)<=Date.parse(asOf)&&r.status==='complete'&&r.supply==='adequate'&&r.stockoutMinutes===0&&r.takeFinal!=null&&Number.isFinite(r.takeFinal)&&r.takeFinal>=0);
  const weighted=rows.map(r=>({r,w:2**(-Math.max(0,(Date.parse(today)-Date.parse(r.date))/86400000)/28)}));
  const effective=weighted.reduce((s,r)=>s+r.w,0),mean=d.samples>=21&&effective>0?weighted.reduce((s,r)=>s+r.w*r.r.takeFinal!,0)/effective:null;
  const weekdays=d.weekdays.map(v=>{const records=weighted.filter(r=>(new Date(r.r.date+'T00:00:00Z').getUTCDay()+6)%7===v.weekday);const sum=records.reduce((s,r)=>s+r.w,0);return {...v,effectiveSamples:sum,estimateG:mean==null?null:(records.reduce((s,r)=>s+r.w*r.r.takeFinal!,0)+7*mean)/(sum+7),share:null as number|null};});
  return {...d,estimateG:mean,share:null as number|null,weekdays,effectiveSamples:effective,currentShare:null as number|null,priorShare:null as number|null,longTermShare:d.share,changePoints:null as number|null,todayTakeG:live?.dishes.find(v=>v.dishId===d.dishId)?.takeG??null};
 });
 const modeled=dishes.filter(d=>d.estimateG!==null);
 for(let i=0;i<7;i++){const total=modeled.reduce((s,d)=>s+d.weekdays[i].estimateG!,0);for(const d of modeled)d.weekdays[i].share=total>0?d.weekdays[i].estimateG!/total:null;}
 const total=modeled.reduce((s,d)=>s+d.estimateG!,0);
 for(const d of modeled){d.share=total>0?d.estimateG!/total:null;d.priorShare=d.weekdays[weekday].share;}
 const lastValid=modeled.map(d=>d.lastValidDate).filter((d):d is string=>!!d).sort().at(-1)??null;
 const stale=modeled.some(d=>!d.lastValidDate||(Date.parse(today)-Date.parse(d.lastValidDate))/86400000>14);
 const usable=live?.date===today&&live.open&&live.elapsedMinutes>=30&&modeled.length>0&&modeled.every(d=>{const o=live.dishes.find(v=>v.dishId===d.dishId);return !!o&&o.fresh&&o.coverage>=.95&&o.emptyMinutes===0&&o.unresolved===0&&o.missingIntervals===0&&Number.isFinite(o.takeG)&&o.takeG>=0;});
 const observedTotal=modeled.reduce((s,d)=>s+(live?.dishes.find(v=>v.dishId===d.dishId)?.takeG??0),0);
 // One shared cohort and one shared mixing weight preserve normalization.
 const alpha=usable&&observedTotal>0&&modeled.every(d=>d.priorShare!=null)&&!stale?Math.min(.5,live.elapsedMinutes/(live.elapsedMinutes+120)):0;
 for(const d of modeled){d.currentShare=d.priorShare==null?null:alpha===0?d.priorShare:(1-alpha)*d.priorShare+alpha*(d.todayTakeG??0)/Math.max(1,observedTotal);d.changePoints=d.currentShare!=null&&d.longTermShare!=null?(d.currentShare-d.longTermShare)*100:null;}
 const reason=!modeled.length?'尚无菜品达到建模条件':total<=0?'历史有效取用合计为零，暂不能估计构成':stale?'部分菜品有效历史已超过14天，当前估计需谨慎':live?.error?live.error:!live?.open?'当前不在营业时间，使用近期历史与星期估计':live.elapsedMinutes<30?'营业不足30分钟，等待足够观测':!usable?'当天覆盖、供应或数据新鲜度不足，暂不加入当天修正':observedTotal<=0?'当天可比菜品尚无正取用量，保留历史估计':'已结合当天有效取用修正';
 return {...base,version:'current-cohort-recency-blend-v2',dishes,modeledCount:modeled.length,learningCount:dishes.length-modeled.length,
 parameters:{minimumSamples:21,shrinkageDays:7,halfLifeDays:28,minimumLiveMinutes:30,minimumCoverage:.95,maxLiveWeight:.5,livePriorMinutes:120,staleDays:14,weighting:'历史指数衰减，28天权重减半'},
 current:{date:today,weekdayName:['周一','周二','周三','周四','周五','周六','周日'][weekday],state:!modeled.length?'learning':stale?'stale':alpha>0?'live':'historical',liveWeight:alpha,lastObservedAt:live?.lastObservedAt??null,lastValidDate:lastValid,reason},
 method:'当前画像是随数据更新的取用重量构成估计，不是人数比例或未来时段需求预测。历史按28天半衰期加权，星期估计向近期基础日均量收缩7个加权日期。当前默认使用今日星期估计；营业至少30分钟，所有已建模菜品均覆盖≥95%、无缺菜与未处理异常且设备数据新鲜时，按α=min(0.5,营业分钟/(营业分钟+120))融合当天同一组菜品的取用重量占比。当天数据不重复进入历史先验。变化为当前估计相对长期等权构成的百分点差。参数为首版描述性设置，未经预测精度校准。'};
}
export type CurrentProfile=ReturnType<typeof buildCurrentProfile>;
