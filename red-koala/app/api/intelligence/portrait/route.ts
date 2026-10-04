import {dataAsOf,scenarioContext} from "@/lib/preferences/scenario";
import { historyGuard } from "@/lib/preferences/history-state";
import { scopeMinuteQuery } from "@/lib/scales/menu";
import { loadOverallProfile } from "@/lib/analysis/overall-repository";
import { dateSchema } from "@/lib/preferences/contract";
import { mondayOf } from "@/lib/analysis/weeks";
import { loadWeeklyPortrait } from "@/lib/analysis/weekly-repository";
import { env } from "cloudflare:workers";
import { analysisSchemaAt } from "@/lib/analysis/contract";
import { readDataset } from "@/lib/preferences/repository";
import { localDate,shiftDate } from "@/lib/preferences/types";
import { buildPortrait,hourlyPortraitQuery,type HourObservation } from "@/lib/analysis/portrait";

export async function GET(req:Request) { const historyBlocked=await historyGuard(false);if(historyBlocked)return historyBlocked;
  const asOf=await dataAsOf(),scenario=await scenarioContext();
  const query=new URL(req.url).searchParams;
  if(query.get("scope")==="overall") {
    if(query.has("week")||query.has("startDate")||query.has("endDate"))return Response.json({error:"整体画像不接受指定日期"},{status:400});
    try{return Response.json(await loadOverallProfile(asOf),{headers:{"Cache-Control":"no-store"}});}
    catch{return Response.json({error:"整体画像暂时无法读取"},{status:503});}
  }
  if(query.has("week")) {
    const parsed=dateSchema.safeParse(query.get("week"));
    if(!parsed.success||mondayOf(parsed.data)>localDate(asOf))return Response.json({error:"请选择有效的自然周"},{status:400});
    try{return Response.json(await loadWeeklyPortrait(parsed.data,asOf),{headers:{"Cache-Control":"no-store"}});}
    catch{return Response.json({error:"周画像暂时无法读取，请刷新重试"},{status:503});}
  }
  const input=analysisSchemaAt(asOf,scenario?90:31).safeParse({question:"客群画像",startDate:query.get("startDate"),endDate:query.get("endDate")});
  if(!input.success) return Response.json({error:"请选择有效日期，范围最多31天且不能包含未来日期"},{status:400});
  try {
    const {startDate,endDate}=input.data;
    const dataset=await readDataset("live");
    let hours:HourObservation[]=[],hourError:string|null=null;
    if(startDate<=shiftDate(localDate(asOf),-90)) hourError="所选日期超出分钟记录保留期，时段画像暂不可用。";
    else {
      try {
        if(!env.DB) throw new Error("database missing");
        const rows=await env.DB.prepare(scopeMinuteQuery(hourlyPortraitQuery)).bind(new Date(`${startDate}T00:00:00+08:00`).toISOString(),new Date(`${shiftDate(endDate,1)}T00:00:00+08:00`).toISOString(),new Date(Math.floor(Date.parse(asOf)/60000)*60000).toISOString()).all<HourObservation>();
        hours=rows.results;
      } catch { hourError="时段记录读取失败，可刷新重试；日统计画像仍可查看。"; }
    }
    return Response.json({...buildPortrait(dataset,startDate,endDate,asOf,hours),hourError},{headers:{"Cache-Control":"no-store"}});
  } catch { return Response.json({error:"画像数据暂时无法读取，请稍后刷新"},{status:503,headers:{"Cache-Control":"no-store"}}); }
}
