import { z } from "zod";
import { dateSchema } from "../preferences/contract.ts";
import { localDate } from "../preferences/types.ts";

export const analysisSchemaAt = (asOf=new Date().toISOString(),maxDays=31) => z.object({
  question: z.string().trim().min(1).max(2000),
  startDate: dateSchema,
  endDate: dateSchema,
}).strict().superRefine((value, ctx) => {
  const days = (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86400000;
  if (days < 0 || days > maxDays-1) ctx.addIssue({code:"custom",message:"日期范围应为 1 至 31 天"});
  if (value.endDate > localDate(asOf)) ctx.addIssue({code:"custom",message:"不能查询未来日期"});
});
export const analysisRequestSchema=analysisSchemaAt();
export const overallAnalysisRequestSchema=z.object({mode:z.literal("overall"),question:z.string().trim().min(1).max(2000)}).strict();
export type AnalysisRequest = z.infer<typeof analysisRequestSchema> & {mode?:"overall"};
export interface Evidence { id:string; tool:string; title:string; args:Record<string,unknown>; data:unknown; }
export interface AnalysisResult { answer:string; model:string; generatedAt:string; scope:{startDate:string;endDate:string;mode?:"overall"}; evidence:Evidence[]; }
export interface AnalysisStatus { configured:boolean; model:string; message:string; }
