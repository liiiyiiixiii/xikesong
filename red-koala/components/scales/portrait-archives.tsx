"use client";
import { useState } from 'react';
import type { ArchiveSummary } from '@/lib/analysis/archive-types';
import { usePolling,Notice } from './shared';
export default function PortraitArchives({onSelect}:{onSelect:(id:string)=>void}){
 const [before,setBefore]=useState<string|null>(null);
 const query=usePolling<{items:ArchiveSummary[];next:string|null}>(`/api/intelligence/archives${before?'?before='+encodeURIComponent(before):''}`,60000);
 return <details className="scale-panel"><summary>每日画像档案</summary><p className="scale-muted">当前仅显示10月1日至4日。已改为按需生成，不再后台自动调用 AI。10月1日至4日保留数值画像；每日解读点击后才生成。历史补算标注实际生成时间。</p>{query.error&&<Notice error>{query.error}</Notice>}{!query.data&&query.loading&&<p>正在读取档案…</p>}{query.data?.items.length===0&&<p>暂无每日档案，生成后会出现在这里。</p>}<div className="portrait-search-results">{query.data?.items.map(item=><button key={item.id} onClick={()=>onSelect(item.id)}>{item.date} · {item.scenario?'模拟数据':'经营数据'}{item.late?' · 延迟补存':''} · {item.status==='complete'?'含 AI 解读':item.status==='pending'?'解读未生成':'数值已保存'}</button>)}</div><div className="auto-analysis-actions">{before&&<button className="week-text-button" onClick={()=>setBefore(null)}>返回最新</button>}{query.data?.next&&<button className="week-text-button" onClick={()=>setBefore(query.data!.next)}>更早档案</button>}</div></details>;
}
