"use client";
import { useState } from 'react';
import type { AnalysisResult } from '@/lib/analysis/contract';
import { Notice,usePolling } from './shared';
export default function RangeReport(){
 const query=usePolling<{result:AnalysisResult|null;scenario?:unknown;startDate?:string;endDate?:string;reason?:string;availableRange?:{startDate:string;endDate:string}|null}>('/api/intelligence/range-report',60000);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function generate(){if(busy||query.loading||query.error||!query.data?.availableRange)return;setBusy(true);setError('');try{const response=await fetch('/api/intelligence/range-report',{method:'POST'});const value=await response.json() as {error?:string};if(!response.ok)throw new Error(value.error??'生成失败');query.refresh();}catch(e){setError(e instanceof Error?e.message:'生成失败');}finally{setBusy(false);}}
 return <section className="scale-panel"><h2>{query.data?.startDate&&query.data.endDate?`${query.data.startDate} — ${query.data.endDate} · `:""}客群画像概览</h2><p className="scale-muted">综合所示日期范围内的取用行为。已生成的解读保存在服务器，刷新后可继续查看。</p>{query.data?.reason&&<Notice>{query.data.reason}</Notice>}{query.data?.scenario?<p className="scale-muted">模拟数据 · 非实际经营记录</p>:null}{error||query.error?<Notice error>{error||query.error}</Notice>:null}{query.data?.result?<><p className="intelligence-answer">{query.data.result.answer}</p><details><summary>分析依据</summary>{query.data.result.evidence.map(e=><details key={e.id}><summary>{e.id} · {e.title}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(e.data,null,2)}</pre></details>)}</details></>:<button className="scale-button" disabled={busy||query.loading||!!query.error||!query.data?.availableRange} onClick={()=>void generate()}>{busy?'正在生成…':'生成该时段综合画像'}</button>}</section>;
}
