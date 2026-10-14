import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { failure } from '@/lib/http';
import { authenticate } from '@/lib/scales/credentials';
import { historyGuard,historyState } from '@/lib/preferences/history-state';
export async function GET(){const blocked=await historyGuard();if(blocked)return blocked;const state=await historyState();return Response.json({phase:state?.phase??null,start:state?.manifest.parameters.start??null,end:state?.manifest.parameters.end??null,mode:state?.manifest.parameters.mode??null,simulation:state?.simulation??null},{headers:{'Cache-Control':'no-store'}});}
export async function POST(req:Request){try{
 if(!['127.0.0.1','localhost','[::1]'].includes(new URL(req.url).hostname))throw new Error('模拟控制仅允许本地使用');
 if(!await authenticate(req))return Response.json({error:'设备凭证无效'},{status:401});
 const state=await historyState();if(state?.phase!=='ready')throw new Error('请先完成历史数据导入');
 const raw=await req.text();if(raw.length>1000)throw new Error('请求过大');const {enabled}=z.object({enabled:z.boolean()}).strict().parse(JSON.parse(raw));
 if(enabled&&state.manifest.parameters.mode==='scenario')throw new Error('统一数据集使用只读回放，不接受独立实时模拟写入');
 const simulation={enabled,provider:'sample-provider' as const,startedAt:enabled?(state.simulation?.enabled?state.simulation.startedAt:new Date().toISOString()):state.simulation?.startedAt??null,updatedAt:new Date().toISOString()};
 if(!env.DB)throw new Error('数据库未连接');await env.DB.prepare("UPDATE history_control SET payload=? WHERE id='live'").bind(JSON.stringify({...state,simulation})).run();return Response.json({simulation});
 }catch(e){return failure(e);}}
