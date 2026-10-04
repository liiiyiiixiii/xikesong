import { setTimeout as delay } from "node:timers/promises";
import { mkdir,readFile,writeFile,rename,appendFile,open,unlink,copyFile } from "node:fs/promises";
import { base,post,simulationSeed } from "../lib/client.mjs";
import { bowls as dishes } from "../lib/dishes.mjs";
import { createRestaurant,advance,migrateRestaurant,layout,summary } from "../lib/restaurant.mjs";
import { pendingToConfirm,anomalyPolicy } from "../lib/anomaly-policy.mjs";
const output=new URL("../output/",import.meta.url);
await mkdir(output,{recursive:true});
const lock=new URL("simulation.lock",output);
async function acquire(){const handle=await open(lock,"wx");await handle.writeFile(String(process.pid));await handle.close();}
try {await acquire();}
catch(error){if(error.code!=="EEXIST")throw error;const pid=Number(await readFile(lock,"utf8"));let alive=true;try{process.kill(pid,0);}catch(e){if(e.code==="ESRCH")alive=false;else throw e;}if(alive)throw new Error(`模拟器已运行，PID ${pid}`);await unlink(lock);await acquire();}
let stopped=false;
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>{stopped=true;});
try {
 const settingsResponse=await fetch(base+"/api/scales/devices");if(!settingsResponse.ok)throw new Error("无法读取设备配置");const settings=await settingsResponse.json();
 for(const dish of dishes){const config=settings.configs.find(c=>c.id===dish.scaleId);if(!config?.enabled||config.dishId!==dish.id||config.tareG!==dish.tareG||config.fullG!==dish.fullG||config.position!==dish.position)throw new Error(`请运行 npm run setup：${dish.scaleId} 配置与传送带布局不一致`);}
 let checkpoint;
 try{checkpoint=JSON.parse(await readFile(new URL("state.json",output),"utf8"));if(checkpoint.base!==base)throw new Error("模拟存档属于另一主体地址，请另存 output 后重新启动");const migrated=migrateRestaurant(checkpoint.state);if(migrated!==checkpoint.state){await copyFile(new URL("state.json",output),new URL(`state-before-menu-change-${Date.now()}.json`,output));checkpoint.state=migrated;}}
 catch(error){if(error.code!=="ENOENT")throw error;}
 if(!checkpoint){
  const response=await fetch(base+"/api/scales/state");if(!response.ok)throw new Error("无法读取初始重量");const realtime=await response.json();
  const weights=Object.fromEntries(realtime.dishes.flatMap(d=>d.scales).filter(s=>s.netG!==null).map(s=>[s.id,s.netG]));
  checkpoint={base,bootId:crypto.randomUUID(),sequence:0,state:createRestaurant({seed:simulationSeed,initialWeights:weights})};
 }

 // All current preparation facts use the same physical checkpoint and refill events.
 const businessDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 async function preparation(){
  const date=businessDate();if(checkpoint.kitchen?.date===date)return;
  const r=await fetch(base+'/api/preferences');if(!r.ok)throw new Error('无法读取模拟备料依据');const data=await r.json(),forecast=data.forecasts.find(f=>f.targetDate===date);
  const ids=[...new Set(dishes.map(d=>d.id))],items=ids.map(id=>{const opening=checkpoint.state.plates.reduce((sum,plate,i)=>sum+(dishes[i].id===id?plate.netG:0),0),suggested=forecast?.lines.find(l=>l.dishId===id)?.suggested??opening*2,prepared=Math.max(opening,suggested);return {dishId:id,prepared,added:0,stock:prepared-opening,transferred:opening};});
  checkpoint.kitchen={date,items};
  if(forecast&&!data.plans.some(p=>p.forecastId===forecast.id))await post('/api/preferences',{source:'live',action:'confirm',forecastId:forecast.id,date,lines:items.map(x=>({dishId:x.dishId,quantity:x.prepared,reason:'实时模拟人工决策：参考历史回放建议，并保证不低于开档上台重量。'}))});
  for(const item of items)await saveExecution(item);
 }
 async function saveExecution(item){await post('/api/preferences',{source:'live',action:'execution',date:checkpoint.kitchen.date,dishId:item.dishId,prepared:item.prepared,added:item.added,kitchenRetained:0,ageWaste:0,closingWaste:0,otherWaste:0,note:'实时模拟进行中；实际备料包含开档可用库存，厨房追加由上台补菜触发。闭店保留与报损尚未结算。'});}
 async function kitchenEvents(events){
  const changed=new Set();for(const e of events.filter(e=>e.kind==='refill')){const item=checkpoint.kitchen.items.find(x=>x.dishId===e.dishId);if(item.stock<e.grams){const added=Math.ceil((e.grams-item.stock)/500)*500;item.stock+=added;item.added+=added;changed.add(item);}item.stock-=e.grams;item.transferred+=e.grams;if(item.prepared+item.added!==item.stock+item.transferred)throw new Error('实时厨房库存不守恒');}
  for(const item of changed)await saveExecution(item);
 }
 await preparation();
 await writeFile(new URL("layout.json",output),JSON.stringify(layout,null,2));
 async function save(){await writeFile(new URL("state.tmp",output),JSON.stringify(checkpoint));await rename(new URL("state.tmp",output),new URL("state.json",output));}
 let previousUploadAt=0,recoveryTicks=0;
 async function confirmPending(){
  const response=await fetch(base+"/api/scales/state");if(!response.ok)throw new Error("无法读取模拟待确认记录");const live=await response.json();
  for(const e of pendingToConfirm(live.pending.filter(e=>dishes.some(d=>d.scaleId===e.scaleId)&&new Date(Date.parse(e.at)+8*3600000).toISOString().slice(0,10)>=businessDate()),Date.now())){
   await post("/api/scales/actions",{source:"live",action:"resolve",eventId:e.id,disposition:"correction",reason:"other"});
   await appendFile(new URL("operator-actions.ndjson",output),JSON.stringify({at:new Date().toISOString(),eventId:e.id,action:"correction",policy:anomalyPolicy,reason:"模拟经营者确认采样恢复差异；缺测重量不补记取用或报损"})+"\n");
  }
 }
 async function upload(events){
  const sampledAt=new Date().toISOString(),samples=checkpoint.state.plates.map((plate,i)=>({scaleId:dishes[i].scaleId,bootId:checkpoint.bootId,sequence:++checkpoint.sequence,sampledAt,grossG:plate.netG+dishes[i].tareG}));
  for(let attempt=0;;attempt++)try{await post("/api/scales/ingest",{samples});break;}catch(error){if(attempt>=4||error.status&&error.status<500)throw error;console.warn("上报失败，重试同一批采样：",error.message);await delay(1000);}
  if(previousUploadAt&&Date.now()-previousUploadAt>5000)recoveryTicks=4;previousUploadAt=Date.now();
  await confirmPending();
  await save();if(events.length)await appendFile(new URL("events.ndjson",output),events.map(e=>JSON.stringify({...e,sampledAt})).join("\n")+"\n");
 }
 console.log(`顾客用餐模拟已接入 ${base}：36 种菜品、${dishes.length} 个碗位，${layout.seats.length} 个座位，传送带每 5 秒移动一位、${layout.cycleSeconds} 秒一圈。`);
 console.log("顾客按偏好取菜，厨房在补菜窗口补充；状态和取菜流水保存在 output/。按 Ctrl+C 停止。");
 for(let i=0;i<4&&!stopped;i++){await upload([]);await delay(1000);}
 if(!stopped){await upload(checkpoint.state.initialEvents.splice(0));await delay(1000);}
 while(!stopped){const started=Date.now();await preparation();const events=recoveryTicks>0?(recoveryTicks--,[]):advance(checkpoint.state);await kitchenEvents(events);await upload(events);if(checkpoint.state.second%30===0)console.log(JSON.stringify(summary(checkpoint.state)));await delay(Math.max(0,1000-(Date.now()-started)));}
} finally {await unlink(lock);}
