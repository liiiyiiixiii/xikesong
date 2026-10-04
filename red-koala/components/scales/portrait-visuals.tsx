"use client";
import { useState } from 'react';
import type { WeeklyPortrait } from '@/lib/analysis/weeks';
import { tileWeights } from '@/lib/analysis/view-model';
import { weight } from './shared';
export const pct=(v:number|null|undefined)=>v==null?'—':`${(v*100).toFixed(1)}%`;
const colors=['#286953','#438368','#628d6b','#6d8262','#95784c','#aa815a','#537f83'];
export function PortraitVisuals({report,day,onDish}:{report:WeeklyPortrait;day:string|null;onDish:(id:string)=>void}) {
 const frame=day?report.daily.find(d=>d.date===day)!:report.current;
 const periods=day?report.daily.find(d=>d.date===day)!.periods:report.periods;
 const [period,setPeriod]=useState<number|null>(null),[search,setSearch]=useState(''),[focus,setFocus]=useState('');
 const rows=period==null?frame.distribution:periods[period].dishes;
 const tiles=tileWeights(rows.map(d=>({dishId:d.dishId,grams:d.grams})),0,0,100,60);
 const matches=frame.dishInsights.filter(d=>`${d.name} ${d.dishId}`.toLowerCase().includes(search.toLowerCase()));
 const changes=day?report.daily.find(d=>d.date===day)!.dailyChange.changes:report.comparisons[2].changes;
 const valid=changes.filter(d=>d.deltaPoints!=null),max=Math.max(1,...valid.map(d=>Math.abs(d.deltaPoints!)));
 const active=rows.find(d=>d.dishId===focus);
 const total=rows.reduce((s,d)=>s+d.grams,0);
 const missing=frame.dishInsights.filter(d=>!rows.some(r=>r.dishId===d.dishId&&(r.share??0)>0));
 return <div className="visual-portrait">
 <section className="scale-panel distribution-panel"><div className="scale-section-heading"><div><span className="scale-eyebrow">取用选择</span><h2>{period==null?'这些菜构成了本期取用画像':`${periods[period].name}的菜品取用分布`}</h2><p className="scale-muted">面积越大，取用重量占比越高；每一块代表一道具体菜。</p></div>{period!=null&&<button className="week-text-button" onClick={()=>setPeriod(null)}>返回全天有效样本</button>}</div>
 <div className="portrait-search"><label>定位菜品 <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索菜名或编号"/></label>{search&&<div className="portrait-search-results">{matches.map(d=><button key={d.dishId} onClick={()=>{setFocus(d.dishId);onDish(d.dishId);}}>{d.name} · {d.dishId}</button>)}{!matches.length&&<span>没有匹配菜品</span>}</div>}</div>
 <div className="dish-treemap" aria-label="全部菜品取用重量分布">{tiles.map((t,i)=>{const d=rows.find(d=>d.dishId===t.dishId)!;return <button key={t.dishId} className={focus===t.dishId?'focused':''} style={{left:`${t.x}%`,top:`${t.y/60*100}%`,width:`${t.width}%`,height:`${t.height/60*100}%`,background:colors[i%colors.length]}} title={`${d.name}（${d.dishId}） · ${pct(d.share)} · ${weight(d.grams)}`} aria-label={`${d.name} ${d.dishId}，${pct(d.share)}，查看依据`} onMouseEnter={()=>setFocus(d.dishId)} onFocus={()=>setFocus(d.dishId)} onClick={()=>onDish(d.dishId)}>{t.width>9&&t.height>6&&<><span>{d.name}</span><strong>{pct(d.share)}</strong></>}</button>;})}{!tiles.length&&<p className="treemap-empty">{total===0&&rows.length?'本期观测取用为零，无法计算分布。':'暂无可计算的取用记录。'}</p>}</div>
 <p className="tree-selection" aria-live="polite">{active?`${active.name}（${active.dishId}） · ${pct(active.share)} · ${weight(active.grams)} · ${'samples' in active?active.samples:active.days}天记录`:'悬停查看数值，点击菜品定位下方明细。'}</p>
 <p className="scale-muted">{period==null?'分母为本期全部供应充足、记录完整样本的取用重量。':'分母为该时段全部已观测取用重量，包含供应受限观测。'}这是重量构成，不是顾客人数或喜爱评分。</p>
 <details><summary>零取用或无法计算的菜品（{missing.length}）</summary><div className="portrait-search-results">{missing.map(d=><button key={d.dishId} onClick={()=>onDish(d.dishId)}>{d.name} · {rows.find(r=>r.dishId===d.dishId)?.grams===0?'零取用':'缺少可计算记录'}</button>)}</div></details>
 </section>
 <div className="portrait-visual-grid"><section className="scale-panel"><span className="scale-eyebrow">时段节奏</span><h2>取用发生在什么时候？</h2><p className="scale-muted">点击时段，上方图切换为该时段全部菜品。</p><div className="rhythm-chart">{periods.map(p=><button key={p.id} aria-pressed={period===p.id} onClick={()=>setPeriod(p.id)}><span>{weight(p.totalG)}</span><div><i style={{height:`${(p.totalG??0)/Math.max(1,...periods.map(v=>v.totalG??0))*100}%`}}/></div><strong>{p.name}</strong><small>{p.days}天记录</small></button>)}</div><p className="scale-muted">仅统计已观测重量，不代表客流高峰。缺少分钟记录时不推算。</p>{report.periodError&&<p role="alert">{report.periodError}</p>}</section>
 <section className="scale-panel"><span className="scale-eyebrow">结构变化</span><h2>{day?'与前一天相比':'与前一周相比'}</h2><p className="scale-muted">向右表示占比增加，向左表示减少；单位为百分点。</p><div className="change-chart">{valid.map(d=><button key={d.dishId} onClick={()=>onDish(d.dishId)}><span>{d.name}<small>{d.dishId}</small></span><div><i style={{left:`${d.deltaPoints!<0?50-Math.abs(d.deltaPoints!)/max*50:50}%`,width:`${Math.abs(d.deltaPoints!)/max*50}%`,background:d.deltaPoints!<0?'#aa815a':'#438368'}}/></div><b>{d.deltaPoints!>=0?'+':''}{d.deltaPoints!.toFixed(1)}</b></button>)}{!valid.length&&<p>暂无可比数据。</p>}</div><details><summary>{frame.dishInsights.length-valid.length} 道菜不可比较 · 查看依据</summary><p>{day?'两天需有共同有效菜品且取用总量大于零。':'限定相同星期、共同有效菜品，每道菜至少三个配对日期且两期总量大于零。'}缺失不按零计算。</p><div className="portrait-search-results">{frame.dishInsights.filter(d=>!valid.some(v=>v.dishId===d.dishId)).map(d=><button key={d.dishId} onClick={()=>onDish(d.dishId)}>{d.name} · 配对样本不足或分母为零</button>)}</div></details></section></div>
 </div>;
}
