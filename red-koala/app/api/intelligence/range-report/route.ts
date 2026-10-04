import { env } from 'cloudflare:workers';
import { checkOrigin,failure } from '@/lib/http';
import { scenarioContext,dataAsOf } from '@/lib/preferences/scenario';
import { historyGuard } from '@/lib/preferences/history-state';
import { createTools } from '@/lib/analysis/tools';
import { runAgent } from '@/lib/analysis/agent';
import { createCompletion } from '@/lib/analysis/provider';
import { resolveModelConfig } from '@/lib/analysis/credentials';
const startDate='2026-10-01',endDate='2026-10-04';
async function context(){if(!env.DB)throw new Error('数据库未连接');await env.DB.exec('CREATE TABLE IF NOT EXISTS intelligence_reports(id TEXT PRIMARY KEY,payload TEXT,lease_until TEXT NOT NULL);');const scenario=await scenarioContext();return {db:env.DB,scenario,id:`${scenario?.datasetId??'live'}:${startDate}:${endDate}`};}
export async function GET(){try{const {db,id}=await context();const row=await db.prepare('SELECT payload FROM intelligence_reports WHERE id=?').bind(id).first<{payload:string|null}>();return Response.json(row?.payload?JSON.parse(row.payload):{result:null},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e,503);}}
export async function POST(req:Request){let release:(()=>Promise<unknown>)|undefined;try{checkOrigin(req);const blocked=await historyGuard();if(blocked)return blocked;const {db,id,scenario}=await context(),now=new Date().toISOString();
 const existing=await db.prepare('SELECT payload FROM intelligence_reports WHERE id=?').bind(id).first<{payload:string|null}>();if(existing?.payload)return Response.json(JSON.parse(existing.payload));
 const lease=new Date(Date.now()+120000).toISOString();await db.prepare('INSERT OR IGNORE INTO intelligence_reports(id,lease_until) VALUES(?,?)').bind(id,'').run();
 const claimed=await db.prepare('UPDATE intelligence_reports SET lease_until=? WHERE id=? AND payload IS NULL AND lease_until<=?').bind(lease,id,now).run();if(!claimed.meta.changes)return Response.json({error:'解读正在生成，请稍后查看'},{status:409});
 release=()=>db.prepare('UPDATE intelligence_reports SET lease_until=? WHERE id=? AND lease_until=?').bind('',id,lease).run();
 const config=await resolveModelConfig();if(!config.apiKey)throw new Error('请先连接模型');
 const asOf=await dataAsOf();if(asOf.slice(0,10)<endDate)throw new Error('该日期数据尚未到齐');
 const input={startDate,endDate,question:'仅根据2026年10月1日至10月4日已观测的具体菜品取用数据，推测一个大概的门店群体取用画像。不要逐日长篇分析，不要枚举所有菜品；用不超过350字总结取用构成、时段倾向、稳定或变化特征及限制。没有顾客个体记录，不推断年龄、身份、人数比例或喜爱分数。数据不足明确说明；不能把9月或10月5日当成本期依据。先查询 daily_statistics 和适用的 period_statistics，不能以整周数据替代这四天。'};
 const execute=createTools(input,asOf);
 const result=await runAgent(input,config.model,createCompletion(config),async(name,args)=>{if(!['daily_statistics','period_statistics'].includes(name))throw new Error('本次仅允许所选四天的日统计和时段统计');const evidence=await execute(name,args);return scenario?{...evidence,data:{scenario,note:'模拟数据，并非实际经营',observations:evidence.data}}:evidence;},AbortSignal.any([req.signal,AbortSignal.timeout(90000)]),asOf);
 const payload={result,scenario,startDate,endDate};await db.prepare('UPDATE intelligence_reports SET payload=? WHERE id=? AND lease_until=?').bind(JSON.stringify(payload),id,lease).run();return Response.json(payload);
 }catch(e){return failure(e,502);}finally{await release?.();}}
