import { test } from "node:test";
import assert from "node:assert/strict";
import { bowls as dishes } from "../lib/dishes.mjs";
import { createRestaurant,advance,validateState,slotAt,layout } from "../lib/restaurant.mjs";
function run(seconds,seed=20261003){const state=createRestaurant({seed});const events=state.initialEvents.splice(0);for(let i=0;i<seconds;i++)events.push(...advance(state));return {state,events};}
test("42 bowls of 36 dishes pass the same point in fixed order at five second intervals",()=>{
 assert.equal(dishes.length,42);assert.equal(new Set(dishes.map(d=>d.id)).size,36);
 const {events}=run(500),passages=events.filter(e=>e.kind==="passage");
 assert.equal(passages.length,101);
 for(const [i,event] of passages.entries()){assert.equal(event.dishId,dishes[i%dishes.length].id);assert.equal(event.second,i*5);assert.equal(slotAt(event.position,event.second),0);}
});
test("one hour of diners conserves every dish's mass; all dishes are served",()=>{
 const {state,events}=run(3600);validateState(state);
 assert(state.guests>12);assert(state.departed>0);assert(state.totalRefillG>0);
 assert.equal(new Set(events.filter(e=>e.kind==="take").map(e=>e.dishId)).size,36);
 assert.equal(events.filter(e=>e.kind==="take").reduce((n,e)=>n+e.grams,0),state.totalTakenG);
 assert.equal(events.filter(e=>e.kind==="refill").reduce((n,e)=>n+e.grams,0),state.totalRefillG);
 for(const plate of state.plates){assert(plate.netG>=0&&plate.netG<=1000);assert.equal(plate.netG,plate.initialG+plate.refillG-plate.takenG);}
});
test("takes occur at the diner seat and refills only at the kitchen window",()=>{
 const {state,events}=run(3600);const changes=new Map(),guests=new Map(events.filter(e=>e.kind==="arrival").map(e=>[e.guest,e]));
 for(const event of events){
  if(!["take","refill"].includes(event.kind))continue;
  const dish=dishes.find(d=>d.scaleId===event.scaleId);assert.equal(slotAt(dish.position,event.second),event.slot-1);
  if(event.kind==="refill")assert.equal(event.slot,1);
  else {assert.equal(layout.seats[event.seat-1]+1,event.slot);if(guests.get(event.guest).diet==="vegetarian")assert(!["meat","seafood","protein"].includes(dish.category));}
  if(changes.has(dish.scaleId))assert(event.second-changes.get(dish.scaleId)>=4,"leave stable readings between weight changes");changes.set(dish.scaleId,event.second);
 }
 assert(state.diners.length<=20);
});
test("seed and serialized continuation reproduce identical consumption",()=>{
 assert.deepEqual(run(600),run(600));assert.notDeepEqual(run(600,42).state.plates,run(600,43).state.plates);
 const first=run(600).state,second=JSON.parse(JSON.stringify(first));
 for(let i=0;i<600;i++)assert.deepEqual(advance(first),advance(second));assert.deepEqual(first,second);
});
test("corrupt or negative mass cannot be restored",()=>{const state=createRestaurant();state.plates[0].netG=-1;assert.throws(()=>validateState(state),/守恒/);assert.throws(()=>createRestaurant({initialWeights:{"sim-1":1500}}),/守恒/);});

test("42-bowl layout derives circumference, cycle time and valid seat positions",()=>{
 assert.equal(layout.dishes.length,42);assert.equal(layout.loopMeters,21);assert.equal(layout.cycleSeconds,210);
 assert.equal(new Set(layout.seats).size,20);assert(layout.seats.every(s=>s>0&&s<42));
});
test("legacy checkpoint migration preserves retained mass and archives no invented history",async()=>{
 const {migrateRestaurant}=await import('../lib/restaurant.mjs');const state=run(300).state;
 const retired=['enoki','oyster-mushroom','wood-ear','cucumber','tomato','bean-sprout','pineapple','orange'];
 const legacy=structuredClone(state);legacy.plates.push(...retired.map(id=>({id,initialG:900,netG:800,takenG:100,refillG:0,lockedUntil:0,refillReadyAt:null})));legacy.totalTakenG+=800;
 const migrated=migrateRestaurant(legacy);assert.equal(legacy.plates.length,50);assert.equal(migrated.plates.length,42);
 assert.deepEqual(migrated.plates,state.plates);assert.equal(migrated.second,state.second);assert.equal(migrated.rng,state.rng);assert.equal(migrated.totalTakenG,state.totalTakenG);
 assert.equal(migrateRestaurant(migrated),migrated);legacy.plates[0].netG=-1;assert.throws(()=>migrateRestaurant(legacy),/守恒/);
});
