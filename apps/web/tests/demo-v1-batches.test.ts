import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {plateFreshness} from '../lib/demo-v1/freshness.ts';
import {project,validatePackage} from '../lib/demo-v1/core.ts';
import {view} from '../lib/demo-v1/service.ts';
import {newSession} from '../lib/demo-v1/session.ts';
import {demoKitchenView} from '../lib/demo-v1/kitchen-view.ts';
import type {Dataset,SceneManifest,DemoState} from '@zhishan/contracts/demo-v1';
const scene=JSON.parse(readFileSync('data/demo-v1/scene-manifest.v1.json','utf8')) as SceneManifest;
const data=JSON.parse(readFileSync('data/demo-v1/dataset.json','utf8')) as Dataset;
const first=data.servingBatches![0].plateId;
const batch=(start:number,end:number|null,id='a')=>({batchId:id,plateId:first,startedAtMs:start,endedAtMs:end,displayWarnAfterMs:10000,displayExpireAfterMs:20000});
test('batch age follows opening/replacement/removal, not refill or global playback',()=>{
 const d={...data,servingBatches:[batch(-5000,18000),batch(18000,40000,'b')]};
 assert.equal(plateFreshness(scene,d,first,4999).state,'fresh');
 assert.equal(plateFreshness(scene,d,first,5000).state,'warning');
 assert.equal(plateFreshness(scene,d,first,15000).state,'expired');
 assert.equal(plateFreshness(scene,d,first,18000).batchId,'b');
 assert.equal(plateFreshness(scene,d,first,18000).state,'fresh');
 assert.equal(plateFreshness(scene,d,first,40000).startedAtMs,null);
 const refill=data.events.find(e=>e.eventType==='staff.refill')!;
 const plateId='plateId' in refill?refill.plateId:'';
 const before=project(scene,data,refill.applyTimeMs-1).plates.find(p=>p.plateId===plateId)!.freshness!;
 const after=project(scene,data,refill.applyTimeMs+1).plates.find(p=>p.plateId===plateId)!.freshness!;
 assert.equal(before.batchId,after.batchId);assert.equal(before.startedAtMs,after.startedAtMs);
 assert.equal(plateFreshness(scene,{...data,servingBatches:[]},first,299000).state,'unconfigured');
});
test('cached API recomputes exact batch boundaries and replay is deterministic',()=>{
 const d={...data,events:[],servingBatches:[batch(0,null)]};Object.freeze(d.events);
 const s=newSession(d.datasetId,'batch-test',0),complete=project(scene,d,d.durationMs);
 for(const time of [9999,10000,19999,20000,0]){
  const actual=view(scene,d,s,time,complete).state.plates.find(p=>p.plateId===first)!.freshness;
  assert.deepEqual(actual,plateFreshness(scene,d,first,time));
 }
});
test('inactive track has no freshness or kitchen alerts even if empty',()=>{
 const plates=project(scene,data,299000).plates;
 const inactive=plates.filter(p=>!scene.tracks.find(t=>t.trackId===p.trackId)!.enabled);
 assert.equal(inactive.length,78);
 for(const p of inactive){p.remainingG=0;p.remainingStatus='empty';assert.equal(p.freshness!.state,'unconfigured');}
 const state={plates,dishes:data.dishes,simTimeMs:299000} as DemoState;
 const board=demoKitchenView(scene,state,'supply-backup');
 assert.equal(board.windows.find(w=>w.id==='supply-backup')!.pending,0);
 assert.equal(board.upcoming.length,0);assert.equal(board.processing.length,0);
 assert.equal(project(scene,data,299000).plates.filter(p=>p.freshness?.state==='warning').length,0);
 assert(new Set(data.servingBatches!.map(b=>b.startedAtMs)).size>80);
});
test('batch package rejects overlap, bad references and inverted timing',async()=>{
 for(const servingBatches of [[batch(0,null),batch(5000,null,'b')],[{...batch(0,null),plateId:'missing'}],[batch(5000,1000)]])await assert.rejects(validatePackage(scene,{...data,servingBatches}));
});
