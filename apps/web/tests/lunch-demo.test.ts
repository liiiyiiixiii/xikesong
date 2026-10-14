import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LunchClock} from '../lib/demo/lunch-clock.ts';
// Archived fixture regression only. The active demo-v1 does not read this 42-plate dataset.
type LegacyPlate={slotId:number;remainingG:number;fullG:number};
type LegacyFrame={second:number;plates:LegacyPlate[];customers:{count:number;entered:number;left:number}};
type LegacyEvent={second:number;kind:string;slotId?:number;weightG?:number};
const frames:LegacyFrame[]=JSON.parse(readFileSync('data/lunch-demo/snapshots.json','utf8'));
const events:LegacyEvent[]=JSON.parse(readFileSync('data/lunch-demo/events.json','utf8'));
test('601 snapshots conserve every bowl weight and crowd count',()=>{
 assert.equal(frames.length,601);
 for(let t=0;t<=600;t++){
  const f=frames[t];assert.equal(f.second,t);assert.equal(f.plates.length,42);
  assert.equal(new Set(f.plates.map((p)=>p.slotId)).size,42);
  assert.equal(f.customers.count,4+f.customers.entered-f.customers.left);assert.ok(f.customers.count>=0&&f.customers.count<=14);
  if(!t)continue;
  const es=events.filter((e)=>e.second===t);
  for(const p of f.plates){const delta=es.filter((e)=>e.slotId===p.slotId).reduce((sum:number,e)=>sum+(e.kind==='refill'?(e.weightG??0):-(e.weightG??0)),0);assert.equal(p.remainingG,frames[t-1].plates[p.slotId-1].remainingG+delta);assert.ok(p.remainingG>=0&&p.remainingG<=p.fullG);}
  if(es.some((e)=>e.kind==='take'))assert.ok(f.customers.count>0);
 }
 assert.equal(frames[600].customers.entered,8);assert.equal(frames[600].customers.left,2);
});
test('at least four low bowls and two emptied then refilled bowls',()=>{
 const low=new Set<number>(),empty=new Set<number>();
 for(const f of frames)for(const p of f.plates){if(p.remainingG/p.fullG<.2)low.add(p.slotId);if(p.remainingG===0)empty.add(p.slotId);}
 assert.ok(low.size>=4);assert.ok([...empty].filter(id=>events.some((e)=>e.kind==='refill'&&e.slotId===id)).length>=2);
});
test('shared clock freezes, resumes, restarts and loops in exactly 600 seconds',()=>{
 const c=new LunchClock(1000);assert.equal(c.read(31000).second,30);
 c.control('pause',31000);assert.equal(c.read(91000).second,30);
 c.control('resume',91000);assert.equal(c.read(101000).second,40);
 c.control('restart',101000);assert.deepEqual(c.read(101000),{second:0,cycle:1,paused:false});
 assert.deepEqual(c.read(701000),{second:0,cycle:2,paused:false});
});
