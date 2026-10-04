import type { Dataset } from "../preferences/types.ts";
import { shiftDate } from "../preferences/types.ts";

// A missing/partial day is never silently turned into a complete zero-demand day.
export function summarizeDays(data:Dataset, startDate:string, endDate:string, asOf:string) {
  const expectedDays = Math.round((Date.parse(endDate)-Date.parse(startDate))/86400000)+1;
  const dishes = data.catalog.map(c => {
    const records = data.days.filter(d => d.dishId===c.id && d.date>=startDate && d.date<=endDate && Date.parse(d.finalAt)<=Date.parse(asOf));
    const known = records.filter(d=>d.takeFinal!==null);
    const comparable = records.filter(d=>d.status==="complete" && d.supply==="adequate" && d.stockoutMinutes===0 && d.takeFinal!==null);
    const wastes = records.filter(d=>d.waste!==null);
    return {dishId:c.id,name:c.name,observedTakeG:known.length?known.reduce((n,d)=>n+d.takeFinal!,0):null,
      observedWasteG:wastes.length?wastes.reduce((n,d)=>n+d.waste!,0):null,wasteKnownDays:wastes.length,
      comparableMeanTakeG:comparable.length?Math.round(comparable.reduce((n,d)=>n+d.takeFinal!,0)/comparable.length):null,
      comparableDays:comparable.length,recordedDays:records.length,missingDays:expectedDays-records.length,
      stockoutDays:records.filter(d=>d.supply==="stockout").length,
      history:records.map(d=>({date:d.date,takeG:d.takeFinal,wasteG:d.waste,status:d.status,supply:d.supply,stockoutMinutes:d.stockoutMinutes}))};
  });
  const total = dishes.reduce((n,d)=>n+(d.observedTakeG??0),0);
  return {startDate,endDate,asOf,unit:"g",expectedDays,
    note:"取用不是实际吃下或喜爱评分；部分记录只是观测总量。缺失不等于零，供应充足完整日均量仅用于可比样本。无客流、顾客属性、收入成本。",
    dishes:dishes.map(d=>({...d,observedWeightShare:total>0 && d.observedTakeG!==null?d.observedTakeG/total:null})).sort((a,b)=>(b.observedTakeG??-1)-(a.observedTakeG??-1))};
}

export function datesBetween(start:string,end:string) {
  const dates:string[]=[];
  for(let date=start;date<=end;date=shiftDate(date,1)) dates.push(date);
  return dates;
}
