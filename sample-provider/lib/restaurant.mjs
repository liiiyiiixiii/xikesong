import { bowls as dishes } from "./dishes.mjs";

export const layout = {
  version: 1, direction: "从补菜窗口出发，沿左侧、上侧、右侧回到窗口",
  loopMeters: dishes.length * 0.5, slotMeters: 0.5, slotSeconds: 5, cycleSeconds: dishes.length * 5,
  refillSlot: 0, seats: Array.from({length:20},(_,i)=>2+Math.floor(i*(dishes.length-3)/20)),
  dishes: dishes.map(d=>({...d,initialSlot:d.position-1,offsetSeconds:(d.position-1)*5})),
};
const mod=(n,m)=>((n%m)+m)%m;
export const slotAt=(position,second)=>mod(position-1-Math.floor(second/layout.slotSeconds),dishes.length);
function random(state){state.rng=(Math.imul(state.rng,1664525)+1013904223)>>>0;return state.rng/4294967296;}
function integer(state,low,high){return low+Math.floor(random(state)*(high-low+1));}
function diner(state,seat,events){
  const id=`guest-${++state.guests}`,diet=random(state)<.2?"vegetarian":"mixed";
  const preferences=Object.fromEntries(["meat","seafood","protein","staple","fruit","vegetable"].map(c=>[c,.3+random(state)*.7]));
  const guest={id,seat,diet,preferences,arrivedAt:state.second,leaveAt:state.second+integer(state,1200,2100),targetG:integer(state,450,850),takenG:0,nextTakeAt:state.second+integer(state,5,20)};
  state.diners.push(guest);events.push({kind:"arrival",second:state.second,guest:id,seat:seat+1,diet,targetG:guest.targetG});
}
export function createRestaurant({seed=20261003,initialWeights={}}={}){
  if(!Number.isInteger(seed))throw new Error("种子必须是整数");
  const state={version:1,seed,initialEvents:[],second:0,rng:seed>>>0,guests:0,diners:[],waiting:0,nextArrivalAt:60,departed:0,totalTakenG:0,totalRefillG:0};
  state.plates=dishes.map(d=>{const initialG=initialWeights[d.scaleId]??integer(state,650,950);return {id:d.scaleId,dishId:d.id,initialG,netG:initialG,takenG:0,refillG:0,lockedUntil:5,refillReadyAt:null};});
  for(let seat=0;seat<12;seat++)diner(state,seat,state.initialEvents);
  state.initialEvents.push({kind:"passage",second:0,dishId:dishes[0].id,position:1,cycle:0,slot:1});
  validateState(state);return state;
}
export function advance(state){
  state.second++;const events=[];
  if(state.second%layout.slotSeconds===0){const index=Math.floor(state.second/layout.slotSeconds)%dishes.length;events.push({kind:"passage",second:state.second,dishId:dishes[index].id,position:index+1,cycle:Math.floor(state.second/layout.cycleSeconds),slot:1});}
  state.diners=state.diners.filter(guest=>{
    if(state.second<guest.leaveAt)return true;
    state.departed++;events.push({kind:"departure",second:state.second,guest:guest.id,takenG:guest.takenG});return false;
  });
  if(state.second>=state.nextArrivalAt){const count=integer(state,1,3);const admitted=Math.min(count,40-state.waiting);state.waiting+=admitted;if(admitted<count)events.push({kind:"turned_away",second:state.second,count:count-admitted});state.nextArrivalAt=state.second+integer(state,60,100);events.push({kind:"party",second:state.second,count});}
  for(let seat=0;seat<layout.seats.length&&state.waiting>0;seat++)if(!state.diners.some(g=>g.seat===seat)){diner(state,seat,events);state.waiting--;}
  for(const [index,plate] of state.plates.entries()){
    const dish=dishes[index];
    if(plate.netG<dish.fullG*.25&&plate.refillReadyAt===null){plate.refillReadyAt=state.second+20;events.push({kind:"refill_order",second:state.second,dishId:dish.id,scaleId:dish.scaleId,readyAt:plate.refillReadyAt});}
    // Kitchen work takes twenty seconds; refill occurs only at the physical window.
    if(plate.refillReadyAt!==null&&state.second>=plate.refillReadyAt&&slotAt(dish.position,state.second)===layout.refillSlot&&state.second>=plate.lockedUntil){
      const grams=dish.fullG-plate.netG;plate.netG+=grams;plate.refillG+=grams;state.totalRefillG+=grams;plate.refillReadyAt=null;plate.lockedUntil=state.second+4;
      events.push({kind:"refill",second:state.second,dishId:dish.id,scaleId:dish.scaleId,grams,slot:1});
    }
  }
  for(const guest of state.diners){
    if(state.second<guest.nextTakeAt||guest.takenG>=guest.targetG)continue;
    const index=dishes.findIndex(d=>slotAt(d.position,state.second)===layout.seats[guest.seat]);
    const dish=dishes[index],plate=state.plates[index];
    if(guest.diet==="vegetarian"&&["meat","seafood","protein"].includes(dish.category))continue;
    if(plate.netG<=0||state.second<plate.lockedUntil)continue;
    if(random(state)>guest.preferences[dish.category]){guest.nextTakeAt=state.second+5;continue;}
    const grams=Math.min(integer(state,dish.category==="staple"?40:20,dish.category==="staple"?85:65),plate.netG,guest.targetG-guest.takenG);
    plate.netG-=grams;plate.takenG+=grams;state.totalTakenG+=grams;guest.takenG+=grams;
    plate.lockedUntil=state.second+4;guest.nextTakeAt=state.second+integer(state,20,45);
    events.push({kind:"take",second:state.second,guest:guest.id,dishId:dish.id,scaleId:dish.scaleId,seat:guest.seat+1,slot:layout.seats[guest.seat]+1,grams,remainingG:plate.netG});
  }
  return events;
}
export function validateState(state){
  if(state?.version!==1||!Number.isInteger(state.second)||state.second<0||!Number.isInteger(state.rng)||!Array.isArray(state.diners)||!Array.isArray(state.plates)||state.plates.length!==dishes.length)throw new Error("模拟状态格式无效");
  for(const [i,p] of state.plates.entries())if(p.id!==dishes[i].scaleId||![p.netG,p.initialG,p.takenG,p.refillG].every(n=>Number.isFinite(n)&&n>=0)||p.netG>dishes[i].fullG||p.initialG+p.refillG-p.takenG!==p.netG)throw new Error(`模拟重量不守恒：${p.id}`);
  return state;
}
export function summary(state){return {second:state.second,arrived:state.guests,seated:state.diners.length,waiting:state.waiting,departed:state.departed,takenG:state.totalTakenG,refillG:state.totalRefillG,emptyDishes:state.plates.filter(p=>p.netG===0).length};}

// One-time, lossless menu retirement: callers archive the original checkpoint.
// Preserve simulation time, RNG, diners and every retained plate's mass.
export function migrateRestaurant(state){
 if(state?.plates?.length===dishes.length)return validateState(state);
 const retired=["enoki","oyster-mushroom","wood-ear","cucumber","tomato","bean-sprout","pineapple","orange"];
 const expected=[...dishes.map(d=>d.scaleId),...retired];
 if(state?.version!==1||!Array.isArray(state.plates)||state.plates.length!==expected.length||state.plates.some((p,i)=>p.id!==expected[i]))throw new Error("无法识别旧菜单存档，请核对后迁移");
 for(const p of state.plates)if(![p.netG,p.initialG,p.takenG,p.refillG].every(n=>Number.isFinite(n)&&n>=0)||p.netG>1000||p.initialG+p.refillG-p.takenG!==p.netG)throw new Error(`旧存档重量不守恒：${p.id}`);
 const next=structuredClone(state);next.plates=next.plates.filter(p=>dishes.some(d=>d.scaleId===p.id));
 next.totalTakenG=next.plates.reduce((n,p)=>n+p.takenG,0);next.totalRefillG=next.plates.reduce((n,p)=>n+p.refillG,0);
 next.initialEvents=next.initialEvents.filter(e=>!e.dishId||dishes.some(d=>d.id===e.dishId));
 return validateState(next);
}
