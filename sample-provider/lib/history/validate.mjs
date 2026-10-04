import assert from 'node:assert/strict';
import { dishes,bowls } from '../dishes.mjs';
export function validateBundle(b){
 const {daily:d,events,minutes,kitchen:k,execution:x}=b;
 assert(dishes.some(v=>v.id===d.dishId));const byScale=new Map([...new Set(minutes.map(m=>m.scaleId))].map(id=>[id,minutes.filter(m=>m.scaleId===id)]));const scaleIds=bowls.filter(v=>v.id===d.dishId).map(v=>v.scaleId);assert.equal(minutes.length,660*scaleIds.length);assert.equal(new Set(events.map(e=>e.id)).size,events.length);
 const sum=(es,kind)=>es.filter(e=>e.kind===kind).reduce((a,e)=>a+(e.weightG??0),0);
 for(const m of minutes){const i=minutes.filter(v=>v.scaleId===m.scaleId).indexOf(m);
  assert.equal(Date.parse(m.minute),Date.parse(d.date+'T11:00:00+08:00')+i*60000);assert(m.observedSeconds>=0&&m.observedSeconds<=60&&m.emptySeconds<=m.observedSeconds);
  const es=events.filter(e=>e.scaleId===m.scaleId&&Date.parse(e.at)>=Date.parse(m.minute)&&Date.parse(e.at)<Date.parse(m.minute)+60000);
  assert.equal(m.takeG,sum(es,'take'));assert.equal(m.refillG,sum(es,'refill'));if(!m.observedSeconds)assert.equal(m.remainingG,null);
 }
 if(d.status==='complete'){
  assert.equal(d.takeFinal,sum(events,'take'));assert.equal(d.takeFinal,minutes.reduce((a,m)=>a+m.takeG,0));assert.equal(d.take20,sum(events.filter(e=>Date.parse(e.at)<Date.parse(d.snapshotAt)),'take'));
  assert.equal(d.opening+d.replenished,d.takeFinal+d.waste+d.closing+d.retainedKitchen);assert.equal(minutes.reduce((a,m)=>a+m.observedSeconds,0),39600*scaleIds.length);
  let empty=0;const start=Date.parse(d.date+'T11:00:00+08:00');for(let i=0;i<660;i++)for(let s=0;s<60;s++){const time=start+(i*60+s)*1000;if(scaleIds.every(id=>byScale.get(id)[i].emptySpans?.some(([a,z])=>a<=time&&time<z)))empty++;}assert.equal(d.stockoutMinutes,empty/60);assert.equal(d.supply,d.stockoutMinutes>0?'stockout':'adequate');
 }else {assert.equal(d.takeFinal,null);assert.equal(d.take20,null);assert.equal(d.supply,'unknown');}
 assert.equal(x.prepared+x.added,sum(k,'opening')+sum(k,'refill')+x.kitchenRetained+x.ageWaste+x.closingWaste+x.otherWaste);
 assert.equal(x.prepared,sum(k,'prepare'));assert.equal(x.added,sum(k,'kitchen_add'));assert.equal(x.kitchenRetained,sum(k,'kitchen_retain'));
 return true;
}
