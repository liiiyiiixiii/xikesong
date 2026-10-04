import { listArchives,readArchive,generateDailyArchive,analyzeArchive } from '@/lib/analysis/archive-repository';
import { dataAsOf } from '@/lib/preferences/scenario';
import { localDate } from '@/lib/preferences/types';
import { z } from 'zod';
import { failure,checkOrigin,body } from '@/lib/http';
export async function GET(req:Request){try{const params=new URL(req.url).searchParams,id=params.get('id');const result=id?await readArchive(id):await listArchives(params.get('before')??undefined);return Response.json(result??{error:'档案不存在'},{status:result?200:404,headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e,503);}}

export async function POST(req:Request){try{checkOrigin(req);const input=z.union([z.object({id:z.string().min(1).max(250)}).strict(),z.object({date:z.string().regex(/^2026-10-0[1-4]$/)}).strict()]).parse(await body(req));if('id' in input){if(!await readArchive(input.id))return Response.json({error:'档案不存在'},{status:404});return Response.json(await analyzeArchive(input.id));}if(input.date>localDate(await dataAsOf()))return Response.json({error:'数据尚未到该日期'},{status:400});return Response.json(await generateDailyArchive(input.date));}catch(e){return failure(e,400);}}
