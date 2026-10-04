import {dataAsOf,scenarioContext} from "@/lib/preferences/scenario";
import { historyGuard } from "@/lib/preferences/history-state";
import { loadOverallProfile } from "@/lib/analysis/overall-repository";
import { localDate } from "@/lib/preferences/types";
import { z } from "zod";
import { body, checkOrigin } from "@/lib/http";
import { analysisSchemaAt,overallAnalysisRequestSchema,type AnalysisRequest } from "@/lib/analysis/contract";
import { createCompletion } from "@/lib/analysis/provider";
import { credentialStatus, resolveModelConfig } from "@/lib/analysis/credentials";
import { runAgent } from "@/lib/analysis/agent";
import { createTools } from "@/lib/analysis/tools";

export async function GET() { const historyBlocked=await historyGuard(false);if(historyBlocked)return historyBlocked;
 try{return Response.json(await credentialStatus(),{headers:{"Cache-Control":"no-store"}});}
 catch{return Response.json({configured:false,model:"deepseek-flash",message:"请在页面底部重新连接模型"},{headers:{"Cache-Control":"no-store"}});}
}

export async function POST(req:Request) { const historyBlocked=await historyGuard(false);if(historyBlocked)return historyBlocked;
  try { checkOrigin(req); } catch { return Response.json({error:"请求来源不匹配"},{status:403}); }
  const asOf=await dataAsOf(),scenario=await scenarioContext();let raw;
  try { raw=await body(req); raw=typeof raw==="object"&&raw!==null&&"mode" in raw?overallAnalysisRequestSchema.parse(raw):analysisSchemaAt(asOf,scenario?90:31).parse(raw); }
  catch { return Response.json({error:"请填写问题和有效日期范围（最多31天，不能选择未来日期）"},{status:400}); }
  try {
    const config=await resolveModelConfig();
    if(!config.apiKey) return Response.json({error:"尚未配置大模型密钥，请在页面底部填写 API Key 连接"},{status:503});

    const overall="mode" in raw?await loadOverallProfile(asOf):null;
    const input:AnalysisRequest=overall?{question:raw.question,mode:"overall",startDate:overall.startDate??localDate(asOf),endDate:overall.endDate??localDate(asOf)}:raw as AnalysisRequest;
    const standardTools=createTools({...input,startDate:new Date(Date.parse(asOf)-29*86400000+8*3600000).toISOString().slice(0,10),endDate:localDate(asOf)},asOf);
    const execute=overall?async(name:string,args:Record<string,unknown>)=>{if(name==="freshness_feedback")return standardTools(name,args);if(name!=="overall_profile")throw new Error("整体模式只允许画像与供应反馈工具");return {title:"全部历史群体取用模型",data:overall};}:createTools(input,asOf);
    const signal=AbortSignal.any([req.signal,AbortSignal.timeout(90000)]);
    const scopedExecute=async(name:string,args:Record<string,unknown>)=>{const evidence=await execute(name,args);return scenario?{...evidence,title:"模拟数据 · "+evidence.title,data:{scenario,note:"全量合成场景，不是实际经营；未来日期亦为模拟。",observations:evidence.data}}:evidence;};
    const result=await runAgent(input,config.model,createCompletion(config),scopedExecute,signal,asOf);
    return Response.json({...result,generatedAt:new Date().toISOString(),scenario},{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    const message=error instanceof z.ZodError?"模型未返回有效的分析响应，请重试":error instanceof Error && (error.name==="TimeoutError"||error.name==="AbortError")?"分析已取消或超时，请重试":error instanceof Error?error.message:"分析服务暂时不可用";
    return Response.json({error:message},{status:502,headers:{"Cache-Control":"no-store"}});
  }
}
