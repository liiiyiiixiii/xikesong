import { historyGuard,historyState } from "@/lib/preferences/history-state";
import { env } from "cloudflare:workers";
import { failure } from "@/lib/http";
import { capture,generate,readDataset,rows } from "@/lib/preferences/repository";
import { readConfigs, readSettings, cleanup } from "@/lib/scales/repository";
import { cutoffAt,localDate,shiftDate } from "@/lib/preferences/types";
import type { Forecast } from "@/lib/preferences/types";
export async function POST(req:Request){ const historyBlocked=await historyGuard(true);if(historyBlocked)return historyBlocked.status===409?Response.json({skipped:true,reason:"历史数据集已冻结"}):historyBlocked; const token=env.FORECAST_JOB_TOKEN;if(!token||req.headers.get("authorization")!==`Bearer ${token}`)return Response.json({error:"调度认证失败"},{status:401});try{
 const history=await historyState();const now=new Date().toISOString(),today=localDate(now),results:{source:string;date:string;id?:string;error?:string}[]=[];
 for(const source of ["live"] as const){let data=await readDataset(source);const configs=(await readConfigs(source)).filter(c=>c.enabled);
 if(configs.length){const settings=await readSettings(source),yesterday=shiftDate(today,-1);
  const earliest=[...data.catalog.map(c=>c.launchDate),...configs.map(c=>localDate(c.updatedAt))].sort()[0],first=earliest>shiftDate(today,-90)?earliest:shiftDate(today,-90);let finalCount=0;
  // Catch up missing days with explicit unavailable snapshots; never reconstruct a timely prediction.
  for(let day=history&&first<=history.manifest.parameters.end?shiftDate(history.manifest.parameters.end,1):first;day<=yesterday&&finalCount<2;day=shiftDate(day,1)){if(data.stores.some(s=>s.date===day&&Date.parse(s.finalAt)>Date.parse(`${day}T${settings.closeTime}:00+08:00`)))continue;await capture(source,day,true);await capture(source,day,false);finalCount++;}
  if(Date.parse(now)>=Date.parse(cutoffAt(today)))await capture(source,today,true);
  if(Date.parse(now)>=Date.parse(`${today}T${settings.closeTime}:00+08:00`)+600000)await capture(source,today,false);
  data=await readDataset(source);
 }
 const due=[...new Set(data.days.map(d=>d.date))].filter(d=>Date.parse(cutoffAt(d))<=Date.parse(now)).sort().reverse();const forecasts=await rows<Forecast>("weight_forecasts",source);
 for(const day of due.filter(d=>!forecasts.some(f=>f.originDate===d)).slice(0,2)){try{const f=await generate(source,day);results.push({source,date:day,id:f.id});}catch(e){results.push({source,date:day,error:e instanceof Error?e.message:"失败"});}}
 }
 await cleanup(now);return Response.json({at:now,results});
 }catch(e){return failure(e,503);}}
