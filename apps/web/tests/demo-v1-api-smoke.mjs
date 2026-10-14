import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const base=process.env.DEMO_BASE_URL??'http://127.0.0.1:5173',three=process.env.THREE_BASE_URL??'http://127.0.0.1:4173';
const full=process.argv.includes('--full');
const call=async(path,body,host=base)=>{const response=await fetch(host+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});return {status:response.status,body:await response.json()};};
const ok=async(path,body,host)=>{const r=await call(path,body,host);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
const get=()=>ok('/api/demo/v1/state');const control=(s,action,requestId=crypto.randomUUID())=>({action,requestId,sessionId:s.sessionId,generation:s.generation});
let s=await get();const identity=x=>[x.datasetId,x.layoutVersion,x.sessionId,x.generation].join('|');
const restart=control(s,'restart');const twice=await Promise.all([ok('/api/demo/v1/control',restart),ok('/api/demo/v1/control',restart)]);assert.equal(twice[0].generation,s.generation+1);assert.equal(twice[1].generation,s.generation+1);s=twice[1];
const pause=control(s,'pause');s=await ok('/api/demo/v1/control',pause);const same=await Promise.all(Array.from({length:5},get));for(const c of same)assert.deepEqual(c,s);
const manifest=await ok('/api/demo/v1/manifest'),reports=await ok('/api/demo/v1/reports');assert.equal(identity(manifest),identity(s));assert.equal(identity(reports),identity(s));assert.equal(manifest.scene.plates.length,s.summary.actualPlateCount);assert.equal(manifest.scene.slots.filter(x=>x.usable).length,s.summary.carryingPositionCount);assert.equal(manifest.scene.seats.filter(x=>x.usable).length,s.summary.availableSeatCount);
assert.deepEqual((await ok('/api/demo/v1/events?after='+encodeURIComponent(s.eventCursor))).events,[]);
assert.equal((await call('/api/demo/v1/control',{...pause,action:'resume'})).status,409);
assert.equal((await call('/api/demo/v1/control',{action:'go'})).status,400);
assert.equal((await call('/api/demo/v1/events?after=bad')).body.error.code,'CURSOR_INVALID');
assert.equal((await call('/api/demo/lunch/state')).status,410);
try{const proxy=await ok('/api/demo/v1/state',undefined,three);assert.deepEqual(proxy,s);console.log('3D proxy and main server expose the same paused state');}catch(e){if(process.env.REQUIRE_THREE==='1')throw e;console.log('3D proxy not required/available:',e.message);}
const path='docs/demo-v1/http-validation.json';
if(!full){writeFileSync(path,JSON.stringify({mode:'quick',passed:true,state:s,at:new Date().toISOString()},null,2));console.log('HTTP quick checks passed; paused state saved for server restart validation');}
else{
 const oldCursor=s.eventCursor;s=await ok('/api/demo/v1/control',control(s,'restart'));assert.equal((await call('/api/demo/v1/events?after='+encodeURIComponent(oldCursor))).body.error.code,'CURSOR_EXPIRED');
 const observations=[];let deadline=Date.now()+s.playback.durationMs+15000;const hardDeadline=Date.now()+15*60000;let last='',expectedIdentity=identity(s),lastWall=Date.now();
 while(Date.now()<deadline&&Date.now()<hardDeadline){const requestStarted=Date.now();s=await get();if(identity(s)!==expectedIdentity){console.log('Another client changed playback generation; isolate and restart observation window');observations.length=0;last='';expectedIdentity=identity(s);deadline=Date.now()+s.playback.durationMs-s.simTimeMs+15000;}if(s.playback.status==='paused')deadline+=Date.now()-lastWall;lastWall=Date.now();const proxy=await ok('/api/demo/v1/state',undefined,three);if(identity(proxy)!==identity(s)){console.log('Control occurred between HTTP reads; resync on next poll');continue;}assert.ok(Math.abs(s.simTimeMs-proxy.simTimeMs)<=Date.now()-requestStarted+200,'simulated-time difference must be bounded by actual wall time between reads');assert.equal(s.summary.inStoreCustomerCount,s.customers.filter(c=>c.status!=='left').length);assert.equal(s.summary.sceneCustomerEntityCount,s.summary.inStoreCustomerCount);assert.equal(new Set(s.customers.filter(c=>c.status==='seated').map(c=>c.seatId)).size,s.summary.seatedCustomerCount);
  const focus=s.plates[0],label=[focus.remainingStatus,s.tasks[0]?.status,s.summary.inStoreCustomerCount,s.playback.status].join('|');if(label!==last){observations.push({simTimeMs:s.simTimeMs,label,summary:s.summary});console.log(JSON.stringify(observations.at(-1)));last=label;}
  if(s.playback.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,1000));
 }
 assert.equal(s.playback.status,'completed');assert.equal(s.tasks[0].status,'completed');assert.equal(s.summary.takenG,840);assert.equal(s.summary.refilledG,840);assert.equal(s.summary.uncertainG,0);assert.equal(s.summary.qualityIssueCount,0);assert.ok(observations.some(o=>o.label.startsWith('half|')));assert.ok(observations.some(o=>o.label.startsWith('low|')));
 const before=await ok('/api/demo/v1/reports');const reset=await ok('/api/demo/v1/control',control(s,'restart'));const after=await ok('/api/demo/v1/reports');assert.equal(after.current.takenG,0);assert.deepEqual(after.simulatedDay,before.simulatedDay);await ok('/api/demo/v1/control',control(reset,'pause'));
 writeFileSync(path,JSON.stringify({mode:'full',passed:true,datasetId:s.datasetId,layoutVersion:s.layoutVersion,sceneDigest:s.sceneDigest,sessionId:s.sessionId,generation:s.generation,observations,at:new Date().toISOString()},null,2));console.log('Complete automatic loop + 3D proxy + replay accounting passed');
}
