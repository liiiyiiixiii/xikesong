"use client";
import { useState } from 'react';
import type { AnalysisResult } from '@/lib/analysis/contract';
import { Notice,usePolling } from './shared';
export default function RangeReport(){
 const query=usePolling<{result:AnalysisResult|null;scenario?:unknown}>('/api/intelligence/range-report',60000);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function generate(){setBusy(true);setError('');try{const response=await fetch('/api/intelligence/range-report',{method:'POST'});const value=await response.json() as {error?:string};if(!response.ok)throw new Error(value.error??'生成失败');query.refresh();}catch(e){setError(e instanceof Error?e.message:'生成失败');}finally{setBusy(false);}}
 return <section className="scale-panel"><h2>10月1日—4日 · 客群画像概览</h2><p className="scale-muted">仅综合这四天的取用行为，提供初步群体画像。已生成的解读保存在服务器，刷新不会重复消耗 Token。</p>{query.data?.scenario?<p className="scale-muted">模拟数据 · 非实际经营记录</p>:null}{error||query.error?<Notice error>{error||query.error}</Notice>:null}{query.data?.result?<><p className="intelligence-answer">{query.data.result.answer}</p><details><summary>分析依据</summary>{query.data.result.evidence.map(e=><details key={e.id}><summary>{e.id} · {e.title}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(e.data,null,2)}</pre></details>)}</details></>:<button className="scale-button" disabled={busy} onClick={()=>void generate()}>{busy?'正在生成…':'生成这四天的综合画像'}</button>}</section>;
}
