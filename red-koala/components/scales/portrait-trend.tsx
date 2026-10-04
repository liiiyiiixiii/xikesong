"use client";
import TrendSummary from './trend-summary';
import { useState } from 'react';
import { ResponsiveContainer,LineChart,Line,XAxis,YAxis,Tooltip,CartesianGrid } from 'recharts';
import { trendPoints,summarizeTrend,type TrendSnapshot } from '@/lib/analysis/portrait-trend';
import { usePolling,Notice } from './shared';
export default function PortraitTrend({date,dishes,selected,onSelect}:{date:string;dishes:{dishId:string;name:string}[];selected:string;onSelect:(id:string)=>void}){
 const [days,setDays]=useState(7);
 const query=usePolling<{records:TrendSnapshot[]}>(`/api/intelligence/visual-trend?date=${date}&days=${days}`,60000);
 const id=dishes.some(d=>d.dishId===selected)?selected:dishes[0]?.dishId??'',name=dishes.find(d=>d.dishId===id)?.name;
 const points=trendPoints(query.data?.records??[],date,days,id),summary=summarizeTrend(points);
 return <section className="scale-panel"><div className="scale-section-heading"><div><h2>取用倾向趋势</h2></div></div>
 <div className="portrait-date-tabs" style={{flexWrap:'wrap'}}><label style={{minWidth:0,maxWidth:'100%'}}>菜品 <select style={{maxWidth:'100%',width:260}} aria-label="趋势菜品" value={id} onChange={e=>onSelect(e.target.value)}>{dishes.map(d=><option key={d.dishId} value={d.dishId}>{d.name}（{d.dishId}）</option>)}</select></label>{[7,28].map(n=><button key={n} aria-pressed={days===n} onClick={()=>setDays(n)}>近{n}天</button>)}</div>
 {query.error&&<Notice error>{query.error}</Notice>}
 {query.loading?<p>正在计算所选范围的趋势…</p>:<><p><strong>{name}</strong>{summary.change!==null&&<span> · {summary.change>=0?'+':''}{summary.change.toFixed(1)}个百分点</span>}</p><TrendSummary key={JSON.stringify([date,days,id,points])} date={date} days={days} dishId={id} fingerprint={JSON.stringify(points)}/><div style={{width:'100%',height:250,minWidth:0}}><ResponsiveContainer width="100%" height="100%"><LineChart data={points.map(p=>({...p,percent:p.share===null?null:p.share*100}))} margin={{top:12,right:20,bottom:8,left:0}}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date" tickFormatter={v=>v.slice(5)} minTickGap={22}/><YAxis unit="%" width={48} domain={[0,'auto']}/><Tooltip formatter={value=>[`${Number(value).toFixed(1)}%`,'估计取用重量占比']} labelFormatter={label=>`${label} · ${points.find(p=>p.date===label)?.origin==='reconstructed'?'历史补算':'当天保存'}`} /><Line type="linear" dataKey="percent" stroke="#286953" strokeWidth={3} dot={props=>{const {cx,cy,payload}=props;if(payload.percent===null)return <g key={payload.date}/>;return <circle key={payload.date} cx={cx} cy={cy} r={4} fill={payload.origin==='reconstructed'?'white':'#286953'} stroke="#286953" strokeWidth={2}/>;}} connectNulls={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div><small>实心点：当天保存 · 空心点：历史补算</small><details><summary>比较口径与缺失记录</summary><p>优先读取当天保存的画像，没有存档的日期现场补算，补算只使用该日期截止时已知的历史，不回填存档或调用 AI。历史补算不恢复当时的实时修正。只比较模型版本、参数和参与菜品一致的日期。缺失日期保留断点，不补零；变化数值为区间首尾差；文字趋势判断由 AI 生成。未检验统计显著性，也不表示持续上升或下降。</p>{points.filter(p=>p.reason).map(p=><small key={p.date} style={{display:'block'}}>{p.date} · {p.reason}</small>)}</details></>}
 </section>;
}
