import { env } from 'cloudflare:workers';
import { dataAsOf,scenarioContext } from '../preferences/scenario';
import { historyState } from '../preferences/history-state';
import { readSettings } from '../scales/repository';
import { loadOverallProfile } from './overall-repository';
import { archiveDue } from './archive-policy';
import { resolveModelConfig } from './credentials';
import { createCompletion } from './provider';
import { runAgent } from './agent';
import type { PortraitArchive,ArchiveSummary } from './archive-types';
let initialized:Promise<unknown>|undefined;
function db(){if(!env.DB)throw new Error('数据库未连接');return env.DB;}
async function init(){await(initialized??=db().exec(`CREATE TABLE IF NOT EXISTS portrait_archives (id TEXT PRIMARY KEY, date TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL, analysis TEXT, status TEXT NOT NULL, error TEXT, retry_at TEXT NOT NULL, lease TEXT, UNIQUE(source,date));`).catch(e=>{initialized=undefined;throw e;}));}
type Row={id:string;payload:string;analysis:string|null;status:PortraitArchive['status'];error:string|null};
function decode(row:Row):PortraitArchive{return {...JSON.parse(row.payload),analysis:row.analysis?JSON.parse(row.analysis):null,status:row.status,error:row.error};}
export async function readArchive(id:string){await init();const row=await db().prepare('SELECT * FROM portrait_archives WHERE id=?').bind(id).first<Row>();return row?decode(row):null;}
export async function listArchives(before?:string){await init();const result=await db().prepare("SELECT * FROM portrait_archives WHERE date BETWEEN '2026-10-01' AND '2026-10-04' AND id < ? ORDER BY id DESC LIMIT 31").bind(before??'\uffff').all<Row>();const items=result.results.slice(0,30).map(row=>{const {profile,analysis,...rest}=decode(row);void analysis;return {...rest,asOf:profile.asOf,version:profile.version,modeledCount:profile.modeledCount} satisfies ArchiveSummary;});return {items,next:result.results.length>30?items.at(-1)!.id:null};}
export async function generateDailyArchive(date?:string,analyze=false){
 await init();const now=new Date().toISOString(),state=await historyState();if(state?.phase==='maintenance')return {skipped:'数据维护中'};
 const scenario=await scenarioContext(),settings=await readSettings('live'),due=date?{date,late:true}:archiveDue(now,settings.closeTime,scenario?.end);
 const source=scenario?`scenario:${scenario.datasetId}`:state?`live:${state.datasetId}`:'live';
 const id=`${due.date}:${source}`;
 let record=await readArchive(id);
 if(!record){
  const profile=await loadOverallProfile(date?`${date}T23:59:59+08:00`:await dataAsOf());
  const payload={id,date:due.date,source,createdAt:now,late:due.late,profile,scenario};
  // Immutable numerical payload: races and later requests cannot overwrite an archived model.
  await db().prepare('INSERT OR IGNORE INTO portrait_archives(id,date,source,created_at,payload,status,retry_at) VALUES(?,?,?,?,?,?,?)').bind(id,due.date,source,now,JSON.stringify(payload),'pending',now).run();
  record=await readArchive(id);
 }
 if(!analyze)return {id:record!.id,status:record!.status};
 return analyzeArchive(record!.id);
}
export async function analyzeArchive(id:string){
 await init();const existing=await readArchive(id);if(existing?.status==='complete')return {id,status:'complete'};const now=new Date().toISOString(),pending={id};
 const lease=crypto.randomUUID(),expires=new Date(Date.parse(now)+120000).toISOString();
 const claim=await db().prepare("UPDATE portrait_archives SET lease=?,retry_at=? WHERE id=? AND status != 'complete' AND retry_at<=?").bind(lease,expires,pending.id,now).run();
 if(!claim.meta.changes)return {id,status:'busy'};
 const saved=(await readArchive(pending.id))!;
 try{
  const config=await resolveModelConfig();
  if(!config.apiKey){await finish('unconfigured',null,'未连接模型，数值画像已保存');return {id:saved.id,status:'unconfigured'};}
  const result=await runAgent({mode:'overall',startDate:saved.profile.startDate??saved.date,endDate:saved.profile.endDate??saved.date,question:'请解释这份已保存的每日客群画像：综合当前菜品取用构成、星期与时段规律、变化和限制。仅依据存档模型，不查询现在的数据，不提出未经供应证据验证的减供或停供建议。说明归档日期与实际数据时间不同的情况。'},config.model,createCompletion(config),async name=>{
   if(name!=='overall_profile')throw new Error('每日档案仅提供当时保存的模型，不查询当前供应状态');
   return {title:saved.scenario?'模拟数据 · 每日画像档案':'每日画像档案',data:{date:saved.date,createdAt:saved.createdAt,late:saved.late,scenario:saved.scenario,profile:saved.profile}};
  },AbortSignal.timeout(90000),saved.profile.asOf);
  result.generatedAt=new Date().toISOString();
  await finish('complete',JSON.stringify(result),null);return {id:saved.id,status:'complete'};
 }catch{await finish('failed',null,'AI 解读生成失败；数值画像已保存，请点击重试');return {id:saved.id,status:'failed'};}
 async function finish(status:string,analysis:string|null,error:string|null){await db().prepare('UPDATE portrait_archives SET status=?,analysis=?,error=?,retry_at=?,lease=NULL WHERE id=? AND lease=?').bind(status,analysis,error,new Date().toISOString(),saved.id,lease).run();}
}
