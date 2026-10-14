import assert from "node:assert/strict";

const base=process.env.SCALE_BASE_URL??"http://127.0.0.1:5173",source="live",suffix=crypto.randomUUID().slice(0,8),dishId=`smoke-dish-${suffix}`;
const configs=[1,2].map(i=>({id:`smoke-${suffix}-${i}`,dishId,dishName:"接口验证菜",tareG:300,fullG:1000,noiseG:3,enabled:true}));
async function call(path,body,token){const r=await fetch(base+path,body===undefined?{cache:"no-store"}:{method:"POST",headers:{"Content-Type":"application/json",Origin:base,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});const json=await r.json();return {status:r.status,json};}
async function okay(path,body,token){const r=await call(path,body,token);assert.equal(r.status,200,JSON.stringify(r.json));return r.json;}
const devices=body=>okay("/api/scales/devices",{source,...body});
const ingest=(samples,token)=>okay("/api/scales/ingest",{samples},token);
const view=()=>okay(`/api/scales/state?source=${source}`);
const date=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const summary=()=>okay(`/api/scales/summary?source=${source}&date=${date}`);
let credential;
try{
 for(const config of configs)await devices({action:"save",config});
 credential=await devices({action:"credential"});assert(credential.token);
 const token=credential.token,bootId=crypto.randomUUID();let seq=0,cursor=Date.now()-7000;
 const sample=(grossG,scaleId=configs[0].id,boot=bootId)=>{cursor=Math.max(cursor+1,Date.now()-100);return {scaleId,bootId:boot,sequence:++seq,sampledAt:new Date(cursor).toISOString(),grossG};};
 const stable=async(grossG,id=configs[0].id)=>{const samples=Array.from({length:3},()=>sample(grossG,id));await ingest(samples,token);return samples;};
 assert.equal((await call("/api/scales/ingest",{samples:[sample(1300)]},"invalid")).status,401);
 await stable(1300);const taking=await stable(1250);
 const duplicate=await ingest(taking,token);assert.equal(duplicate.accepted,0);assert.equal(duplicate.ignored,3);
 await stable(1450);await ingest([sample(1449),sample(1451),sample(1450)],token);
 let totals=(await summary()).dishes.find(d=>d.dishId===dishId);assert.equal(totals.takeG,50);assert.equal(totals.refillG,200);
 const unknown={...sample(1200),scaleId:"unknown-smoke"};assert.equal((await call("/api/scales/ingest",{samples:[sample(1400),unknown]},token)).status,400);
 const future={...sample(1200),sampledAt:new Date(Date.now()+60000).toISOString()};assert.equal((await call("/api/scales/ingest",{samples:[sample(1400),future]},token)).status,400);
 await ingest([sample(0)],token);await stable(1350);
 let state=await view(),pending=state.pending.find(e=>e.scaleId===configs[0].id);assert.equal(pending.weightG,100);
 assert.equal((await summary()).dishes.find(d=>d.dishId===dishId).takeG,50,"bowl removal is not consumption");
 const resolution={source,action:"resolve",eventId:pending.id,disposition:"waste",reason:"display_age"};await okay("/api/scales/actions",resolution);
 assert.equal((await call("/api/scales/actions",resolution)).status,400,"cannot resolve twice");
 await stable(1250);const manual={source,action:"report",scaleId:configs[0].id,disposition:"waste",weightG:100,reason:"closing",requestId:crypto.randomUUID()};await okay("/api/scales/actions",manual);await okay("/api/scales/actions",manual);
 totals=(await summary()).dishes.find(d=>d.dishId===dishId);assert.equal(totals.takeG,50,"reported measured waste replaces take");assert.equal(totals.wasteG,200);
 await stable(800,configs[1].id);state=await view();let dish=state.dishes.find(d=>d.id===dishId);assert.equal(dish.remainingG,1450);assert.equal(dish.percent,72.5);assert.equal(dish.scales.length,2);
 const same=await stable(1220);await Promise.all([ingest(same,token),ingest(same,token)]);assert.equal((await summary()).dishes.find(d=>d.dishId===dishId).takeG,80,"parallel retry counted once");
 assert.equal((await call("/api/scales/state?source=demo")).status,400);
 assert.equal((await call("/api/scales/ingest",{source:"live",samples:[sample(1000)]},token)).status,400);
 await devices({action:"calibration",scaleId:configs[0].id,tareG:400,fullG:1000});await stable(1200);
 assert.equal((await summary()).dishes.find(d=>d.dishId===dishId).takeG,80,"calibration resets baseline");
 for(const path of ["/api/state","/api/ingest","/api/actions","/api/analysis","/api/model-config","/api/import/orders","/data-import"]){const r=await fetch(base+path,{method:path==="/api/ingest"?"POST":"GET"});assert.equal(r.status,404,`${path} removed`);}
 console.log(JSON.stringify({passed:true,scenarios:"authentication, stable changes, noise, duplicate/concurrent retries, invalid batches, bowl removal, waste reclassification, calibration, multi-bowl percentages, obsolete source rejected, removed routes"}));
}finally{
 for(const config of configs)await devices({action:"save",config:{...config,enabled:false}}).catch(()=>{});
}
