import { bowls as dishes } from '../dishes.mjs';
import { layout, slotAt } from '../restaurant.mjs';
export const parameters={version:'restaurant-unified-v4.0',mode:'scenario',seed:20260904,start:'2026-09-03',end:'2026-10-05',timezone:'Asia/Shanghai',seats:20,open:'11:00',close:'22:00',weekdayGuests:128,weekendGuests:155,targetG:[480,780],durationSeconds:[2100,3300],refillG:420,deviceGapSeconds:720};
export function simulateDay(index, p=parameters){
 let rng=(p.seed+index*104729)>>>0;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;},int=(a,b)=>a+Math.floor(random()*(b-a+1));
 const date=new Date(Date.parse(p.start+'T00:00:00Z')+index*86400000).toISOString().slice(0,10),weekend=[0,6].includes(new Date(date).getUTCDay());
 const at=s=>new Date(Date.parse(date+'T11:00:00+08:00')+s*1000).toISOString();
 const truth=[],guests=[],active=[],queue=[],sampled=[];let serial=0,maxSeats=0;
 const emit=(kind,s,dishId,grams,extra={})=>{const e={id:`${date}:${++serial}`,kind,second:s,at:at(s),dishId,grams,...extra};truth.push(e);return e;};
 const count=(weekend?p.weekendGuests:p.weekdayGuests)+int(-9,9),arrivals=[];
 // A mixture of lunch, dinner and off-peak visits, all seated before last orders.
 for(let i=0;i<count;i++){const r=random();let s;if(r<.41)s=1800+(random()+random())*3600;else if(r<.88)s=21600+(random()+random())*4200;else s=random()*36000;arrivals.push(Math.floor(s));}arrivals.sort((a,b)=>a-b);
 const plates=dishes.map((d,j)=>{
  const taste=d.demandIndex??j,preference=.5+((taste*17)%31)/24,trend=1+((taste%7)-3)*index*.003,weekendLift=weekend?1+((taste%5)-2)*.07:1;
  const prepared=Math.round((1500+preference*450)*trend*weekendLift/50)*50,opening=250+(j%4)*30;
  // prepared means opening available kitchen stock (carry-in + fresh preparation).
  // Cross-day sourcing is derived from prior kitchen_retain by history-report.mjs.
  emit('prepare',0,d.id,prepared,{scaleId:d.scaleId});emit('opening',0,d.id,opening,{scaleId:d.scaleId});
  return {d,net:opening,kitchen:prepared-opening,preference:preference*trend*weekendLift,lock:0,refillDue:null,gap:[5,12,20,26].includes(index)&&j===(index*3)%42?[14700,15420]:null,hold:[3,10,18,25].includes(index)&&j===(index*7)%42,minutes:Array.from({length:660},(_,m)=>({source:'live',scaleId:d.scaleId,dishId:d.id,minute:at(m*60),takeG:0,refillG:0,observedSeconds:0,emptySeconds:0,remainingG:null,emptySpans:[],remainingAt:at(m*60+59)}))};
 });
 const known=(pl,s)=>!pl.gap||s<pl.gap[0]||s>=pl.gap[1];
 for(let s=0;s<39600;s++){
  for(let i=active.length-1;i>=0;i--)if(s>=active[i].leaveAt){const g=active.splice(i,1)[0];emit('departure',s,null,0,{guest:g.id,takenG:g.takenG});}
  while(arrivals.length&&arrivals[0]<=s)queue.push({requestedAt:arrivals.shift()});
  while(queue.length&&active.length<20){const q=queue.shift(),seat=Array.from({length:20},(_,i)=>i).find(i=>!active.some(g=>g.seat===i));const g={id:`${date}:guest-${guests.length+1}`,seat,requestedAt:q.requestedAt,arrivedAt:s,leaveAt:Math.min(s+int(...p.durationSeconds),39599),targetG:int(...p.targetG),takenG:0,next:s+int(10,40),vegetarian:random()<.14};guests.push(g);active.push(g);emit('arrival',s,null,0,{guest:g.id,seat,targetG:g.targetG});}
  maxSeats=Math.max(maxSeats,active.length);
  for(const pl of plates){const d=pl.d;
   if(pl.net<150&&pl.refillDue===null&&s<38500)pl.refillDue=s+20;
   const hold=pl.hold&&s>24500&&s<26300;
   if(pl.refillDue!==null&&s>=pl.refillDue&&!hold&&slotAt(d.position,s)===0&&s>=pl.lock){
    const amount=s>36000?180:p.refillG;
    if(pl.kitchen<amount){const extra=600;emit('kitchen_add',s,d.id,extra,{scaleId:d.scaleId});pl.kitchen+=extra;}
    pl.net+=amount;pl.kitchen-=amount;emit('refill',s,d.id,amount,{scaleId:d.scaleId});pl.refillDue=null;pl.lock=s+4;
   }
   // A small set of explicitly confirmed bowl withdrawals, never consumption.
   if(index%6===2&&d.position===index+1&&s===18000){const w=pl.net;emit('pending',s,d.id,w,{scaleId:d.scaleId,reason:'display_age',resolvedAt:at(s+90),resolution:'waste'});emit('waste',s,d.id,w,{scaleId:d.scaleId,reason:'display_age',confirmedAt:at(s+90)});pl.net=0;pl.lock=s+4;}
  }
  for(const g of active){if(s<g.next||g.takenG>=g.targetG)continue;const pl=plates.find(pl=>slotAt(pl.d.position,s)===layout.seats[g.seat]);if(!pl||pl.net<=0||s<pl.lock)continue;if(g.vegetarian&&['meat','seafood','protein'].includes(pl.d.category))continue;
   if(random()>Math.min(.88,.22*pl.preference)){g.next=s+5;continue;}const grams=Math.min(int(25,65),pl.net,g.targetG-g.takenG);pl.net-=grams;pl.lock=s+4;g.takenG+=grams;g.next=s+int(65,105);emit('take',s,pl.d.id,grams,{scaleId:pl.d.scaleId,guest:g.id,seat:g.seat,remainingG:pl.net});
  }
  for(const pl of plates){const b=pl.minutes[Math.floor(s/60)];if(known(pl,s)){b.observedSeconds++;if(pl.net===0){b.emptySeconds++;const time=Date.parse(at(s)),last=b.emptySpans.at(-1);if(last?.[1]===time)last[1]=time+1000;else b.emptySpans.push([time,time+1000]);}b.remainingG=pl.net;}else b.remainingG=null;
   if(s%300===0 || (s>=14400 && s<15600))sampled.push({second:s,scaleId:pl.d.scaleId,truthG:pl.net,observedG:known(pl,s)?pl.net:null});}
 }
 // Dispose plate leftovers at close. Kitchen reserve is separately counted and retained.
 for(const pl of plates){emit('waste',39599,pl.d.id,pl.net,{scaleId:pl.d.scaleId,reason:'closing'});pl.net=0;pl.minutes[659].remainingG=0;const kw=Math.floor(pl.kitchen*.025);emit('kitchen_waste',39599,pl.d.id,kw,{scaleId:pl.d.scaleId});pl.kitchen-=kw;emit('kitchen_retain',39599,pl.d.id,pl.kitchen,{scaleId:pl.d.scaleId});}
 const plateBundles=plates.map(pl=>{
  const stream=truth.filter(e=>e.scaleId===pl.d.scaleId),observed=stream.filter(e=>!['prepare','kitchen_add','kitchen_waste','kitchen_retain'].includes(e.kind)&&known(pl,e.second));
  const sum=(kind,until=39600,events=stream)=>events.filter(e=>e.kind===kind&&e.second<until).reduce((a,e)=>a+e.grams,0);
  for(const e of observed){const b=pl.minutes[Math.floor(e.second/60)];if(e.kind==='take')b.takeG+=e.grams;if(e.kind==='refill')b.refillG+=e.grams;}
  const empty=pl.minutes.reduce((a,b)=>a+b.emptySeconds,0)/60,missing=!!pl.gap;
  const daily={date,dishId:pl.d.id,status:missing?'partial':'complete',take20:missing?null:sum('take',32400),takeFinal:missing?null:sum('take'),takeG:missing?null:sum('take'),opening:sum('opening'),replenished:missing?null:sum('refill'),waste:sum('waste'),closing:0,supply:missing?'unknown':empty>0?'stockout':'adequate',stockoutMinutes:missing?null:empty,snapshotAt:date+'T20:00:00+08:00',finalAt:date+'T22:00:00+08:00',ageWaste:stream.filter(e=>e.kind==='waste'&&e.reason==='display_age').reduce((a,e)=>a+e.grams,0),closingWaste:stream.filter(e=>e.kind==='waste'&&e.reason==='closing').reduce((a,e)=>a+e.grams,0),retainedKitchen:0};
  const execution={date,dishId:pl.d.id,prepared:sum('prepare'),added:sum('kitchen_add'),kitchenRetained:sum('kitchen_retain'),ageWaste:0,closingWaste:sum('kitchen_waste'),otherWaste:0,note:index===0?'人工模拟：开业初始备料假设，无前日预测。厨房报损与台面报损分账。':'人工模拟：按历史经验试供，厨房追加按库存触发；厨房报损与台面报损分账。',at:date+'T22:00:00+08:00'};
  return {daily,events:observed.map(e=>({id:e.id,source:'live',scaleId:pl.d.scaleId,dishId:pl.d.id,at:e.at,receivedAt:e.at,kind:e.kind,weightG:e.grams,...(e.reason?{reason:e.reason}:{}),...(e.resolvedAt?{resolvedAt:e.resolvedAt,resolution:e.resolution}:{})})),minutes:pl.minutes,execution,kitchen:stream.filter(e=>['prepare','kitchen_add','kitchen_waste','kitchen_retain','opening','refill'].includes(e.kind)).map(e=>({id:e.id,scaleId:e.scaleId,kind:e.kind,at:e.at,weightG:e.grams}))};
 });
 const bundles=[...new Set(dishes.map(d=>d.id))].map(id=>{
  const rows=plateBundles.filter(b=>b.daily.dishId===id),first=rows[0],minutes=rows.flatMap(b=>b.minutes).sort((a,b)=>a.minute.localeCompare(b.minute)||a.scaleId.localeCompare(b.scaleId)),events=rows.flatMap(b=>b.events).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
  const sum=key=>rows.some(b=>b.daily[key]===null)?null:rows.reduce((s,b)=>s+b.daily[key],0),partial=rows.some(b=>b.daily.status!=='complete');
  let empty=0;for(let m=0;m<660;m++)for(let second=0;second<60;second++){const time=Date.parse(rows[0].minutes[m].minute)+second*1000;if(rows.every(b=>b.minutes[m].emptySpans.some(([a,z])=>a<=time&&time<z)))empty++;}
  const daily={...first.daily,...Object.fromEntries(['take20','takeFinal','takeG','opening','replenished','waste','closing','ageWaste','closingWaste','retainedKitchen'].map(k=>[k,sum(k)])),status:partial?'partial':'complete',supply:partial?'unknown':empty?'stockout':'adequate',stockoutMinutes:partial?null:empty/60};
  const execution={...first.execution,...Object.fromEntries(['prepared','added','kitchenRetained','ageWaste','closingWaste','otherWaste'].map(k=>[k,rows.reduce((s,b)=>s+b.execution[k],0)]))};
  return {daily,events,minutes,execution,kitchen:rows.flatMap(b=>b.kitchen)};
 });
 const guestTaken=guests.reduce((a,g)=>a+g.takenG,0),take=truth.filter(e=>e.kind==='take').reduce((a,e)=>a+e.grams,0);
 if(guestTaken!==take||guests.some(g=>g.takenG>g.targetG)||maxSeats>20||queue.length)throw new Error('顾客约束失败');
 for(const pl of plates){const es=truth.filter(e=>e.scaleId===pl.d.scaleId),sum=k=>es.filter(e=>e.kind===k).reduce((a,e)=>a+e.grams,0);if(sum('opening')+sum('refill')!==sum('take')+sum('waste'))throw new Error('上台重量不守恒');if(sum('prepare')+sum('kitchen_add')!==sum('opening')+sum('refill')+sum('kitchen_waste')+sum('kitchen_retain'))throw new Error('厨房重量不守恒');}
 return {date,bundles,truth,guests,sampled,report:{date,guests:guests.length,maxSeats,turnover:guests.length/20,meanMealMinutes:guests.reduce((a,g)=>a+g.leaveAt-g.arrivedAt,0)/guests.length/60,meanWaitMinutes:guests.reduce((a,g)=>a+g.arrivedAt-g.requestedAt,0)/guests.length/60,takeG:take,meanIntakeG:take/guests.length,refills:truth.filter(e=>e.kind==='refill').length,tableWasteG:truth.filter(e=>e.kind==='waste').reduce((a,e)=>a+e.grams,0),kitchenWasteG:truth.filter(e=>e.kind==='kitchen_waste').reduce((a,e)=>a+e.grams,0),anomalies:bundles.filter(b=>b.daily.status==='partial'||b.daily.supply==='stockout'||b.daily.ageWaste>0).map(b=>({dishId:b.daily.dishId,status:b.daily.status,stockoutMinutes:b.daily.stockoutMinutes,ageWaste:b.daily.ageWaste}))}};
}
