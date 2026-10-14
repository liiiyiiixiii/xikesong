import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {arrangeLabels} from '../../apps/restaurant-3d/src/label-layout';
import {livePositions} from '../../apps/restaurant-3d/src/live-position';
import {demoKitchenView} from '../../apps/web/lib/demo-v1/kitchen-view';
import {demoFreshness} from '../../apps/web/lib/demo-v1/freshness';
import {project} from '../../apps/web/lib/demo-v1/core';
import type {SceneManifest,Dataset,DemoState} from '@zhishan/contracts/demo-v1';
import {plateAlerts} from '@zhishan/contracts/kitchen-display';
test('dense callouts avoid overlap, preserve priority and report overflow',()=>{
 const layout=arrangeLabels(Array.from({length:30},(_,i)=>({id:String(i),text:'菜品',alert:i===25?'expired' as const:'refill' as const,x:300,y:200})),640,480);
 assert.equal(layout.placed[0].id,'25');assert(layout.hidden.length>0);assert.equal(layout.placed.length+layout.hidden.length,30);
 for(const a of layout.placed)for(const b of layout.placed)if(a!==b)assert(a.left+84<=b.left||b.left+84<=a.left||a.top+30<=b.top||b.top+30<=a.top);
});
test('live track motion uses server positions and freezes authority when expired',()=>{
 const snapshot={contractVersion:'operations-v2' as const,serverAt:'2026-10-13T00:00:00Z',dataRevision:'test:1',environment:'test' as const,tracks:[{trackId:'a',name:'A',lengthM:20,direction:1 as const,quality:'estimated' as const,bootId:'b',sequence:1,running:true,speedMps:.1,observedAt:'2026-10-13T00:00:00Z',validUntil:'2026-10-13T00:00:03Z',phaseM:0,positions:[{scaleId:'real',positionM:0}]}]};
 const start=livePositions(snapshot,0).get('real')!,next=livePositions(snapshot,1000).get('real')!;assert.notDeepEqual(start,next);assert.equal(livePositions(snapshot,3001).size,0);assert.equal(livePositions(null,0).size,0);
 snapshot.tracks[0].running=false;snapshot.tracks[0].speedMps=0;assert.deepEqual(livePositions(snapshot,0),livePositions(snapshot,1000));
});
test('demo ten-plate views remain window-specific, ordered, and independent of alert severity',async()=>{
 const scene=JSON.parse(await readFile(new URL('../../apps/web/data/demo-v1/scene-manifest.v1.json',import.meta.url),'utf8')) as SceneManifest;
 const dataset=JSON.parse(await readFile(new URL('../../apps/web/data/demo-v1/dataset.json',import.meta.url),'utf8')) as Dataset;
 const projection=project(scene,dataset,0),state={...projection,dishes:dataset.dishes,simTimeMs:0} as unknown as DemoState;
 for(const window of scene.servingWindows){const view=demoKitchenView(scene,state,window.windowId);assert.equal(view.upcoming.length,scene.tracks.find(t=>t.trackId===window.trackId)!.enabled?10:0);assert(view.upcoming.every(p=>p.trackId===window.trackId));assert(view.upcoming.every((p,i)=>i===0||p.distanceM!>=view.upcoming[i-1].distanceM!));const original=view.upcoming.map(x=>x.id);for(const p of state.plates){p.remainingStatus='empty';p.remainingG=0;}assert.deepEqual(demoKitchenView(scene,state,window.windowId).upcoming.map(x=>x.id),original);}
 const rules={...dataset.rules,displayWarnAfterMs:240000,displayExpireAfterMs:360000};assert.equal(demoFreshness(rules,239999,0).state,'fresh');assert.equal(demoFreshness(rules,240000,0).state,'warning');assert.equal(demoFreshness(rules,360000,0).state,'expired');
 assert.deepEqual(plateAlerts({known:true,empty:true,refill:true,freshness:'expired'}),['expired']);
});

test('warnings stay as markers; only selected and up to three urgent cards expand',()=>{
 const points=Array.from({length:174},(_,i)=>({id:String(i),text:'菜品',alert:'warning' as const,x:(i%10)*100+10,y:Math.floor(i/10)*40+10}));
 assert.equal(arrangeLabels(points,1440,900).placed.length,0);
 const selected=arrangeLabels(points.map(p=>({...p,selected:p.id==='173'})),1440,900);
 assert.deepEqual(selected.placed.map(p=>p.id),['173']);
 const urgent=arrangeLabels(points.map(p=>({...p,alert:'expired' as const,selected:p.id==='173'})),1440,900);
 assert.equal(urgent.placed.length,3);assert.equal(urgent.placed[0].id,'173');
 assert.equal(urgent.hidden.length,171);
});
