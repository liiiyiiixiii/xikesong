/** Consumes the OTHER project's generated package and business projector read-only.
 * This is an integration check, never a second business engine or production endpoint.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {project as mainProject,validatePackage} from '../../apps/web/lib/demo-v1/core';
import {generateRush} from '../../apps/web/lib/demo-v1/rush-generator';
import {sceneSchema} from '@zhishan/contracts/demo-v1';
import type {Dataset} from '@zhishan/contracts/demo-v1';
import type {SceneManifest} from '../../apps/restaurant-3d/src/demo/layout';
import {parseState,validateEvent,type State} from '../../apps/restaurant-3d/src/external-state';
import {project as sceneProject} from '../../apps/restaurant-3d/src/simulation';
const scene=JSON.parse(readFileSync('public/data/scene-manifest.v1.json','utf8')) as SceneManifest;
const officialScene=sceneSchema.parse(scene);
// Explicit candidate mode exercises the official generator without publishing into
// the other project's directory. Default mode still rejects a stale published package.
const candidateMode=process.env.DEMO_PACKAGE_MODE==='candidate';
const dataset:Dataset=candidateMode
 ? (await generateRush(scene,JSON.parse(readFileSync('../web/data/demo-v1/dishes.json','utf8')),`read-only-candidate:${scene.layoutVersion}`)).dataset
 : JSON.parse(readFileSync('../web/data/demo-v1/dataset.json','utf8'));
for(const e of dataset.events)Object.freeze(e);Object.freeze(dataset.events);
test(`${candidateMode?'in-memory official-generator candidate':'published main-system lunch package'} matches current manifest and all event windows`,async()=>{
 await validatePackage(scene,dataset);for(const e of dataset.events)validateEvent(e,scene);
 assert.equal(dataset.sceneDigest,scene.contentDigest);assert.equal(dataset.source,'simulation');
});
test('every action boundary ±1ms projects correct counts/weights and real customer IDs',()=>{
 const times=new Set([0,dataset.durationMs]);for(const e of dataset.events)if(e.layer==='action')for(const t of [e.startTimeMs,e.applyTimeMs,e.endTimeMs])for(const dt of [-1,0,1])if(t+dt>=0&&t+dt<=dataset.durationMs)times.add(t+dt);
 for(const t of [...times].sort((a,b)=>a-b)){
  const core=mainProject(officialScene,dataset,t);
  const meta={contractVersion:'1.0.0' as const,datasetId:dataset.datasetId,layoutVersion:scene.layoutVersion,sessionId:'read-only-integration',generation:0,revision:core.appliedCount,simTimeMs:t,source:'simulation' as const};
  const totals={takenG:core.summary.takenG,refilledG:core.summary.refilledG,uncertainG:core.summary.uncertainG};
  const s:State={...meta,...core,sceneDigest:scene.contentDigest,playback:{status:t===dataset.durationMs?'completed':'running',durationMs:dataset.durationMs},eventCursor:'read-only-fixture-cursor',activeEvents:core.events.filter(e=>e.startTimeMs<=t&&e.endTimeMs>t),dishes:dataset.dishes,rules:dataset.rules,reports:{...meta,current:totals,simulatedDay:{...totals,date:dataset.simulatedBusinessDate,scope:'dataset-once',datasetId:dataset.datasetId},byDish:core.byDish,history:{halfMonth:null,month:null},note:'read-only integration fixture'}};
  parseState(s,scene);const visual=sceneProject(scene,s,t,s.activeEvents);
  assert.deepEqual(visual.customers.map(c=>c.customerId),s.customers.filter(c=>c.status!=='left').map(c=>c.customerId));assert.ok(visual.customers.every(c=>!c.missingMovement));
  assert.equal(visual.customers.filter(c=>c.seated).length,s.summary.seatedCustomerCount);
 }
 const final=mainProject(officialScene,dataset,dataset.durationMs);assert.ok(final.summary.refilledG>0);if(dataset.simulationWindow){assert.equal(final.summary.inStoreCustomerCount,47);assert.equal(mainProject(officialScene,dataset,0).summary.seatedCustomerCount,31);}else {assert.equal(final.summary.takenG,final.summary.refilledG);assert.equal(final.summary.inStoreCustomerCount,0);}
});
