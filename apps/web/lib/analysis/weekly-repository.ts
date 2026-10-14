import { scopeMinuteQuery } from "../scales/menu.ts";
import { env } from "cloudflare:workers";
import { readDataset } from "../preferences/repository.ts";
import { localDate,shiftDate } from "../preferences/types.ts";
import { buildWeeklyPortrait,mondayOf,mealQuery,type MealRow } from "./weeks.ts";
export async function loadWeeklyPortrait(week:string,asOf=new Date().toISOString()) {
 const start=mondayOf(week),end=shiftDate(start,7);const data=await readDataset("live");
 let meals:MealRow[]=[],periodError:string|null=null;
 if(start<=shiftDate(localDate(asOf),-90)) periodError="分钟记录超出90天保留期，时段画像不可用。";
 else try {
  if(!env.DB)throw new Error("no database");
  const rows=await env.DB.prepare(scopeMinuteQuery(mealQuery)).bind(new Date(`${start}T00:00:00+08:00`).toISOString(),new Date(`${end}T00:00:00+08:00`).toISOString(),new Date(Math.floor(Date.parse(asOf)/60000)*60000).toISOString()).all<MealRow>();
  if(rows.results.length>15000)throw new Error("too many records");meals=rows.results;
 } catch {periodError="时段记录读取失败，请刷新重试；日与周画像仍可查看。";}
 return {...buildWeeklyPortrait(data,start,asOf,meals),periodError};
}
