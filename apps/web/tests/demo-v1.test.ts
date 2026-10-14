import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sceneDigest,validatePackage,project,DemoError,position,inWindow} from '../lib/demo-v1/core.ts';
import {generate} from '../lib/demo-v1/generator.ts';
import {newSession,timeOf,transition} from '../lib/demo-v1/session.ts';
import {view} from '../lib/demo-v1/service.ts';
import type {SceneManifest,Dataset,Control,InputEvent} from '@zhishan/contracts/demo-v1';
const dishes=JSON.parse(readFileSync('tests/fixtures/demo-short-dishes.json','utf8'));
async function fixture(count=3,seats=12):Promise<SceneManifest>{
 const path=[{x:0,y:0,z:0},{x:10,y:0,z:0},{x:10,y:0,z:10},{x:0,y:0,z:10},{x:0,y:0,z:0}];
 const scene:SceneManifest={contractVersion:'1.0.0',layoutVersion:`test-only-${count}-${seats}`,contentDigest:'',coordinateSystem:{unit:'m',origin:'test origin',axes:{x:'right',y:'up',z:'down'},drawingScaleM:.02,measured:false},layoutParameters:{leftGapPercent:65,sauceLengthPercent:180},tracks:[{trackId:'main',enabled:true,lengthM:40,direction:1,speedMps:1,path,arcLengthLut:path.map((p,i)=>({...p,sM:i*10}))},{trackId:'backup',enabled:false,lengthM:40,direction:-1,speedMps:1,path,arcLengthLut:path.map((p,i)=>({...p,sM:i*10}))}],slots:Array.from({length:count+2},(_,i)=>({slotId:`slot-${i}`,trackId:i===count+1?'backup':'main',s0M:i*.5,usable:true})),plates:Array.from({length:count},(_,i)=>({plateId:`plate-${i}`,slotId:`slot-${i}`,dishId:dishes[i%dishes.length].dishId,diameterM:.32,heightM:.08})),kitchen:{boundary:[{x:-2,y:0,z:9},{x:2,y:0,z:9},{x:2,y:0,z:11},{x:-2,y:0,z:11}]},servingWindows:[{windowId:'kitchen',trackId:'main',centerSM:30,halfWidthM:.3,position:{x:0,y:0,z:10},staffPosition:{x:.75,y:0,z:10}}],seats:Array.from({length:seats},(_,i)=>({seatId:`seat-${i}`,usable:true,position:{x:i,y:0,z:-1},takeWindow:{trackId:'main',centerSM:5+i*.4,halfWidthM:.15}}))};scene.contentDigest=await sceneDigest(scene);return scene;
}
async function bundle(count=3,seats=12){const scene=await fixture(count,seats),result=await generate(scene,dishes,'test-only:fixture');return {scene,...result};}
function control(s:ReturnType<typeof newSession>,action:Control['action']):Control{return {action,sessionId:s.sessionId,generation:s.generation,requestId:crypto.randomUUID()};}
function changed(data:Dataset,change:(events:InputEvent[])=>void){const copy=structuredClone(data);change(copy.events);return copy;}
async function rejects(scene:SceneManifest,data:Dataset,code:string){await assert.rejects(validatePackage(scene,data),(e:unknown)=>e instanceof DemoError&&e.code===code);}

test('two capacities derive independent counts and automatically refill',async()=>{
 for(const [count,seats]of [[3,12],[61,27]]){
 const {scene,dataset,truth}=await bundle(count,seats),{result}=await validatePackage(scene,dataset);
 assert.equal(result.summary.carryingPositionCount,count+2);assert.equal(result.summary.actualPlateCount,count);assert.equal(result.summary.dishTypeCount,Math.min(count,dishes.length));assert.equal(result.summary.availableSeatCount,seats);
 assert.equal(result.summary.takenG,truth.expectedTakenG);assert.equal(result.summary.refilledG,truth.expectedRefilledG);assert.equal(result.summary.uncertainG,0);assert.equal(result.tasks[0].status,'completed');assert.equal(result.summary.inStoreCustomerCount,0);
 const half=project(scene,dataset,truth.takeTimesMs[0]);assert.equal(half.plates[0].remainingStatus,'half');assert.equal(half.tasks[0].status,'preparing');assert.equal(project(scene,dataset,truth.takeTimesMs[1]).plates[0].remainingStatus,'low');
 const backup=structuredClone(scene);backup.plates[0].slotId=`slot-${count+1}`;assert.deepEqual(position(backup,'plate-0',0),position(backup,'plate-0',99999));
 }
});
test('22 in-store customers are not truncated to 14 or seat capacity',async()=>{
 const {scene,dataset}=await bundle(20,18);dataset.events=[];
 for(let i=0;i<22;i++)dataset.events.push({eventId:`e${i}`,targetEntityId:`c${i}`,startTimeMs:0,applyTimeMs:0,endTimeMs:0,eventType:'customer.enter',layer:'action',customerId:`c${i}`});
 const {result}=await validatePackage(scene,dataset);assert.equal(result.summary.inStoreCustomerCount,22);assert.equal(result.summary.sceneCustomerEntityCount,22);assert.equal(result.summary.seatedCustomerCount,0);
});
test('event duplicates and shuffled delivery do not double count, conflicting IDs fail',async()=>{
 const {scene,dataset}=await bundle(),normal=project(scene,dataset,dataset.durationMs);
 const result=await validatePackage(scene,{...dataset,events:[...dataset.events.slice().reverse(),...dataset.events]});assert.deepEqual(result.result.summary,normal.summary);
 const conflict=structuredClone(dataset);conflict.events.push({...conflict.events[0],endTimeMs:9});await rejects(scene,conflict,'INVALID_REQUEST');
});
test('clock, pause, persistence, replay, reports and cursor synchronize',async()=>{
 const {scene,dataset}=await bundle();let s=newSession(dataset.datasetId,'fingerprint',1000);
 const a=view(scene,dataset,s,31000),b=view(scene,dataset,s,31000);assert.deepEqual(a.state,b.state);assert.deepEqual(a.events(a.state.eventCursor).events,[]);assert.equal(view(scene,dataset,s,31001).state.revision,a.state.revision);
 const before=view(scene,dataset,s,21000),later=view(scene,dataset,s,51000);assert.deepEqual([...before.events().events,...later.events(before.state.eventCursor).events],later.events().events);
 s=transition(s,control(s,'pause'),31000,dataset.durationMs);assert.equal(timeOf(s,100000,dataset.durationMs),30000);assert.deepEqual(view(scene,dataset,s,40000).state,view(scene,dataset,s,90000).state);
 const restored=JSON.parse(JSON.stringify(s));assert.deepEqual(view(scene,dataset,restored,90000).state,view(scene,dataset,s,90000).state);
 s=transition(s,control(s,'resume'),100000,dataset.durationMs);assert.equal(timeOf(s,110000,dataset.durationMs),40000);
 const old=view(scene,dataset,s,110000);s=transition(s,control(s,'restart'),110000,dataset.durationMs);const next=view(scene,dataset,s,110000);assert.equal(next.state.generation,1);assert.equal(next.state.simTimeMs,0);assert.equal(next.reports.simulatedDay.takenG,old.reports.simulatedDay.takenG);assert.equal(next.reports.current.takenG,0);
 assert.throws(()=>next.events(old.state.eventCursor),(e:unknown)=>e instanceof DemoError&&e.code==='CURSOR_EXPIRED');assert.throws(()=>next.events('malformed'));
});
test('references, duplicate seating, geometry, preparation, version and digest errors are specific',async()=>{
 const {scene,dataset}=await bundle();
 await rejects(scene,changed(dataset,es=>{const e=es.find(e=>e.eventType==='customer.seat')!;if(e.eventType==='customer.seat')e.seatId='missing';}),'REFERENCE_INVALID');
 await rejects(scene,changed(dataset,es=>{const seats=es.filter(e=>e.eventType==='customer.seat');assert.ok(seats.length>=2);seats[1].seatId=seats[0].seatId;}),'CAPACITY_INVALID');
 await rejects(scene,changed(dataset,es=>{const e=es.find(e=>e.eventType==='customer.take')!;if(e.eventType==='customer.take')e.plateId='missing';e.targetEntityId='missing';}),'REFERENCE_INVALID');
 for(const type of ['customer.take','staff.refill'])await rejects(scene,changed(dataset,es=>{const e=es.find(e=>e.eventType===type)!;e.applyTimeMs+=5000;e.endTimeMs=e.applyTimeMs+1000;if('operationId' in e){const o=es.find(o=>o.eventType==='weight.observed'&&o.operationId===e.operationId);if(o){o.startTimeMs=e.applyTimeMs;o.applyTimeMs=e.applyTimeMs;o.endTimeMs=e.applyTimeMs;}}}),'SPATIAL_INVALID');
 await rejects(scene,changed(dataset,es=>{const e=es.find(e=>e.eventType==='staff.refill')!;e.startTimeMs=0;}),'PRECONDITION_FAILED');
 await rejects(scene,{...dataset,layoutVersion:'wrong'},'DATASET_MISMATCH');await rejects({...scene,layoutVersion:'tampered'},dataset,'DIGEST_MISMATCH');
});
test('empty emergency differs from stale, offline, removed and unknown',async()=>{
 const {scene,dataset}=await bundle();const e=dataset.events.find(e=>e.eventType==='weight.observed'&&e.operationId?.startsWith('op:take'))!;if(e.eventType!=='weight.observed')throw Error('fixture');
 const data=structuredClone(dataset);data.events=data.events.filter(x=>x.applyTimeMs<=e.applyTimeMs);const sample=data.events.find(x=>x.eventId===e.eventId)!;if(sample.eventType!=='weight.observed')throw Error('fixture');sample.grossG=dishes[0].tareG;
 const empty=project(scene,data,e.applyTimeMs);assert.equal(empty.plates[0].remainingStatus,'empty');assert.equal(empty.tasks.length,1);
 for(const quality of ['offline','unknown','removed'] as const){const variant=structuredClone(data);variant.events.push({eventId:`q-${quality}`,targetEntityId:e.plateId,plateId:e.plateId,eventType:'quality.changed',layer:'observation',quality,startTimeMs:e.applyTimeMs+1,applyTimeMs:e.applyTimeMs+1,endTimeMs:e.applyTimeMs+1});assert.equal(project(scene,variant,e.applyTimeMs+1).plates[0].remainingStatus,'unknown');}
 const stale=project(scene,data,e.applyTimeMs+data.rules.staleAfterMs+1);assert.equal(stale.plates[0].quality,'stale');assert.equal(stale.plates[0].remainingStatus,'unknown');
});
test('unattributed weight, reboot, old sequence, outlier and bad quality are not customer taking',async()=>{
 const {scene,dataset}=await bundle();const sample:InputEvent={eventId:'sample',targetEntityId:'plate-0',eventType:'weight.observed',layer:'observation',plateId:'plate-0',scaleId:'scale:plate-0',bootId:'sim-boot-1',sequence:1,grossG:600,quality:'good',region:'dining',startTimeMs:1000,applyTimeMs:1000,endTimeMs:1000};
 for(const patch of [{},{bootId:'new-boot'},{quality:'offline' as const},{sequence:0},{grossG:5000}]){const result=project(scene,{...dataset,events:[{...sample,...patch}]},2000);assert.equal(result.summary.takenG,0);assert.equal(result.summary.refilledG,0);}
 const reboot=project(scene,{...dataset,events:[sample,{...sample,eventId:'boot2',bootId:'boot-2',sequence:0,applyTimeMs:2000,grossG:900},{...sample,eventId:'late-old-boot',sequence:100,applyTimeMs:3000,grossG:350}]},4000);assert.equal(reboot.plates[0].remainingG,600);assert.equal(reboot.summary.takenG,0);
});
test('normal actions use the exported windows and never exhaust a plate',async()=>{
 const {scene,dataset}=await bundle();
 for(const e of dataset.events){if(e.eventType==='customer.take')assert.ok(inWindow(scene,e.plateId,e.applyTimeMs,scene.seats.find(s=>s.seatId===e.seatId)!.takeWindow));if(e.eventType==='staff.refill')assert.ok(inWindow(scene,e.plateId,e.applyTimeMs,scene.servingWindows.find(w=>w.windowId===e.windowId)!));}
 for(const t of dataset.events.map(e=>e.applyTimeMs)){const p=project(scene,dataset,t);assert.equal(p.plates.some(p=>p.remainingStatus==='empty'),false);assert.equal(new Set(p.customers.filter(c=>c.status==='seated').map(c=>c.seatId)).size,p.summary.seatedCustomerCount);}
});

test('staleness, action boundaries, task association and playback completion advance revision and events',async()=>{
 const {scene,dataset}=await bundle();const quiet={...dataset,events:[],durationMs:40000};const s=newSession(dataset.datasetId,'fp',0);
 const good=view(scene,quiet,s,30000),stale=view(scene,quiet,s,30001);assert.equal(good.state.plates[0].quality,'good');assert.equal(stale.state.plates[0].quality,'stale');assert.ok(stale.state.revision>good.state.revision);assert.ok(stale.events(good.state.eventCursor).events.some(e=>e.eventType==='quality.expired'));
 const refill=dataset.events.find(e=>e.eventType==='staff.refill')!;if(refill.eventType!=='staff.refill')throw Error('fixture');
 const before=view(scene,dataset,s,refill.startTimeMs-1),start=view(scene,dataset,s,refill.startTimeMs),applied=view(scene,dataset,s,refill.applyTimeMs),end=view(scene,dataset,s,refill.endTimeMs);
 assert.ok(start.state.revision>before.state.revision);assert.equal(start.state.staff[0].action,'refilling');assert.equal(applied.state.staff[0].taskId,refill.taskId);assert.equal(applied.state.staff[0].action,'refilling');assert.ok(end.state.revision>applied.state.revision);assert.notEqual(end.state.staff[0].action,'refilling');
 assert.ok(view(scene,dataset,s,dataset.durationMs).state.revision>view(scene,dataset,s,dataset.durationMs-1).state.revision);
});
test('simulated-day includes only happened events and preserves their union across replays',async()=>{
 const {scene,dataset,truth}=await bundle();let s=newSession(dataset.datasetId,'fp',0);
 assert.equal(view(scene,dataset,s,truth.takeTimesMs[0]-1).reports.simulatedDay.takenG,0);
 const taken=view(scene,dataset,s,truth.takeTimesMs[0]);assert.equal(taken.reports.simulatedDay.takenG,520);assert.equal(taken.reports.simulatedDay.refilledG,0);
 s=transition(s,control(s,'restart'),truth.takeTimesMs[0],dataset.durationMs);
 const reset=view(scene,dataset,s,truth.takeTimesMs[0]);assert.equal(reset.reports.current.takenG,0);assert.equal(reset.reports.simulatedDay.takenG,520);
 assert.equal(view(scene,dataset,s,truth.takeTimesMs[0]*2).reports.simulatedDay.takenG,520);
 assert.equal(view(scene,dataset,s,truth.takeTimesMs[0]+truth.refillAtMs).reports.simulatedDay.takenG,840);
});
test('initial half plate triggers preparation without waiting for a customer action',async()=>{
 const {scene,dataset}=await bundle();dataset.events=[];dataset.initialWeights[0].grossG=800;
 const state=project(scene,dataset,0);assert.equal(state.plates[0].remainingStatus,'half');assert.equal(state.tasks.length,1);
});

test('formal movement survives a mid-walk refresh and staff occupies the exported ground point',async()=>{
 const scene=JSON.parse(readFileSync('data/demo-v1/scene-manifest.v1.json','utf8')) as SceneManifest;
 const dataset=JSON.parse(readFileSync('data/demo-v1/dataset.json','utf8')) as Dataset;
 await validatePackage(scene,dataset);
 const seat=dataset.events.find(e=>e.eventType==='customer.seat')!;if(seat.eventType!=='customer.seat')throw Error('fixture');
 const half=project(scene,dataset,Math.floor((seat.startTimeMs+seat.applyTimeMs)/2));const c=half.customers.find(c=>c.customerId===seat.customerId)!;
 assert.equal(c.status,'walking');assert.equal(c.seatId,null);assert.equal(c.targetSeatId,seat.seatId);assert.deepEqual(c.movement?.path,seat.path);assert.equal(c.movement?.endTimeMs,seat.applyTimeMs);
 const departure=dataset.events.find(e=>e.eventType==='customer.depart')!;const exiting=project(scene,dataset,departure.applyTimeMs+1).customers.find(c=>c.customerId===departure.customerId)!;assert.equal(exiting.status,'walking');assert.equal(exiting.seatId,null);assert.ok(exiting.movement);
 assert.deepEqual(half.staff.find(s=>s.role==='supplier')!.position,scene.servingWindows.find(w=>w.trackId===scene.tracks.find(t=>t.enabled)?.trackId)!.staffPosition);
});
test('configurable thresholds affect generated rule triggers and dataset identity',async()=>{
 const {scene,dataset}=await bundle();const next=await generate(scene,dishes,'test-only:fixture',{...dataset.rules,halfRatio:.6,lowRatio:.25,preparationMs:12000});assert.notEqual(next.dataset.datasetId,dataset.datasetId);
 const half=project(scene,next.dataset,next.truth.takeTimesMs[0]);assert.equal(half.plates[0].remainingStatus,'half');assert.equal(half.tasks[0].readyAtMs-half.tasks[0].preparationStartMs,12000);
 assert.equal(project(scene,next.dataset,next.truth.takeTimesMs[1]).plates[0].remainingStatus,'low');
});
test('initial missing plate is not empty and ignored device sequence does not advance revision',async()=>{
 const {scene,dataset}=await bundle();dataset.events=[];dataset.initialWeights[0].grossG=0;const s=newSession(dataset.datasetId,'fp',0);assert.equal(view(scene,dataset,s,0).state.plates[0].quality,'removed');assert.equal(view(scene,dataset,s,0).state.plates[0].remainingStatus,'unknown');
 dataset.initialWeights[0].grossG=1300;dataset.events.push({eventId:'old',targetEntityId:'plate-0',eventType:'weight.observed',layer:'observation',plateId:'plate-0',scaleId:'scale:plate-0',bootId:'sim-boot-1',sequence:0,grossG:500,quality:'good',region:'dining',startTimeMs:1000,applyTimeMs:1000,endTimeMs:1000});assert.equal(view(scene,dataset,s,999).state.revision,view(scene,dataset,s,1000).state.revision);
});


test('window alignment compares floor projection while rejecting an actual horizontal mismatch',async()=>{
 const {scene,dataset}=await bundle();scene.servingWindows[0].position.y=.98;scene.contentDigest=await sceneDigest(scene);dataset.sceneDigest=scene.contentDigest;dataset.provenance.sceneDigest=scene.contentDigest;await validatePackage(scene,dataset);
 scene.servingWindows[0].position.x+=.2;scene.contentDigest=await sceneDigest(scene);dataset.sceneDigest=scene.contentDigest;dataset.provenance.sceneDigest=scene.contentDigest;await rejects(scene,dataset,'SPATIAL_INVALID');
});


test('crowd size is bounded by active seats, spread over the track and exits are staggered',async()=>{
 const {scene,dataset}=await bundle(3,27);
 const entries=dataset.events.filter(e=>e.eventType==='customer.enter');
 const arrivals=dataset.events.filter(e=>e.eventType==='customer.seat');
 const departures=dataset.events.filter(e=>e.eventType==='customer.leave').sort((a,b)=>a.applyTimeMs-b.applyTimeMs);
 assert.equal(entries.length,24);assert.equal(arrivals.length,24);assert.equal(departures.length,24);
 assert.equal(new Set(arrivals.map(e=>e.seatId)).size,24);
 const peakTime=Math.max(...arrivals.map(e=>e.applyTimeMs));
 const peak=project(scene,dataset,peakTime);assert.equal(peak.summary.inStoreCustomerCount,24);assert.equal(peak.summary.seatedCustomerCount,24);
 for(let i=1;i<departures.length;i++)assert.ok(departures[i].applyTimeMs-departures[i-1].applyTimeMs>=1100);
 assert.equal(project(scene,dataset,dataset.durationMs).summary.inStoreCustomerCount,0);
 const reduced=await generate(scene,dishes,'test-only:reduced',dataset.rules,{customerCount:6,arrivalIntervalMs:1600});
 assert.equal(reduced.dataset.events.filter(e=>e.eventType==='customer.enter').length,6);
 await assert.rejects(generate(scene,dishes,'test-only:invalid',dataset.rules,{customerCount:-1,arrivalIntervalMs:1600}));
});
