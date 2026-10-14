import { env } from 'cloudflare:workers';
import { analysisDataContext } from './source-context';
import { availableDateRange,archiveSnapshotAt,validateDateFilter,type DateRange } from './date-scope';
import { readDataset } from '../preferences/repository';
import { readSettings } from '../scales/repository';
import { loadOverallProfile } from './overall-repository';
import { archiveDue } from './archive-policy';
import { resolveModelConfig } from './credentials';
import { createCompletion } from './provider';
import { runAgent } from './agent';
import type { PortraitArchive,ArchiveSummary } from './archive-types';
import { snapshotMetadata } from './snapshot-version';
let initialized:Promise<unknown>|undefined;
function db(){if(!env.DB)throw new Error('数据库未连接');return env.DB;}
async function init(){await(initialized??=db().exec(`
 CREATE TABLE IF NOT EXISTS portrait_archives (id TEXT PRIMARY KEY, date TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL, analysis TEXT, status TEXT NOT NULL, error TEXT, retry_at TEXT NOT NULL, lease TEXT, UNIQUE(source,date));
 CREATE TABLE IF NOT EXISTS portrait_archive_versions (id TEXT PRIMARY KEY, date TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL, analysis TEXT, status TEXT NOT NULL, error TEXT, retry_at TEXT NOT NULL, lease TEXT, archive_version INTEGER NOT NULL, supersedes_id TEXT NOT NULL, fingerprint TEXT NOT NULL, UNIQUE(source,date,archive_version), UNIQUE(source,date,fingerprint));
 `).catch(e=>{initialized=undefined;throw e;}));}
const columns='id,date,source,created_at,payload,analysis,status,error,retry_at,lease';
const archiveRows=`(SELECT ${columns},1 AS archive_version,NULL AS supersedes_id FROM portrait_archives UNION ALL SELECT ${columns},archive_version,supersedes_id FROM portrait_archive_versions)`;
type Row={id:string;date:string;payload:string;analysis:string|null;status:PortraitArchive['status'];error:string|null;archive_version:number;supersedes_id:string|null};
function decode(row:Row):PortraitArchive{return {...JSON.parse(row.payload),archiveVersion:row.archive_version,supersedesId:row.supersedes_id,analysis:row.analysis?JSON.parse(row.analysis):null,status:row.status,error:row.error};}
async function storedVersions(source:string,date:string){return (await db().prepare(`SELECT * FROM ${archiveRows} WHERE source=? AND date=? ORDER BY archive_version DESC`).bind(source,date).all<Row>()).results;}
export async function readArchive(id:string,verify=true){
 await init();const {source}=await analysisDataContext();
 const row=await db().prepare(`SELECT * FROM ${archiveRows} WHERE id=? AND source=?`).bind(id,source).first<Row>();if(!row)return null;
 const record=decode(row),versions=(await storedVersions(source,row.date)).map(row=>{const saved=decode(row);return {id:saved.id,archiveVersion:saved.archiveVersion,supersedesId:saved.supersedesId,createdAt:saved.createdAt,status:saved.status};});
 return {...record,versions,snapshot:await snapshotMetadata(record.source,record.profile,verify?(cutoff=>loadOverallProfile(cutoff,true)):undefined)};
}
export async function listArchives(before?:string,range:Partial<DateRange>={}){
 await init();const {source,asOf,provenance}=await analysisDataContext();validateDateFilter(range.startDate,range.endDate);
 const availableRange=availableDateRange(await readDataset('live'),asOf);
 const cursor=before?await db().prepare(`SELECT * FROM ${archiveRows} WHERE id=? AND source=?`).bind(before,source).first<Row>():null;
 if(before&&!cursor)throw new Error('档案分页依据不存在');
 const result=await db().prepare(`SELECT * FROM ${archiveRows} WHERE source=? AND date>=? AND date<=? AND (date<? OR (date=? AND archive_version<?)) ORDER BY date DESC,archive_version DESC LIMIT 31`).bind(source,range.startDate??'0000-01-01',range.endDate??'9999-12-31',cursor?.date??'9999-12-31',cursor?.date??'9999-12-31',cursor?.archive_version??Number.MAX_SAFE_INTEGER).all<Row>();
 const items=await Promise.all(result.results.slice(0,30).map(async row=>{const {profile,analysis,...rest}=decode(row);void analysis;return {...rest,snapshot:await snapshotMetadata(rest.source,profile),asOf:profile.asOf,version:profile.version,modeledCount:profile.modeledCount} satisfies ArchiveSummary;}));
 return {items,next:result.results.length>30?items.at(-1)!.id:null,source,asOf,provenance,availableRange};
}

/** Explicit numerical regeneration only. Original snapshots and confirmed prep
 * plans are immutable; an AI interpretation remains a separate opt-in action. */
export async function regenerateArchive(id:string){
 await init();const saved=await readArchive(id,false);if(!saved)throw new Error('档案不存在或不属于当前数据源');
 const profile=await loadOverallProfile(saved.profile.asOf,true);
 if((await analysisDataContext()).source!==saved.source)throw new Error('数据源已切换，请刷新后重试');
 if(Date.parse(profile.asOf)!==Date.parse(saved.profile.asOf))throw new Error('重新生成的截止时间不一致');
 const snapshot=await snapshotMetadata(saved.source,profile),existing=await storedVersions(saved.source,saved.date);
 for(const row of existing){const previous=decode(row);if((await snapshotMetadata(saved.source,previous.profile)).fingerprint===snapshot.fingerprint)return {id:previous.id,status:previous.status,archiveVersion:previous.archiveVersion,created:false};}
 const now=new Date().toISOString(),nextId=`${saved.date}:${saved.source}:v:${crypto.randomUUID()}`,parent=existing[0].id;
 const payload={id:nextId,date:saved.date,source:saved.source,createdAt:now,late:true,profile,scenario:saved.scenario,snapshot};
 // One atomic SQL statement allocates a version. The fingerprint unique key
 // makes simultaneous regeneration of identical evidence converge on one row.
 const result=await db().prepare(`INSERT OR IGNORE INTO portrait_archive_versions(id,date,source,created_at,payload,status,retry_at,archive_version,supersedes_id,fingerprint) SELECT ?,?,?,?,?,?,?,COALESCE(MAX(archive_version),1)+1,?,? FROM portrait_archive_versions WHERE source=? AND date=?`).bind(nextId,saved.date,saved.source,now,JSON.stringify(payload),'pending',now,parent,snapshot.fingerprint,saved.source,saved.date).run();
 const row=await db().prepare('SELECT * FROM portrait_archive_versions WHERE source=? AND date=? AND fingerprint=?').bind(saved.source,saved.date,snapshot.fingerprint).first<Row>();
 if(!row)throw new Error('画像新版本保存失败');
 return {id:row.id,status:row.status,archiveVersion:row.archive_version,created:!!result.meta.changes};
}
export async function generateDailyArchive(date?:string,analyze=false){
 await init();const now=new Date().toISOString(),{source,scenario,asOf,provenance}=await analysisDataContext();
 const settings=await readSettings('live'),due=date?{date,late:true}:archiveDue(now,settings.closeTime,scenario?.end);
 const id=`${due.date}:${source}`;
 let record=await readArchive(id,false);
 if(!record){
  const cutoff=archiveSnapshotAt(due.date,asOf,availableDateRange(await readDataset('live'),asOf));
  const profile=await loadOverallProfile(cutoff);
  const payload={id,date:due.date,source,createdAt:now,late:due.late,profile,scenario,provenance,snapshot:await snapshotMetadata(source,profile)};
  // Immutable numerical payload: races and later requests cannot overwrite an archived model.
  await db().prepare('INSERT OR IGNORE INTO portrait_archives(id,date,source,created_at,payload,status,retry_at) VALUES(?,?,?,?,?,?,?)').bind(id,due.date,source,now,JSON.stringify(payload),'pending',now).run();
  record=await readArchive(id,false);
 }
 if(!analyze)return {id:record!.id,status:record!.status};
 return analyzeArchive(record!.id);
}
export async function analyzeArchive(id:string){
 await init();const existing=await readArchive(id,false);if(!existing)throw new Error('档案不存在或不属于当前数据源');if(existing.status==='complete')return {id,status:'complete'};const now=new Date().toISOString(),pending={id};
 const table=existing.archiveVersion>1?'portrait_archive_versions':'portrait_archives';
 const lease=crypto.randomUUID(),expires=new Date(Date.parse(now)+120000).toISOString();
 const claim=await db().prepare(`UPDATE ${table} SET lease=?,retry_at=? WHERE id=? AND status != 'complete' AND retry_at<=?`).bind(lease,expires,pending.id,now).run();
 if(!claim.meta.changes)return {id,status:'busy'};
 const saved=(await readArchive(pending.id,false))!;
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
 async function finish(status:string,analysis:string|null,error:string|null){await db().prepare(`UPDATE ${table} SET status=?,analysis=?,error=?,retry_at=?,lease=NULL WHERE id=? AND lease=?`).bind(status,analysis,error,new Date().toISOString(),saved.id,lease).run();}
}
