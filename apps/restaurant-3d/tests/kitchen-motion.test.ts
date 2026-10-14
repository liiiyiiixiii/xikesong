import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kitchenMotion} from '../src/kitchen-motion';
import {Character} from '../src/characters';

test('chopping, stirring and plating have distinct visible strokes and deterministic paused poses',()=>{
 for(const role of ['chop','cook','mix','plate']){
  const poses=Array.from({length:80},(_,i)=>kitchenMotion(i*.1,role));
  const range=(key:'rightX'|'rightY')=>Math.max(...poses.map(p=>p[key]))-Math.min(...poses.map(p=>p[key]));
  assert.ok(range('rightX')>(role==='chop'?1:.4));
  if(role!=='chop')assert.ok(range('rightY')>.6);
  const chef=new Character(2,'chef');chef.animate(3.25,false,false,0,role);
  const snapshot=chef.rightArm.rotation.toArray();chef.animate(6,false,false,0,role);chef.animate(3.25,false,false,0,role);
  assert.deepEqual(chef.rightArm.rotation.toArray(),snapshot,'pause and replay use clock sampling, not accumulated local time');
  chef.root.updateMatrixWorld(true);chef.root.traverse(o=>assert.ok(o.matrixWorld.elements.every(Number.isFinite)));
 }
 const cycle=Array.from({length:40},(_,i)=>kitchenMotion(i*.1,'plate').food);
 assert.ok(cycle.includes(true)&&cycle.includes(false),'tongs pick up and release garnish');
});
