"use client";
import { useState } from "react";
import { KeyRound,PlugZap } from "lucide-react";
import { Notice,request,usePolling } from "./shared";
interface Status {configured:boolean;model:string;suffix?:string|null;message:string;source?:string;}
export default function ModelConnection({onChanged}:{onChanged:()=>void}) {
 const state=usePolling<Status>("/api/intelligence/config",60000);
 const [apiKey,setApiKey]=useState(""),[model,setModel]=useState("deepseek-flash"),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[failed,setFailed]=useState(false);
 async function perform(action:"connect"|"test"|"disconnect") {
  setBusy(true);setNotice("");setFailed(false);
  try {const result=await request<Status>("/api/intelligence/config",action==="connect"?{action,apiKey,model}:{action});setNotice(result.message);setApiKey("");state.refresh();onChanged();}
  catch(e){setFailed(true);setNotice(e instanceof Error?e.message:"连接失败");}finally{setBusy(false);}
 }
 return <section className="scale-panel model-connection"><div className="scale-section-heading"><div><h2><KeyRound size={18}/>连接 DeepSeek</h2><p className="scale-muted">填写 API Key，验证通过后即可使用 AI 画像分析，无需修改配置文件。</p></div><span className="portrait-chip">{state.data?.configured?`已连接 · 尾号 ${state.data.suffix??"—"}`:"尚未连接"}</span></div>
 {state.error&&<Notice error>{state.error}</Notice>}
 <form onSubmit={e=>{e.preventDefault();void perform("connect");}}><label htmlFor="deepseek-key">DeepSeek API Key</label><div className="model-key-row"><input id="deepseek-key" type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} required minLength={8} maxLength={512} disabled={busy} placeholder={state.data?.configured?"填写新 Key 可更换连接":"粘贴你的 API Key"}/><button className="scale-button" disabled={busy||!apiKey.trim()}><PlugZap size={16}/>{busy?"处理中…":"连接并保存"}</button></div><details><summary>模型设置</summary><label>模型名称<input value={model} onChange={e=>setModel(e.target.value)} maxLength={100} required disabled={busy}/></label></details></form>
 <p className="scale-muted">密钥仅在服务端加密保存，页面只显示尾号。连接测试会向 DeepSeek 发送一条简短测试请求，可能产生少量调用费用；不会发送门店数据。</p>
 {state.data?.configured&&<div className="model-actions"><button type="button" disabled={busy} onClick={()=>void perform("test")}>测试当前连接</button><button type="button" disabled={busy} onClick={()=>void perform("disconnect")}>断开并移除密钥</button><span className="scale-muted">当前模型：{state.data.model}</span></div>}
 {notice&&<Notice error={failed}>{notice}</Notice>}
 </section>;
}
