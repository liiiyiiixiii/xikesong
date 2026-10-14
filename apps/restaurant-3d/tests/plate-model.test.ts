import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createPlateAssembly} from '../src/plate-model';

test('carrier remains hollow and fixed while either fitted bowl can be lifted independently',()=>{
 for(const style of ['metal','basket'] as const){
  const a=createPlateAssembly(.32,.08,style);a.root.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(a.root);
  assert.ok(bounds.max.x<=.161&&bounds.min.x>=-.161);
  assert.ok(bounds.min.y>=-.00001&&bounds.max.y<=.083);
  const carrierBefore=new T.Box3().setFromObject(a.carrier).clone();
  a.bowl.position.y=.2;a.root.updateMatrixWorld(true);
  assert.deepEqual(new T.Box3().setFromObject(a.carrier),carrierBefore);
  assert.equal(a.foodAnchor.parent,a.bowl);
  assert.equal(a.carrier.userData.mount,'fixed-to-conveyor');
  // Removing the insert exposes a through opening down the center of the carrier.
  const ray=new T.Raycaster(new T.Vector3(0,.3,0),new T.Vector3(0,-1,0));
  assert.equal(ray.intersectObject(a.carrier,true).length,0);
  a.bowl.position.y=0;a.root.updateMatrixWorld(true);
  assert.ok(ray.intersectObject(a.bowl,true).length>0);
 }
});
