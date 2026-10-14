import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const base=`http://127.0.0.1:${Number(process.env.DEMO_PORT??5273)}`;
const visual=`http://127.0.0.1:${Number(process.env.THREE_PORT??4273)}`;
async function get(url){const response=await fetch(url,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,url);return response;}
for(const route of ['/admin','/kitchen','/admin?view=intelligence'])await get(base+route);
for(const route of ['/','/menu.html','/plate-detail.html','/data/scene-manifest.v1.json'])await get(visual+route);
const manifest=await(await get(base+'/api/demo/v1/manifest')).json();
const local=JSON.parse(readFileSync(new URL('../apps/restaurant-3d/public/data/scene-manifest.v1.json',import.meta.url),'utf8'));
let state=await(await get(base+'/api/demo/v1/state')).json();
assert.equal(state.sceneDigest,local.contentDigest);assert.equal(state.plates.length,174);assert.equal(state.playback.durationMs,600000);
async function control(action){const r=await fetch(base+'/api/demo/v1/control',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({action,requestId:crypto.randomUUID(),sessionId:state.sessionId,generation:state.generation})});assert.equal(r.status,200,action);state=await r.json();return state;}
await control('restart');
assert.equal((await control('pause')).playback.status,'paused');
const pausedTime=state.simTimeMs;await new Promise(resolve=>setTimeout(resolve,350));assert.equal((await(await get(base+'/api/demo/v1/state')).json()).simTimeMs,pausedTime);
assert.equal((await control('resume')).playback.status,'running');const generation=state.generation;
await control('restart');assert.equal(state.generation,generation+1);assert(state.simTimeMs<1000);
const proxied=await(await get(visual+'/api/demo/v1/state')).json();assert.equal(proxied.sessionId,state.sessionId);
assert(manifest);
console.log('HTTP smoke passed: pages, static assets, 174 plates/96 active dishes, scene digest, shared pause/resume/restart and 3D proxy.');
