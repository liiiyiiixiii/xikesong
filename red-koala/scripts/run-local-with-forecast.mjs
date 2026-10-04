import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root=fileURLToPath(new URL("../",import.meta.url));
// One shared local secret, never printed; Wrangler reads .env for local bindings.
const envFile=path.join(root,".env");let text=existsSync(envFile)?readFileSync(envFile,"utf8"):"";
const match=text.match(/^FORECAST_JOB_TOKEN=(.*)$/m);const token=match?.[1]?.trim().replace(/^['"]|['"]$/g,"")||randomBytes(32).toString("hex");
if(!match)text+=`\nFORECAST_JOB_TOKEN=${token}\n`;
const keyMatch=text.match(/^ANALYSIS_KEY_SECRET=(.*)$/m);
if(!keyMatch?.[1]?.trim()) {
 text=text.replace(/^ANALYSIS_KEY_SECRET=.*\r?\n?/gm, "");
 text+=`\nANALYSIS_KEY_SECRET=${randomBytes(32).toString("hex")}\n`;
}
if(text!==(existsSync(envFile)?readFileSync(envFile,"utf8"):"")){writeFileSync(envFile,text,{mode:0o600});chmodSync(envFile,0o600);}
const mode=process.argv[2]??"dev";
const command=mode==="start"?["--import","./scripts/sites-env.mjs","node_modules/wrangler/bin/wrangler.js","dev","--config","dist/server/wrangler.json","--local","--persist-to",".wrangler/state","--ip","127.0.0.1","--port","5173","--inspector-port","0"]:["./scripts/run-framework.mjs","dev"];
const child=spawn(process.execPath,command,{cwd:root,stdio:"inherit",env:{...process.env,FORECAST_JOB_TOKEN:token}});let running=false,stopped=false,lastError="";
let archiveRunning=false;
async function archiveTick(){if(archiveRunning||stopped)return;archiveRunning=true;try{const response=await fetch("http://127.0.0.1:5173/api/intelligence/archive-jobs",{method:"POST",headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(110000)});if(!response.ok)console.warn("[画像归档] HTTP",response.status);}catch{console.warn("[画像归档] 请求失败，下次调度重试");}finally{archiveRunning=false;}}
async function tick(){void archiveTick();if(running||stopped)return;running=true;try{const response=await fetch("http://127.0.0.1:5173/api/preferences/jobs",{method:"POST",headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(55000)});if(!response.ok){const result=await response.json();throw new Error(result.error||`HTTP ${response.status}`);}const result=await response.json();for(const row of result.results??[])if(row.error)throw new Error(row.error);lastError="";}catch(e){const message=e instanceof Error?e.message:String(e);if(message!==lastError){console.warn("[备料调度]",message);lastError=message;}}finally{running=false;}}
const timer=setInterval(tick,60000);const initial=setTimeout(tick,12000);
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>{stopped=true;clearInterval(timer);clearTimeout(initial);child.kill(signal);});
child.on("exit",code=>{stopped=true;clearInterval(timer);clearTimeout(initial);process.exit(code??0);});
