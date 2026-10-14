import {scenarioContext} from "@/lib/preferences/scenario";
import { historyGuard } from "@/lib/preferences/history-state";
import { z } from "zod";
import { failure, sourceSchema } from "@/lib/http";
import { dailySummary, localDate } from "@/lib/scales/repository";
export async function GET(req: Request) { const historyBlocked=await historyGuard(false);if(historyBlocked)return historyBlocked;  try { const query = new URL(req.url).searchParams, source = sourceSchema.parse(query.get("source") ?? "live"), date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, "日期无效").parse(query.get("date") ?? localDate(new Date().toISOString())); const scenario=await scenarioContext(); if (!scenario && date > localDate(new Date().toISOString())) throw new Error("不能查询未来日期的执行统计"); return Response.json(await dailySummary(source, date,scenario?date+"T23:59:59+08:00":undefined), { headers: { "Cache-Control": "no-store" } }); } catch (e) { return failure(e); } }
