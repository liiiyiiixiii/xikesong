import { existsSync } from "node:fs";
if(existsSync(new URL("../output/simulation.lock",import.meta.url)))throw new Error("请先停止实时用餐模拟器，再运行异常场景");
import { setTimeout as delay } from "node:timers/promises";

import { base, token, post } from "../lib/client.mjs";
import { bowls as dishes } from "../lib/dishes.mjs";

const scenario=true;
const count=scenario?1:dishes.length;
const settings=await fetch(base+"/api/scales/devices").then(r=>r.json());
for(let i=0;i<count;i++)if(!settings.configs?.some(c=>c.id===`sim-${i+1}`&&c.dishId===dishes[i].id&&c.enabled))throw new Error("请先运行 npm run setup 配置样例设备");
const bootId=crypto.randomUUID();let activeBoot=bootId,sequence=0,stopped=false;
process.on("SIGINT",()=>{stopped=true;});process.on("SIGTERM",()=>{stopped=true;});
const weights=Array.from({length:count},(_,i)=>1000-(i*73)%930);
async function tick(values,options={}){
 if(options.bootId)activeBoot=options.bootId;
 const sampledAt=new Date().toISOString();const samples=values.map((grossG,i)=>({scaleId:`sim-${i+1}`,bootId:activeBoot,sequence:++sequence,sampledAt,grossG}));
 const result=await post("/api/scales/ingest",{samples},token);
 if(options.duplicate)await post("/api/scales/ingest",{samples},token);
 return {samples,result};
}
async function hold(grossG,n=4,options={}){for(let i=0;i<n&&!stopped;i++){await tick([grossG],options);await delay(1000);}}
console.log(`称重模拟器已接入 ${base}：${count} 个秤。${scenario?"正在验证取用、补菜、噪声、拿碗、重启、重复和断线。":"每秒上传，按 Ctrl+C 停止。"}`);

 await hold(1300);await hold(1250);await hold(1450);
 for(const value of [1449,1451,1450,1449,1450]){await tick([value]);await delay(1000);}
 await hold(0);await hold(1400);
 await hold(1400,4,{bootId:crypto.randomUUID(),duplicate:true});
 await delay(12000);await hold(1200);
 const old={scaleId:"sim-1",bootId,sequence:1,sampledAt:new Date(Date.now()-60000).toISOString(),grossG:0};
 await post("/api/scales/ingest",{samples:[old]},token);
 console.log("场景上传完成。待确认变化留在管理端，不自动归入取用或报损。");
