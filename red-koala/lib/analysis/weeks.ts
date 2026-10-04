import type { Dataset,DishDay } from "../preferences/types.ts";
import { localDate,shiftDate } from "../preferences/types.ts";
import { buildPortrait } from "./portrait.ts";
import { datesBetween } from "./statistics.ts";

export const mealPeriods=[{id:0,name:"上午",hours:"00:00–11:00"},{id:1,name:"午餐",hours:"11:00–14:00"},{id:2,name:"下午",hours:"14:00–17:00"},{id:3,name:"晚餐",hours:"17:00–21:00"},{id:4,name:"夜间",hours:"21:00–24:00"}];
export function mondayOf(date:string) {const dow=new Date(`${date}T00:00:00Z`).getUTCDay();return shiftDate(date,-((dow+6)%7));}
export interface MealRow {date:string;dishId:string;period:number;takeG:number;observedSeconds:number;}
const good=(r:DishDay)=>r.status==="complete"&&r.supply==="adequate"&&r.stockoutMinutes===0&&r.takeFinal!==null;
const percent=(n:number)=>`${(n*100).toFixed(1)}%`;
function distribution(rows:DishDay[],data:Dataset) {
  const total=rows.reduce((n,r)=>n+(r.takeFinal??0),0);
  const dishes=new Map<string,number>();
  for(const r of rows)dishes.set(r.dishId,(dishes.get(r.dishId)??0)+(r.takeFinal??0));
  return [...dishes].map(([dishId,grams])=>({dishId,name:data.catalog.find(c=>c.id===dishId)?.name??dishId,grams,share:total>0?grams/total:null,samples:rows.filter(r=>r.dishId===dishId).length})).sort((a,b)=>b.grams-a.grams||a.dishId.localeCompare(b.dishId));
}
function infer(data:Dataset,start:string,end:string,asOf:string) {
  const p=buildPortrait(data,start,end,asOf),rows=data.days.filter(d=>d.date>=start&&d.date<=end&&Date.parse(d.finalAt)<=Date.parse(asOf));
  const valid=rows.filter(good),dist=distribution(valid,data),leader=dist.find(d=>(d.share??0)>0);
  const dates=[...new Set(valid.map(d=>d.date))];
  const leaderDays=leader?dates.filter(date=>{const leading=distribution(valid.filter(d=>d.date===date),data)[0];return leading?.dishId===leader.dishId&&(leading.share??0)>0;}).length:0;
  const coverage=p.expectedRecords?valid.length/p.expectedRecords:0;
  const sufficient=coverage>=.7&&dates.length>=Math.min(3,datesBetween(start,end).length);
  const type=!leader?"画像待形成":!sufficient?"群体取用画像（初步）":"群体取用画像";
  const conclusion=leader?`本期有${valid.length}个供应充足且记录完整的菜品日样本，涵盖${dates.length}个有效日期，${dist.filter(d=>d.grams>0).length}道菜有有效取用。各菜重量占比反映本期取用构成；${sufficient?"可结合时段与共同样本对照观察结构变化":"当前样本覆盖不足，暂不推断稳定偏好"}。`:"缺少供应充足的有效取用记录，暂不能判断客群取用特征。";
  const dishInsights=p.dishes.map(d=>{const validDish=dist.find(v=>v.dishId===d.dishId);const days=valid.filter(v=>v.dishId===d.dishId);const expected=datesBetween(start,end).filter(date=>date>=(data.catalog.find(c=>c.id===d.dishId)?.launchDate??start)).length;const enough=days.length>=Math.min(3,expected)&&expected>0&&days.length/expected>=.7;
    const leadingDays=days.filter(r=>{const first=distribution(valid.filter(v=>v.date===r.date),data)[0];return first?.dishId===d.dishId&&(first.share??0)>0;}).length;
    const status=!validDish?"缺少有效样本":validDish.grams===0?"有效样本零取用":enough&&days.length>=3&&leadingDays/days.length>=.6?"持续领先":enough?"已有取用依据":"初步观察";
    return {dishId:d.dishId,name:d.name,share:validDish?.share??null,grams:validDish?.grams??null,samples:days.length,expectedDays:expected,leadingDays,status,stockoutDays:d.stockoutDays,observedTakeG:d.observedTakeG,
      conclusion:!validDish?`${d.name}暂无供应充足的有效记录，不能判定低偏好。`:validDish.grams===0?`${d.name}在${days.length}个有效日期取用为零，先核对上架和展示条件，不自动下架。`:`${d.name}占有效取用重量的${validDish.share===null?"未知":percent(validDish.share)}，${leadingDays}/${days.length}个有效日期取用领先；${status}。`,
      suggestion:!enough?`先补齐${d.name}的完整供应记录，再判断是否增减量。`:d.stockoutDays>0?`先排查${d.name}的缺菜时段，避免把供应不足误判为需求下降。`:validDish?.grams===0?`对${d.name}进行小批试供并观察，保留人工判断。`:`结合${d.name}的每日、时段和周际占比变化，调整这道菜的试供量。`};});
  return {portrait:p,type,conclusion,confidence:sufficient?"有一定依据":"初步观察",sampleDays:dates.length,validSamples:valid.length,coverage,dishInsights,leaderDays,leader:leader?.name??null,leaderId:leader?.dishId??null,distribution:dist,
    suggestion:!sufficient?"先补齐供应和取用记录，再判断调整方向。":"按每道菜的时段供应、共同样本变化与备料预测分别评估试供量，由管理者确认。"};
}
// Same weekdays AND same available dishes on each paired date; do not compare an unfinished week to a full week's totals.
export function compareWeeks(data:Dataset,current:string,previous:string,asOf:string) {
  const currentRows:DishDay[]=[],previousRows:DishDay[]=[];const pairedDates:string[]=[];
  for(let i=0;i<7;i++) {
    const a=shiftDate(current,i),b=shiftDate(previous,i);
    const left=data.days.filter(d=>d.date===a&&good(d)&&Date.parse(d.finalAt)<=Date.parse(asOf));
    const right=data.days.filter(d=>d.date===b&&good(d)&&Date.parse(d.finalAt)<=Date.parse(asOf));
    const pairs=left.flatMap(l=>{const r=right.find(r=>r.dishId===l.dishId);return r?[{l,r}]:[];});
    if(pairs.length){pairedDates.push(a);currentRows.push(...pairs.map(p=>p.l));previousRows.push(...pairs.map(p=>p.r));}
  }
  const now=distribution(currentRows,data),before=distribution(previousRows,data);
  const enough=pairedDates.length>=3&&currentRows.reduce((s,r)=>s+r.takeFinal!,0)>0&&previousRows.reduce((s,r)=>s+r.takeFinal!,0)>0;
  const changes=data.catalog.map(c=>{const a=now.find(d=>d.dishId===c.id)?.share??null,b=before.find(d=>d.dishId===c.id)?.share??null;const dishPairedDays=new Set(currentRows.filter(d=>d.dishId===c.id).map(d=>d.date)).size;const comparable=enough&&dishPairedDays>=3&&a!==null&&b!==null;return {dishId:c.id,name:c.name,pairedDays:dishPairedDays,currentShare:comparable?a:null,previousShare:comparable?b:null,deltaPoints:comparable?(a!-b!)*100:null};}).sort((a,b)=>Math.abs(b.deltaPoints??0)-Math.abs(a.deltaPoints??0));
  const strongest=changes.find(c=>c.deltaPoints!==null);
  return {current,previous,pairedDays:pairedDates.length,pairedSamples:currentRows.length,comparable:enough,changes,
    conclusion:!enough?"共同有效日期不足3天或对照取用为零，暂不判断周变化。":!strongest?"缺少至少3个配对日期的单菜样本，暂不判断偏好变化。":Math.abs(strongest.deltaPoints!)<3?`共同样本中最大单菜占比变化小于3个百分点，取用结构相对平稳。`:`${strongest.name}在共同样本中的占比较前周${strongest.deltaPoints!>0?"上升":"下降"}${Math.abs(strongest.deltaPoints!).toFixed(1)}个百分点，提示取用结构发生变化，需结合供应与客流验证。`};
}
export function compareDays(data:Dataset,date:string,asOf:string) {
  const previous=shiftDate(date,-1);
  const valid=(at:string)=>data.days.filter(d=>d.date===at&&good(d)&&Date.parse(d.finalAt)<=Date.parse(asOf));
  const a=valid(date),b=valid(previous),ids=new Set(a.filter(d=>b.some(p=>p.dishId===d.dishId)).map(d=>d.dishId));
  const left=distribution(a.filter(d=>ids.has(d.dishId)),data),right=distribution(b.filter(d=>ids.has(d.dishId)),data);
  const known=left.some(d=>d.share!==null)&&right.some(d=>d.share!==null);
  const changes=known?[...ids].map(dishId=>({dishId,name:data.catalog.find(c=>c.id===dishId)?.name??dishId,deltaPoints:((left.find(c=>c.dishId===dishId)?.share??0)-(right.find(c=>c.dishId===dishId)?.share??0))*100})).sort((x,y)=>Math.abs(y.deltaPoints)-Math.abs(x.deltaPoints)):[];
  const biggest=changes[0];
  return {previous,pairedDishes:ids.size,changes,conclusion:!biggest?"与前一天缺少可比的非零共同样本，暂不判断日变化。":Math.abs(biggest.deltaPoints)<3?`与${previous}的${ids.size}道共同有效菜相比，各菜取用结构相对平稳。`:`与${previous}的${ids.size}道共同有效菜相比，${biggest.name}占比${biggest.deltaPoints>0?"上升":"下降"}${Math.abs(biggest.deltaPoints).toFixed(1)}个百分点；这反映日间结构变化，不能单独证明长期偏好改变。`};
}
function meals(rows:MealRow[],data:Dataset,start:string,end:string) {
  return mealPeriods.map(period=>{
    const selected=rows.filter(r=>r.date>=start&&r.date<=end&&r.period===period.id);
    const total=selected.length?selected.reduce((n,r)=>n+r.takeG,0):null;
    const ids=[...new Set(selected.map(r=>r.dishId))];
    const ranks=ids.map(id=>{const records=selected.filter(r=>r.dishId===id),grams=records.reduce((n,r)=>n+r.takeG,0);return {dishId:id,name:data.catalog.find(c=>c.id===id)?.name??id,grams,share:total?grams/total:null,days:new Set(records.map(r=>r.date)).size};}).sort((a,b)=>b.grams-a.grams);
    return {...period,totalG:total,days:new Set(selected.map(r=>r.date)).size,top:ranks.slice(0,3),dishes:ranks,dishCount:ids.length,
      conclusion:!selected.length?"暂无分钟取用记录，不能由全天数据推断。":!total?"有观测记录，但该时段取用为零。":`${ranks[0].name}是该时段已观测取用领先菜，占该时段取用重量的${percent(ranks[0].share!)}；优先检查其时段供应。`,
      note:"按时段内已观测重量计算，缺菜与记录覆盖可能影响排名，不代表顾客人数占比。"};
  });
}
export function buildWeeklyPortrait(data:Dataset,week:string,asOf:string,mealRows:MealRow[]=[]) {
  const monday=mondayOf(week),today=localDate(asOf);
  const fourWeeks=Array.from({length:4},(_,i)=>{const start=shiftDate(monday,(i-3)*7),end=shiftDate(start,6);return {start,end,...infer(data,start,end,asOf)};});
  const current=fourWeeks[3];
  const daily=datesBetween(monday,current.end).map(date=>({date,future:date>today,inProgress:date===today,...infer(data,date,date,asOf),dailyChange:compareDays(data,date,asOf),periods:meals(mealRows,data,date,date)}));
  return {weekStart:monday,weekEnd:current.end,asOf,inProgress:current.end>=today,current,daily,fourWeeks,
    periods:meals(mealRows,data,monday,current.end),comparisons:fourWeeks.slice(1).map((w,i)=>compareWeeks(data,w.start,fourWeeks[i].start,asOf)),
    method:"画像推断仅使用完整且供应充足的菜品日样本；覆盖至少70%、有效日期至少3天（日画像1天）才作相对明确判断。不使用第一名菜品命名群体画像；单菜持续领先至少需要3个有效日期且在60%的有效日期领先。周比较限定同星期与共同有效菜品，每道菜至少3个配对日期才比较；3个百分点为描述性变化阈值，非统计显著性检验。所有百分比都是取用重量占比，不是顾客比例。"};
}
export type WeeklyPortrait=ReturnType<typeof buildWeeklyPortrait> & {periodError?:string|null};
export const mealQuery=`SELECT date(minute,'+8 hours') AS date,dish_id AS dishId,
+ CASE WHEN CAST(strftime('%H',minute,'+8 hours') AS INTEGER)<11 THEN 0 WHEN CAST(strftime('%H',minute,'+8 hours') AS INTEGER)<14 THEN 1 WHEN CAST(strftime('%H',minute,'+8 hours') AS INTEGER)<17 THEN 2 WHEN CAST(strftime('%H',minute,'+8 hours') AS INTEGER)<21 THEN 3 ELSE 4 END AS period,
+ SUM(json_extract(payload,'$.takeG')) AS takeG,SUM(json_extract(payload,'$.observedSeconds')) AS observedSeconds
+ FROM scale_minutes WHERE source='live' AND minute>=? AND minute<? AND minute<? GROUP BY date,dish_id,period ORDER BY date,dish_id,period LIMIT 15001`.replaceAll('\n+','\n');
