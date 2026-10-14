import { readDailyVisual,generateDailyVisual } from '@/lib/analysis/daily-visual-repository';
import { checkOrigin,failure } from '@/lib/http';
import { dateSchema } from '@/lib/preferences/contract';
export async function GET(req:Request){try{const date=new URL(req.url).searchParams.get('date');return Response.json(await readDailyVisual(date?dateSchema.parse(date):undefined),{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e,503);}}
export async function POST(req:Request){try{checkOrigin(req);return Response.json(await generateDailyVisual(),{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e,503);}}
