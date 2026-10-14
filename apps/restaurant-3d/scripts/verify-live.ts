import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {parseState,validateEvent} from '../src/external-state';
import type {SceneManifest} from '../src/demo/layout';
const base=process.env.DEMO_BASE_URL??'http://127.0.0.1:5173/api/demo/v1',scene=JSON.parse(readFileSync('public/data/scene-manifest.v1.json','utf8')) as SceneManifest;
const report:{[key:string]:unknown}={startedAt:new Date().toISOString(),base,sceneDigest:scene.contentDigest,source:'actual-main-system-http',checkpoints:[]};
async function get(path:string){const r=await fetch(base+path,{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,`${path}: ${await(r.status!==200?r.text():Promise.resolve(''))}`);return r.json();}
async function control(action:string){const s=await get('/state'),r=await fetch(base+'/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,requestId:crypto.randomUUID(),sessionId:s.sessionId,generation:s.generation})});assert.equal(r.status,200);return parseState(await r.json(),scene);}
try{
 const m=await get('/manifest');assert.equal(m.scene.contentDigest,scene.contentDigest);
 const paused=await control('pause');await sleep(650);const still=parseState(await get('/state'),scene);assert.equal(still.simTimeMs,paused.simTimeMs);assert.equal(still.revision,paused.revision);assert.deepEqual(still.plates,paused.plates);report.pause=true;
 const restarted=await control('restart');assert.equal(restarted.generation,paused.generation+1);report.restart=true;
 let previous=restarted,cursor=restarted.eventCursor,readings=0;const seen=new Map<string,unknown>(),checkpoints=report.checkpoints as unknown[];let lastStage='';let peakCustomers=0,peakSeated=0;
 const truth=JSON.parse(readFileSync('../web/data/demo-v1/validation-truth.json','utf8'));
 const deadline=Date.now()+m.durationMs+90000;
 while(true){
  assert.ok(Date.now()<deadline,'Live playback did not complete before timeout');
  const current=parseState(await get('/state'),scene);assert.equal(current.generation,restarted.generation,'Another client changed generation during live test');assert.equal(current.sessionId,restarted.sessionId);
  const events=await get('/events?after='+encodeURIComponent(cursor));for(const e of events.events){validateEvent(e,scene);if(seen.has(e.eventId))assert.deepEqual(e,seen.get(e.eventId));seen.set(e.eventId,e);}cursor=current.eventCursor;
  assert.ok(current.simTimeMs>=previous.simTimeMs);readings++;peakCustomers=Math.max(peakCustomers,current.summary.inStoreCustomerCount);peakSeated=Math.max(peakSeated,current.summary.seatedCustomerCount);
  const stage=JSON.stringify([current.summary.inStoreCustomerCount,current.summary.seatedCustomerCount,current.summary.takenG,current.summary.refilledG,current.tasks.map(t=>t.status),current.playback.status]);
  if(stage!==lastStage){const checkpoint={simTimeMs:current.simTimeMs,summary:current.summary,tasks:current.tasks.map(t=>({taskId:t.taskId,status:t.status})),playback:current.playback.status};checkpoints.push(checkpoint);console.log(JSON.stringify(checkpoint));lastStage=stage;}
  if(current.playback.status==='completed'){report.finalState=current;break;}
  previous=current;await sleep(400);
 }
 const final=report.finalState as ReturnType<typeof parseState>;assert.equal(final.summary.inStoreCustomerCount,truth.expectedFinalCustomers??0);assert.equal(final.summary.takenG,truth.expectedTakenG);assert.equal(final.summary.refilledG,truth.expectedRefilledG);assert.ok(final.tasks.some(t=>t.status==='completed'));if(truth.expectedPeakSeated)assert.equal(peakSeated,truth.expectedPeakSeated);
 for(const kind of ['customer.enter','customer.seat','customer.take','staff.refill','customer.depart','customer.leave'])assert.ok([...seen.values()].some((e:any)=>e.eventType===kind),`Missing ${kind}`);
 const reports=await get('/reports');assert.equal(reports.current.takenG,final.summary.takenG);assert.equal(reports.current.refilledG,final.summary.refilledG);report.reports=reports;report.peakCustomers=peakCustomers;report.peakSeated=peakSeated;const scheduled=JSON.parse(readFileSync('../web/data/demo-v1/validation-report.json','utf8')).presentation?.scheduledCustomers;if(scheduled){assert.equal(peakCustomers,scheduled);assert.equal(peakSeated,scheduled);}
 const refresh=parseState(await get('/state'),scene);assert.deepEqual(refresh,final);report.refreshAtCompletion=true;report.readings=readings;report.uniqueEvents=seen.size;report.passed=true;
}catch(error){report.passed=false;report.error=String(error);process.exitCode=1;console.error(error);}finally{report.finishedAt=new Date().toISOString();writeFileSync('docs/demo-v1/lunch-live-validation.json',JSON.stringify(report,null,2)+'\n');}
