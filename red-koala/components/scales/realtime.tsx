"use client";
import type { FreshnessTimer } from "@/lib/freshness/model";
import { timerText,FreshnessActionForm } from "./freshness";
import { useFreshness } from "./freshness-state";
import { bowlCards } from "./bowl-view";

import { useEffect, useRef, useState } from "react";
import { WifiOff, AlertCircle, Plus, Search, ArrowUpRight } from "lucide-react";
import type { DishRealtime, Realtime, Source, WeightEvent } from "@/lib/scales/types";
import { clockTime, Notice, request, Sparkline, weight } from "./shared";
import { RealtimeDialog } from "./realtime-dialog";
import "./realtime.css";

function changeWeight(value: number) { return `${value >= 0 ? "减少" : "增加"} ${weight(Math.abs(value))}`; }
const statusText = { okay: "余量充足", low: "余量偏低", empty: "已空碗", offline: "设备离线", partial: "数据不足", anomaly: "称重异常" };
const scaleStatus = { active: "正常", empty: "空碗", removed: "碗已取下", offline: "离线", unstable: "等待稳定", anomaly: "异常" };
type Filter = "all" | "low" | "empty" | "issues" | "due";
const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "全部碗位" }, { key: "low", label: "余量偏低" },
  { key: "empty", label: "空碗" }, { key: "issues", label: "设备 / 数据异常" },
];
function available(dish: DishRealtime, disconnected: boolean) {
  return !disconnected && !["offline", "partial", "anomaly"].includes(dish.status)
    && dish.percent != null && Number.isFinite(dish.percent) && dish.remainingG != null;
}
function matches(dish: DishRealtime, filter: Filter, timer?:FreshnessTimer) {
  if(filter==="due")return timer?.status==="overdue";
  return filter === "all" || (filter === "issues" ? ["offline", "partial", "anomaly"].includes(dish.status) : dish.status === filter);
}
function Meter({ dish, valid }: { dish: DishRealtime; valid: boolean }) {
  return <span className={`live-meter${valid ? "" : " is-unavailable"}`} aria-hidden="true">
    {valid && <span style={{ width: `${Math.max(0, Math.min(100, dish.percent!))}%` }} />}
  </span>;
}
function DishCard({ dish, disconnected, onOpen, timer }: { timer?:FreshnessTimer; dish: DishRealtime; disconnected: boolean; onOpen: () => void }) {
  const {now}=useFreshness();
  const valid = available(dish, disconnected);
  const status = disconnected ? "offline" : dish.status;
  const label = disconnected ? "连接中断" : statusText[status];
  return <button type="button" className={`live-dish status-${status}`} onClick={onOpen}
    aria-haspopup="dialog" aria-label={`${dish.name}，${label}，剩余 ${valid ? `${Math.round(dish.percent!)}%，${weight(dish.remainingG)}` : "未知"}，查看详情`}>
    <span className="live-dish-name" title={dish.name}>{dish.name}</span>
    <span className="live-dish-amount"><strong>{valid ? Math.round(dish.percent!) : "—"}{valid && <small>%</small>}</strong><span>{valid ? weight(dish.remainingG) : "—"}</span></span>
    {timer&&["soon","overdue","unknown"].includes(timer.status)&&<span className={`fresh-card-badge fresh-${timer.status}`} title={timerText(timer,now)}>{timer.status==="overdue"?"已到更换时间":timer.status==="unknown"?"时间待核实":`${Math.max(1,Math.ceil((Date.parse(timer.batch!.deadlineAt)-Date.parse(now))/60000))}分钟后更换`}</span>}
    <Meter dish={dish} valid={valid} />
    <span className="live-dish-status"><span><i />{label}</span>{valid && dish.overfull && <span className="live-overfull">超量</span>}</span>
  </button>;
}
function DishDetails({ dish, disconnected, selectedScale,onAction }: { dish: DishRealtime; disconnected: boolean; selectedScale:string|null;onAction:(timer:FreshnessTimer)=>void }) {
  const freshness=useFreshness();
  useEffect(()=>{if(selectedScale)document.getElementById('bowl-detail-'+selectedScale)?.scrollIntoView({block:'nearest'});},[selectedScale]);
  const valid = available(dish, disconnected);
  return <div className={`live-details status-${disconnected ? "offline" : dish.status}`}>
    {disconnected && <Notice error>连接中断，实时数据暂不可用。正在重新连接。</Notice>}
    <section className="live-detail-summary">
      <span className="live-detail-status">{disconnected ? "连接中断" : statusText[dish.status]}</span>
      <div className="live-detail-amount"><strong>{valid ? `${Math.round(dish.percent!)}%` : "—"}</strong><span>剩余 {valid ? weight(dish.remainingG) : "—"}</span></div>
    <Meter dish={dish} valid={valid} />
      <p>标准满量 {weight(dish.fullG)}{valid && dish.overfull && <span className="live-overfull"> · 超过标准满量</span>}</p>
    </section>
    <section className="live-detail-section">
      <h3>取用趋势 <span>近 30 分钟</span></h3>
      <p className="live-detail-rate">近 5 分钟取用速率<strong>{disconnected ? "—" : dish.rateGPerMinute == null ? "数据不足" : `${weight(dish.rateGPerMinute)} / 分`}</strong></p>
      {disconnected ? <p className="live-detail-note">恢复连接后显示趋势</p> : <>
        <Sparkline values={dish.trend.map(t => t.coverage >= .6 ? t.takeG : null)} label={`${dish.name}最近三十分钟取用趋势`} large />
        <p className="live-detail-note">每分钟取用重量 · 数据不足的时段留空</p>
      </>}
    </section>
    <section className="live-detail-section">
      <h3>碗与设备 <span>{dish.scales.length} 个碗</span></h3>
      <div className="live-bowls">{dish.scales.map(scale => {const timer=freshness.timers.find(t=>t.scaleId===scale.id);return <div id={"bowl-detail-"+scale.id} className={selectedScale===scale.id?"fresh-selected-bowl":""} key={scale.id}>
        <span><strong>{scale.id}</strong><small>{disconnected ? "连接中断" : scaleStatus[scale.status]}</small></span>
        <span><strong>{disconnected || ["offline", "anomaly", "unstable", "removed"].includes(scale.status) ? "—" : weight(scale.netG)}</strong><small>满量 {weight(scale.fullG)}</small></span>
        {timer&&<div className="fresh-bowl-time"><span>{timerText(timer,freshness.now)}</span>{timer.batch&&<small>上台 {clockTime(timer.batch.startedAt)} · 截止 {clockTime(timer.batch.deadlineAt)}</small>}<button className="scale-button secondary small" disabled={!!freshness.error||disconnected} onClick={()=>onAction(timer)}>{timer.batch?'撤下 / 换新盘':'登记上盘'}</button></div>}
      </div>;})}</div>
    </section>
  </div>;
}

function Resolve({event,source,onClose,onDone,disconnected}:{event:WeightEvent;source:Source;onClose:()=>void;onDone:()=>void;disconnected:boolean}) {const freshness=useFreshness(),timer=freshness.timers.find(t=>t.scaleId===event.scaleId);const [handling,setHandling]=useState(false);const [disposition,setDisposition]=useState<"waste"|"retain"|"correction">(event.weightG>0?"waste":"correction"),[reason,setReason]=useState("display_age"),[busy,setBusy]=useState(false),[error,setError]=useState("");async function submit(){if(disconnected)return;if(disposition!=="correction"&&timer?.batch){setHandling(true);return;}setBusy(true);setError("");try{await request("/api/scales/actions",{source,action:"resolve",eventId:event.id,disposition,reason});onDone();onClose();}catch(e){setError(e instanceof Error?e.message:"处理失败");}finally{setBusy(false);}}if(handling&&timer)return <FreshnessActionForm timer={timer} eventId={event.id} initialWeight={event.weightG} initialDisposition={disposition==="retain"?"retain":"waste"} initialReason={reason} disconnected={disconnected||!!freshness.error} onClose={onClose} onDone={onDone}/>;return <RealtimeDialog title="确认重量变化" onClose={onClose}><p className="scale-muted">{event.scaleId} · {clockTime(event.at)} · {changeWeight(event.weightG)}</p><p>这次变化发生在碗离开秤或称重中断期间，请确认用途。</p><div className="scale-choice-row">{([["waste","已丢弃"],["retain","撤下保留"],["correction","换碗 / 校正"]] as const).filter(([value])=>event.weightG>0||value==="correction").map(([value,label])=><button className={disposition===value?"selected":""} key={value} onClick={()=>setDisposition(value)}>{label}</button>)}</div>{disposition==="waste"&&<label className="scale-field">报损原因<select value={reason} onChange={e=>setReason(e.target.value)}><option value="display_age">放置过久</option><option value="closing">当日剩余</option><option value="other">其他</option></select></label>}{disconnected&&<Notice error>连接中断，恢复后才能提交。</Notice>}{error&&<Notice error>{error}</Notice>}<div className="scale-modal-actions"><button className="scale-button secondary" onClick={onClose}>取消</button><button className="scale-button" disabled={busy||disconnected||(disposition!=="correction"&&!!timer?.batch&&!!freshness.error)} onClick={()=>void submit()}>{busy?"保存中…":"确认处理"}</button></div></RealtimeDialog>;}
function ManualReport({source,data,onClose,onDone,disconnected,onTimed}:{source:Source;data:Realtime;onClose:()=>void;onDone:()=>void;disconnected:boolean;onTimed:(timer:FreshnessTimer)=>void}) {const freshness=useFreshness();const requestId=useRef("");const scales=data.dishes.flatMap(d=>d.scales),[scaleId,setScaleId]=useState(scales[0]?.id??""),[amount,setAmount]=useState(""),[disposition,setDisposition]=useState("waste"),[reason,setReason]=useState("display_age"),[busy,setBusy]=useState(false),[error,setError]=useState("");async function submit(e:React.FormEvent){e.preventDefault();if(disconnected)return;setBusy(true);setError("");try{await request("/api/scales/actions",{source,action:"manual",requestId:requestId.current||(requestId.current=crypto.randomUUID()),scaleId,weightG:Number(amount),disposition,reason});onDone();onClose();}catch(e){setError(e instanceof Error?e.message:"记录失败");}finally{setBusy(false);}}const timer=freshness.timers.find(t=>t.scaleId===scaleId);if(timer?.batch)return <RealtimeDialog title="记录撤下" onClose={onClose}><label className="scale-field">菜品与秤<select value={scaleId} onChange={e=>setScaleId(e.target.value)}>{scales.map(s=><option value={s.id} key={s.id}>{s.dishName} · {s.id}</option>)}</select></label><p>此碗正在计时，可登记部分撤下或结束整盘批次。</p><button className="scale-button" disabled={disconnected||!!freshness.error} onClick={()=>onTimed(timer)}>继续处理此碗</button></RealtimeDialog>;return <RealtimeDialog title="记录撤下" onClose={onClose}><form onSubmit={submit} onChange={()=>{requestId.current="";}}><label className="scale-field">菜品与秤<select value={scaleId} onChange={e=>setScaleId(e.target.value)} required>{scales.map(s=><option value={s.id} key={s.id}>{s.dishName} · {s.id}</option>)}</select></label><label className="scale-field">撤下重量（克）<input type="number" min="1" max="100000" step="1" value={amount} onChange={e=>setAmount(e.target.value)} required/></label><div className="scale-choice-row"><button type="button" className={disposition==="waste"?"selected":""} onClick={()=>{setDisposition("waste");requestId.current="";}}>已丢弃</button><button type="button" className={disposition==="retain"?"selected":""} onClick={()=>{setDisposition("retain");requestId.current="";}}>撤下保留</button></div>{disposition==="waste"&&<label className="scale-field">报损原因<select value={reason} onChange={e=>setReason(e.target.value)}><option value="display_age">放置过久</option><option value="closing">当日剩余</option><option value="other">其他</option></select></label>}<p className="scale-muted">存在待确认变化时，会替换对应记录。</p>{disconnected&&<Notice error>连接中断，恢复后才能提交。</Notice>}{error&&<Notice error>{error}</Notice>}<div className="scale-modal-actions"><button type="button" className="scale-button secondary" onClick={onClose}>取消</button><button className="scale-button" disabled={busy||disconnected||!scales.length}>{busy?"保存中…":"保存记录"}</button></div></form></RealtimeDialog>;}

export default function RealtimePanel({ data, error, loading, source, onSettings, onRefresh, dueFilter=0 }: { dueFilter?:number;
  data?: Realtime; error?: string; loading: boolean; source: Source; onSettings: () => void; onRefresh: () => void;
}) {
  const freshness=useFreshness(),timers=freshness.timers;
  const [selectedScale,setSelectedScale]=useState<string|null>(null),[action,setAction]=useState<FreshnessTimer|null>(null),[previousDue,setPreviousDue]=useState(dueFilter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [event, setEvent] = useState<WeightEvent | null>(null);
  const [report, setReport] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(dueFilter?"due":"all");
  if(previousDue!==dueFilter){setPreviousDue(dueFilter);setFilter(dueFilter?"due":"all");setQuery("");}
  const disconnected = !!error;
  const groupedDishes = data?.dishes ?? [];
  const dishes = bowlCards(groupedDishes);
  const pending = data?.pending ?? [];
  const selected = groupedDishes.find(dish => dish.id === selectedId);
  const needle = query.trim().toLocaleLowerCase();
  // During an outage no stale status may hide a dish or look like a current count.
  const activeFilter = (disconnected||filter==="due"&&freshness.error) ? "all" : filter;
  const visible = dishes.filter(dish => matches(dish, activeFilter, timers.find(t=>t.scaleId===dish.scales[0]?.id)) && dish.name.toLocaleLowerCase().includes(needle));
  const clearFilters = () => { setQuery(""); setFilter("all"); };
  return <div className="live-panel">
    <section className="live-toolbar" aria-label="实时菜品工具栏">
      <div className="live-heading"><h1>实时菜品</h1><span className={`connection-status ${disconnected ? "disconnected" : ""}`}>
        {disconnected ? <WifiOff size={14} /> : <span />}{disconnected ? "连接中断 · 正在重连" : loading ? "正在连接" : `${data?.scenario?`数据集回放 ${data.at.slice(0,10)} · `:data?.simulation?.enabled?"数据模拟 · ":""}更新于 ${clockTime(data?.at)}`}
      </span></div>
      <div className="live-toolbar-actions">
        <label className="live-search"><Search size={16} /><input type="search" aria-label="搜索菜品" placeholder="搜索菜品" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <button className="scale-button secondary small" onClick={() => setReport(true)} disabled={!dishes.length || disconnected || !!data?.scenario}><Plus size={15} />记录撤下</button>
      </div>
    </section>
    {freshness.error&&<p className="live-connection-notice" role="status">时限提醒暂不可用；上次记录仅供核对，原有余量与趋势继续更新。</p>}
    {activeFilter==='due'&&<p className="fresh-filter-note">正在查看已到更换时间的碗位 <button className="scale-text-button" onClick={clearFilters}>显示全部</button></p>}
    <section className="live-summary" aria-label="菜品状态筛选">
      <div className="live-filters">{filters.map(item => <button key={item.key} type="button" className={`live-filter filter-${item.key}`} aria-pressed={activeFilter === item.key} disabled={(disconnected || loading) && item.key !== "all"} onClick={() => setFilter(item.key)}>
        <i />{item.label}<strong>{disconnected || loading ? "—" : dishes.filter(dish => matches(dish, item.key)).length}</strong>
      </button>)}</div>
      <button className="live-pending-button" onClick={() => setPendingOpen(true)} disabled={disconnected || loading} aria-haspopup="dialog"><AlertCircle size={15} />待确认<strong>{disconnected || loading ? "—" : pending.length}</strong><ArrowUpRight size={14} /></button>
    </section>
    {disconnected && <p className="live-connection-notice" role="alert">余量与状态暂不可用，恢复连接后自动更新。</p>}
    {dishes.length ? visible.length ? <div className="live-matrix" aria-label="实时菜品矩阵">{visible.map(dish => <DishCard timer={timers?.find(t=>t.scaleId===dish.scales[0]?.id)} key={dish.id} dish={dish} disconnected={disconnected} onOpen={() => {setSelectedId(dish.scales[0]?.dishId ?? dish.id);setSelectedScale(dish.scales[0]?.id??null);}} />)}</div>
      : <div className="live-empty"><h2>没有符合条件的菜品</h2><p>试试其他菜名或状态。</p><button className="scale-button secondary" onClick={clearFilters}>清除筛选</button></div>
      : <div className="live-empty"><h2>{loading ? "正在读取设备" : disconnected ? "暂时无法读取菜品" : "还没有菜品上台"}</h2><p>{loading ? "连接后自动显示实时余量。" : disconnected ? "正在重新连接，请稍候。" : "先添加秤，绑定菜品并设置皮重与标准满量。"}</p>{!loading && !disconnected && <button className="scale-button" onClick={onSettings}>配置设备与菜品</button>}</div>}
    {!!dishes.length && <p className="live-matrix-note">显示 {visible.length} / {dishes.length} 个碗 · {groupedDishes.length} 种菜品<span>点击菜品查看趋势与各碗明细</span></p>}
    {selectedId && <RealtimeDialog drawer title={selected?.name ?? "菜品详情"} description="实时余量、取用趋势与设备状态" onClose={() => setSelectedId(null)}>
      {selected ? <DishDetails dish={selected} selectedScale={selectedScale} onAction={setAction} disconnected={disconnected} /> : <p className="live-detail-note">该菜品已不在当前供菜列表中。</p>}
    </RealtimeDialog>}
    {pendingOpen && <RealtimeDialog drawer title="待确认重量变化" description="碗取下或重新放回后，请逐项确认重量变化的用途。" onClose={() => { setPendingOpen(false); setEvent(null); }}>
      {disconnected ? <Notice error>连接中断，恢复后显示待确认记录。</Notice> : pending.length ? <div className="live-pending-list">{pending.map(item => <div key={item.id}>
        <div><strong>{groupedDishes.find(dish => dish.id === item.dishId)?.name ?? item.scaleId}</strong><small>{item.scaleId} · {clockTime(item.at)}</small><span>{changeWeight(item.weightG)}</span></div>
        <button className="scale-button secondary small" onClick={() => setEvent(item)}>处理</button>
      </div>)}</div> : <div className="live-empty"><h2>暂无待确认记录</h2><p>新的重量变化将在这里显示。</p></div>}
      {event && <Resolve key={event.id} event={event} source={source} disconnected={disconnected} onClose={() => setEvent(null)} onDone={onRefresh} />}
    </RealtimeDialog>}
    {action&&<FreshnessActionForm key={action.batch?.id??action.scaleId} timer={action} disconnected={!!freshness.error||disconnected} onClose={()=>setAction(null)} onDone={onRefresh}/> }
    {report && data && <ManualReport onTimed={timer=>{setReport(false);setAction(timer);}} source={source} data={data} disconnected={disconnected} onClose={() => setReport(false)} onDone={onRefresh} />}
  </div>;
}
