import { readVisualTrend } from '@/lib/analysis/daily-visual-repository';
import { rebuildTrend } from '@/lib/analysis/rebuild-trend';
import { readDataset } from '@/lib/preferences/repository';
import { localDate } from '@/lib/preferences/types';
import { dateSchema } from '@/lib/preferences/contract';
import { failure } from '@/lib/http';
export async function GET(req:Request){try{
 const params=new URL(req.url).searchParams,date=dateSchema.parse(params.get('date')),days=Number(params.get('days')??7),now=new Date().toISOString();
 if(![7,28].includes(days)||date>localDate(now))return Response.json({error:'请选择有效日期及7或28天范围'},{status:400});
 const [saved,data]=await Promise.all([readVisualTrend(date),readDataset('live')]);
 return Response.json({records:rebuildTrend(data,saved,date,days,now),computedAt:now},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return failure(e,400);}}
