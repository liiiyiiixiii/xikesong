import { env } from 'cloudflare:workers';
import { readConfigs, readEvents, readMinutes } from '../scales/repository.ts';
import { newState, type DeviceState } from '../scales/engine.ts';
import type { WeightEvent } from '../scales/types.ts';
import { makeBatch, timerStatus, supplySuggestions, type FreshnessRule, type FreshnessBatch, type FreshnessView, type SupplyDecision, type FreshnessRemoval } from './model.ts';
import type { FreshnessAction } from './contract.ts';
function db(){if(!env.DB)throw new Error('数据库未连接');return env.DB;}
let initialization:Promise<unknown>|undefined;
export async function freshnessTables(){await(initialization??=db().exec("CREATE TABLE IF NOT EXISTS freshness_rules (dish_id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS freshness_batches (id TEXT PRIMARY KEY,scale_id TEXT NOT NULL,dish_id TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,closed_at TEXT,payload TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS freshness_active_scale ON freshness_batches(scale_id) WHERE status='active'; CREATE INDEX IF NOT EXISTS freshness_closed ON freshness_batches(closed_at); CREATE TABLE IF NOT EXISTS freshness_decisions (id TEXT PRIMARY KEY,at TEXT NOT NULL,payload TEXT NOT NULL);").catch(error=>{initialization=undefined;throw error;}));}
export async function hasActiveFreshness(scaleId:string){await freshnessTables();return !!await db().prepare("SELECT id FROM freshness_batches WHERE scale_id=? AND status='active'").bind(scaleId).first();}
async function rules(){const r=await db().prepare('SELECT payload FROM freshness_rules').all<{payload:string}>();return r.results.map(r=>JSON.parse(r.payload) as FreshnessRule);}
export async function freshnessView(now=new Date().toISOString(),from?:string,to?:string,compact=false):Promise<FreshnessView>{
  await freshnessTables();
  const since=from??new Date(Date.parse(now)-30*86400000).toISOString(),until=to??now;
  const [configs,ruleList,rows,decisionRows,previousRows,states]=await Promise.all([readConfigs('live'),rules(),db().prepare("SELECT payload FROM freshness_batches WHERE status='active' OR (?=0 AND closed_at>=? AND closed_at<=?) ORDER BY started_at DESC").bind(compact?1:0,since,until).all<{payload:string}>(),db().prepare('SELECT payload FROM freshness_decisions WHERE ?=0 AND at>=? AND at<=? ORDER BY at DESC LIMIT 100').bind(compact?1:0,since,until).all<{payload:string}>(),db().prepare("SELECT scale_id,dish_id,MAX(closed_at) AS closed_at FROM freshness_batches WHERE status='closed' GROUP BY scale_id,dish_id").all<{scale_id:string;dish_id:string;closed_at:string}>(),db().prepare("SELECT scale_id,payload FROM scale_latest WHERE source='live'").all<{scale_id:string;payload:string}>()]);
  const batches=rows.results.map(r=>JSON.parse(r.payload) as FreshnessBatch),active=batches.filter(b=>b.status==='active');
  const timers:FreshnessView['timers']=configs.filter(c=>c.enabled&&ruleList.some(r=>r.dishId===c.dishId&&r.enabled)||active.some(b=>b.scaleId===c.id)).map(c=>{
    const batch=active.find(b=>b.scaleId===c.id)??null;
    return {scaleId:c.id,dishId:batch?.dishId??c.dishId,name:batch?.dishName??c.dishName,status:batch?timerStatus(batch,now):'unknown',batch,deviceEnabled:c.enabled};
  });
  // A closed batch remains proof of an empty slot even after the feedback lookback window.
  for(const timer of timers.filter(t=>!t.batch)){
    const previous=previousRows.results.find(r=>r.scale_id===timer.scaleId&&r.dish_id===timer.dishId);
    const stateRow=states.results.find(r=>r.scale_id===timer.scaleId),state:DeviceState|undefined=stateRow?JSON.parse(stateRow.payload):undefined;
    const stocked=state&&(state.displayedNet??0)>0&&Date.parse(state.sampledAt)>Date.parse(previous?.closed_at??'');
    if(previous&&!stocked)timer.status='waiting';
  }
  const feedback=batches.filter(b=>b.status==='closed');
  return {at:now,scope:{from:since,to:until},rules:ruleList,timers:from||to?[]:timers,feedback,suggestions:supplySuggestions(feedback),decisions:decisionRows.results.map(r=>JSON.parse(r.payload)),catalog:[...new Map(configs.filter(c=>c.enabled).map(c=>[c.dishId,{id:c.dishId,name:c.dishName}])).values()]};
}
export async function freshnessAction(input:FreshnessAction,now=new Date().toISOString()){
  await freshnessTables();
  if(input.action==='rule'){
    if(input.warningMinutes>=input.maxMinutes)throw new Error('提前提醒时间必须小于最长上台时间');
    const configs=await readConfigs('live');if(!configs.some(c=>c.dishId===input.dishId&&c.enabled))throw new Error('菜品不存在或已停用');
    if(!input.enabled&&await db().prepare("SELECT id FROM freshness_batches WHERE dish_id=? AND status='active'").bind(input.dishId).first())throw new Error('请先处理该菜品所有在台批次，再关闭时限管理');
    const rule:FreshnessRule={dishId:input.dishId,enabled:input.enabled,maxMinutes:input.maxMinutes,warningMinutes:input.warningMinutes,updatedAt:now};
    const saved=await db().prepare("INSERT INTO freshness_rules(dish_id,payload) VALUES (?,?) ON CONFLICT(dish_id) DO UPDATE SET payload=excluded.payload WHERE ?=1 OR NOT EXISTS(SELECT 1 FROM freshness_batches WHERE dish_id=? AND status='active')").bind(rule.dishId,JSON.stringify(rule),rule.enabled?1:0,rule.dishId).run();
    if(!saved.meta.changes)throw new Error('请先处理该菜品所有在台批次');return rule;
  }
  if(input.action==='decision'){
    const old=await db().prepare('SELECT payload FROM freshness_decisions WHERE id=?').bind(input.requestId).first<{payload:string}>();if(old)return JSON.parse(old.payload);
    const view=await freshnessView(now),suggestion=view.suggestions.find(s=>s.dishId===input.dishId&&s.period===input.period);
    if(!suggestion||input.evidenceIds.some(id=>!suggestion.evidenceIds.includes(id)))throw new Error('建议依据已变化，请刷新后重试');
    const decision:SupplyDecision={id:input.requestId,dishId:input.dishId,period:input.period,choice:input.choice,note:input.note,at:now,evidenceIds:input.evidenceIds};
    await db().prepare('INSERT INTO freshness_decisions(id,at,payload) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind(decision.id,now,JSON.stringify(decision)).run();return decision;
  }
  if(input.action==='start'){
    const old=await db().prepare('SELECT payload FROM freshness_batches WHERE id=?').bind(input.requestId).first<{payload:string}>();if(old)return JSON.parse(old.payload);
    const started=Date.parse(input.startedAt);if(started>Date.parse(now)||started<Date.parse(now)-86400000)throw new Error('上台时间须在过去24小时内；时间不明请先撤下核实');
    const config=(await readConfigs('live')).find(c=>c.id===input.scaleId&&c.enabled),rule=(await rules()).find(r=>r.dishId===config?.dishId&&r.enabled);
    if(!config||!rule)throw new Error('请先为该菜品开启时限管理');
    const pending=await db().prepare("SELECT id FROM scale_events WHERE source='live' AND scale_id=? AND kind='pending' AND json_extract(payload,'$.resolvedAt') IS NULL LIMIT 1").bind(config.id).first();
    if(pending)throw new Error('请先处理该碗位的待确认重量变化');
    const batch=makeBatch(input.requestId,config,rule,new Date(started).toISOString(),input.openingG);
    const previous=await db().prepare("SELECT MAX(closed_at) AS closed_at FROM freshness_batches WHERE scale_id=?").bind(config.id).first<{closed_at:string|null}>();
    if(previous?.closed_at&&started<Date.parse(previous.closed_at))throw new Error('上台时间不能早于该碗位上一批次的撤下时间');
    try{
      const saved=await db().prepare("INSERT INTO freshness_batches(id,scale_id,dish_id,status,started_at,payload) SELECT ?,?,?,'active',?,? WHERE EXISTS(SELECT 1 FROM freshness_rules WHERE dish_id=? AND payload=?) AND EXISTS(SELECT 1 FROM scale_configs WHERE source='live' AND id=? AND payload=?)").bind(batch.id,batch.scaleId,batch.dishId,batch.startedAt,JSON.stringify(batch),rule.dishId,JSON.stringify(rule),config.id,JSON.stringify(config)).run();
      if(!saved.meta.changes)throw new Error('配置已改变');
    }catch{throw new Error('该碗位已有在台批次或配置已改变，请刷新；补菜不能重新计时');}return batch;
  }
  if(input.action==='partial')return partialRemoval(input,now);
  // Removal and the feedback message commit in one D1 transaction. The scale revision gates
  // every write so ingest, double clicks, and two operators cannot double-count disposal.
  for(let attempt=0;attempt<5;attempt++){
    const row=await db().prepare('SELECT payload FROM freshness_batches WHERE id=?').bind(input.batchId).first<{payload:string}>();if(!row)throw new Error('批次不存在');
    const batch=JSON.parse(row.payload) as FreshnessBatch;
    if(batch.status==='closed'){if(batch.closeRequestId===input.requestId)return batch;throw new Error('该批次已处理，请刷新');}
    const config=(await readConfigs('live')).find(c=>c.id===batch.scaleId);
    if(!config||config.dishId!==batch.dishId)throw new Error('碗位绑定已改变，请先核实原菜品');
    const rule=(await rules()).find(r=>r.dishId===batch.dishId&&r.enabled);
    if(input.replace&&(!rule||!config.enabled))throw new Error('该菜品未启用，不能换新盘');
    const stateRow=await db().prepare("SELECT revision,payload FROM scale_latest WHERE source='live' AND scale_id=?").bind(batch.scaleId).first<{revision:number;payload:string}>();
    const state:DeviceState=stateRow?JSON.parse(stateRow.payload):newState();
    const pendingRows=await db().prepare("SELECT payload FROM scale_events WHERE source='live' AND scale_id=? AND kind='pending' AND json_extract(payload,'$.resolvedAt') IS NULL").bind(batch.scaleId).all<{payload:string}>();
    const pendingEvents=pendingRows.results.map(r=>JSON.parse(r.payload) as WeightEvent);
    const pending=pendingEvents.length===1&&pendingEvents[0].dishId===batch.dishId&&pendingEvents[0].at>=batch.startedAt&&pendingEvents[0].weightG>0&&Math.abs(pendingEvents[0].weightG-input.remainingG)<=config.noiseG?pendingEvents[0]:null;
    if(pendingEvents.length&&!pending)throw new Error('待确认重量变化与本次撤下不匹配，请先在实时页面核实并校正，再处理本批次');
    const fresh=Date.parse(now)-Date.parse(state.receivedAt)<=10000&&Date.parse(now)-Date.parse(state.sampledAt)<=10000;
    if(fresh&&state.mode!=='removed')throw new Error('请先将整盘从秤上取下，等待设备显示已取下，再确认处理');
    const measured=state.beforeRemoval??state.stableNet;
    if(fresh&&!pending&&measured!==null&&Math.abs(measured-input.remainingG)>config.noiseG)throw new Error('撤下重量与取盘前的稳定余量不符，请核实；请勿先在秤上倒空旧菜');
    const [events,minutes]=await Promise.all([readEvents('live',batch.startedAt,new Date(Date.parse(now)+1).toISOString()),readMinutes('live',new Date(Math.floor(Date.parse(batch.startedAt)/60000)*60000).toISOString(),now)]);
    const relevant=events.filter(e=>e.scaleId===batch.scaleId&&e.dishId===batch.dishId&&!e.id.startsWith('live:freshness:'));
    if(relevant.some(e=>(e.kind==='waste'||e.kind==='retain')&&e.batchId!==batch.id))throw new Error('本批次已在其他入口记录撤下，请核对以避免重复报损');
    const measuredOpening=relevant.find(e=>e.kind==='refill'&&e.resolution==='freshness_opening');
    const openingG=batch.openingG??measuredOpening?.weightG??null;
    const observedTakeG=relevant.filter(e=>e.kind==='take').reduce((n,e)=>n+e.weightG,0),observedRefillG=relevant.filter(e=>e.kind==='refill'&&e!==measuredOpening).reduce((n,e)=>n+e.weightG,0);
    const seconds=minutes.filter(m=>m.scaleId===batch.scaleId&&m.dishId===batch.dishId).reduce((n,m)=>{
      const spans=(m as typeof m&{observedSpans?:[number,number][]}).observedSpans;
      return n+(spans?spans.reduce((s,[a,z])=>s+Math.max(0,Math.min(z,Date.parse(now))-Math.max(a,Date.parse(batch.startedAt)))/1000,0):Math.max(0,m.observedSeconds-(60-Math.max(0,Math.min(Date.parse(m.minute)+60000,Date.parse(now))-Math.max(Date.parse(m.minute),Date.parse(batch.startedAt)))/1000)));
    },0);
    const coverage=Math.min(1,seconds/Math.max(1,(Date.parse(now)-Date.parse(batch.startedAt))/1000));
    const supplied=openingG===null?null:openingG+observedRefillG;
    const usable=fresh&&coverage>=.9&&supplied!==null&&Math.abs(supplied-observedTakeG-input.remainingG-relevant.filter(e=>e.kind==='waste'||e.kind==='retain').reduce((n,e)=>n+e.weightG,0))<=Math.max(config.noiseG*3,supplied*.05)&&!relevant.some(e=>e.kind==='correction'||e.kind==='pending'||e.kind==='waste'||e.kind==='retain');
    const closed:FreshnessBatch={...batch,partialWasteG:relevant.filter(e=>e.kind==='waste').reduce((n,e)=>n+e.weightG,0),partialRetainedG:relevant.filter(e=>e.kind==='retain').reduce((n,e)=>n+e.weightG,0),openingG,status:'closed',closedAt:now,closeRequestId:input.requestId,remainingG:input.remainingG,disposition:input.disposition,reason:input.reason,observedTakeG,observedRefillG,coverage,quality:usable?'usable':'incomplete'};
    const nextState:DeviceState={...state,stableNet:null,displayedNet:null,candidates:[],beforeRemoval:null,needsBaseline:true,suppressOpening:true,freshnessOpening:true,mode:'unstable'};delete nextState.pendingId;
    const operation=crypto.randomUUID();
    const gate="EXISTS(SELECT 1 FROM scale_latest WHERE source='live' AND scale_id=? AND operation_id=?)";
    const statements=[db().prepare("INSERT INTO scale_latest(source,scale_id,revision,operation_id,payload) SELECT 'live',?,1,?,? WHERE EXISTS(SELECT 1 FROM freshness_batches WHERE id=? AND status='active') ON CONFLICT(source,scale_id) DO UPDATE SET revision=scale_latest.revision+1,operation_id=excluded.operation_id,payload=excluded.payload WHERE scale_latest.revision=?").bind(batch.scaleId,operation,JSON.stringify(nextState),batch.id,stateRow?.revision??0),
      db().prepare(`UPDATE freshness_batches SET status='closed',closed_at=?,payload=? WHERE id=? AND status='active' AND ${gate}`).bind(now,JSON.stringify(closed),batch.id,batch.scaleId,operation)];
    if(input.remainingG>0){const event:WeightEvent={id:'live:freshness:'+batch.id,batchId:batch.id,removalScope:'full',source:'live',scaleId:batch.scaleId,dishId:batch.dishId,at:now,receivedAt:now,kind:input.disposition,weightG:input.remainingG,reason:input.reason};statements.push(db().prepare(`INSERT INTO scale_events(id,source,scale_id,dish_id,at,received_at,kind,payload) SELECT ?,'live',?,?,?,?,?,? WHERE ${gate}`).bind(event.id,event.scaleId,event.dishId,now,now,event.kind,JSON.stringify(event),batch.scaleId,operation));}
    if(input.replace){const next=makeBatch(input.requestId,config,rule!,now,input.newOpeningG);statements.push(db().prepare(`INSERT INTO freshness_batches(id,scale_id,dish_id,status,started_at,payload) SELECT ?,?,?,'active',?,? WHERE ${gate}`).bind(next.id,next.scaleId,next.dishId,next.startedAt,JSON.stringify(next),batch.scaleId,operation));}
    if(pending)statements.push(db().prepare(`UPDATE scale_events SET payload=? WHERE id=? AND ${gate}`).bind(JSON.stringify({...pending,resolvedAt:now,resolution:input.disposition}),pending.id,batch.scaleId,operation));
    const result=await db().batch(statements);if(result[0].meta.changes)return closed;
  }
  throw new Error('设备正在更新，请重试');
}

/** Partial physical removals reclassify an observed change without ending the batch. */
async function partialRemoval(input:Extract<FreshnessAction,{action:'partial'}>,now:string){
  const eventId='live:freshness-partial:'+input.requestId;
  for(let attempt=0;attempt<5;attempt++){
    const duplicate=await db().prepare('SELECT payload FROM scale_events WHERE id=?').bind(eventId).first<{payload:string}>();
    if(duplicate)return JSON.parse(duplicate.payload);
    const row=await db().prepare("SELECT payload FROM freshness_batches WHERE id=? AND status='active'").bind(input.batchId).first<{payload:string}>();
    if(!row)throw new Error('该批次已结束，请刷新后核实');
    const batch=JSON.parse(row.payload) as FreshnessBatch,config=(await readConfigs('live')).find(c=>c.id===batch.scaleId&&c.dishId===batch.dishId);
    if(!config)throw new Error('碗位绑定已改变，请核实');
    const latest=await db().prepare("SELECT revision,payload FROM scale_latest WHERE source='live' AND scale_id=?").bind(batch.scaleId).first<{revision:number;payload:string}>();
    if(!latest)throw new Error('请先完成部分撤下，等待重量稳定后再登记');
    const state:DeviceState=JSON.parse(latest.payload);
    const from=new Date(Math.max(Date.parse(batch.startedAt),Date.parse(now)-120000)).toISOString();
    const events=(await readEvents('live',from,new Date(Date.parse(now)+1).toISOString())).filter(e=>e.scaleId===batch.scaleId&&e.dishId===batch.dishId&&!e.resolvedAt);
    const pendingRows=await db().prepare("SELECT payload FROM scale_events WHERE source='live' AND scale_id=? AND kind='pending' AND json_extract(payload,'$.resolvedAt') IS NULL").bind(batch.scaleId).all<{payload:string}>();
    const pending=pendingRows.results.map(r=>JSON.parse(r.payload) as WeightEvent);
    const choices=(pending.length?pending:events.filter(e=>e.kind==='take')).filter(e=>e.at>=batch.startedAt&&e.weightG>0&&Math.abs(e.weightG-input.weightG)<=config.noiseG&&(!input.eventId||e.id===input.eventId));
    if(choices.length!==1||pending.length>1)throw new Error('找不到唯一匹配的撤下变化，请等待重量稳定，或在待确认入口选择对应记录');
    const measured=choices[0],operation=crypto.randomUUID(),next=structuredClone(state);
    if(next.pendingId===measured.id){delete next.pendingId;next.mode=next.displayedNet===null?'unstable':next.displayedNet<=config.noiseG?'empty':'active';}
    const event:WeightEvent={...measured,id:eventId,kind:input.disposition,reason:input.reason,receivedAt:now,batchId:batch.id,removalScope:'partial',resolvedAt:undefined,resolution:undefined};
    const gate="EXISTS(SELECT 1 FROM scale_latest WHERE source='live' AND scale_id=? AND operation_id=?)";
    const statements=[db().prepare("UPDATE scale_latest SET revision=revision+1,operation_id=?,payload=? WHERE source='live' AND scale_id=? AND revision=? AND EXISTS(SELECT 1 FROM freshness_batches WHERE id=? AND status='active')").bind(operation,JSON.stringify(next),batch.scaleId,latest.revision,batch.id),
      db().prepare(`UPDATE scale_events SET payload=? WHERE id=? AND ${gate}`).bind(JSON.stringify({...measured,resolvedAt:now,resolution:input.disposition}),measured.id,batch.scaleId,operation),
      db().prepare(`INSERT INTO scale_events(id,source,scale_id,dish_id,at,received_at,kind,payload) SELECT ?,'live',?,?,?,?,?,? WHERE ${gate} ON CONFLICT(id) DO NOTHING`).bind(event.id,event.scaleId,event.dishId,event.at,now,event.kind,JSON.stringify(event),batch.scaleId,operation)];
    if(measured.kind==='take'){
      const minute=new Date(Math.floor(Date.parse(measured.at)/60000)*60000).toISOString();
      const bucket=await db().prepare("SELECT payload FROM scale_minutes WHERE source='live' AND scale_id=? AND dish_id=? AND minute=?").bind(batch.scaleId,batch.dishId,minute).first<{payload:string}>();
      if(bucket){const value=JSON.parse(bucket.payload);value.takeG=Math.max(0,value.takeG-measured.weightG);statements.push(db().prepare(`UPDATE scale_minutes SET payload=? WHERE source='live' AND scale_id=? AND dish_id=? AND minute=? AND ${gate}`).bind(JSON.stringify(value),batch.scaleId,batch.dishId,minute,batch.scaleId,operation));}
    }
    const result=await db().batch(statements);if(result[0].meta.changes)return event;
  }
  throw new Error('设备记录正在更新，请重试');
}

export async function removalHistory(from:string,to:string):Promise<FreshnessRemoval[]>{
  await freshnessTables();
  const [events,configs,rows]=await Promise.all([readEvents('live',from,new Date(Date.parse(to)+1).toISOString()),readConfigs('live'),db().prepare('SELECT id,payload FROM freshness_batches WHERE started_at<=?').bind(to).all<{id:string;payload:string}>()]);
  const batches=new Map(rows.results.map(r=>[r.id,JSON.parse(r.payload) as FreshnessBatch]));
  return events.filter(e=>(e.kind==='waste'||e.kind==='retain')&&Date.parse(e.receivedAt)<=Date.parse(to)).map(e=>{
    const batch=batches.get(e.batchId??(e.id.startsWith('live:freshness:')?e.id.slice('live:freshness:'.length):''));
    return {id:e.id,dishId:e.dishId,name:batch?.dishName??configs.find(c=>c.dishId===e.dishId)?.dishName??e.dishId,scaleId:e.scaleId,at:e.at,weightG:e.weightG,disposition:e.kind as 'waste'|'retain',reason:e.reason,batchId:batch?.id,startedAt:batch?.startedAt,scope:e.removalScope??(batch?'full':undefined)};
  });
}
