import {scenarioContext} from "../preferences/scenario";
import { buildCurrentProfile,type CurrentObservation } from "./current-profile.ts";
import { dailySummary,realtime,readSettings,readEvents } from "../scales/repository.ts";
import { scopeMinuteQuery } from "../scales/menu.ts";
import { env } from 'cloudflare:workers';
import { readDataset } from '../preferences/repository.ts';
import { localDate,shiftDate } from '../preferences/types.ts';
import { overallMealQuery,type OverallMeal } from './overall.ts';
export async function loadOverallProfile(asOf=new Date().toISOString()){
 const data=await readDataset('live'),endDate=localDate(asOf),startDate=shiftDate(endDate,-89);
 let rows:OverallMeal[]=[],error:string|null=null;
 try{if(!env.DB)throw new Error('no database');const result=await env.DB.prepare(scopeMinuteQuery(overallMealQuery)).bind(new Date(`${startDate}T00:00:00+08:00`).toISOString(),new Date(Math.floor(Date.parse(asOf)/60000)*60000).toISOString()).all<OverallMeal>();if(result.results.length>5000)throw new Error('too many dishes');rows=result.results;}catch{error='时段记录暂时不可用，全天模型仍可查看。';}
 let live:CurrentObservation|undefined;
 try {
  const [summary,state,settings]=await Promise.all([dailySummary('live',endDate,asOf),realtime('live',asOf),readSettings('live')]);
  const now=Date.parse(asOf),opening=Date.parse(`${endDate}T${settings.openTime}:00+08:00`),closing=Date.parse(`${endDate}T${settings.closeTime}:00+08:00`);
  const events=now>opening?await readEvents('live',new Date(opening).toISOString(),new Date(Math.min(now,closing)+1).toISOString()):[];
  live={date:endDate,open:now>=opening&&now<closing,elapsedMinutes:Math.max(0,(Math.min(now,closing)-opening)/60000),lastObservedAt:state.dishes.flatMap(d=>d.scales.map(s=>s.lastAt)).filter((s):s is string=>!!s).sort().at(-1)??null,error:null,dishes:summary.dishes.map(d=>{const current=state.dishes.find(v=>v.id===d.dishId);return {...d,takeG:events.filter(e=>e.dishId===d.dishId&&e.kind==='take'&&Date.parse(e.receivedAt)<=now).reduce((sum,e)=>sum+e.weightG,0),missingIntervals:d.missingIntervals??0,fresh:!!current&&['okay','low'].includes(current.status)&&current.scales.every(s=>s.lastAt!=null&&now-Date.parse(s.lastAt)>=0&&now-Date.parse(s.lastAt)<=120000)};})};
 }catch{live={date:endDate,open:false,elapsedMinutes:0,lastObservedAt:null,dishes:[],error:'实时记录读取失败，暂用历史估计'};}
 return buildCurrentProfile(data,asOf,rows,{startDate,endDate,error},live,!!await scenarioContext());
}
