import type { Dataset, Dish, InputEvent, SceneManifest, Rules } from '@zhishan/contracts/demo-v1';
import { CONTRACT_VERSION, rulesSchema } from '@zhishan/contracts/demo-v1';
import { DemoError, digest, nextPass, project, validatePackage, validateScene } from './core.ts';

export const presentationDefaults={customerCount:24,arrivalIntervalMs:1100};
export async function generate(rawScene:unknown,dishes:Dish[],scenePath:string,configuredRules?:Rules,presentation=presentationDefaults) {
  if(!Number.isInteger(presentation.customerCount)||presentation.customerCount<2||presentation.customerCount>500||!Number.isFinite(presentation.arrivalIntervalMs)||presentation.arrivalIntervalMs<800)throw new DemoError('SCHEMA_INVALID','演示顾客数或进店间隔无效');
  const scene=await validateScene(rawScene);
  const track=scene.tracks.find(t=>t.enabled);
  if(!track)throw new DemoError('PRECONDITION_FAILED','没有启用的运行轨道');
  const plate=scene.plates.find(p=>scene.slots.some(s=>s.slotId===p.slotId&&s.trackId===track.trackId));
  const seats=scene.seats.filter(s=>s.usable&&s.takeWindow.trackId===track.trackId);
  const window=scene.servingWindows.find(w=>w.trackId===track.trackId);
  if(!plate||seats.length<1||!window)throw new DemoError('PRECONDITION_FAILED','正式场景缺少餐盘、有效座位或供餐口');
  const walkingSpeedMps=1.2; // explicit demo assumption; positions come only from exported navigation
  function pathFor(seat:SceneManifest['seats'][number]){const supplied=(seat as typeof seat & {approachPath?:{x:number;y?:number;z:number}[]}).approachPath;return supplied?.map(p=>({x:p.x,y:p.y??0,z:p.z}));}
  function walkMs(seat:SceneManifest['seats'][number]){const path=pathFor(seat);return path?Math.ceil(path.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-path[i].x,p.y-path[i].y,p.z-path[i].z),0)/walkingSpeedMps*1000):5000;}
  const allSeatedAfter=Math.max(...seats.map(walkMs))+15000;
  const sortedSeats=seats.map(s=>({s,t:nextPass(scene,plate.plateId,s.takeWindow.centerSM,allSeatedAfter)})).sort((a,b)=>a.t-b.t);
  const first=sortedSeats[0];
  // Use a second reachable seat before the next kitchen pass, otherwise the same seat one lap later.
  const earliestKitchen=nextPass(scene,plate.plateId,window.centerSM,first.t+15000);
  const second=sortedSeats.find(s=>s.t>first.t+2500&&s.t<earliestKitchen-2000)??{s:first.s,t:nextPass(scene,plate.plateId,first.s.takeWindow.centerSM,first.t+3000)};
  const rules:Rules=configuredRules??{label:'演示参数，非实测门店标准',halfRatio:.5,lowRatio:.2,emptyG:5,preparationMs:15000,actionMs:1000,staleAfterMs:30000,maxDeltaG:Math.max(...dishes.map(d=>d.fullG))*1.2};
  rulesSchema.parse(rules);if(rules.staleAfterMs<1||rules.preparationMs<1||rules.halfRatio<=rules.lowRatio)throw new DemoError('SCHEMA_INVALID','阈值或耗时配置无效');
  const actionMs=rules.actionMs;
  const dataset:Dataset={contractVersion:CONTRACT_VERSION,datasetId:`short-${scene.layoutVersion}-${scene.contentDigest.slice(7,19)}-v1`,layoutVersion:scene.layoutVersion,sceneDigest:scene.contentDigest,source:'simulation',simulatedBusinessDate:'2026-10-12',durationMs:0,seed:20261012,
    rules,dishes,staff:[{staffId:'staff-kitchen-01',name:'厨房员工'}],
    initialWeights:scene.plates.map(p=>{const dish=dishes.find(d=>d.dishId===p.dishId);if(!dish)throw new DemoError('REFERENCE_INVALID','场景使用了未知 dishId',{plateId:p.plateId,dishId:p.dishId});return {plateId:p.plateId,grossG:dish.fullG+dish.tareG,bootId:'sim-boot-1',sequence:0};}),events:[],provenance:{scenePath,sceneDigest:scene.contentDigest,generatorVersion:'demo-v1.1.0-crowd'}};
  const dish=dishes.find(d=>d.dishId===plate.dishId)!;
  const halfRemainingG=Math.round(dish.fullG*(rules.halfRatio*.96>rules.lowRatio?rules.halfRatio*.96:(rules.halfRatio+rules.lowRatio)/2)*1000)/1000;
  const lowRemainingG=Math.round((dish.fullG*rules.lowRatio*.8>rules.emptyG?dish.fullG*rules.lowRatio*.8:(dish.fullG*rules.lowRatio+rules.emptyG)/2)*1000)/1000;
  const base=(eventId:string,targetEntityId:string,at:number,duration=0)=>({eventId,targetEntityId,startTimeMs:Math.max(0,at-duration),applyTimeMs:at,endTimeMs:at+duration});
  const push=(e:InputEvent)=>dataset.events.push(e);
  const seatIds=[...new Set([first.s.seatId,second.s.seatId])];
  const available=seats.filter(s=>!seatIds.includes(s.seatId)).sort((a,b)=>a.takeWindow.centerSM-b.takeWindow.centerSM);
  const extraCount=Math.min(presentation.customerCount,seats.length)-seatIds.length;
  for(let i=0;i<extraCount;i++)seatIds.push(available[Math.floor(i*available.length/extraCount)].seatId);
  for(const [i,seatId]of seatIds.entries()){
    const customerId=`customer-${String(i+1).padStart(3,'0')}`;
    push({...base(`enter:${customerId}`,customerId,1000+i*presentation.arrivalIntervalMs),eventType:'customer.enter',layer:'action',customerId});
    const seat=seats.find(s=>s.seatId===seatId)!,path=pathFor(seat),startTimeMs=1000+i*presentation.arrivalIntervalMs,applyTimeMs=startTimeMs+walkMs(seat);
    push({...base(`seat:${customerId}`,customerId,applyTimeMs),startTimeMs,eventType:'customer.seat',layer:'action',customerId,seatId,...(path?{path}:{})});
  }
  const changes=new Map<number,{grossG:number;operationId:string;region:'dining'|'kitchen'}>();
  for(const [i,pass]of [first,second].entries()){
    const customerId=`customer-${String(seatIds.indexOf(pass.s.seatId)+1).padStart(3,'0')}`,operationId=`op:take:${i+1}`;
    push({...base(`take:${i+1}`,plate.plateId,pass.t,actionMs),eventType:'customer.take',layer:'action',plateId:plate.plateId,customerId,seatId:pass.s.seatId,operationId});
    changes.set(pass.t,{grossG:dish.tareG+(i===0?halfRemainingG:lowRemainingG),operationId,region:'dining'});
  }
  // Ask the same business reducer that runs in production for the preparation task.
  for(const [i,[at,c]]of [...changes].entries())push({...base(`weight:focus:${i+1}`,plate.plateId,at),eventType:'weight.observed',layer:'observation',plateId:plate.plateId,scaleId:`scale:${plate.plateId}`,bootId:'sim-boot-1',sequence:i+1,quality:'good',...c});
  // A baseline before each action prevents sparse generation from depending on expired readings.
  for(const [i,at]of [first.t,second.t].entries())if(at>25000)push({...base(`baseline:${i}`,plate.plateId,at-1000),eventType:'weight.observed',layer:'observation',plateId:plate.plateId,scaleId:`scale:${plate.plateId}`,bootId:'sim-boot-1',sequence:0,quality:'good',grossG:dish.tareG+(i===0?dish.fullG:halfRemainingG),region:'dining'});
  // Planning uses a long freshness horizon only; final observations below restore the actual 30s rule.
  const planning={...dataset,durationMs:second.t+1,rules:{...dataset.rules,staleAfterMs:second.t+30000}};
  const task=project(scene,planning,second.t).tasks[0];
  if(!task)throw new DemoError('PRECONDITION_FAILED','半盘未生成备菜任务');
  const refillAt=nextPass(scene,plate.plateId,window.centerSM,Math.max(task.readyAtMs+actionMs,second.t+3000));
  const operationId='op:refill:1';
  push({...base('refill:1',plate.plateId,refillAt,actionMs),eventType:'staff.refill',layer:'action',plateId:plate.plateId,staffId:task.staffId,windowId:window.windowId,taskId:task.taskId,operationId});
  changes.set(refillAt,{grossG:dish.fullG+dish.tareG,operationId,region:'kitchen'});
  let lastExitMs=refillAt;
  const exitArrivalBaseMs=refillAt+8000+Math.max(...seatIds.map(id=>walkMs(seats.find(s=>s.seatId===id)!)));
  for(const [i,seatId]of seatIds.entries()){const customerId=`customer-${String(i+1).padStart(3,'0')}`,seat=seats.find(s=>s.seatId===seatId)!,path=pathFor(seat)?.slice().reverse(),applyTimeMs=exitArrivalBaseMs+i*presentation.arrivalIntervalMs,startTimeMs=applyTimeMs-walkMs(seat);push({...base(`depart:${customerId}`,customerId,startTimeMs),eventType:'customer.depart',layer:'action',customerId});push({...base(`leave:${customerId}`,customerId,applyTimeMs),startTimeMs,eventType:'customer.leave',layer:'action',customerId,...(path?{path}:{})});lastExitMs=Math.max(lastExitMs,applyTimeMs);}
  dataset.durationMs=lastExitMs+5000;
  dataset.events=dataset.events.filter(e=>e.eventType!=='weight.observed');
  // Incremental scale samples, no repeated whole-store snapshots. Stationary weights are
  // sampled every 20s; focal operations add observations exactly at the apply time.
  for(const p of scene.plates){
    const d=dishes.find(d=>d.dishId===p.dishId)!;
    const times=new Set<number>();for(let t=Math.max(1,Math.floor(rules.staleAfterMs*2/3));t<=dataset.durationMs;t+=Math.max(1,Math.floor(rules.staleAfterMs*2/3)))times.add(t);
    if(p.plateId===plate.plateId)for(const t of changes.keys())times.add(t);
    let grossG=d.fullG+d.tareG,sequence=0;
    for(const at of [...times].sort((a,b)=>a-b)){
      const c=p.plateId===plate.plateId?changes.get(at):undefined;if(c)grossG=c.grossG;
      push({...base(`weight:${p.plateId}:${++sequence}`,p.plateId,at),eventType:'weight.observed',layer:'observation',plateId:p.plateId,scaleId:`scale:${p.plateId}`,bootId:'sim-boot-1',sequence,grossG,quality:'good',region:c?.region??'unknown',...(c?{operationId:c.operationId}:{})});
    }
  }
  // IDs depend on final observation sequence, so derive the authoritative task again.
  const finalTask=project(scene,{...dataset,events:dataset.events.filter(e=>e.eventType!=='staff.refill'&&!(e.eventType==='weight.observed'&&e.operationId===operationId))},second.t).tasks[0];
  const refill=dataset.events.find(e=>e.eventType==='staff.refill')! as Extract<InputEvent,{eventType:'staff.refill'}>;refill.taskId=finalTask.taskId;
  dataset.events.sort((a,b)=>a.applyTimeMs-b.applyTimeMs||a.eventId.localeCompare(b.eventId));
  dataset.datasetId=`demo-${(await digest({...dataset,datasetId:''})).slice(7,27)}`;
  const verified=await validatePackage(scene,dataset);
  if(verified.result.tasks.length!==1||verified.result.tasks[0].status!=='completed'||verified.result.summary.uncertainG!==0||verified.result.summary.qualityIssueCount!==0)throw new DemoError('PRECONDITION_FAILED','正常自动闭环未通过',{summary:verified.result.summary,tasks:verified.result.tasks});
  return {dataset,truth:{purpose:'仅供验证，不提供给运行服务',focusPlateId:plate.plateId,takeTimesMs:[first.t,second.t],refillAtMs:refillAt,expectedTakenG:dish.fullG-lowRemainingG,expectedRefilledG:dish.fullG-lowRemainingG,minimumRemainingG:lowRemainingG},report:{presentation:{requestedCustomers:presentation.customerCount,scheduledCustomers:seatIds.length,arrivalIntervalMs:presentation.arrivalIntervalMs,activeTrackOnly:true},layoutVersion:scene.layoutVersion,sceneDigest:scene.contentDigest,counts:verified.result.summary,durationMs:dataset.durationMs,trackPeriodMs:track.lengthM/track.speedMps*1000,eventCount:dataset.events.length,task:verified.result.tasks[0],allEventsValidated:true}};
}
