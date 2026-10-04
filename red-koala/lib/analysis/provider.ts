import type { Complete } from "./agent.ts";

export interface ModelConfig { apiKey:string; baseUrl:string; model:string; }
export function modelConfig(bindings:{ANALYSIS_API_KEY?:string;ANALYSIS_BASE_URL?:string;ANALYSIS_MODEL?:string;DEEPSEEK_API_KEY?:string;DEEPSEEK_BASE_URL?:string;DEEPSEEK_MODEL?:string}):ModelConfig {
  // A new provider configuration must not inherit another provider's legacy key.
  const custom=bindings.ANALYSIS_API_KEY!==undefined || bindings.ANALYSIS_BASE_URL!==undefined || bindings.ANALYSIS_MODEL!==undefined;
  const baseUrl=((custom?bindings.ANALYSIS_BASE_URL:bindings.DEEPSEEK_BASE_URL)?.trim()||"https://api.deepseek.com").replace(/\/$/,"");
  const url=new URL(baseUrl);
  if(url.protocol!=="https:" || url.username || url.password || url.search || url.hash) throw new Error("模型服务地址必须为不含凭证及查询参数的 HTTPS 地址");
  return {apiKey:(custom?bindings.ANALYSIS_API_KEY:bindings.DEEPSEEK_API_KEY)?.trim()||"",baseUrl,model:(custom?bindings.ANALYSIS_MODEL:bindings.DEEPSEEK_MODEL)?.trim()||"deepseek-flash"};
}
export function createCompletion(config:ModelConfig, fetcher:typeof fetch=fetch):Complete {
  return async(messages,tools,signal)=>{
    if(!config.apiKey) throw new Error("尚未配置大模型密钥，请在服务端配置 ANALYSIS_API_KEY 并重启服务");
    // Workers supports manual/follow only; reject redirects without forwarding credentials.
    let response:Response;
    try {
      response=await fetcher(`${config.baseUrl}/chat/completions`,{method:"POST",redirect:"manual",signal,
        headers:{Authorization:`Bearer ${config.apiKey}`,"Content-Type":"application/json"},
        body:JSON.stringify({model:config.model,messages,tools,stream:false,max_tokens:3000,
          ...(new URL(config.baseUrl).hostname==="api.deepseek.com"?{thinking:{type:"disabled"}}:{})})});
    } catch { throw new Error(signal.aborted?"分析已取消或超时，请缩小问题后重试":"模型服务连接失败，请检查服务地址和网络"); }
    // Do not echo provider response bodies: they may contain request data or secrets.
    if(response.status>=300&&response.status<400)throw new Error("模型服务返回重定向，已停止请求，请检查服务地址");if(!response.ok) throw new Error(response.status===401||response.status===403?"模型服务鉴权失败，请检查服务端密钥与权限":response.status===429?"模型服务限流或额度不足，请稍后重试":`模型服务暂时不可用（HTTP ${response.status}）`);
    const body=await response.text();
    if(body.length>200000) throw new Error("模型返回内容过大");
    try { return (JSON.parse(body) as {choices?:{message:unknown}[]}).choices?.[0]?.message; }
    catch { throw new Error("模型返回了无效响应"); }
  };
}
