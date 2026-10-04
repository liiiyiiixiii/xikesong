import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pendingToConfirm,concurrentAnomalies} from '../lib/anomaly-policy.mjs';
test('simulated operator retains at most one bowl pending and confirms expired records',()=>{
 const now=Date.parse('2026-10-04T12:00:00+08:00');const pending=Array.from({length:42},(_,i)=>({id:String(i),scaleId:`sim-${i}`,at:new Date(now-i*1000).toISOString()}));
 const confirmed=new Set(pendingToConfirm(pending,now).map(e=>e.id));assert.equal(pending.filter(e=>!confirmed.has(e.id)).length,1);assert.equal(pendingToConfirm(pending,now+91000).length,42);
});
test('overlapping faults count distinct bowls; touching intervals do not overlap',()=>{
 assert.equal(concurrentAnomalies([{scaleId:'a',from:0,to:10},{scaleId:'b',from:10,to:20}]),1);
 assert.equal(concurrentAnomalies([{scaleId:'a',from:0,to:10},{scaleId:'a',from:1,to:5}]),1);
 assert.equal(concurrentAnomalies([{scaleId:'a',from:0,to:10},{scaleId:'b',from:9,to:20}]),2);
});
