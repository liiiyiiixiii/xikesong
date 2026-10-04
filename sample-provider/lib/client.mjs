import { readFileSync, existsSync } from "node:fs";
const envFile=new URL("../.env",import.meta.url);
const saved=existsSync(envFile)?Object.fromEntries(readFileSync(envFile,"utf8").split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const index=line.indexOf("=");return [line.slice(0,index),line.slice(index+1).trim()];})):{};
export const base=(process.env.SCALE_BASE_URL??saved.SCALE_BASE_URL??"http://127.0.0.1:5173").replace(/\/$/,"");
export const simulationSeed=Number(process.env.SIM_SEED??saved.SIM_SEED??20261003);
export const token=process.env.SCALE_DEVICE_TOKEN??saved.SCALE_DEVICE_TOKEN;
export async function post(path,input,credential=token){
 if(!credential)throw new Error("请先运行 npm run setup，或设置 SCALE_DEVICE_TOKEN");
 const response=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${credential}`},body:JSON.stringify(input),signal:AbortSignal.timeout(60000)});
 const result=await response.json();if(!response.ok){const error=new Error(result.error??`HTTP ${response.status}`);error.status=response.status;throw error;}return result;
}
