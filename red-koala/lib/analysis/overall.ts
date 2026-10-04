import type { Dataset } from '../preferences/types.ts';
import { localDate } from '../preferences/types.ts';
import { mealPeriods } from './weeks.ts';
export const overallVersion='equal-history-shrinkage-grams-v1';
export interface OverallMeal {dishId:string;period:number;grams:number;days:number;firstDate:string;lastDate:string;}
export function buildOverallProfile(data:Dataset,asOf:string,mealRows:OverallMeal[]=[],periodWindow?:{startDate:string;endDate:string;error:string|null}) {
 const today=localDate(asOf),cutoff=Date.parse(asOf);
 const known=data.days.filter(d=>d.date<=today&&Date.parse(d.finalAt)<=cutoff&&data.catalog.some(c=>c.id===d.dishId&&c.launchDate<=d.date));
 const open=new Set(data.stores.filter(s=>s.status==='open'&&s.date<=today&&Date.parse(s.finalAt)<=cutoff).map(s=>s.date));
 const eligible=known.filter(d=>open.has(d.date)&&d.status==='complete'&&d.supply==='adequate'&&d.stockoutMinutes===0&&d.takeFinal!=null&&Number.isFinite(d.takeFinal)&&d.takeFinal>=0);
 const dates=known.map(d=>d.date).sort();
 const dishes=data.catalog.filter(c=>c.launchDate<=today).map(c=>{
  const rows=eligible.filter(d=>d.dishId===c.id),unique=new Map(rows.map(d=>[d.date,d])),samples=[...unique.values()],n=samples.length;
  const mean=n>=21?samples.reduce((s,d)=>s+d.takeFinal!,0)/n:null;
  const weekdays=Array.from({length:7},(_,i)=>{const r=samples.filter(d=>(new Date(d.date+'T00:00:00Z').getUTCDay()+6)%7===i);return {weekday:i,name:["周一","周二","周三","周四","周五","周六","周日"][i],samples:r.length,estimateG:mean==null?null:(r.reduce((s,d)=>s+d.takeFinal!,0)+7*mean)/(r.length+7),share:null as number|null};});
  return {dishId:c.id,name:c.name,samples:n,knownDays:known.filter(d=>d.dishId===c.id).length,estimateG:mean,share:null as number|null,status:mean==null?'学习中':mean===0?'有效样本零取用':'已建模',firstValidDate:samples.map(d=>d.date).sort()[0]??null,lastValidDate:samples.map(d=>d.date).sort().at(-1)??null,weekdays};
 });
 const total=dishes.reduce((s,d)=>s+(d.estimateG??0),0);for(const d of dishes){d.share=d.estimateG==null||total===0?null:d.estimateG/total;for(let i=0;i<7;i++){const sum=dishes.reduce((s,v)=>s+(v.weekdays[i].estimateG??0),0);d.weekdays[i].share=d.weekdays[i].estimateG==null||sum===0?null:d.weekdays[i].estimateG!/sum;}}
 const periods=mealPeriods.map(p=>{const rows=mealRows.filter(r=>r.period===p.id&&dishes.some(d=>d.dishId===r.dishId));const total=rows.length?rows.reduce((s,r)=>s+r.grams,0):null;return {...p,totalG:total,dishes:rows.map(r=>({...r,name:dishes.find(d=>d.dishId===r.dishId)!.name,share:total&&total>0?r.grams/total:null}))};});
 return {scope:'overall' as const,version:overallVersion,asOf,startDate:dates[0]??null,endDate:dates.at(-1)??null,parameters:{minimumSamples:21,shrinkageDays:7,weighting:'全部有效历史等权'},modeledCount:dishes.filter(d=>d.estimateG!==null).length,learningCount:dishes.filter(d=>d.estimateG===null).length,dishes,periods,periodWindow:periodWindow??{startDate:today,endDate:today,error:null},periodObservedStart:mealRows.map(r=>r.firstDate).sort()[0]??null,periodObservedEnd:mealRows.map(r=>r.lastDate).sort().at(-1)??null,
 method:'星期编号0=周一、1=周二、2=周三、3=周四、4=周五、5=周六、6=周日，引用星期请使用name字段。模型值是有效日期平均取用量，不是历史累计量或明日预测。星期估计=(该星期总取用+7×基础日均量)/(该星期样本数+7)。占比仅在达到21个有效日期的菜品之间归一化。',limitations:['群体取用重量构成不是顾客比例或喜爱评分，不识别个人。','模型排除缺菜及不完整样本，无法恢复未观测需求。','时段仅为保留期内已观测倾向，不能证明完整供应覆盖；与全天模型分母、历史范围不同。']};
}
export type OverallProfile=ReturnType<typeof buildOverallProfile>;

export const overallMealQuery=`SELECT dish_id AS dishId,
 CASE WHEN CAST(strftime('%H',minute,'+8 hours') AS INTEGER)<11 THEN 0 WHEN CAST(strftime('%H',minute,'+8 hours') AS INTEGER)<14 THEN 1 WHEN CAST(strftime('%H',minute,'+8 hours') AS INTEGER)<17 THEN 2 WHEN CAST(strftime('%H',minute,'+8 hours') AS INTEGER)<21 THEN 3 ELSE 4 END AS period,
 SUM(json_extract(payload,'$.takeG')) AS grams,COUNT(DISTINCT date(minute,'+8 hours')) AS days,MIN(date(minute,'+8 hours')) AS firstDate,MAX(date(minute,'+8 hours')) AS lastDate
 FROM scale_minutes WHERE source='live' AND minute>=? AND minute<? AND json_extract(payload,'$.observedSeconds')>0 AND json_extract(payload,'$.takeG') IS NOT NULL GROUP BY dish_id,period LIMIT 5001`;
