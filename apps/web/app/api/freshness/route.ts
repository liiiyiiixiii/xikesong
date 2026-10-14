import {scenarioContext,dataAsOf} from '@/lib/preferences/scenario';
import { body,checkOrigin,failure } from '@/lib/http';
import { historyGuard,historyState } from '@/lib/preferences/history-state';
import { localDay } from '@/lib/freshness/model';
import { freshnessAction as schema } from '@/lib/freshness/contract';
import { freshnessWindow } from '@/lib/freshness/query';
import { freshnessAction,freshnessView,removalHistory } from '@/lib/freshness/repository';
export async function GET(req:Request){const blocked=await historyGuard(false);if(blocked)return blocked;try{
 const window=freshnessWindow(new URL(req.url).searchParams,await dataAsOf()),view=await freshnessView(window.now,window.from,window.to,window.mode==='timers');
 if(window.from&&window.to)view.removals=await removalHistory(window.from,window.to);
 return Response.json(view,{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}}
export async function POST(req:Request){if(await scenarioContext())return Response.json({error:"统一模拟数据集回放为只读"},{status:409});const blocked=await historyGuard(false);if(blocked)return blocked;try{
  checkOrigin(req);const input=schema.parse(await body(req)),history=await historyState(),now=new Date().toISOString();
  // New explicitly confirmed operations may be recorded after the frozen history;
  // this never enables the simulator or rewrites imported historical records.
  if(history?.phase==='ready'&&['start','close','partial'].includes(input.action)&&localDay(input.action==='start'?input.startedAt:now)<=history.manifest.parameters.end)return Response.json({error:'该日期的历史记录已冻结，请登记新的营业日'},{status:409});
  return Response.json(await freshnessAction(input,now));
}catch(e){return failure(e);}}
