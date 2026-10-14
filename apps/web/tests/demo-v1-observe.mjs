// Read-only live acceptance. Never pause, resume, restart or mutate the shared session.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const base=process.env.DEMO_BASE_URL??'http://127.0.0.1:5173',three=process.env.THREE_BASE_URL??'http://127.0.0.1:4173';
const identity=s=>[s.datasetId,s.layoutVersion,s.sessionId,s.generation].join('|');
const get=async(host,path='/api/demo/v1/state')=>{const r=await fetch(host+path,{cache:'no-store'});const s=await r.json();if(r.status===410&&s.error?.code==='CURSOR_EXPIRED')return {expired:true};assert.equal(r.status,200,JSON.stringify(s));return s;};
let expected='',observations=[],initialTime=null,last='',cursor=null,allEvents=new Map(),reads=0,maxRoundTripMs=0,lastState;
const deadline=Date.now()+15*60000;
while(Date.now()<deadline){
 const started=Date.now(),[s,p]=await Promise.all([get(base),get(three)]);maxRoundTripMs=Math.max(maxRoundTripMs,Date.now()-started);
 if(identity(s)!==identity(p)){console.log('Playback changed between reads, resynchronizing');continue;}
 assert.ok(Math.abs(s.simTimeMs-p.simTimeMs)<=Date.now()-started+200);
 if(identity(s)!==expected){expected=identity(s);observations=[];initialTime=s.simTimeMs;cursor=null;allEvents=new Map();console.log(JSON.stringify({identity:expected,initialTimeMs:initialTime}));}
 assert.equal(s.summary.actualPlateCount,s.plates.length);assert.equal(s.summary.inStoreCustomerCount,s.customers.filter(c=>c.status!=='left').length);assert.equal(s.summary.seatedCustomerCount,new Set(s.customers.filter(c=>c.status==='seated').map(c=>c.seatId)).size);assert.equal(s.summary.sceneCustomerEntityCount,s.summary.inStoreCustomerCount);
 assert.equal(identity(s.reports),identity(s));assert.equal(s.reports.simTimeMs,s.simTimeMs);assert.ok(s.reports.simulatedDay.takenG>=s.summary.takenG);assert.equal(s.summary.uncertainG,0);assert.equal(s.summary.qualityIssueCount,0);
 const stream=await get(base,'/api/demo/v1/events'+(cursor?'?after='+encodeURIComponent(cursor):''));if(stream.expired||identity(stream)!==expected){cursor=null;expected='';continue;}cursor=stream.eventCursor;for(const e of stream.events)allEvents.set(e.eventId,e);
 const label=[s.plates[0].remainingStatus,s.tasks[0]?.status,s.summary.inStoreCustomerCount,s.summary.seatedCustomerCount,s.playback.status].join('|');
 if(label!==last){observations.push({simTimeMs:s.simTimeMs,label,summary:s.summary});console.log(JSON.stringify(observations.at(-1)));last=label;}
 reads++;lastState=s;
 if(s.playback.status==='completed'&&observations.some(o=>o.label.startsWith('half|'))&&observations.some(o=>o.label.startsWith('low|'))){
  assert.equal(s.tasks[0].status,'completed');assert.equal(s.summary.takenG,840);assert.equal(s.summary.refilledG,840);assert.equal(s.summary.inStoreCustomerCount,0);
  const manifest=await get(base,'/api/demo/v1/manifest');assert.equal(manifest.scene.contentDigest,s.sceneDigest);assert.equal(manifest.scene.slots.filter(x=>x.usable).length,s.summary.carryingPositionCount);assert.equal(manifest.scene.seats.filter(x=>x.usable).length,s.summary.availableSeatCount);
  writeFileSync('docs/demo-v1/http-validation.json',JSON.stringify({mode:'full',method:'read-only complete automatic loop via main HTTP and actual 3D proxy; no controls sent',passed:true,datasetId:s.datasetId,layoutVersion:s.layoutVersion,sceneDigest:s.sceneDigest,sessionId:s.sessionId,generation:s.generation,initialTimeMs:initialTime,reads,eventCount:allEvents.size,maxRoundTripMs,observations,at:new Date().toISOString()},null,2));console.log('Read-only full HTTP + 3D proxy acceptance passed');process.exit(0);
 }
 await new Promise(r=>setTimeout(r,750));
}
throw Error('Did not observe a complete consistent generation: '+JSON.stringify(lastState?.playback));
