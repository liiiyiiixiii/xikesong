"use client";
import { useState } from 'react';
import type { ArchiveSummary } from '@/lib/analysis/archive-types';
import { usePolling,Notice } from './shared';
import SnapshotNotice from './snapshot-notice';
export default function PortraitArchives({onSelect,open=false}:{onSelect:(id:string)=>void;open?:boolean}){
 const [before,setBefore]=useState<string|null>(null);
 const query=usePolling<{items:ArchiveSummary[];next:string|null;availableRange?:{startDate:string;endDate:string}|null}>(`/api/intelligence/archives${before?'?before='+encodeURIComponent(before):''}`,60000);
 return <details className="scale-panel" open={open}><summary>每日画像档案</summary><p className="scale-muted">展示当前数据来源的已保存画像。每日解读按需生成，历史补算标注实际生成时间。</p>{query.data?.availableRange&&<p className="scale-muted">可用日期：{query.data.availableRange.startDate} — {query.data.availableRange.endDate}</p>}{query.error&&<Notice error>{query.error}</Notice>}{!query.data&&query.loading&&<p>正在读取档案…</p>}{query.data?.items.length===0&&<p>暂无每日档案，生成后会出现在这里。</p>}<div className="portrait-search-results">{query.data?.items.map(item=><div key={item.id}><button onClick={()=>onSelect(item.id)}>{item.date} · v{item.archiveVersion??1} · {item.scenario?'模拟数据':'经营数据'}{item.late?' · 延迟补存':''} · {item.status==='complete'?'含 AI 解读':item.status==='pending'?'解读未生成':'数值已保存'}</button><SnapshotNotice snapshot={item.snapshot}/></div>)}</div><div className="auto-analysis-actions">{before&&<button className="week-text-button" onClick={()=>setBefore(null)}>返回最新</button>}{query.data?.next&&<button className="week-text-button" onClick={()=>setBefore(query.data!.next)}>更早档案</button>}</div></details>;
}
