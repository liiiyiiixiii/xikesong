import { env } from 'cloudflare:workers';
function db(){if(!env.DB)throw new Error('数据库未连接');return env.DB;}
import { z } from 'zod';
import { dailySummary, readConfigs } from '../scales/repository';
import { generate, confirm, rows } from './repository';
import type { Forecast, Confirmation } from './types';
import { manifestSchema,validateHistoryBundle,checksum,historyDayCount } from './history-contract';
import { historyState } from './history-state';
const control=(value:unknown)=>db().prepare("INSERT INTO history_control(id,payload) VALUES('live',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(JSON.stringify(value));
const base=z.object({version:z.literal(2),action:z.enum(['begin','status','reset','batch','replay','confirm','audit','finish']),datasetId:z.string().min(1).max(120)});
export async function historyImport(raw:unknown){
 const input=base.passthrough().parse(raw),state=await historyState();
 if(input.action==='begin'){
  const manifest=manifestSchema.parse(input.manifest);if(manifest.datasetId!==input.datasetId)throw new Error('数据集标识不符');
  const configs=(await readConfigs('live')).filter(c=>c.enabled),remap=input.replace===true&&state?.phase==='ready';
  if(configs.length!==42||new Set(manifest.catalog.map(c=>c.id)).size!==manifest.catalog.length||new Set(manifest.mapping.map(c=>c.dishId)).size!==manifest.catalog.length||new Set(manifest.mapping.map(c=>c.scaleId)).size!==42||manifest.mapping.some(m=>!configs.some(c=>c.id===m.scaleId&&c.position===m.position&&(remap||c.dishId===m.dishId))||!manifest.catalog.some(c=>c.id===m.dishId))||manifest.catalog.some(d=>!configs.some(c=>c.dishId===d.id&&c.dishName===d.name)))throw new Error('菜品与42个碗位映射不一致');
  if(state&&!remap){if(state.datasetId!==input.datasetId||JSON.stringify(state.manifest)!==JSON.stringify(manifest))throw new Error('已有不同数据集，需本地恢复或结束维护');return {state};}
  if(remap)z.string().regex(/^[a-f0-9]{64}$/).parse(input.backupChecksum);
  const next={datasetId:input.datasetId,phase:'maintenance',manifest,startedAt:new Date().toISOString(),...(remap?{backup:input.backupChecksum,previousDataset:state?.datasetId}:{})};await control(next).run();return {state:next};
 }
 if(!state||state.datasetId!==input.datasetId)throw new Error('请先开始数据集维护');
 if(input.action==='status'){const receipts=await db().prepare('SELECT batch_id,checksum,dish_key FROM history_batches WHERE dataset_id=? ORDER BY batch_id').bind(input.datasetId).all();return {state,receipts:receipts.results};}
 if(input.action==='reset'){
  if(state.phase!=='maintenance')throw new Error('不在维护状态');if(state.reset)return {reset:true};const backup=z.string().regex(/^[a-f0-9]{64}$/).parse(input.backupChecksum);
  // The local operator takes a SQLite online backup before this operation. Secrets/configuration are excluded.
  const tables=['scale_latest','scale_samples','scale_events','scale_minutes','weight_catalog','weight_daily','weight_snapshots','weight_models','weight_forecasts','weight_plans','weight_executions','weight_evaluations','weight_jobs','store','preference_catalog','preference_daily','preference_snapshots','preference_models','preference_forecasts','preference_plans','preference_executions','preference_evaluations','preference_jobs','preference_batches','history_batches'];
  const extra=await db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('freshness_batches','freshness_decisions')").all<{name:string}>();tables.push(...extra.results.map(r=>r.name));
  const configs=await readConfigs('live');const remaps=state.manifest.mapping.map(m=>{const c=configs.find(c=>c.id===m.scaleId);if(!c)throw new Error('碗位不存在');return db().prepare("UPDATE scale_configs SET payload=? WHERE source='live' AND id=?").bind(JSON.stringify({...c,dishId:m.dishId,dishName:state.manifest.catalog.find(d=>d.id===m.dishId)!.name}),m.scaleId);});
  await db().batch([...tables.map(t=>db().prepare(`DELETE FROM ${t}`)),...remaps,control({...state,reset:true,backup})]);return {reset:true};
 }
 if(!state.reset)throw new Error('尚未备份并清除旧业务数据');
 if(input.action==='batch'){
  const packet=z.object({version:z.literal(2),action:z.literal('batch'),datasetId:z.string(),batchId:z.string().regex(/^\d{4}$/),checksum:z.string().regex(/^[a-f0-9]{64}$/),payload:z.string()}).strict().parse(input);
  if(Number(packet.batchId)<1||Number(packet.batchId)>state.manifest.expectedBatches)throw new Error('批次编号越界');
  if(await checksum(packet.payload)!==packet.checksum)throw new Error('批次校验值不符');
  const old=await db().prepare('SELECT checksum FROM history_batches WHERE dataset_id=? AND batch_id=?').bind(packet.datasetId,packet.batchId).first<{checksum:string}>();if(old){if(old.checksum!==packet.checksum)throw new Error('同编号批次内容冲突');return {duplicate:true,batchId:packet.batchId};}
  if(state.phase!=='maintenance')throw new Error('数据集已冻结');
  const b=validateHistoryBundle(JSON.parse(packet.payload),state.manifest),d=b.daily,key=`live:${d.date}:${d.dishId}`,store={date:d.date,status:'open',snapshotAt:d.snapshotAt,finalAt:d.finalAt};
  const statements=[
   db().prepare("INSERT INTO weight_catalog(id,source,payload) SELECT 'live:'||json_extract(value,'$.id'),'live',value FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING").bind(JSON.stringify(state.manifest.catalog)),
   db().prepare("INSERT INTO scale_events(id,source,scale_id,dish_id,at,received_at,kind,payload) SELECT json_extract(value,'$.id'),'live',json_extract(value,'$.scaleId'),json_extract(value,'$.dishId'),json_extract(value,'$.at'),json_extract(value,'$.receivedAt'),json_extract(value,'$.kind'),value FROM json_each(?)").bind(JSON.stringify(b.events)),
   db().prepare("INSERT INTO scale_minutes(source,scale_id,dish_id,minute,payload) SELECT 'live',json_extract(value,'$.scaleId'),json_extract(value,'$.dishId'),json_extract(value,'$.minute'),value FROM json_each(?)").bind(JSON.stringify(b.minutes)),
   db().prepare("INSERT INTO weight_daily(id,source,date,item_id,payload) VALUES(?,'live',?,'store',?) ON CONFLICT(id) DO NOTHING").bind(`live:${d.date}:store`,d.date,JSON.stringify(store)),
   db().prepare("INSERT INTO weight_daily(id,source,date,item_id,payload) VALUES(?,'live',?,?,?)").bind(key,d.date,d.dishId,JSON.stringify(d)),
   db().prepare("INSERT INTO weight_snapshots(id,source,date,item_id,payload) VALUES(?,'live',?,?,?)").bind(key,d.date,d.dishId,JSON.stringify({date:d.date,dishId:d.dishId,take20:d.take20,snapshotAt:d.snapshotAt})),
   db().prepare("INSERT INTO weight_executions(id,source,date,payload) VALUES(?,'live',?,?)").bind(key,d.date,JSON.stringify({...b.execution,provenance:'simulated-history',importedAt:new Date().toISOString()})),
   db().prepare('INSERT INTO history_batches(dataset_id,batch_id,checksum,dish_key,imported_at,payload) VALUES(?,?,?,?,?,?)').bind(packet.datasetId,packet.batchId,packet.checksum,`${d.date}:${d.dishId}`,new Date().toISOString(),JSON.stringify({kitchen:b.kitchen,eventCount:b.events.length,minuteCount:b.minutes.length}))
  ];await db().batch(statements);return {batchId:packet.batchId,duplicate:false};
 }
 const count=await db().prepare('SELECT count(*) AS n FROM history_batches WHERE dataset_id=?').bind(input.datasetId).first<{n:number}>();if(count?.n!==state.manifest.expectedBatches)throw new Error('历史批次尚未完整，不能回放或解除维护');
 if(input.action==='audit'){
  const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(input.date);if(date<state.manifest.parameters.start||date>state.manifest.parameters.end)throw new Error('核验日期越界');
  const days=await db().prepare("SELECT payload FROM weight_daily WHERE source='live' AND date=? AND item_id!='store' ORDER BY item_id").bind(date).all<{payload:string}>();
  const minutes=await db().prepare("SELECT dish_id,count(*) n,sum(json_extract(payload,'$.takeG')) takeG,sum(json_extract(payload,'$.refillG')) refillG,sum(json_extract(payload,'$.observedSeconds')) observedSeconds,sum(json_extract(payload,'$.emptySeconds')) emptySeconds FROM scale_minutes WHERE source='live' AND minute>=? AND minute<? GROUP BY dish_id").bind(new Date(date+'T11:00:00+08:00').toISOString(),new Date(date+'T22:00:00+08:00').toISOString()).all();
  const summary=await dailySummary('live',date,date+'T23:59:59+08:00');return {days:days.results.map(r=>JSON.parse(r.payload)),minutes:minutes.results,summary};
 }
 if(input.action==='replay'){
  const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(input.date);if(date<state.manifest.parameters.start||date>state.manifest.parameters.end)throw new Error('回放日期越界');
  const forecast=await generate('live',date,.1,false,state.manifest.parameters.mode==='scenario');const result={...forecast,provenance:'historical-replay',datasetId:state.datasetId};await db().prepare('UPDATE weight_forecasts SET payload=? WHERE id=?').bind(JSON.stringify(result),forecast.id).run();return result;
 }
 if(input.action==='confirm'){
  const data=z.object({forecastId:z.string().uuid(),date:z.string(),at:z.string().datetime({offset:true}),lines:z.array(z.object({dishId:z.string(),quantity:z.number().finite().nonnegative(),reason:z.string().min(1).max(500)})).length(state.manifest.catalog.length)}).parse(input.confirmation);
  if(data.date<=state.manifest.parameters.start||data.date>state.manifest.parameters.end||data.at!==`${new Date(Date.parse(data.date+'T00:00:00Z')-86400000).toISOString().slice(0,10)}T20:10:00+08:00`)throw new Error('模拟确认时间或日期越界');
  const old=(await rows<Confirmation>('weight_plans','live')).find(p=>p.date===data.date);if(old){if(JSON.stringify(old)!==JSON.stringify(data))throw new Error('确认记录冲突');return {duplicate:true};}await confirm('live',data);return {confirmed:true};
 }
 if(input.action==='finish'){
  if((await rows<Forecast>('weight_forecasts','live')).length!==historyDayCount(state.manifest)||(await rows<Confirmation>('weight_plans','live')).length!==historyDayCount(state.manifest)-1)throw new Error('回放或确认未完成');
  await control({...state,phase:'ready',completedAt:new Date().toISOString()}).run();return {complete:true};
 }
 throw new Error('未知动作');
}
