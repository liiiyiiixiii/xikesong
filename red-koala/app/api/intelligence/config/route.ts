import { historyGuard } from "@/lib/preferences/history-state";
import { z } from "zod";
import { body,checkOrigin } from "@/lib/http";
import { credentialStatus,resolveModelConfig,saveModelKey,disconnectModel,testDeepSeek } from "@/lib/analysis/credentials";
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("connect"),apiKey:z.string().trim().min(8).max(512).regex(/^[\x21-\x7e]+$/),model:z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._/-]+$/).default("deepseek-flash")}).strict(),
 z.object({action:z.literal("test")}).strict(),z.object({action:z.literal("disconnect")}).strict()
]);
export async function GET(){ const historyBlocked=await historyGuard(false);if(historyBlocked)return historyBlocked; try{return Response.json(await credentialStatus(),{headers:{"Cache-Control":"no-store"}});}catch{return Response.json({configured:false,model:"deepseek-flash",message:"模型配置读取失败，可重新填写密钥连接"},{headers:{"Cache-Control":"no-store"}});}}
export async function POST(req:Request){ const historyBlocked=await historyGuard(false);if(historyBlocked)return historyBlocked; try{checkOrigin(req);}catch{return Response.json({error:"请求来源不匹配"},{status:403});}let input;try{input=schema.parse(await body(req));}catch{return Response.json({error:"请填写有效的 API Key 和模型名称"},{status:400});}try{
 if(input.action==="disconnect")await disconnectModel();
 else {const config=input.action==="connect"?{apiKey:input.apiKey,model:input.model,baseUrl:"https://api.deepseek.com"}:await resolveModelConfig();await testDeepSeek(config,AbortSignal.any([req.signal,AbortSignal.timeout(20000)]));if(input.action==="connect")await saveModelKey(input.apiKey,input.model);}
 return Response.json({...await credentialStatus(),message:input.action==="disconnect"?"已断开连接并移除保存的密钥":input.action==="connect"?"连接成功，密钥已加密保存":"连接测试成功"},{headers:{"Cache-Control":"no-store"}});
}catch(error){return Response.json({error:error instanceof Error?error.message:"连接操作失败，请重试"},{status:502,headers:{"Cache-Control":"no-store"}});}}
