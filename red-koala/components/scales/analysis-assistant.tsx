"use client";
import { useCallback,useEffect,useRef,useState } from 'react';
import { Sparkles,Download,Square } from 'lucide-react';
import type { AnalysisResult,AnalysisStatus } from '@/lib/analysis/contract';
import { analysisSummary,type PortraitCache } from '@/lib/analysis/view-model';
import { Notice,usePolling } from './shared';
const weeklyQuestion='请先调用 weekly_portrait，综合解释所选日期范围的群体取用画像。用简短的三段话解释菜品选择分布、时段差异和周期变化，并给出有依据的建议；用具体菜名举证，不以第一名命名画像，不用类别代替菜名，不重复列出所有菜品数值。首段不超过120字，总体尽量不超过450字。单日只解释指定日期，周数据仅作背景。明确供应限制、未完结周期与数据缺口；占比是取用重量比例，不是顾客比例或喜爱评分。引用真实查询证据。';
export default function AnalysisAssistant({startDate,endDate,cache,fingerprint,connectionVersion,hasData,mode}:{startDate:string;endDate:string;cache:PortraitCache<AnalysisResult>;fingerprint:string;connectionVersion:number;hasData:boolean;mode?:"overall"}) {
 const defaultQuestion=mode==='overall'?'请调用 overall_profile，用简短中文解释当前动态群体取用模型、近期变化、星期规律和时段观测。引用具体菜品及证据，不用第一名命名画像。必须说明current.state、liveWeight及reason；historical或stale状态不得声称当天数据已参与或模型已实时校准。区分模型估计与实际观测，说明建模菜品分母、学习中菜品、历史范围和时段保留期；不能将估计日均量称为明日预测或人数比例。第一段不超过120字，总体尽量不超过450字。':weeklyQuestion;
 const status=usePolling<AnalysisStatus>('/api/intelligence',60000);
 const [question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<AnalysisResult|null>(null),[submitted,setSubmitted]=useState(defaultQuestion);
 const controller=useRef<AbortController|null>(null);
 const baseKey=JSON.stringify([mode,startDate,endDate,connectionVersion,status.data?.model,fingerprint]);
 const run=useCallback(async(prompt:string,force=false)=>{
  if(controller.current)return;
  const key=baseKey+prompt,cached=!force?cache.get(key):undefined;
  setSubmitted(prompt);setError('');
  if(cached){setResult(cached);return;}
  const current=new AbortController();controller.current=current;setBusy(true);setResult(null);
  try{
   const response=await fetch('/api/intelligence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(mode==='overall'?{mode,question:prompt}:{question:prompt,startDate,endDate}),signal:current.signal});
   const data=await response.json() as AnalysisResult&{error?:string};
   if(!response.ok)throw new Error(data.error||'分析失败，请重试');
   if(mode==='overall'?data.scope?.mode!=='overall':data.scope?.startDate!==startDate||data.scope?.endDate!==endDate)throw new Error('分析日期与当前范围不一致，请重试');
   if(current.signal.aborted)return;
   cache.set(key,data);setResult(data);
  }catch(e){if(!current.signal.aborted)setError(e instanceof Error?e.message:'连接中断，请重试');}
  finally{if(controller.current===current){controller.current=null;setBusy(false);}}
 },[baseKey,cache,startDate,endDate,mode]);
 useEffect(()=>()=>{controller.current?.abort();controller.current=null;},[]);
 function download(){if(!result)return;const text=`# 客群画像解读\n\n${startDate} 至 ${endDate}\n\n${result.answer}\n\n## 依据\n\n${result.evidence.map(e=>`${e.id} · ${e.title}\n\n${JSON.stringify(e.data,null,2)}`).join('\n\n')}`;const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`客群画像-${endDate}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const preview=analysisSummary(result?.answer??'');
 return <section className="auto-portrait-analysis"><div className="scale-section-heading"><div><h2><Sparkles size={18}/>画像解读</h2><p className="scale-muted">点击后结合图表解释取用特征，供应调整仍由管理者确认。</p></div><span className="intelligence-model">{status.data?.configured?status.data.model:'未连接模型'}</span></div>
 {status.error&&<Notice error>{status.error}<button onClick={status.refresh}>重新检查</button></Notice>}
 {!hasData?<p className="scale-muted">本期缺少取用记录，暂不生成综合画像。</p>:status.data&&!status.data.configured?<p className="scale-muted">在页面底部连接 DeepSeek 后点击生成综合解读。统计图表可直接查看。</p>:null}
 {busy&&<Notice>正在生成本期画像解读…</Notice>}{error&&<Notice error>{error}</Notice>}
 {result&&status.data?.configured&&<article aria-label="AI画像解读结果"><p className="ai-portrait-preview">{preview.slice(0,240)}{preview.length>240?'…':''}</p><details><summary>展开完整解读与证据</summary><p className="intelligence-answer">{result.answer}</p><p>数据截止：{new Date(result.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</p>{submitted!==defaultQuestion&&<p>补充问题：{submitted}</p>}{result.evidence.map(e=><details className="intelligence-evidence" key={e.id}><summary>{e.id} · {e.title}</summary><pre>{JSON.stringify(e.data,null,2)}</pre></details>)}<button className="week-text-button" onClick={download}><Download size={14}/>导出解读</button></details></article>}
 <div className="auto-analysis-actions">{busy?<button className="week-text-button" onClick={()=>{controller.current?.abort();setError('已取消解读，可手动重新分析。');}}> <Square size={14}/>取消</button>:<button className="week-text-button" disabled={!status.data?.configured||!hasData} onClick={()=>void run(defaultQuestion,!!result)}>{result?'重新分析':'生成画像解读'}</button>}<small>连接模型后，相关统计将发送给配置的模型服务；同范围未变化的结果在本次页面会话内复用30分钟。</small></div>
 <details><summary>补充关注点（可选）</summary><form onSubmit={e=>{e.preventDefault();if(question.trim())void run(question.trim(),true);}}><textarea aria-label="补充分析问题" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={2000} rows={2}/><button className="scale-button" disabled={busy||!status.data?.configured||!hasData||!question.trim()}>分析补充问题</button></form></details>
 </section>;
}
