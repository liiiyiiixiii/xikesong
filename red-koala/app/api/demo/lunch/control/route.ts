import {clock,lunchState} from '@/lib/demo/lunch';
import {checkOrigin,failure} from '@/lib/http';
export async function POST(req:Request){try{checkOrigin(req);const {action}=await req.json() as {action:string};if(!['pause','resume','restart'].includes(action))throw Error('无效播放操作');clock.control(action);return Response.json(lunchState(),{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
