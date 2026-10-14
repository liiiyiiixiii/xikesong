import {createOperationsBackup,restoreOperationsBackup} from '../lib/operations-v2/backup.ts';
import {OperationsStore} from '../lib/operations-v2/storage.ts';
import {conveyorSnapshot} from '../lib/operations-v2/conveyor.ts';
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {createOperationsApplication} from '../lib/operations-v2/application.ts';
import {credentialRecord} from '../lib/operations-v2/security.ts';
import {identifyKitchenVisits} from '../lib/operations-v2/kitchen-visits.ts';
import {projectBindingMeasurement,type MeasurementInput,type MeasurementSample,type MeasurementEvent} from '../lib/operations-v2/measurement.ts';
import type {KitchenVisit} from '@zhishan/contracts/v2/kitchen';
import {plateAlerts} from '@zhishan/contracts/kitchen-display';
const base=Date.parse('2026-10-13T04:00:00Z'),time=(n:number)=>new Date(base+n*1000).toISOString();
const config={boundaryWindowMs:0,maxSampleGapMs:2000,freshMs:10000,stableWindowMs:1000,stableMinSamples:2,stableToleranceG:1,negativeToleranceG:1,maxStepG:null,locationFreshMs:10000,timeZone:'Asia/Shanghai' as const,ruleVersion:'test'};
const binding={id:'binding',scaleId:'scale',dishId:'dish',validFrom:time(0),validTo:null,tareG:100,fullFoodG:1000,foodOnly:true};
function data():MeasurementInput{
 const weights=[200,200,200,400,800,900,900,900,900];
 const samples:MeasurementSample[]=weights.map((grossG,i)=>({id:'sample-'+i,sample:{scaleId:'scale',bootId:'boot',sequence:i,sampledAt:time(i),grossG,measurementStatus:'ok'},receivedAt:time(i)}));
 const events:MeasurementEvent[]=[{event:{eventId:'29d857e2-106a-4c1f-98c2-81203c334404',scaleId:'scale',bootId:'boot',eventSequence:1,occurredAt:time(2),type:'enter_kitchen',sampleRef:{bootId:'boot',sequence:2}},origin:'device',receivedAt:time(2)},{event:{eventId:'13126e4b-eed4-46fc-930c-dcc86b352ec6',scaleId:'scale',bootId:'boot',eventSequence:2,occurredAt:time(6),type:'exit_kitchen',sampleRef:{bootId:'boot',sequence:6}},origin:'device',receivedAt:time(6)}];
 return {binding,config,samples,events,operations:[],asOf:time(8),version:0};
}
test('ordinary kitchen stay infers refill and restores food-only observation without injecting customer consumption',()=>{
 const input=data(),visits=identifyKitchenVisits(input,time(0));assert.equal(visits.length,1);assert.equal(visits[0].status,'refill');assert.equal(visits[0].refillG,700);assert(visits[0].evidenceIds.includes('sample-1'));
 assert.equal(projectBindingMeasurement(input).observation.foodRemainingG,null);
 const projected=projectBindingMeasurement({...input,kitchenRefills:visits});assert.equal(projected.observation.foodRemainingG,800);assert.equal(projected.observation.quality,'good');assert.equal(projected.cycles.filter(c=>c.status==='confirmed').length,0);
 assert.equal(identifyKitchenVisits(input,time(3)).length,0);assert.equal(identifyKitchenVisits(input,null).length,0);
});
test('exceptions, gaps, removed bowls, boot changes and non-kitchen increases never infer an ordinary refill',()=>{
 for(const failure of ['ice','gap','removed','boot','fault','unknown','customer','unstable']){
  const input=data();
  if(failure==='ice')input.operations=[{id:'ice',version:0,status:'pending_review',recordedAt:time(8),input:{requestId:crypto.randomUUID(),bindingId:'binding',occurredAt:time(3),type:'ice_add',quantityStatus:'unknown',weightG:null,evidenceIds:[],note:'ice'}}];
  if(failure==='gap')input.samples=input.samples.filter((_,i)=>i<3||i>5);
  if(failure==='removed')input.samples=input.samples.map((s,i)=>i===4?{...s,sample:{...s.sample,measurementStatus:'ok',grossG:0}}:s);
  if(failure==='boot')input.samples=input.samples.map((s,i)=>i>3?{...s,sample:{...s.sample,bootId:'new'}}:s);
  if(failure==='fault')input.events=[...input.events,{event:{eventId:'fault',scaleId:'scale',bootId:'boot',eventSequence:3,occurredAt:time(3),type:'device_fault',reasonCode:'sensor_fault'},receivedAt:time(3),origin:'device'}];
  if(failure==='unknown')input.binding={...binding,foodOnly:false};
  if(failure==='customer')input.events=[];
  if(failure==='unstable')input.samples=input.samples.map((s,i)=>i===5?{...s,sample:{...s.sample,measurementStatus:'ok',grossG:880}}:s);
  assert(!identifyKitchenVisits(input,time(0)).some(v=>v.status==='refill'),failure);
 }
});
test('unchanged kitchen passage and open kitchen stays are not completed refills; expiry wins over low food',()=>{
 const input=data();input.samples=input.samples.map(s=>({...s,sample:{...s.sample,measurementStatus:'ok',grossG:200}}));assert.equal(identifyKitchenVisits(input,time(0))[0].status,'unchanged');
 input.events=input.events.slice(0,1);assert.equal(identifyKitchenVisits(input,time(0))[0].status,'processing');
 assert.deepEqual(plateAlerts({known:true,empty:true,refill:true,freshness:'expired'}),['expired']);assert.deepEqual(plateAlerts({known:true,empty:false,refill:true,freshness:'warning'}),['refill','warning']);
});
const manager='kitchen-manager-token-12345678901234567890',device='kitchen-device-token-12345678901234567890';
async function fixture(t:TestContext){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-15',d1Databases:{OPS_DB:crypto.randomUUID()}});t.after(()=>mf.dispose());let now=time(0);
 const app=await createOperationsApplication(await mf.getD1Database('OPS_DB') as unknown as D1Database,{environment:'test',bootstrapToken:manager,clock:()=>now});
 const credential=await credentialRecord({id:'device',token:device,role:'device',actor:{id:'device',label:'test',kind:'system'},scaleIds:['scale'],trackIds:['track']});await app.store.transact(await app.store.revision(),[{type:'insert',table:'credentials',values:credential}]);
 async function request(path:string,body?:unknown,token=manager,method=body?'POST':'GET'){const r=await app.fetch(new Request('http://localhost/api/v2'+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));return {status:r.status,body:await r.json() as {device:{binding:{id:string}};tracks:Array<{quality:string;phaseM:number;sequence:number}>;upcoming:Array<{distanceM:number}>;rows:Array<{verificationMethod:string;assignee:unknown}>;visits:Array<{current:KitchenVisit;revisions:KitchenVisit[]}>;bowls:Array<{foodRemainingG:number|null}>}};}
 const saved=await request('/devices/scale',{requestId:crypto.randomUUID(),expectedVersion:0,scaleId:'scale',name:'Test dish',enabled:true,positionOrder:1,measurement:config,binding:{dishId:'dish',dishName:'西兰花',containerRef:null,tareG:100,fullFoodG:1000,foodOnly:true}},manager,'PUT');assert.equal(saved.status,200);
 const track={id:'track',name:'主轨',lengthM:20,direction:1,freshMs:3000,carriers:[{scaleId:'scale',offsetM:18}],windows:[{id:'window',name:'窗口一',enterM:0,exitM:3}]};
 const set=await request('/conveyor/config',{requestId:crypto.randomUUID(),expectedVersion:0,config:{automaticRefillEnabled:true,tracks:[track]}},manager,'PUT');assert.equal(set.status,200);
 return {...app,request,setTime:(n:number)=>now=time(n),track,bindingId:saved.body.device.binding.id};
}
test('HTTP track scopes, calibration, motion integration, pause, missing sequence and stale data persist safely',async t=>{
 const f=await fixture(t);
 const send=(sequence:number,n:number,running=false,speedMps=0)=>f.request('/telemetry/conveyor',{requestId:crypto.randomUUID(),motion:{trackId:'track',bootId:'boot',sequence,occurredAt:time(n),running,speedMps,direction:1}},device);
 const motion={requestId:crypto.randomUUID(),motion:{trackId:'track',bootId:'boot',sequence:0,occurredAt:time(0),running:false,speedMps:0,direction:1}};
 assert.equal((await f.request('/telemetry/conveyor',motion)).status,403);assert.equal((await f.request('/telemetry/conveyor',motion,device)).status,200);
 assert.equal((await f.request('/conveyor/state')).body.tracks[0].quality,'recalibration');
 assert.equal((await f.request('/conveyor/calibrate',{requestId:crypto.randomUUID(),expectedVersion:1,trackId:'track',bootId:'boot',sequence:0,phaseM:0})).status,200);
 const board=(await f.request('/kitchen/board?windowId=window')).body;assert.equal(board.upcoming.length,1);assert.equal(board.upcoming[0].distanceM,2);
 f.setTime(1);assert.equal((await send(1,1,true,.5)).status,200);f.setTime(2);assert.equal((await send(2,2,false,0)).status,200);
 assert.equal((await f.request('/conveyor/state')).body.tracks[0].phaseM,.5);f.setTime(3);assert.equal((await f.request('/conveyor/state')).body.tracks[0].phaseM,.5);
 f.setTime(6);assert.equal((await f.request('/conveyor/state')).body.tracks[0].quality,'stale');assert.equal((await f.request('/kitchen/board')).body.upcoming.length,0);
 assert.equal((await send(4,6)).status,200);assert.equal((await f.request('/conveyor/state')).body.tracks[0].quality,'recalibration');
 assert.equal((await f.request('/telemetry/conveyor',motion,device)).status,200);assert.equal((await f.request('/conveyor/state')).body.tracks[0].sequence,4);
 assert.equal((await f.request('/conveyor/calibrate',{requestId:crypto.randomUUID(),expectedVersion:1,trackId:'track',bootId:'boot',sequence:4,phaseM:0})).status,200);
 assert.equal((await f.request('/telemetry/conveyor',{requestId:crypto.randomUUID(),motion:{...motion.motion,sequence:5,occurredAt:time(6),positionValid:false}},device)).status,200);assert.equal((await f.request('/conveyor/state')).body.tracks[0].quality,'recalibration');
 assert.equal((await f.request('/conveyor/calibrate',{requestId:crypto.randomUUID(),expectedVersion:1,trackId:'track',bootId:'boot',sequence:5,phaseM:0})).status,409);
 const attack=await f.request('/telemetry/conveyor',{requestId:crypto.randomUUID(),motion:{...motion.motion,trackId:'other'}},device);assert.equal(attack.status,403);
});
test('real HTTP samples automatically complete an unclaimed refill task; late ice invalidates completion and retains revisions',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/serving/rules/dish',{requestId:crypto.randomUUID(),expectedVersion:0,config:{enabled:true,thresholds:{emptyG:5,lowRatio:.2,fullRatio:.7,hysteresisRatio:.01,holdSeconds:0},halfPolicy:{mode:'disabled',unchangedCycles:null,observationSeconds:null,changeToleranceG:1,deferSeconds:60,refillDuringPeak:false},peakPeriods:[],manualVerificationAllowed:true}},manager,'PUT')).status,200);
 const input=data();
 for(let i=0;i<input.samples.length;i++){
  f.setTime(i);const s=input.samples[i].sample;
  assert.equal((await f.request('/telemetry/samples',{version:2,batchId:crypto.randomUUID(),samples:[s]},device)).status,200);
  const e=input.events.find(e=>e.event.occurredAt===time(i));if(e)assert.equal((await f.request('/telemetry/events',{version:2,batchId:crypto.randomUUID(),events:[{...e.event,eventId:i===2?'29d857e2-106a-4c1f-98c2-81203c334404':'13126e4b-eed4-46fc-930c-dcc86b352ec6'}]},device)).status,200);
 }
 const tasks=(await f.request('/refill/tasks?status=resolved')).body.rows;assert.equal(tasks.length,1);assert.equal(tasks[0].verificationMethod,'automatic');assert.equal(tasks[0].assignee,null);
 const visits=(await f.request('/kitchen/visits?bindingId='+f.bindingId)).body.visits;assert.equal(visits.length,1);assert.equal(visits[0].current.status,'refill');
 assert.equal((await f.request('/conveyor/config',{requestId:crypto.randomUUID(),expectedVersion:1,config:{automaticRefillEnabled:false,tracks:[f.track]}},manager,'PUT')).status,200);
 const record={requestId:crypto.randomUUID(),bindingId:f.bindingId,occurredAt:time(3),type:'ice_add',quantityStatus:'unknown',weightG:null,evidenceIds:[],note:'迟到加冰登记'};
 assert.equal((await f.request('/operations',record)).status,200);assert.equal((await f.request('/operations',record)).status,200);
 const changed=(await f.request('/kitchen/visits?bindingId='+f.bindingId)).body.visits;assert.equal(changed.length,1);assert.equal(changed[0].current.status,'exception');assert(changed[0].revisions.some(v=>v.status==='refill'));
 assert.equal((await f.request('/refill/tasks?status=resolved')).body.rows.length,0);assert.equal((await f.request('/refill/tasks')).body.rows.length,1);assert.equal((await f.request('/serving/state')).body.bowls[0].foodRemainingG,null);
});

test('an unexplained customer-area increase prevents later kitchen weight from becoming food inference',()=>{
 const input=data();input.samples=input.samples.map((s,i)=>i===0?{...s,sample:{...s.sample,measurementStatus:'ok',grossG:150}}:s);
 assert(identifyKitchenVisits(input,time(0))[0].reasonCodes.includes('UNKNOWN_PRIOR_COMPOSITION'));
});
test('refilling below the completion threshold leaves the unclaimed task open',async t=>{
 const f=await fixture(t);
 await f.request('/serving/rules/dish',{requestId:crypto.randomUUID(),expectedVersion:0,config:{enabled:true,thresholds:{emptyG:5,lowRatio:.2,fullRatio:.7,hysteresisRatio:.01,holdSeconds:0},halfPolicy:{mode:'disabled',unchangedCycles:null,observationSeconds:null,changeToleranceG:1,deferSeconds:60,refillDuringPeak:false},peakPeriods:[],manualVerificationAllowed:true}},manager,'PUT');
 const input=data();for(let i=0;i<input.samples.length;i++){
  f.setTime(i);const s={...input.samples[i].sample,grossG:i<3?200:250};await f.request('/telemetry/samples',{version:2,batchId:crypto.randomUUID(),samples:[s]},device);
  const e=input.events.find(e=>e.event.occurredAt===time(i));if(e)await f.request('/telemetry/events',{version:2,batchId:crypto.randomUUID(),events:[e.event]},device);
 }
 assert.equal((await f.request('/kitchen/visits?bindingId='+f.bindingId)).body.visits[0].current.status,'refill');
 assert.equal((await f.request('/refill/tasks?status=resolved')).body.rows.length,0);assert.equal((await f.request('/refill/tasks?status=open')).body.rows.length,1);
});

test('backup preserves raw motion and visits while restored generation requires new calibration',async t=>{
 const f=await fixture(t);
 await f.request('/telemetry/conveyor',{requestId:crypto.randomUUID(),motion:{trackId:'track',bootId:'boot',sequence:0,occurredAt:time(0),running:false,speedMps:0,direction:1}},device);
 await f.request('/conveyor/calibrate',{requestId:crypto.randomUUID(),expectedVersion:1,trackId:'track',bootId:'boot',sequence:0,phaseM:0});
 const visit=identifyKitchenVisits(data(),time(0))[0];await f.store.transact(await f.store.revision(),[{type:'insert',table:'kitchen_visits',values:{id:visit.id,binding_id:f.bindingId,payload:JSON.stringify({current:visit,revisions:[]})}}]);
 const backup=await createOperationsBackup(f.store);assert.equal(backup.data.tables.find(t=>t.table==='conveyor_events')!.rows.length,1);
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("restore")}}',compatibilityDate:'2026-05-15',d1Databases:{DB:crypto.randomUUID()}});t.after(()=>mf.dispose());
 const restored=new OperationsStore(await mf.getD1Database('DB') as unknown as D1Database,'test');await restored.initialize();await restoreOperationsBackup(restored,backup);
 assert.equal((await restored.query('kitchen_visits')).length,1);assert.equal((await conveyorSnapshot(restored,time(0))).tracks[0].quality,'recalibration');
 assert.equal((await conveyorSnapshot(f.store,time(0))).tracks[0].quality,'estimated');
});

test('two plates refill concurrently through device batches without any employee operation',async t=>{
 const f=await fixture(t);
 await f.request('/devices/second',{requestId:crypto.randomUUID(),expectedVersion:0,scaleId:'second',name:'Second dish',enabled:true,positionOrder:2,measurement:config,binding:{dishId:'dish',dishName:'土豆丝',containerRef:null,tareG:100,fullFoodG:1000,foodOnly:true}},manager,'PUT');
 const credential=await credentialRecord({id:'device',token:device,role:'device',actor:{id:'device',label:'test',kind:'system'},scaleIds:['scale','second'],trackIds:['track']});await f.store.transact(await f.store.revision(),[{type:'upsert',table:'credentials',values:credential}]);
 await f.request('/serving/rules/dish',{requestId:crypto.randomUUID(),expectedVersion:0,config:{enabled:true,thresholds:{emptyG:5,lowRatio:.2,fullRatio:.7,hysteresisRatio:.01,holdSeconds:0},halfPolicy:{mode:'disabled',unchangedCycles:null,observationSeconds:null,changeToleranceG:1,deferSeconds:60,refillDuringPeak:false},peakPeriods:[],manualVerificationAllowed:true}},manager,'PUT');
 const input=data();for(let i=0;i<input.samples.length;i++){
  f.setTime(i);const s=input.samples[i].sample,batch={version:2,batchId:crypto.randomUUID(),samples:[s,{...s,scaleId:'second'}]};assert.equal((await f.request('/telemetry/samples',batch,device)).status,200);assert.equal((await f.request('/telemetry/samples',batch,device)).status,200);
  const e=input.events.find(e=>e.event.occurredAt===time(i));if(e)assert.equal((await f.request('/telemetry/events',{version:2,batchId:crypto.randomUUID(),events:[e.event,{...e.event,eventId:crypto.randomUUID(),scaleId:'second'}]},device)).status,200);
 }
 const tasks=(await f.request('/refill/tasks?status=resolved')).body.rows;assert.equal(tasks.length,2);assert(tasks.every(t=>t.verificationMethod==='automatic'&&t.assignee===null));assert.equal((await f.store.query('operations')).length,0);assert.equal((await f.store.query('kitchen_visits')).length,2);
});
