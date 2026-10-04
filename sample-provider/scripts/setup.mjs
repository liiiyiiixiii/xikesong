import { writeFileSync,readFileSync,existsSync } from "node:fs";
import { base, token } from "../lib/client.mjs";
import { bowls as dishes } from "../lib/dishes.mjs";
async function configure(input){const response=await fetch(base+"/api/scales/devices",{method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});const result=await response.json();if(!response.ok)throw new Error(result.error);return result;}
const response=await fetch(base+"/api/scales/devices");if(!response.ok)throw new Error("无法读取主体设备设置");const settings=await response.json();
// Reuse a saved credential; never silently rotate an existing gateway's token.
let credential=token;
if(!credential){if(settings.credentialConfigured)throw new Error("主体已配置密钥，请将现有密钥设置为 SCALE_DEVICE_TOKEN；需要更换时在管理端生成。");credential=(await configure({action:"credential"})).token;}
const envFile=new URL("../.env",import.meta.url);
const custom=existsSync(envFile)?readFileSync(envFile,"utf8").split(/\r?\n/).filter(line=>!/^SCALE_(BASE_URL|DEVICE_TOKEN)=/.test(line)).join("\n").trim():"";
writeFileSync(envFile,`${custom}\nSCALE_BASE_URL=${base}\nSCALE_DEVICE_TOKEN=${credential}\n`,{mode:0o600});
for(let i=0;i<dishes.length;i++){
 const existing=settings.configs.find(c=>c.id===`sim-${i+1}`);
 if(existing){if(existing.dishId!==dishes[i].id||!existing.enabled||existing.tareG!==300||existing.fullG!==1000)throw new Error(`设备 ${existing.id} 配置冲突，请在管理端核对`);if(existing.position===dishes[i].position)continue;}
 await configure({action:"save",config:{id:`sim-${i+1}`,dishId:dishes[i].id,dishName:dishes[i].name,tareG:300,fullG:1000,noiseG:3,enabled:true,position:dishes[i].position}});
}
// Retire only surplus simulator devices; preserve records and other gateways.
for(const config of settings.configs){
 if(/^sim-\d+$/.test(config.id)&&!dishes.some(d=>d.scaleId===config.id)&&config.enabled)
  await configure({action:"save",config:{...config,enabled:false}});
}
console.log("样例设备配置完成，密钥保存在本项目 .env。运行 npm start 开始上传。");
