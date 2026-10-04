import { buildCurrentProfile } from './current-profile.ts';
import { shiftDate,localDate,type Dataset } from '../preferences/types.ts';
import type { TrendSnapshot } from './portrait-trend.ts';
// Rebuild missing historical estimates with only records available by that day's cutoff.
// This is a retrospective calculation, never an assertion that a snapshot existed then.
export function rebuildTrend(data:Dataset,saved:TrendSnapshot[],end:string,days:number,now:string):TrendSnapshot[]{
 return Array.from({length:days},(_,i)=>shiftDate(end,i-days+1)).filter(date=>date<=localDate(now)).map(date=>{
  const existing=saved.find(r=>r.date===date);if(existing)return {...existing,origin:'saved' as const};
  const cutoff=new Date(Math.min(Date.parse(`${date}T23:59:59+08:00`),Date.parse(now))).toISOString();
  const profile=buildCurrentProfile(data,cutoff);
  return {date,origin:'reconstructed' as const,version:profile.version+JSON.stringify(profile.parameters),cohort:JSON.stringify(profile.dishes.filter(d=>d.currentShare!==null).map(d=>d.dishId).sort()),dishes:profile.dishes.map(d=>({dishId:d.dishId,name:d.name,share:d.currentShare}))};
 });
}
