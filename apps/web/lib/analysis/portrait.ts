import type { Dataset } from "../preferences/types.ts";
import { datesBetween, summarizeDays } from "./statistics.ts";

export interface HourObservation { hour:number; takeG:number; recordedMinutes:number; days:number; }
export function buildPortrait(data:Dataset,startDate:string,endDate:string,asOf:string,hours:HourObservation[]=[]) {
  const summary=summarizeDays(data,startDate,endDate,asOf);
  const dishes=summary.dishes.map(d=>({...d,category:data.catalog.find(c=>c.id===d.dishId)?.category?.trim()||"未分类"}));
  const observed=dishes.filter(d=>d.observedTakeG!==null);
  const total=observed.length?observed.reduce((sum,d)=>sum+d.observedTakeG!,0):null;
  const categories=[...new Set(observed.map(d=>d.category))].map(name=>{
    const items=observed.filter(d=>d.category===name),takeG=items.reduce((s,d)=>s+d.observedTakeG!,0);
    return {name,takeG,share:total?takeG/total:null,dishes:items.length};
  }).sort((a,b)=>b.takeG-a.takeG);
  const trend=datesBetween(startDate,endDate).map(date=>{
    const rows=dishes.flatMap(d=>d.history.filter(h=>h.date===date&&h.takeG!==null));
    const expected=data.catalog.filter(c=>c.launchDate<=date).length;
    return {date,takeG:rows.length?rows.reduce((s,r)=>s+r.takeG!,0):null,observedDishes:rows.length,expectedDishes:expected,
      complete:expected>0&&rows.length===expected&&rows.every(r=>r.status==="complete"&&r.supply==="adequate"&&r.stockoutMinutes===0)};
  });
  const hourly=Array.from({length:24},(_,hour)=>({hour,takeG:hours.find(h=>h.hour===hour)?.takeG??null,days:hours.find(h=>h.hour===hour)?.days??0}));
  const peak=[...hours].filter(h=>h.takeG>0).sort((a,b)=>b.takeG-a.takeG)[0];
  const top=dishes.find(d=>(d.observedTakeG??0)>0);
  const topCategory=categories.find(c=>c.takeG>0&&c.name!=="未分类");
  const stockoutDishCount=dishes.filter(d=>d.stockoutDays>0).length;
  const expectedRecords=datesBetween(startDate,endDate).reduce((n,date)=>n+data.catalog.filter(c=>c.launchDate<=date).length,0);
  const comparableRecords=dishes.reduce((n,d)=>n+d.comparableDays,0);
  const notes:string[]=[];
  if(top) notes.push(`${top.name}的已观测取用量最高，占已知取用重量的${((top.observedWeightShare??0)*100).toFixed(1)}%。可优先关注其供应稳定性。`);
  if(topCategory) notes.push(`${topCategory.name}占已知取用重量的${((topCategory.share??0)*100).toFixed(1)}%，体现当前取用结构，不能直接解释为选择人数或喜爱评分。`);
  if(stockoutDishCount) notes.push(`${stockoutDishCount}道菜存在缺菜日；这些菜的低取用可能受供应约束影响。`);
  if(!observed.length) notes.push("所选期间暂无可用日取用记录，暂不能形成整体客群画像。可调整日期或等待日统计入库。");
  return {startDate,endDate,asOf,totalTakeG:total,observedDishCount:observed.length,comparableRecords,expectedRecords,
    completeDays:trend.filter(d=>d.complete).length,stockoutDishCount,dishes,categories,trend,hourly,
    peakHour:peak?.hour??null,notes,
    tags:[top?`取用领先 · ${top.name}`:"等待取用数据",topCategory?`主要品类 · ${topCategory.name}`:"品类特征待补充",peak?`观测高峰 · ${peak.hour}:00`:"时段特征待补充"],
    limitations:["画像描述门店整体客群的取用行为，不识别个人或推断年龄、性别。","重量占比不等于人数占比或喜爱程度；缺菜与记录不完整会影响比较。","日历史与分钟记录分别统计，覆盖范围可能不同；无分钟数据时不还原时段曲线。"]};
}
export type Portrait=ReturnType<typeof buildPortrait>;

export const hourlyPortraitQuery=`SELECT CAST(strftime('%H',minute,'+8 hours') AS INTEGER) AS hour,
  SUM(json_extract(payload,'$.takeG')) AS takeG, COUNT(*) AS recordedMinutes,
  COUNT(DISTINCT date(minute,'+8 hours')) AS days
  FROM scale_minutes WHERE source='live' AND minute>=? AND minute<? AND minute<?
  GROUP BY CAST(strftime('%H',minute,'+8 hours') AS INTEGER) ORDER BY hour`;
