import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildGeometry,wrap,type SceneManifest} from '../src/demo/layout';
import {parseState,validateEvent,SharedClock,PresentationBuffer,StateSource,interpolateMovement,type State,type DemoEvent} from '../src/external-state';
import {counts,project} from '../src/simulation';
const scene=JSON.parse(readFileSync('public/data/scene-manifest.v1.json','utf8')) as SceneManifest;
function stateAt(t=0):State{return {reports:{contractVersion:'1.0.0',datasetId:'fixture-boundary-tests-only',layoutVersion:scene.layoutVersion,sessionId:'fixture-session',generation:0,revision:1,simTimeMs:t,source:'simulation',current:{takenG:0,refilledG:0,uncertainG:0},simulatedDay:{date:'2026-10-12',scope:'dataset-once',datasetId:'fixture-boundary-tests-only',takenG:0,refilledG:0,uncertainG:0},byDish:[],history:{halfMonth:null,month:null},note:'unit-test-only'},contractVersion:'1.0.0',datasetId:'fixture-boundary-tests-only',layoutVersion:scene.layoutVersion,sceneDigest:scene.contentDigest,sessionId:'fixture-session',generation:0,revision:1,simTimeMs:t,source:'simulation',playback:{status:'running',durationMs:300000},plates:scene.plates.map(p=>{const slot=scene.slots.find(s=>s.slotId===p.slotId)!,track=scene.tracks.find(t=>t.trackId===slot.trackId)!;return {...p,trackId:track.trackId,sM:wrap(slot.s0M+(track.enabled?track.speedMps*t/1000:0),track.lengthM),remainingG:1000,fullG:1000,quality:'good',remainingStatus:'full',lastObservedSimTimeMs:0};}),customers:[],staff:[],tasks:[],summary:{carryingPositionCount:scene.slots.length,actualPlateCount:scene.plates.length,dishTypeCount:new Set(scene.plates.map(p=>p.dishId)).size,availableSeatCount:scene.seats.length,seatedCustomerCount:0,inStoreCustomerCount:0,sceneCustomerEntityCount:0,takenG:0,refilledG:0,uncertainG:0,qualityIssueCount:0},eventCursor:`opaque:${t}`,activeEvents:[],dishes:scene.dishCatalog,rules:{label:'演示参数，非实测门店标准',halfRatio:.5,lowRatio:.2,emptyG:0,preparationMs:10000,actionMs:1000,staleAfterMs:30000,maxDeltaG:1500}};}
const event=(time=1000):DemoEvent=>({eventId:`test:${time}`,eventType:'weight.observed',layer:'observation',targetEntityId:scene.plates[0].plateId,plateId:scene.plates[0].plateId,scaleId:'fixture-scale',bootId:'fixture-boot',sequence:1,grossG:800,quality:'good',region:'dining',startTimeMs:time,applyTimeMs:time,endTimeMs:time});
test('valid counts are independent; walking customers not seated; duplicate seats rejected',()=>{
 const s=stateAt(5000);s.customers=Array.from({length:20},(_,i)=>({customerId:`customer-${i}`,status:'walking' as const,seatId:null,enteredAtMs:1000,leftAtMs:null,movement:{path:scene.seats[i].approachPath.map(p=>({...p,y:0})),startTimeMs:1000,endTimeMs:20000}}));s.summary.inStoreCustomerCount=20;s.summary.sceneCustomerEntityCount=20;
 assert.equal(parseState(s,scene).customers.length,20);assert.equal(counts(scene,s).seatedCustomers,0);assert.equal(project(scene,s,5000).customers.length,20);
 s.customers[0].status='seated';s.customers[0].seatId=scene.seats[0].seatId;s.customers[1].status='seated';s.customers[1].seatId=scene.seats[0].seatId;assert.throws(()=>parseState(s,scene),/重复占用/);
});
test('no fixed menu order, name or dataset historical time restriction',()=>{
 const s=stateAt();s.dishes.reverse();s.dishes=s.dishes.map(d=>({...d,name:'业务修改名称'+d.dishId}));s.plates.reverse();assert.doesNotThrow(()=>parseState(s,scene));
 const changed=structuredClone(s);changed.plates[0].dishId='bad';assert.throws(()=>parseState(changed,scene),/REFERENCE_INVALID/);
});
test('mismatched digest, duplicate plates, invalid source and server position fail explicitly',()=>{
 for(const change of [(s:State)=>s.sceneDigest='bad',(s:State)=>s.plates.push(s.plates[0]),(s:State)=>(s.source='device' as 'simulation'),(s:State)=>s.plates[0].sM+=1]){const s=stateAt();change(s);assert.throws(()=>parseState(s,scene));}
});
test('client does not classify remaining weights or mutate business quantities',()=>{
 const s=stateAt();s.plates[0].remainingG=300;s.plates[0].remainingStatus='full';parseState(s,scene);const before=JSON.stringify(s);project(scene,s,2000,[event()]);assert.equal(JSON.stringify(s),before);assert.equal(s.plates[0].remainingStatus,'full');
});
test('shared clock stays continuous at 300ms polling plus jitter and action apply point',()=>{
 const clock=new SharedClock();clock.accept(stateAt(10000),0);
 const packets=[{at:350,sim:10300},{at:680,sim:10600},{at:1080,sim:10900},{at:1420,sim:11200},{at:1670,sim:11500},{at:1980,sim:11800},{at:2300,sim:12100}];
 const samples:number[]=[];for(let now=0;now<=2500;now+=10){const p=packets.find(p=>p.at===now);if(p){const s=stateAt(p.sim);s.activeEvents=[event(11500)];clock.accept(s,now);}if(now>=1000)samples.push(clock.time(now));}
 for(let i=1;i<samples.length;i++)assert.ok(Math.abs(samples[i]-samples[i-1]-10)<1e-8,'normal traffic cannot periodically stop the belt');
 assert.equal(clock.time(10000),12350);assert.equal(clock.time(99999),12350);assert.equal(clock.stale(10000),true);
});
test('pause freezes every domain, resume anchors to shared time and restart resets generation',()=>{
 const clock=new SharedClock();const paused=stateAt(7000);paused.playback.status='paused';clock.accept(paused,100);assert.equal(clock.time(80000),7000);const a=project(scene,paused,clock.time(200));const b=project(scene,paused,clock.time(5000));assert.deepEqual(a,b);
 const resumed=stateAt(7000);clock.accept(resumed,5000);assert.equal(clock.time(6200),7250); // bounded by server confirmation
 const restarted=stateAt(0);restarted.generation=1;clock.accept(restarted,7000);assert.equal(clock.time(7000),0);
});
test('buffered authoritative weights switch at applyTimeMs, not before; track never stops there',()=>{
 const buffer=new PresentationBuffer();const before=stateAt(900),after=stateAt(1200);after.revision=2;after.plates[0].remainingG=500;
 buffer.add(before,[]);buffer.add(after,[event(1000)]);assert.equal(buffer.at(999)!.plates[0].remainingG,1000);assert.equal(buffer.at(1000)!.plates[0].remainingG,500);
 const p1=project(scene,buffer.at(999),999).plates[0].position,p2=project(scene,buffer.at(1000),1000).plates[0].position;assert.ok(Math.hypot(p2.x-p1.x,p2.z-p1.z)>0);
});
test('movement interpolation uses route arc length and exact endpoints',()=>{
 const m={path:[{x:0,z:0},{x:3,z:0},{x:3,z:4}],startTimeMs:100,endTimeMs:7100};assert.equal(interpolateMovement(m,3100).x,3);assert.equal(interpolateMovement(m,3100).z,0);assert.equal(interpolateMovement(m,7100).z,4);
});
test('take and refill are rejected if apply-time plate is outside the correct window',()=>{
 const seat=scene.seats[0],e={...event(),eventType:'customer.take',layer:'action',seatId:seat.seatId,customerId:'fixture-customer',operationId:'fixture-operation'} as DemoEvent;assert.throws(()=>validateEvent(e,scene),/SPATIAL_INVALID/);
});
test('state/events HTTP gap does not lose a short ended event; opaque cursor retained, duplicate IDs deduplicated',async()=>{
 let now=0,stateReads=0;const requested:string[]=[];const short=event(150);
 const fetcher=async(url:RequestInfo|URL)=>{const path=String(url);requested.push(path);if(path.endsWith('/manifest'))return Response.json({contractVersion:'1.0.0',scene});if(path.endsWith('/reports'))return Response.json({...stateAt(),current:{}});
  if(path.endsWith('/state')){stateReads++;const s=stateAt(stateReads===1?0:stateReads===2?100:250);return Response.json(s);}
  const response={...stateAt(200),events:path.endsWith('opaque%3A0')?[]:[short,short],eventCursor:'opaque-server-advanced'};return Response.json(response);};
 const source=new StateSource('/api/demo/v1',scene,()=>{},fetcher as typeof fetch,()=>now);await source.poll();now=300;await source.poll();now=600;await source.poll();assert.ok(source.events.has(short.eventId));assert.equal(source.events.size,1);assert.ok(requested.some(s=>s.endsWith('after=opaque%3A100')));assert.ok(!requested.some(s=>s.includes('after=opaque-server-advanced')));
});
test('cursor expiry and generation changes trigger a clean state resynchronisation',async()=>{
 let expired=false,generation=0;const requests:string[]=[];
 const fetcher=async(url:RequestInfo|URL)=>{const path=String(url);requests.push(path);const s=stateAt();s.generation=generation;if(path.endsWith('/manifest'))return Response.json({contractVersion:'1.0.0',scene});if(path.includes('/events')&&!expired){expired=true;return Response.json({error:{code:'CURSOR_EXPIRED',message:'expired'}},{status:410});}if(path.includes('/events'))return Response.json({...s,events:[],eventCursor:'new-cursor'});return Response.json(s);};
 const source=new StateSource('/api/demo/v1',scene,()=>{},fetcher as typeof fetch);await source.poll();await source.poll();assert.match(source.error,/CURSOR_EXPIRED/);generation=1;await source.poll();assert.equal(source.latest?.generation,1);assert.equal(source.error,'');assert.equal(requests.filter(p=>p.endsWith('/manifest')).length,2);
});
test('a second real geometry configuration and 12 plate bindings work end-to-end in the projector',()=>{
 const variant=buildGeometry({seatPitchM:1.4,plateGapM:.55});variant.dishCatalog=scene.dishCatalog;
 variant.plates=scene.plates.slice(0,12).map((p,i)=>({...p,slotId:variant.slots[i*2].slotId}));variant.contentDigest='sha256:fixture-alternative-layout';
 const s=stateAt();s.sceneDigest=variant.contentDigest;s.plates=s.plates.slice(0,12).map((p,i)=>({...p,slotId:variant.plates[i].slotId,sM:variant.slots[i*2].s0M}));
 s.summary.carryingPositionCount=variant.slots.length;s.summary.actualPlateCount=12;s.summary.dishTypeCount=new Set(variant.plates.map(p=>p.dishId)).size;s.summary.availableSeatCount=variant.seats.length;
 assert.doesNotThrow(()=>parseState(s,variant));const count=counts(variant,s);assert.equal(count.carryingPositions,variant.slots.filter(slot=>slot.usable).length);assert.notEqual(count.carryingPositions,scene.slots.filter(slot=>slot.usable).length);assert.equal(count.availableSeats,variant.seats.filter(seat=>seat.usable).length);assert.notEqual(count.availableSeats,scene.seats.filter(seat=>seat.usable).length);assert.equal(sceneProjectCount(),12);
 function sceneProjectCount(){return project(variant,s,5000).plates.length;}
});
test('network failure freezes within cap, reconnect snapshots server state without local drift',async()=>{
 let now=0,offline=false,serverTime=10000;const fetcher=async(url:RequestInfo|URL)=>{if(offline)throw Error('network offline');const path=String(url),s=stateAt(serverTime);if(path.endsWith('/manifest'))return Response.json({contractVersion:'1.0.0',scene});if(path.includes('/events'))return Response.json({...s,events:[],eventCursor:'opaque-new'});return Response.json(s);};
 const source=new StateSource('/api/demo/v1',scene,()=>{},fetcher as typeof fetch,()=>now);await source.poll();offline=true;now=10000;await source.poll();assert.equal(source.clock.time(now),10250);assert.equal(source.clock.time(now+99999),10250);assert.match(source.status(),/连接异常/);
 offline=false;serverTime=17000;now=12000;await source.poll();assert.equal(source.latest?.simTimeMs,17000);assert.equal(source.clock.time(now),17000);assert.equal(source.error,'');
});
test('ambiguous control response retries same requestId, never issues a second logical restart',async()=>{
 const requests:any[]=[];let attempt=0;const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>{const path=String(url);if(path.endsWith('/manifest'))return Response.json({contractVersion:'1.0.0',scene});if(path.endsWith('/control')){requests.push(JSON.parse(String(init?.body)));if(attempt++===0)throw Error('fetch lost response');const s=stateAt();s.generation=1;return Response.json(s);}return Response.json(stateAt());};
 const source=new StateSource('/api/demo/v1',scene,()=>{},fetcher as typeof fetch);await source.poll();await source.control('restart');assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId);assert.equal(source.latest?.generation,1);
});
test('paused and completed polling retain one snapshot per effective boundary',()=>{
 const buffer=new PresentationBuffer(),paused=stateAt(1000);paused.playback.status='paused';
 buffer.add(stateAt(900),[]);buffer.add(paused,[event(1000)]);
 for(let i=0;i<10000;i++)buffer.add(paused,[event(1000)]);
 const frames=(buffer as unknown as {frames:unknown[]}).frames;
 assert.equal(frames.length,2,'wall time cannot grow a paused buffer');
 assert.equal(buffer.at(999)?.simTimeMs,900);assert.equal(buffer.at(1000),paused);
 const completed=stateAt(300000);completed.playback.status='completed';
 for(let i=0;i<10000;i++)buffer.add(completed,[event(300000)]);
 assert.ok(frames.length<=2,'completed playback must remain bounded');
 assert.equal(buffer.at(300000),completed);
});
test('reports use the same state revision without a second network dependency',async()=>{
 const paths:string[]=[];const fetcher=async(url:RequestInfo|URL)=>{const path=String(url);paths.push(path);if(path.endsWith('/manifest'))return Response.json({contractVersion:'1.0.0',scene});if(path.endsWith('/state'))return Response.json(stateAt(100));throw Error('separate reporting endpoint unavailable');};
 const source=new StateSource('/api/demo/v1',scene,()=>{},fetcher as typeof fetch);await source.poll();
 assert.equal(source.connected,true);assert.equal(source.error,'');assert.deepEqual(source.reports,stateAt(100).reports);
 assert.ok(!paths.some(p=>p.endsWith('/reports')));
});
test('conflicting event response is rejected atomically and clean resync recovers',async()=>{
 let reads=0;const first=event(0),later=event(50);
 const fetcher=async(url:RequestInfo|URL)=>{const path=String(url);if(path.endsWith('/manifest'))return Response.json({contractVersion:'1.0.0',scene});
  if(path.includes('/events'))return Response.json({...stateAt(100),events:[later],eventCursor:'opaque:100'});
  const s=stateAt(reads++===0?0:100);s.activeEvents=[reads===2?{...first,grossG:900} as DemoEvent:first];return Response.json(s);};
 const source=new StateSource('/api/demo/v1',scene,()=>{},fetcher as typeof fetch);await source.poll();const accepted=source.latest;
 await source.poll();assert.match(source.error,/内容冲突/);assert.equal(source.latest,accepted);assert.equal(source.clock.state,accepted);
 assert.deepEqual([...source.events.values()],[first],'no partially accepted stream events');
 await source.poll();assert.equal(source.error,'');assert.equal(source.latest?.simTimeMs,100);assert.equal(source.connected,true);
});
test('network events reject unknown kinds, malformed measurement payloads and missing references',()=>{
 const valid=event();assert.doesNotThrow(()=>validateEvent(valid,scene));
 for(const bad of [
  {...valid,eventType:'invented.event'}, {...valid,layer:'action'}, {...valid,grossG:-100}, {...valid,sequence:-1},
  {...valid,quality:'invalid'}, {...valid,region:'invalid'}, {...valid,plateId:'missing-plate'},
  {eventId:'derived',eventType:'task.created',layer:'observation',targetEntityId:'staff',status:'preparing',startTimeMs:0,applyTimeMs:0,endTimeMs:0},
 ])assert.throws(()=>validateEvent(bad as DemoEvent,scene),/SCHEMA_INVALID|REFERENCE_INVALID/);
});
