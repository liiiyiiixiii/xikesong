"use client";
import OverallPortrait from "./daily-portrait";
import { useState } from 'react';
import { RefreshCw,ChevronLeft,ChevronRight,ArrowLeft } from 'lucide-react';
import type { WeeklyPortrait } from '@/lib/analysis/weeks';
import { mondayOf } from '@/lib/analysis/weeks';
import { shiftDate } from '@/lib/preferences/types';
import { portraitFingerprint,PortraitCache } from '@/lib/analysis/view-model';
import type { AnalysisResult } from '@/lib/analysis/contract';
import { dateToday,Notice,usePolling } from './shared';
import AnalysisAssistant from './analysis-assistant';
import { PortraitVisuals } from './portrait-visuals';
import PortraitDetails from './portrait-details';
import ModelConnection from './model-connection';
const weekdays=['周一','周二','周三','周四','周五','周六','周日'];
export default function Intelligence(){
 const [overall,setOverall]=useState(true);
 const history=usePolling<{end:string;mode:string}>("/api/preferences/history",60000);
 const today=history.data?.mode==="scenario"?history.data.end:dateToday();
 const current=mondayOf(today);
 const [page,setPage]=useState(current),[week,setWeek]=useState<string|null>(null),[day,setDay]=useState<string|null>(null),[version,setVersion]=useState(0),[selected,setSelected]=useState<{id:string;nonce:number}|null>(null);
 const [cache]=useState(()=>new PortraitCache<AnalysisResult>());
 const query=usePolling<WeeklyPortrait>(week?`/api/intelligence/portrait?week=${week}`:null,60000),report=query.data;
 function open(value:string){setWeek(value);setDay(null);setSelected(null);}
 const scope=day??week;
 const frame=report?(day?report.daily.find(d=>d.date===day):report.current):null;
 const fingerprint=report?portraitFingerprint(report):'';
 if(overall)return <OverallPortrait cache={cache} connectionVersion={version} onConnectionChanged={()=>setVersion(v=>v+1)} onBack={()=>setOverall(false)}/>;
 return <section className="intelligence portrait-dashboard"><div className="scale-page-title"><div><span className="scale-eyebrow">群体取用行为</span><h1>历史画像</h1><p className="scale-muted">回看指定周和日期的数据，为当前画像提供依据。</p></div>{week&&<button className="scale-button" onClick={query.refresh}><RefreshCw size={15}/>刷新数据</button>}</div>
 {!week?<div className="portrait-entry-pair"><div className="compact-week-picker"><div className="compact-week-navigation"><button aria-label="上一周" onClick={()=>setPage(shiftDate(page,-7))}><ChevronLeft size={16}/>上一周</button><button aria-label="下一周" disabled={page>=current} onClick={()=>setPage(shiftDate(page,7))}>下一周<ChevronRight size={16}/></button></div><div className="week-library"><button onClick={()=>open(page)}><span>{page===current?'本周 · 进行中':'已结束'}</span><strong>{page} — {shiftDate(page,6)}</strong><small>周一至周日 · 查看画像 →</small></button></div></div><button className="overall-entry" onClick={()=>setOverall(true)}><span>主画像 · 动态估计</span><strong>当前客群画像</strong><small>返回当前估计 →</small></button></div>:<><button className="portrait-back" onClick={()=>setWeek(null)}><ArrowLeft size={16}/>返回选周</button><div className="week-detail-heading"><h2>{week} — {shiftDate(week,6)}</h2><span>{week===current?'本周进行中':'自然周汇总'} · 北京时间</span></div><div className="portrait-date-tabs" aria-label="画像范围"><button aria-pressed={!day} onClick={()=>{setDay(null);setSelected(null);}}>整周</button>{weekdays.map((label,i)=>{const date=shiftDate(week,i);return <button key={date} aria-pressed={day===date} disabled={date>today} onClick={()=>{setDay(date);setSelected(null);}}>{label}<small>{date.slice(5)}</small></button>;})}</div>
 {query.error&&<Notice error>{query.error}</Notice>}{query.loading&&<Notice>正在整理画像数据…</Notice>}
 {report&&frame&&scope&&<><p className="portrait-scope-note">{day??`${week} 至 ${report.weekEnd}`} · {frame.validSamples}个有效菜品日样本 · 覆盖 {(frame.coverage*100).toFixed(0)}%{(!day&&report.inProgress)||day===today?' · 统计未完结':''}</p><PortraitVisuals key={`visual:${week}:${day}`} report={report} day={day} onDish={id=>setSelected({id,nonce:Date.now()})}/><section className="scale-panel"><AnalysisAssistant key={`${scope}:${version}:${fingerprint}`} startDate={scope} endDate={day??(report.weekEnd>today?today:report.weekEnd)} cache={cache} fingerprint={fingerprint} connectionVersion={version} hasData={frame.dishInsights.some(d=>d.observedTakeG!==null)||(day?report.daily.find(d=>d.date===day)!.periods:report.periods).some(p=>p.totalG!==null)}/></section><PortraitDetails key={`details:${week}:${day}`} report={report} day={day} selected={selected}/></>}
 </>}
 <ModelConnection onChanged={()=>setVersion(v=>v+1)}/>
 </section>;
}
