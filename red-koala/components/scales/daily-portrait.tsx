"use client";
import { useEffect,useRef,useState } from 'react';
import type { DailyVisual } from '@/lib/analysis/daily-visual';
import type { AnalysisResult } from '@/lib/analysis/contract';
import { tileWeights,type PortraitCache } from '@/lib/analysis/view-model';
import { usePolling,Notice,dateToday } from './shared';
import { pct } from './portrait-visuals';
import PortraitTrend from './portrait-trend';
import ModelConnection from './model-connection';
const colors=['#286953','#438368','#628d6b','#95784c','#aa815a','#537f83'];
type Props={cache:PortraitCache<AnalysisResult>;connectionVersion:number;onConnectionChanged:()=>void;onBack:()=>void};
export default function DailyPortrait({onConnectionChanged,onBack}:Props){
 const [today,setToday]=useState(dateToday),[selected,setSelected]=useState<string|null>(null),[search,setSearch]=useState(''),[focus,setFocus]=useState(''),[trendDish,setTrendDish]=useState(''),[error,setError]=useState('');
 const date=selected??today;
 const query=usePolling<{record:DailyVisual|null;dates:string[];pending:boolean}>(`/api/intelligence/daily-visual?date=${date}`,15000);
 const {data,refresh}=query;
 const attempted=useRef(new Set<string>());
 useEffect(()=>{const timer=setInterval(()=>setToday(dateToday()),60000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  if(date!==today||!data||data.record||data.pending||attempted.current.has(date))return;
  attempted.current.add(date);
  // The server owns generation; closing the page must not cancel the daily snapshot.
  void fetch('/api/intelligence/daily-visual',{method:'POST'}).then(async response=>{if(!response.ok)throw new Error('今日面板暂时无法生成，请稍后再查看');refresh();}).catch(e=>setError(e.message));
 },[date,today,data,refresh]);
 const saved=query.data?.record,r=saved?.profile;
 const dishes=r?.dishes??[],filtered=dishes.filter(d=>`${d.name} ${d.dishId}`.toLowerCase().includes(search.toLowerCase()));
 const tiles=tileWeights(dishes.map(d=>({dishId:d.dishId,grams:d.currentShare??0})),0,0,100,60),active=dishes.find(d=>d.dishId===focus);
 return <section className="intelligence portrait-dashboard"><div className="scale-page-title"><div><span className="scale-eyebrow">每日一份 · 保存后直接查看</span><h1>客群画像</h1></div><label>画像日期 <select aria-label="画像日期" value={date} onChange={e=>{setSelected(e.target.value===today?null:e.target.value);setFocus('');setSearch('');}}>{[...new Set([today,...query.data?.dates??[]])].sort().reverse().map(d=><option key={d} value={d}>{d}</option>)}</select></label></div>
 {query.error||error?<Notice error>{query.error||error}</Notice>:null}
 {!saved&&<Notice>{query.data?(date!==today?'该日没有保存的面板。':'今日面板首次生成中，完成后会自动保存…'):'正在读取已保存的面板…'}</Notice>}
 {saved&&<section className="scale-panel"><div className="scale-section-heading"><div><h2>{saved.copy?.headline??'菜品取用倾向'}</h2><p className="scale-muted">{saved.simulation?'模拟数据 · ':''}面积表示模型估计取用重量占比，不是人数比例或喜爱评分。</p></div><small>{saved.date} · 已保存</small></div>
 <div className="portrait-search"><label>查找菜品 <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="输入菜名或编号"/></label>{search&&<div className="portrait-search-results">{filtered.map(d=><button key={d.dishId} onClick={()=>{setFocus(d.dishId);setTrendDish(d.dishId);}}>{d.name} · {pct(d.currentShare)}</button>)}</div>}</div>
 <div className="dish-treemap" aria-label="每日客群画像">{tiles.map((t,i)=>{const d=dishes.find(d=>d.dishId===t.dishId)!;return <button key={d.dishId} className={focus===d.dishId?'focused':''} style={{left:`${t.x}%`,top:`${t.y/60*100}%`,width:`${t.width}%`,height:`${t.height/60*100}%`,background:colors[i%colors.length]}} onMouseEnter={()=>setFocus(d.dishId)} onFocus={()=>setFocus(d.dishId)} onClick={()=>{setFocus(d.dishId);setTrendDish(d.dishId);}} title={`${d.name}（${d.dishId}） ${pct(d.currentShare)}`} aria-label={`${d.name} ${pct(d.currentShare)}`}>{t.width>8&&t.height>7&&<><span>{d.name}</span><strong>{pct(d.currentShare)}</strong></>}</button>;})}{!tiles.length&&<p className="treemap-empty">有效样本不足，暂时无法估计分布。</p>}</div>
 <p className="tree-selection" aria-live="polite">{active?`${active.name}（${active.dishId}） · ${pct(active.currentShare)} · ${active.samples}个有效日期${saved.copy?.notes.find(n=>n.dishId===active.dishId)?' · '+saved.copy.notes.find(n=>n.dishId===active.dishId)!.text:''}`:'悬停或点击菜品，查看取用特征。'}</p>
 {saved.status==='generating'&&<small>数值面板已保存，AI 正在生成简短提示…</small>}{saved.error&&<small>{saved.error}</small>}
 <details><summary>样本与模型依据</summary><p>模型范围：{r!.startDate} — {r!.endDate}；数据截止：{new Date(r!.asOf).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}。</p><p>{r!.modeledCount}道菜参与占比，{r!.learningCount}道菜学习中；每天首次生成后保持不变。</p><p>{r!.method}</p><p>AI 生成标题和菜品提示；面积与占比直接读取数值模型。</p>{dishes.filter(d=>!d.currentShare).map(d=><p key={d.dishId}>{d.name}（{d.dishId}） · {d.currentShare===0?'估计零取用':d.status}</p>)}</details></section>}
 {saved&&<PortraitTrend date={date} dishes={dishes} selected={trendDish} onSelect={id=>{setFocus(id);setTrendDish(id);}}/>}
 <button className="portrait-back" onClick={onBack}>查看历史周／日数据</button>
 <details><summary>模型连接设置</summary><ModelConnection onChanged={onConnectionChanged}/></details></section>;
}
