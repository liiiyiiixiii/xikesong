import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateInterior} from '../src/demo/interior-validation';
import {kitchenChefs,kitchenFixtures} from '../src/demo/interior-layout';
import type {SceneManifest} from '../src/demo/layout';

const scene=JSON.parse(readFileSync('public/data/scene-manifest.v1.json','utf8')) as SceneManifest;
test('open kitchen equipment and three working chefs clear both supply workers and all guest paths',()=>{
 assert.deepEqual(validateInterior(scene),[]);
 assert.equal(kitchenChefs.length,3);
 for(const chef of kitchenChefs){const station=kitchenFixtures.find(f=>f.id===chef.station)!;
  const dx=station.x-chef.x,dz=station.z-chef.z;
  assert.ok((dx*Math.sin(chef.angle)+dz*Math.cos(chef.angle))/Math.hypot(dx,dz)>.99);
 }
 assert.ok(!scene.walls.some(w=>['wall-9','wall-10'].includes(w.wallId)));
});
test('interior validation rejects equipment conflicts with a relocated supply worker',()=>{
 const blocked=structuredClone(scene);blocked.servingWindows[0].staffPosition={x:6,z:.85};
 assert.ok(validateInterior(blocked).some(e=>e.includes('worker collision')));
});
