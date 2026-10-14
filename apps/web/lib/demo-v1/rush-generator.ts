import {initialServingBatches} from './freshness.ts';
import type {Dataset,Dish,InputEvent,SceneManifest,TaskState} from '@zhishan/contracts/demo-v1';
import {digest,nextPass,validatePackage,validateScene} from './core.ts';
type Point={x:number;y:number;z:number};
type Guest={customerId:string;seat:SceneManifest['seats'][number];from:number;to:number;profile:string;elapsedDiningMs:number};
/** Lunch-window model. All rates/portions/dwell times are explicit simulation assumptions. */
export async function generateRush(raw:unknown,dishes:Dish[],scenePath:string,seed=20261012){
 const scene=await validateScene(raw),track=scene.tracks.find(t=>t.enabled)!,window=scene.servingWindows.find(w=>w.trackId===track.trackId)!;
 const plates=scene.plates.filter(p=>scene.slots.find(s=>s.slotId===p.slotId)!.trackId===track.trackId);
 const seats=scene.seats.filter(s=>s.usable&&s.takeWindow.trackId===track.trackId).sort((a,b)=>a.takeWindow.centerSM-b.takeWindow.centerSM);
 if(plates.length!==96||seats.length!==47||new Set(plates.map(p=>p.dishId)).size!==96)throw Error('午高峰需要96种菜、96盘、47个有效主轨座位');
 let rng=seed>>>0;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
 const dishMap=new Map(dishes.map(d=>[d.dishId,d]));
 const dataset:Dataset={contractVersion:'1.0.0',datasetId:'pending-lunch',layoutVersion:scene.layoutVersion,sceneDigest:scene.contentDigest,source:'simulation',simulatedBusinessDate:'2026-10-12',simulationWindow:{startLocal:'12:00:00',endLocal:'12:10:00',timeZone:'Asia/Shanghai'},durationMs:600000,seed,
 rules:{label:'演示参数，非实测门店标准',halfRatio:.5,lowRatio:.2,emptyG:5,preparationMs:15000,actionMs:700,staleAfterMs:30000,maxDeltaG:600},dishes,
 staff:[{staffId:'chef-prep',name:'切配厨师',role:'chef',station:{x:6,y:0,z:1.72},kitchenAction:'chop'},{staffId:'chef-cook',name:'热菜厨师',role:'chef',station:{x:9,y:0,z:1.72},kitchenAction:'stir'},{staffId:'chef-plate',name:'装盘厨师',role:'chef',station:{x:7,y:0,z:2.88},kitchenAction:'plate'},{staffId:'staff-kitchen-01',name:'供餐员',role:'supplier',station:window.staffPosition}],initialCustomers:[],initialWeights:[],events:[],provenance:{scenePath,sceneDigest:scene.contentDigest,generatorVersion:'demo-v1.2.0-lunch-rush-per-plate-batches-v1'}};
 dataset.servingBatches=initialServingBatches(scene);
 const activeIds=new Set(plates.map(p=>p.plateId));
 for(const [i,p]of scene.plates.entries()){const d=dishMap.get(p.dishId)!;const ratio=activeIds.has(p.plateId)?(i%9===0?1:.24+random()*.71):1;dataset.initialWeights.push({plateId:p.plateId,grossG:d.tareG+Math.round(d.fullG*ratio),bootId:'lunch-boot-1',sequence:0});}
 const base=(eventId:string,targetEntityId:string,at:number,half=0)=>({eventId,targetEntityId,startTimeMs:at-half,applyTimeMs:at,endTimeMs:at+half});
 const pathFor=(s:typeof seats[number])=>{const path=(s as typeof s&{approachPath:Point[]}).approachPath;if(!path?.length)throw Error('缺少入座路径');return path.map(p=>({x:p.x,y:p.y??0,z:p.z}));};
 const walkMs=(s:typeof seats[number])=>{const p=pathFor(s);return Math.ceil(p.slice(1).reduce((n,v,i)=>n+Math.hypot(v.x-p[i].x,v.z-p[i].z),0)/1.2*1000);};
 const profiles=['balanced','meat-lover','light','snack-lover'];const guests:Guest[]=[];let serial=0;
 const addGuest=(seat:typeof seats[number],from:number,to:number,initial:boolean,index:number)=>{
  const customerId=`lunch-guest-${String(++serial).padStart(3,'0')}`,profile=profiles[index%4],elapsedDiningMs=initial?(to<600000?2700000+Math.floor(random()*900000):900000+Math.floor(random()*1200000)):0;
  const g={customerId,seat,from,to,profile,elapsedDiningMs};guests.push(g);
  if(initial)dataset.initialCustomers!.push({customerId,seatId:seat.seatId,elapsedDiningMs,profile});
  else {const start=from-walkMs(seat);dataset.events.push({...base(`enter:${customerId}`,customerId,start),eventType:'customer.enter',layer:'action',customerId},{...base(`seat:${customerId}`,customerId,from),startTimeMs:start,eventType:'customer.seat',layer:'action',customerId,seatId:seat.seatId,path:pathFor(seat)});}
  if(to<600000){dataset.events.push({...base(`depart:${customerId}`,customerId,to),eventType:'customer.depart',layer:'action',customerId},{...base(`leave:${customerId}`,customerId,to+walkMs(seat)),startTimeMs:to,eventType:'customer.leave',layer:'action',customerId,path:pathFor(seat).reverse()});}
 };
 // Spread the 31 existing diners throughout the room, rather than filling one contiguous row.
 const initialIndices=new Set(Array.from({length:31},(_,i)=>Math.floor(i*47/31)));let initialIndex=0,newIndex=0;
 for(const [i,seat]of seats.entries())if(initialIndices.has(i)){
  const departure=initialIndex<12?265000+initialIndex*19000:600000;
  addGuest(seat,0,departure,true,initialIndex);
  if(departure<600000)addGuest(seat,departure+24000+walkMs(seat),600000,false,initialIndex+1);
  initialIndex++;
 }else{const arrival=18000+Math.floor(newIndex/2)*20500+(newIndex%2)*2200;addGuest(seat,arrival+walkMs(seat),600000,false,newIndex++);}
 // Reserve narrow walking routes in time. Relative-motion checks cover every segment,
 // including a crossing between samples; waiting takes place before entry / while seated.
 type Walk={g:Guest;kind:'in'|'out';start:number;duration:number;path:Point[];breaks:number[]};
 const jobs:Walk[]=dataset.events.filter(e=>e.eventType==='customer.seat'||e.eventType==='customer.leave').map(e=>{
  if(e.eventType!=='customer.seat'&&e.eventType!=='customer.leave')throw Error('walk');const path=e.path!,lengths=path.slice(1).map((p,i)=>Math.hypot(p.x-path[i].x,p.z-path[i].z)),sum=lengths.reduce((a,b)=>a+b,0),duration=e.applyTimeMs-e.startTimeMs;let t=0;
  return {g:guests.find(g=>g.customerId===e.customerId)!,kind:e.eventType==='customer.seat'?'in' as const:'out' as const,start:e.startTimeMs,duration,path,breaks:[0,...lengths.map(l=>t+=l/sum*duration)]};
 }).sort((a,b)=>a.start-b.start);
 const at=(w:Walk,time:number)=>{const elapsed=Math.max(0,Math.min(w.duration,time-w.start));let i=w.breaks.findIndex((b,i)=>i>0&&b>=elapsed)-1;i=Math.max(0,i);const f=(elapsed-w.breaks[i])/(w.breaks[i+1]-w.breaks[i]||1),a=w.path[i],b=w.path[i+1];return {x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f};};
 const collision=(a:Walk,b:Walk)=>{const lo=Math.max(a.start,b.start),hi=Math.min(a.start+a.duration,b.start+b.duration);if(lo>=hi)return false;
  const times=[lo,hi,...a.breaks.map(t=>t+a.start),...b.breaks.map(t=>t+b.start)].filter(t=>t>=lo&&t<=hi).sort((x,y)=>x-y);
  for(let i=1;i<times.length;i++){const a0=at(a,times[i-1]),b0=at(b,times[i-1]),a1=at(a,times[i]),b1=at(b,times[i]);const x=a0.x-b0.x,z=a0.z-b0.z,vx=a1.x-b1.x-x,vz=a1.z-b1.z-z,f=Math.max(0,Math.min(1,-(x*vx+z*vz)/(vx*vx+vz*vz||1)));if(Math.hypot(x+f*vx,z+f*vz)<.58)return true;}return false;
 };
 const planned:Walk[]=[];let delayedWalks=0;
 for(const w of jobs){const original=w.start;
  if(w.kind==='in'){const previous=guests.find(g=>g.seat.seatId===w.g.seat.seatId&&g.from===0&&g.to<600000);if(previous)w.start=Math.max(w.start,previous.to+24000);}
  while(planned.some(other=>collision(w,other)))w.start+=1000;
  if(w.start+w.duration>=595000)throw Error('客流路线预约超出观察窗口');if(w.start!==original)delayedWalks++;
  const end=w.start+w.duration;
  if(w.kind==='in'){w.g.from=end;const enter=dataset.events.find(e=>e.eventType==='customer.enter'&&e.customerId===w.g.customerId)!;Object.assign(enter,{startTimeMs:w.start,applyTimeMs:w.start,endTimeMs:w.start});const seat=dataset.events.find(e=>e.eventType==='customer.seat'&&e.customerId===w.g.customerId)!;Object.assign(seat,{startTimeMs:w.start,applyTimeMs:end,endTimeMs:end});}
  else {w.g.to=w.start;const depart=dataset.events.find(e=>e.eventType==='customer.depart'&&e.customerId===w.g.customerId)!;Object.assign(depart,{startTimeMs:w.start,applyTimeMs:w.start,endTimeMs:w.start});const leave=dataset.events.find(e=>e.eventType==='customer.leave'&&e.customerId===w.g.customerId)!;Object.assign(leave,{startTimeMs:w.start,applyTimeMs:end,endTimeMs:end});}planned.push(w);
 }
 type Candidate={at:number;g:Guest;plateId:string;portion:number};const candidates:Candidate[]=[];
 const categories=(g:Guest,t:number)=>{
  if(g.to<600000&&t>g.to-110000)return ['fruit','dessert','snack'];
  if(g.profile==='light')return ['vegetable','mushroom','tofu','fruit','seafood'];
  if(g.profile==='snack-lover')return ['snack','dessert','poultry','fruit','processed'];
  if(g.profile==='meat-lover')return ['beef','pork','poultry','seafood','processed'];
  return ['beef','pork','poultry','seafood','vegetable','mushroom','tofu','snack','fruit','dessert'];
 };
 for(const g of guests){let after=g.from+(g.from===0?5000+Math.floor(random()*42000):7000+Math.floor(random()*12000));const previous:string[]=[];
  while(after<g.to-8000){const acceptable=categories(g,after),choices=plates.filter(p=>acceptable.includes(dishMap.get(p.dishId)!.category!)&&!previous.slice(-3).includes(p.dishId)).map(p=>({p,at:nextPass(scene,p.plateId,g.seat.takeWindow.centerSM,after),score:random()*16000})).sort((a,b)=>(a.at+a.score)-(b.at+b.score));const c=choices[0];if(!c||c.at>=g.to-6000)break;
   const d=dishMap.get(c.p.dishId)!;candidates.push({at:c.at,g,plateId:c.p.plateId,portion:Math.round((d.portionG??35)*(random()<.18?2:1))});previous.push(d.dishId);
   after=c.at+Math.floor(35000+random()*48000+(g.to<600000?15000:0));
  }
 }
 const net=new Map(dataset.initialWeights.map(w=>[w.plateId,w.grossG-dishMap.get(scene.plates.find(p=>p.plateId===w.plateId)!.dishId)!.tareG]));
 const tasks:TaskState[]=[],freeAt=new Map(dataset.staff.filter(s=>s.role==='chef').map(s=>[s.staffId,0]));
 type Refill={at:number;task:TaskState};const refills:Refill[]=[];const supplierSlots:number[]=[];
 const scheduleTask=(plateId:string,at:number,trigger:string)=>{
  const p=scene.plates.find(p=>p.plateId===plateId)!,d=dishMap.get(p.dishId)!;
  if(!activeIds.has(plateId)||net.get(plateId)!>d.fullG*.5||tasks.some(t=>t.plateId===plateId&&t.status!=='completed'))return;
  const staff=[...freeAt].map(([id,t])=>({id,at:Math.max(at,t)})).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id))[0];
  const task:TaskState={taskId:`task:${trigger}`,plateId,dishId:d.dishId,staffId:staff.id,status:'preparing',createdAtMs:at,preparationStartMs:staff.at,readyAtMs:staff.at+(d.preparationMs??15000),completedAtMs:null,triggerEventId:trigger};tasks.push(task);freeAt.set(staff.id,task.readyAtMs);
  let refillAt=nextPass(scene,plateId,window.centerSM,task.readyAtMs+700);
  while(supplierSlots.some(t=>Math.abs(t-refillAt)<1500))refillAt=nextPass(scene,plateId,window.centerSM,refillAt+1600);
  if(refillAt<599000){supplierSlots.push(refillAt);refills.push({at:refillAt,task});}
 };
 for(const p of scene.plates)scheduleTask(p.plateId,0,`initial:${p.plateId}`);
 const changes=new Map<string,Extract<InputEvent,{eventType:'weight.observed'}>[]>();let operation=0,skippedUnavailable=0;const lastPlateAction=new Map<string,number>();
 const observe=(plateId:string,at:number,operationId:string,region:'dining'|'kitchen',eventId:string)=>{const d=dishMap.get(scene.plates.find(p=>p.plateId===plateId)!.dishId)!;const e:Extract<InputEvent,{eventType:'weight.observed'}>={...base(eventId,plateId,at),eventType:'weight.observed',layer:'observation',plateId,scaleId:`scale:${plateId}`,bootId:'lunch-boot-1',sequence:0,grossG:d.tareG+net.get(plateId)!,quality:'good',operationId,region};changes.set(plateId,[...(changes.get(plateId)??[]),e]);};
 candidates.sort((a,b)=>a.at-b.at);let ci=0;
 while(ci<candidates.length||refills.length){refills.sort((a,b)=>a.at-b.at);const c=candidates[ci],r=refills[0];
  if(r&&(!c||r.at<c.at)){refills.shift();const {task,at}=r,p=scene.plates.find(p=>p.plateId===task.plateId)!,d=dishMap.get(p.dishId)!,operationId=`refill:${++operation}`;
   net.set(p.plateId,d.fullG);dataset.events.push({...base(operationId,p.plateId,at,700),eventType:'staff.refill',layer:'action',plateId:p.plateId,staffId:'staff-kitchen-01',windowId:window.windowId,taskId:task.taskId,operationId});observe(p.plateId,at,operationId,'kitchen',`weight:${operationId}`);task.status='completed';task.completedAtMs=at;
  }else if(c){ci++;const available=net.get(c.plateId)!;if(available<10||Math.abs(c.at-(lastPlateAction.get(c.plateId)??-10000))<1500){skippedUnavailable++;continue;}
   const amount=Math.min(available,c.portion),operationId=`take:${++operation}`;net.set(c.plateId,available-amount);lastPlateAction.set(c.plateId,c.at);
   dataset.events.push({...base(operationId,c.plateId,c.at,700),eventType:'customer.take',layer:'action',customerId:c.g.customerId,seatId:c.g.seat.seatId,plateId:c.plateId,operationId});observe(c.plateId,c.at,operationId,'dining',`weight:${operationId}`);scheduleTask(c.plateId,c.at,`weight:${operationId}`);
  }
 }
 for(const p of scene.plates){const updates=changes.get(p.plateId)??[],byTime=new Map(updates.map(e=>[e.applyTimeMs,e]));let grossG=dataset.initialWeights.find(w=>w.plateId===p.plateId)!.grossG,sequence=0;
  const times=new Set(updates.map(e=>e.applyTimeMs));for(let t=20000;t<=600000;t+=20000)times.add(t);
  for(const at of [...times].sort((a,b)=>a-b)){const change=byTime.get(at);if(change)grossG=change.grossG;dataset.events.push(change?{...change,sequence:++sequence}:{...base(`sample:${p.plateId}:${at}`,p.plateId,at),eventType:'weight.observed',layer:'observation',plateId:p.plateId,scaleId:`scale:${p.plateId}`,bootId:'lunch-boot-1',sequence:++sequence,grossG,quality:'good',region:'unknown'});}
 }
 dataset.events.sort((a,b)=>a.applyTimeMs-b.applyTimeMs||a.eventId.localeCompare(b.eventId));
 dataset.datasetId=`lunch-${(await digest({...dataset,datasetId:''})).slice(7,27)}`;
 const {result}=await validatePackage(scene,dataset);
 const occupancy=[0,...dataset.events.filter(e=>['customer.seat','customer.depart'].includes(e.eventType)).map(e=>e.applyTimeMs),600000].sort((a,b)=>a-b).map(t=>({timeMs:t,seated:31+dataset.events.filter(e=>e.eventType==='customer.seat'&&e.applyTimeMs<=t).length-dataset.events.filter(e=>e.eventType==='customer.depart'&&e.applyTimeMs<=t).length}));
 const plateBalances=scene.plates.map(p=>{const initial=dataset.initialWeights.find(w=>w.plateId===p.plateId)!.grossG-dishMap.get(p.dishId)!.tareG;let last=initial,takenG=0,refilledG=0;for(const c of changes.get(p.plateId)??[]){const next=c.grossG-dishMap.get(p.dishId)!.tareG;if(c.region==='dining')takenG+=last-next;else refilledG+=next-last;last=next;}return {plateId:p.plateId,initialG:initial,takenG,refilledG,finalG:last};});
 const truth={purpose:'独立操作增减量及客流验证，不供运行服务读取',expectedTakenG:plateBalances.reduce((n,p)=>n+p.takenG,0),expectedRefilledG:plateBalances.reduce((n,p)=>n+p.refilledG,0),expectedFinalCustomers:guests.length-12,expectedPeakSeated:47,plateBalances,occupancy,guests:guests.map(g=>({customerId:g.customerId,seatId:g.seat.seatId,seatedFromMs:g.from,departAtMs:g.to<600000?g.to:null,elapsedDiningMs:g.elapsedDiningMs,profile:g.profile}))};
 const report={allEventsValidated:true,datasetId:dataset.datasetId,sceneDigest:scene.contentDigest,durationMs:600000,window:dataset.simulationWindow,mainPlates:96,mainSeats:47,uniqueMainDishes:96,initialCustomers:31,initialPartialMainPlates:plates.filter(p=>plateBalances.find(b=>b.plateId===p.plateId)!.initialG<dishMap.get(p.dishId)!.fullG).length,arrivals:28,departures:12,peakSeated:Math.max(...occupancy.map(o=>o.seated)),finalCustomers:result.summary.inStoreCustomerCount,delayedWalks,minimumWalkingSeparationM:.58,takeActions:dataset.events.filter(e=>e.eventType==='customer.take').length,refillActions:dataset.events.filter(e=>e.eventType==='staff.refill').length,skippedUnavailable,counts:result.summary,eventCount:dataset.events.length,occupancy,openTasksAtEnd:result.tasks.filter(t=>t.status!=='completed').length};
 if(report.peakSeated!==47||result.summary.uncertainG||result.summary.qualityIssueCount||truth.expectedTakenG!==result.summary.takenG||truth.expectedRefilledG!==result.summary.refilledG)throw Error('午高峰验证失败');
 return {dataset,truth,report};
}
