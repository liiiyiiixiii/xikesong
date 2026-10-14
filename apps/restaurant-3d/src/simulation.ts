/** Pure visual projection: never creates customers, changes weights, or advances a business clock. */
import { positionAt, type SceneManifest, type Point } from './demo/layout';
import { interpolateMovement, type State, type DemoEvent } from './external-state';
export function counts(scene:SceneManifest,state:State|null){return {
 carryingPositions:scene.slots.filter(s=>s.usable).length,actualPlates:scene.plates.length,dishTypes:new Set(scene.plates.map(p=>p.dishId)).size,
 availableSeats:scene.seats.filter(s=>s.usable).length,seatedCustomers:state?.customers.filter(c=>c.status==='seated').length??null,
 inStoreCustomers:state?.customers.filter(c=>c.status!=='left').length??null,sceneCustomerEntities:state?.customers.filter(c=>c.status!=='left').length??null,
};}
export function project(scene:SceneManifest,state:State|null,time:number,events:DemoEvent[]=[]){
 const active=events.filter(e=>e.startTimeMs<=time&&e.endTimeMs>=time);
 const plates=scene.plates.map(binding=>{const slot=scene.slots.find(s=>s.slotId===binding.slotId)!,track=scene.tracks.find(t=>t.trackId===slot.trackId)!;return {...binding,position:positionAt(track,slot.s0M,time),state:state?.plates.find(p=>p.plateId===binding.plateId)??null};});
 const customers=state?.customers.filter(c=>c.status!=='left').map(c=>{
  const seat=scene.seats.find(s=>s.seatId===c.seatId);
  const movement=c.movement;
  let position:Point&{angle:number};
  if(movement&&time<movement.endTimeMs)position=interpolateMovement(movement,time);
  else if(c.status==='seated'&&seat)position={...seat.position,angle:seat.angle};
  else if(movement)position=interpolateMovement(movement,time);
  else position={...scene.entry,angle:Math.PI}; // Visible diagnostic at entrance; never pretends to be seated.
  const take=active.find(e=>e.eventType==='customer.take'&&e.customerId===c.customerId);
  return {...c,position,missingMovement:c.status==='walking'&&!movement,seated:c.status==='seated'&&(!movement||time>=movement.endTimeMs),takeApplied:!!take&&time>=take.applyTimeMs,takeProgress:take?Math.min(1,(time-take.startTimeMs)/Math.max(1,take.endTimeMs-take.startTimeMs)):null};
 })??[];
 const staff=state?.staff.map((s,i)=>{const window=scene.servingWindows.find(w=>w.trackId==='track-main')!;const fallback={x:window.position.x+.75,z:window.position.z-.75*i};
  const position=s.movement?interpolateMovement(s.movement,time):{...(s.position??fallback),angle:s.role==='chef'?(s.kitchenAction==='plate'?0:Math.PI):-Math.PI/2};
  const refill=active.find(e=>e.eventType==='staff.refill'&&e.staffId===s.staffId);
  return {...s,position,refill:!!refill};
 })??[];
 return {plates,customers,staff};
}
