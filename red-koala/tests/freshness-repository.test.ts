import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import type { SQLInputValue } from 'node:sqlite';
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../drizzle/0003_massive_robin_chapel.sql',import.meta.url),'utf8'));
let failNextEvent=false;
class Statement {
 readonly sql:string;readonly args:SQLInputValue[];
 constructor(sql:string,args:SQLInputValue[]=[]){this.sql=sql;this.args=args;}
 bind(...args:SQLInputValue[]){return new Statement(this.sql,args);}
 async first(){return sqlite.prepare(this.sql).get(...this.args)??null;}
 async all(){return {results:sqlite.prepare(this.sql).all(...this.args)};}
 async run(){if(failNextEvent&&this.sql.startsWith('INSERT INTO scale_events')){failNextEvent=false;throw new Error('injected transaction failure');}const r=sqlite.prepare(this.sql).run(...this.args);return {meta:{changes:Number(r.changes)}};}
}
const fakeDB={exec:async(sql:string)=>{sqlite.exec(sql);},prepare:(sql:string)=>new Statement(sql),batch:async(statements:Statement[])=>{sqlite.exec('BEGIN');try{const rows=[];for(const s of statements)rows.push(await s.run());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
Object.assign(globalThis,{freshnessTestDB:fakeDB});
registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env={DB:globalThis.freshnessTestDB}',shortCircuit:true};return next(specifier,context);}});
const {freshnessAction,freshnessView}=await import('../lib/freshness/repository.ts');
const {saveConfig,ingest,readEvents}=await import('../lib/scales/repository.ts');
const at='2026-10-04T09:00:00.000Z',id='bowl-1';
const config={id,dishId:'lamb',dishName:'羊肉卷',tareG:300,fullG:1000,noiseG:3,enabled:true};
let sequence=0;
async function sample(grossG:number,time:string){return ingest('live',[{scaleId:id,bootId:'boot',sequence:++sequence,sampledAt:time,grossG}],time);}
async function stable(grossG:number,time:string){for(let i=0;i<3;i++)await sample(grossG,new Date(Date.parse(time)+i*1000).toISOString());}
test('D1 workflow: persistence, no reset by refill, atomic close/replace, feedback, retries, and no invented consumption',async()=>{
 await saveConfig('live',config);
 await freshnessAction({action:'rule',dishId:'lamb',enabled:true,maxMinutes:180,warningMinutes:30},at);
 const empty=await freshnessView(at);assert.equal(empty.timers[0].status,'unknown');
 const requestId=crypto.randomUUID();
 const start={action:'start' as const,requestId,scaleId:id,startedAt:at,openingG:1000,confirmed:true as const};
 await freshnessAction(start,at);await freshnessAction(start,at);
 await assert.rejects(()=>freshnessAction({...start,requestId:crypto.randomUUID()},at),/已有在台/);
 await stable(1300,at);await stable(1400,'2026-10-04T09:00:03Z');
 assert.equal((await freshnessView('2026-10-04T09:00:06Z')).timers[0].batch!.deadlineAt,'2026-10-04T12:00:00.000Z');
 await assert.rejects(()=>saveConfig('live',{...config,enabled:false}),/先撤下/);
 await assert.rejects(()=>freshnessAction({action:'rule',dishId:'lamb',enabled:false,maxMinutes:180,warningMinutes:30},at),/先处理/);
 const close={action:'close' as const,requestId:crypto.randomUUID(),batchId:requestId,remainingG:1100,disposition:'waste' as const,reason:'display_age' as const,replace:true,newOpeningG:500,confirmed:true as const};
 await assert.rejects(()=>freshnessAction(close,'2026-10-04T09:00:06Z'),/整盘/);
 await sample(0,'2026-10-04T09:00:07Z');
 await assert.rejects(()=>freshnessAction({...close,remainingG:900},'2026-10-04T09:00:08Z'),/余量不符/);
 await freshnessAction(close,'2026-10-04T09:00:08Z');await freshnessAction(close,'2026-10-04T09:00:08Z');
 let view=await freshnessView('2026-10-04T09:00:08Z');assert.equal(view.feedback.length,1);assert.equal(view.timers[0].batch!.id,close.requestId);assert.equal(view.feedback[0].observedRefillG,100);
 let events=await readEvents('live',at,'2026-10-04T09:00:09Z');assert.equal(events.filter(e=>e.kind==='waste').length,1);assert.equal(events.filter(e=>e.kind==='take').length,0);
 await stable(800,'2026-10-04T09:00:09Z');
 events=await readEvents('live',at,'2026-10-04T09:00:12Z');assert.equal(events.filter(e=>e.kind==='take'||e.kind==='pending').length,0);assert.equal(events.filter(e=>e.resolution==='freshness_opening')[0].weightG,500);
 await sample(0,'2026-10-04T09:00:12Z');
 await freshnessAction({...close,batchId:close.requestId,requestId:crypto.randomUUID(),remainingG:500,replace:false},'2026-10-04T09:00:13Z');
 view=await freshnessView('2026-10-04T09:00:13Z');assert.equal(view.timers[0].status,'waiting');assert.equal(view.feedback[0].observedRefillG,0,'replacement initial supply is not counted twice');
 const evidenceIds=view.suggestions[0].evidenceIds;
 await freshnessAction({action:'decision',requestId:crypto.randomUUID(),dishId:'lamb',period:'晚间',choice:'reduce',note:'晚间小盘试供，三天后复核',evidenceIds},'2026-10-04T09:00:14Z');
 assert.equal((await freshnessView('2026-10-04T09:00:14Z')).decisions.length,1);
 assert.equal((await freshnessView('2026-11-05T09:00:14Z')).timers[0].status,'waiting','closed slots survive feedback retention window');
});
test('matching pending removal commits with feedback; a failed transaction rolls everything back',async()=>{
 const startId=crypto.randomUUID(),startedAt='2026-10-04T10:00:00.000Z';
 await freshnessAction({action:'start',requestId:startId,scaleId:id,startedAt,openingG:1000,confirmed:true},startedAt);
 await stable(1300,startedAt);await stable(300,'2026-10-04T10:00:03Z');await sample(0,'2026-10-04T10:00:06Z');
 const close={action:'close' as const,requestId:crypto.randomUUID(),batchId:startId,remainingG:1000,disposition:'waste' as const,reason:'display_age' as const,replace:false,newOpeningG:null,confirmed:true as const};
 failNextEvent=true;await assert.rejects(()=>freshnessAction(close,'2026-10-04T10:00:07Z'),/injected/);
 assert.equal((await freshnessView('2026-10-04T10:00:07Z')).timers[0].batch!.id,startId);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM scale_events WHERE id=?").get('live:freshness:'+startId)!.n,0);
 await freshnessAction(close,'2026-10-04T10:00:07Z');
 await assert.rejects(()=>freshnessAction({...close,requestId:crypto.randomUUID()},'2026-10-04T10:00:07Z'),/已处理/);
 const events=await readEvents('live',startedAt,'2026-10-04T10:00:08Z');
 assert.equal(events.find(e=>e.kind==='pending')!.resolution,'waste');assert.equal(events.filter(e=>e.kind==='take').length,0);assert.equal(events.filter(e=>e.kind==='waste').length,1);
});
test('offline time continues, existing deadlines survive rule edits, and incomplete feedback cannot reduce supply',async()=>{
 const startId=crypto.randomUUID(),startedAt='2026-10-04T11:00:00.000Z';
 await assert.rejects(()=>freshnessAction({action:'start',requestId:crypto.randomUUID(),scaleId:id,startedAt:at,openingG:null,confirmed:true},startedAt),/早于/);
 await freshnessAction({action:'start',requestId:startId,scaleId:id,startedAt,openingG:null,confirmed:true},startedAt);
 await freshnessAction({action:'rule',dishId:'lamb',enabled:true,maxMinutes:240,warningMinutes:40},startedAt);
 const view=await freshnessView('2026-10-04T14:00:00.000Z');assert.equal(view.timers[0].status,'overdue');assert.equal(view.timers[0].batch!.deadlineAt,'2026-10-04T14:00:00.000Z');
 await freshnessAction({action:'close',requestId:crypto.randomUUID(),batchId:startId,remainingG:100,disposition:'waste',reason:'display_age',replace:false,newOpeningG:null,confirmed:true},'2026-10-04T14:00:00.000Z');
 const after=await freshnessView('2026-10-04T14:00:00.000Z');assert.equal(after.feedback[0].quality,'incomplete');assert.equal(after.feedback[0].openingG,null);assert(after.suggestions.every(s=>s.level==='observe'));
 const compact=await freshnessView('2026-10-04T14:00:00.000Z',undefined,undefined,true);assert.equal(compact.feedback.length,0);assert.equal(compact.timers[0].status,'waiting');
});
test('partial waste and retained removals preserve the deadline, reclassify consumption, and later close exactly once',async()=>{
 const startId=crypto.randomUUID(),startedAt='2026-10-04T14:10:00.000Z';
 await freshnessAction({action:'start',requestId:startId,scaleId:id,startedAt,openingG:1000,confirmed:true},startedAt);
 await stable(1300,startedAt);await stable(1200,'2026-10-04T14:10:03Z');
 const before=(await freshnessView('2026-10-04T14:10:06Z')).timers[0].batch!.deadlineAt;
 const partial={action:'partial' as const,requestId:crypto.randomUUID(),batchId:startId,weightG:100,disposition:'waste' as const,reason:'display_age' as const,confirmed:true as const};
 failNextEvent=true;await assert.rejects(()=>freshnessAction(partial,'2026-10-04T14:10:06Z'),/injected/);
 assert.equal((await readEvents('live',startedAt,'2026-10-04T14:10:07Z')).filter(e=>e.kind==='take').length,1);
 await freshnessAction(partial,'2026-10-04T14:10:06Z');await freshnessAction(partial,'2026-10-04T14:10:06Z');
 assert.equal((await freshnessView('2026-10-04T14:10:06Z')).timers[0].batch!.deadlineAt,before);
 await sample(0,'2026-10-04T14:10:07Z');await stable(1000,'2026-10-04T14:10:08Z');
 const pending=(await readEvents('live',startedAt,'2026-10-04T14:10:11Z')).find(e=>e.kind==='pending')!;
 await freshnessAction({...partial,requestId:crypto.randomUUID(),weightG:200,disposition:'retain',eventId:pending.id},'2026-10-04T14:10:11Z');
 assert.equal((await freshnessView('2026-10-04T14:10:11Z')).timers[0].batch!.deadlineAt,before);
 await sample(0,'2026-10-04T14:10:12Z');
 await freshnessAction({action:'close',requestId:crypto.randomUUID(),batchId:startId,remainingG:700,disposition:'waste',reason:'display_age',replace:false,newOpeningG:null,confirmed:true},'2026-10-04T14:10:13Z');
 const events=await readEvents('live',startedAt,'2026-10-04T14:10:14Z');
 assert.equal(events.filter(e=>e.kind==='take').length,0);
 assert.equal(events.filter(e=>e.kind==='waste').reduce((n,e)=>n+e.weightG,0),800);
 assert.equal(events.filter(e=>e.kind==='retain').reduce((n,e)=>n+e.weightG,0),200);
 const {dailySummary}=await import('../lib/scales/repository.ts');
 const report=await dailySummary('live','2026-10-04','2026-10-04T15:00:00.000Z');
 const allEvents=await readEvents('live','2026-10-03T16:00:00.000Z','2026-10-04T15:00:00.001Z');
 assert.equal(report.dishes[0].ageWasteG,allEvents.filter(e=>e.kind==='waste'&&e.reason==='display_age').reduce((n,e)=>n+e.weightG,0));
 assert.equal(report.dishes[0].retainedG,200);
 const {removalHistory}=await import('../lib/freshness/repository.ts');
 const details=await removalHistory(startedAt,'2026-10-04T14:10:14.000Z');assert.equal(details.length,3);assert(details.every(r=>r.batchId===startId));
 assert.equal(details.filter(r=>r.scope==='partial').length,2);
});
test('historical feedback has no current timers or future decisions and respects date endpoints',async()=>{
 const future={id:'future-decision',dishId:'lamb',period:'晚间',choice:'keep',note:'future',at:'2026-10-05T00:00:00.000Z',evidenceIds:[]};
 sqlite.prepare('INSERT INTO freshness_decisions(id,at,payload) VALUES (?,?,?)').run(future.id,future.at,JSON.stringify(future));
 const history=await freshnessView('2026-10-04T09:00:09.000Z','2026-10-04T09:00:00.000Z','2026-10-04T09:00:09.000Z');
 assert.equal(history.feedback.length,1);assert.equal(history.decisions.length,0);assert.equal(history.timers.length,0);
});
