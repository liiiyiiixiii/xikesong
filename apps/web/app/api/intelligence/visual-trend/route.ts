import { readVisualTrend } from '@/lib/analysis/daily-visual-repository';
import { rebuildTrend } from '@/lib/analysis/rebuild-trend';
import { readDataset } from '@/lib/preferences/repository';
import { localDate } from '@/lib/preferences/types';
import { dateSchema } from '@/lib/preferences/contract';
import { failure } from '@/lib/http';
import { analysisDataContext } from '@/lib/analysis/source-context';
export async function GET(req:Request){try{
 const params=new URL(req.url).searchParams,date=dateSchema.parse(params.get('date')),days=Number(params.get('days')??7),context=await analysisDataContext();
 if(![7,28].includes(days)||date>localDate(context.asOf))return Response.json({error:'请选择数据截止日期以内的日期及7或28天范围'},{status:400});
 const [saved,data]=await Promise.all([readVisualTrend(date),readDataset('live')]);
 return Response.json({records:rebuildTrend(data,saved,date,days,context.asOf),computedAt:new Date().toISOString(),asOf:context.asOf,provenance:context.provenance},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return failure(e,400);}}
