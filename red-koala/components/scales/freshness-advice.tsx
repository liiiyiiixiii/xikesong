'use client';
import { useState } from 'react';
import type { FreshnessView,SupplySuggestion } from '@/lib/freshness/model';
import { DecisionForm } from './freshness';
import { usePolling,Notice,weight } from './shared';
export function useSupplyFeedback(startDate?:string,endDate?:string){
 const params=new URLSearchParams({mode:'feedback'});if(startDate&&endDate){params.set('startDate',startDate);params.set('endDate',endDate);}
 return usePolling<FreshnessView>('/api/freshness?'+params.toString(),60000);
}
export type SupplyFeedbackQuery=ReturnType<typeof useSupplyFeedback>;
export function SupplyHint({dishId,query}:{dishId:string;query:SupplyFeedbackQuery}){
 if(query.error)return null;
 const suggestions=query.data?.suggestions.filter(s=>s.dishId===dishId&&s.level!=='observe')??[];
 return suggestions.length?<small className="fresh-advice-hint">{suggestions.some(s=>s.level==='review_pause')?'有供应调整建议':'有减量建议'}</small>:null;
}
export function DishSupplyAdvice({dishId,query,historical=false}:{dishId:string;query:SupplyFeedbackQuery;historical?:boolean}){
 const [selected,setSelected]=useState<SupplySuggestion|null>(null);
 if(query.error)return <Notice>供应反馈暂不可用，上方原有分析仍可查看。</Notice>;
 if(query.loading)return <p className="scale-muted">正在读取该菜供应反馈…</p>;
 const suggestions=query.data?.suggestions.filter(s=>s.dishId===dishId)??[],decisions=query.data?.decisions.filter(d=>d.dishId===dishId)??[];
 if(!suggestions.length&&!decisions.length)return null;
 return <div className="fresh-inline-advice"><p className="scale-muted">{historical?'所选历史范围内的供应反馈':'最近30天的供应反馈'} · 不改变上方画像与预测口径</p>{suggestions.map(s=><div key={s.period}><p><strong>{s.period}：</strong>{s.message}</p><details><summary>查看超时剩余依据 · {s.batches} 批次</summary><p>{s.usableBatches} 个可比较批次 · {s.affectedDays} 个营业日超时剩余较多 · 批次报损 {weight(s.wasteG)}</p><ul>{query.data!.feedback.filter(b=>s.evidenceIds.includes(b.id)).map(b=><li key={b.id}>{new Date(b.startedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · {b.scaleId} · 撤下 {weight(b.remainingG)} · 已观测取用 {weight(b.observedTakeG)} · {b.quality==='usable'?'可比较':'观测不完整'}</li>)}</ul><p>一次超时不代表无人需要；还需结合上方取用趋势与供应情况。未接入客流，不能直接归因。</p></details>{!historical&&<button className="scale-text-button" onClick={()=>setSelected(s)}>记录供应安排</button>}</div>)}{decisions.length>0&&<details><summary>{historical?'当时已记录':'已记录'}的供应安排</summary>{decisions.map(d=><p key={d.id}>{d.period} · {d.note}<small> {new Date(d.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</small></p>)}</details>}{selected&&<DecisionForm suggestion={selected} onClose={()=>setSelected(null)} onDone={query.refresh} disconnected={!!query.error}/>}</div>;
}
