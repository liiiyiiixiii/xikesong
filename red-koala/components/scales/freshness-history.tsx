'use client';
import type { FreshnessView } from '@/lib/freshness/model';
import { usePolling,weight,Notice } from './shared';
import { RealtimeDialog } from './realtime-dialog';
const when=(at:string)=>new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const reasons:Record<string,string>={display_age:'放置过久',closing:'闭店撤下',other:'其他'};
export function RemovalDetails({date,dishId,name,onClose}:{date:string;dishId?:string;name?:string;onClose:()=>void}){
 const query=usePolling<FreshnessView>('/api/freshness?date='+date,30000);
 const rows=query.data?.removals?.filter(r=>!dishId||r.dishId===dishId)??[];
 return <RealtimeDialog drawer title={`${name??'全部菜品'} · 撤下明细`} description={`${date} · 北京时间 · 与当日报损使用同一套重量记录`} onClose={onClose}>
  {query.error?<Notice error>撤下明细暂不可用，原有统计仍可查看。</Notice>:query.loading?<Notice>正在读取撤下记录…</Notice>:<>{!rows.length&&<p className="scale-muted">该日期没有可追溯的撤下记录；历史汇总若有报损，不代表已有批次依据。</p>}<ul className="fresh-history">{rows.map(r=><li key={r.id}><strong>{r.name} · {r.scaleId}</strong><p>{r.disposition==='waste'?'报损':'撤下保留'} {weight(r.weightG)} · {reasons[r.reason??'']??'原因未记录'}{r.scope==='partial'?' · 部分撤下':r.scope==='full'?' · 整盘撤下':''}</p><small>撤下 {when(r.at)}</small><small>{r.startedAt?`上台 ${when(r.startedAt)}`:'旧记录未关联批次，上台时间未知'}</small></li>)}</ul><p className="scale-muted">撤下保留不计入报损；同一笔重量只计一次。</p></>}
 </RealtimeDialog>;
}
