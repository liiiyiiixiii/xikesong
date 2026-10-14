import { env } from 'cloudflare:workers';
import { generateDailyVisual } from '@/lib/analysis/daily-visual-repository';
import { failure } from '@/lib/http';
export async function POST(req:Request){if(!env.FORECAST_JOB_TOKEN||req.headers.get('authorization')!==`Bearer ${env.FORECAST_JOB_TOKEN}`)return Response.json({error:'调度认证失败'},{status:401});try{const value=await generateDailyVisual();return Response.json({date:value.record?.date,status:value.record?.status??'pending'});}catch(e){return failure(e,503);}}
