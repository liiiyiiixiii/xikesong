'use client';
import { useState } from 'react';
import { useFreshness,FreshnessSound } from './freshness-state';
import { FreshnessActionForm,timerText } from './freshness';
import { RealtimeDialog } from './realtime-dialog';
import type { FreshnessTimer } from '@/lib/freshness/model';
import { Notice } from './shared';
export function KitchenFreshness(){
 const state=useFreshness(),[open,setOpen]=useState(false),[selected,setSelected]=useState<FreshnessTimer|null>(null);
 const rank={overdue:0,soon:1,unknown:2,running:3,waiting:4};
 const alerts=state.timers.filter(t=>['soon','overdue','unknown'].includes(t.status)).sort((a,b)=>rank[a.status]-rank[b.status]||String(a.batch?.deadlineAt).localeCompare(String(b.batch?.deadlineAt)));
 if(!alerts.length&&!state.error)return null;
 return <><div className="fresh-kitchen-strip" role="status"><button className="scale-text-button" onClick={()=>setOpen(true)}>{state.error?'更换提醒暂不可用':`${alerts[0].name} · ${timerText(alerts[0],state.now)}${alerts.length>1?` · 共${alerts.length}碗需关注`:''}`} <span>查看处理 →</span></button><FreshnessSound/></div>
 {open&&<RealtimeDialog drawer title="需要关注的碗位" onClose={()=>setOpen(false)}>{state.error&&<Notice error>提醒连接中断，上次保存时间仅供核对；原有余量显示继续工作。</Notice>}<div className="fresh-timer-list">{alerts.map(t=><div key={t.scaleId}><strong>{t.name} · {t.scaleId}</strong><p>{timerText(t,state.now)}</p><button className="scale-button secondary small" disabled={!!state.error} onClick={()=>setSelected(t)}>{t.batch?'撤下 / 换新盘':'登记上盘'}</button></div>)}</div></RealtimeDialog>}
 {selected&&<FreshnessActionForm key={selected.batch?.id??selected.scaleId} timer={selected} onClose={()=>setSelected(null)} onDone={state.refresh} disconnected={!!state.error}/>}</>;
}
