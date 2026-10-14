import { listArchives,readArchive,generateDailyArchive,analyzeArchive,regenerateArchive } from '@/lib/analysis/archive-repository';
import { dateSchema } from '@/lib/preferences/contract';
import { z } from 'zod';
import { failure,checkOrigin,body } from '@/lib/http';
export async function GET(req:Request){try{const params=new URL(req.url).searchParams,id=params.get('id');const result=id?await readArchive(id):await listArchives(params.get('before')??undefined,{startDate:params.get('startDate')??undefined,endDate:params.get('endDate')??undefined});return Response.json(result??{error:'档案不存在'},{status:result?200:404,headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e,400);}}

export async function POST(req:Request){try{checkOrigin(req);const input=z.union([z.object({id:z.string().min(1).max(250),action:z.literal('regenerate')}).strict(),z.object({id:z.string().min(1).max(250)}).strict(),z.object({date:dateSchema}).strict()]).parse(await body(req));if('action' in input)return Response.json(await regenerateArchive(input.id));if('id' in input){if(!await readArchive(input.id))return Response.json({error:'档案不存在'},{status:404});return Response.json(await analyzeArchive(input.id));}return Response.json(await generateDailyArchive(input.date));}catch(e){return failure(e,400);}}
