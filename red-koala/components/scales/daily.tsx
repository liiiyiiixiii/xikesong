"use client";
import { RemovalDetails } from "./freshness-history";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ClipboardCheck, Search, ArrowUpRight } from "lucide-react";
import type { DailySummary, ExecutionView, ForecastView, PreferenceView, Source } from "@/lib/scales/types";
import { clockTime, dateToday, nextDate, Notice, request, Sparkline, usePolling, weight } from "./shared";
import { RealtimeDialog } from "./realtime-dialog";
import "./daily.css";

function ForecastEditor({forecast,preferences,source,onDone}:{forecast:ForecastView;preferences:PreferenceView;source:Source;onDone:()=>void}) {const confirmed=preferences.plans.find(p=>p.forecastId===forecast.id);const [lines,setLines]=useState(()=>forecast.lines.map(line=>{const saved=confirmed?.lines.find(c=>c.dishId===line.dishId);return{dishId:line.dishId,quantity:saved?.quantity!=null?String(saved.quantity):line.suggested==null?"":String(line.suggested),reason:saved?.reason??""};})),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");function update(index:number,field:"quantity"|"reason",value:string){setLines(previous=>previous.map((line,i)=>i===index?{...line,[field]:value}:line));}async function submit(e:React.FormEvent){e.preventDefault();setNotice("");const missing=lines.some((line,i)=>{const suggested=forecast.lines[i].suggested;return (suggested==null||Number(line.quantity)!==suggested)&&!line.reason.trim();});if(missing){setNotice("请为修改量或试供量填写简短理由。");return;}setBusy(true);try{await request("/api/preferences",{source,action:"confirm",forecastId:forecast.id,date:forecast.targetDate,lines:lines.map(line=>({...line,quantity:Number(line.quantity)}))});setNotice("备料计划已确认");onDone();}catch(e){setNotice(e instanceof Error?e.message:"确认失败");}finally{setBusy(false);}}return <form onSubmit={submit}><div className="scale-section-heading"><div><h2>{forecast.targetDate} 备料建议</h2><p className="scale-muted">预估取用量 + {Math.round(forecast.buffer*100)}% 余量 · 确认量单位为克</p></div>{confirmed&&<span className="plan-confirmed"><Check size={15}/>已确认</span>}</div>{(forecast.late||forecast.provenance==="historical-replay")&&<Notice>{forecast.provenance === "historical-replay" ? "模拟数据回放 · 实际计算于 " : "补生成于 "}{new Date(forecast.generatedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}，这份建议不是当时的预测。</Notice>}{preferences.supplyFeedbackError&&<Notice>{preferences.supplyFeedbackError}</Notice>}<div className="scale-table-scroll"><table className="scale-plan-table"><thead><tr><th>菜品</th><th>预估取用 / 范围</th><th>建议量</th><th>确认量（克）</th><th>修改或试供理由</th></tr></thead><tbody>{forecast.lines.map((line,i)=><tr key={line.dishId}><td><strong>{line.name}</strong>{preferences.supplyFeedback?.suggestions.filter(s=>s.dishId===line.dishId&&s.level!=="observe").map(s=><small key={s.period} className="fresh-badge">运营反馈 · {s.period}：{s.level==="reduce"?"建议减小单盘量":"评估限时或试停供"}（未自动改量）</small>)}{preferences.supplyFeedback?.decisions.filter(d=>d.dishId===line.dishId).slice(0,1).map(d=><small key={d.id}>最新供应安排：{d.note}</small>)}<small>{line.confidence==="observing"?"新菜观察中":line.confidence==="limited"?"样本较少":""}</small></td><td>{weight(line.demand)}<small>{line.low==null?"可填写试供量":`${weight(line.low)} – ${weight(line.high)}`}</small></td><td>{weight(line.suggested)}</td><td><input aria-label={`${line.name}确认备料量（克）`} type="number" min="0" max="100000000" step="1" required readOnly={preferences.history?.phase==="ready"&&forecast.targetDate<=preferences.history.manifest.parameters.end} value={lines[i].quantity} onChange={e=>update(i,"quantity",e.target.value)} placeholder="试供量"/></td><td><input aria-label={`${line.name}修改或试供理由`} readOnly={preferences.history?.phase==="ready"&&forecast.targetDate<=preferences.history.manifest.parameters.end} value={lines[i].reason} onChange={e=>update(i,"reason",e.target.value)} maxLength={500} placeholder={line.suggested==null?"填写观察依据":"修改时填写"}/></td></tr>)}</tbody></table></div><div className="scale-plan-footer"><p className="scale-muted">确认每日总备料量后，仍可根据现场余量追加。</p><button className="scale-button" disabled={busy||!forecast.lines.length||preferences.history?.phase==="ready"&&forecast.targetDate<=preferences.history.manifest.parameters.end}><ClipboardCheck size={17}/>{busy?"保存中…":confirmed?"更新确认计划":"确认备料计划"}</button></div>{notice&&<Notice error={!notice.includes("已确认")}>{notice}</Notice>}<details className="scale-model-details"><summary>查看建议依据 <ChevronDown size={14}/></summary><p>模型根据各菜近期取用与星期规律每天更新，历史权重每七天减半。默认 10% 余量是可调整的经营设置；参考范围用于辅助备料。</p>{forecast.lines.map(line=><p key={line.dishId}><strong>{line.name}：</strong>{line.explanation}</p>)}<p className="scale-muted">数据截止 {new Date(forecast.cutoff).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})} · 生成于 {clockTime(forecast.generatedAt)}</p></details></form>;}
function ExecutionForm({source,date,dishId,name,existing,onDone,readOnly=false}:{source:Source;date:string;dishId:string;name:string;existing?:ExecutionView;onDone:()=>void;readOnly?:boolean}) {const [form,setForm]=useState({prepared:existing?.prepared??0,added:existing?.added??0,kitchenRetained:existing?.kitchenRetained??0,ageWaste:existing?.ageWaste??0,closingWaste:existing?.closingWaste??0,otherWaste:existing?.otherWaste??0,note:existing?.note??""}),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");async function submit(e:React.FormEvent){e.preventDefault();setNotice("");setBusy(true);try{await request("/api/preferences",{source,action:"execution",date,dishId,...form});setNotice("实际备料已记录");onDone();}catch(e){setNotice(e instanceof Error?e.message:"保存失败");}finally{setBusy(false);}}function quantityField(key:Exclude<keyof typeof form,"note">,label:string){return <label className="scale-field" key={key}>{label}（克）<input type="number" min="0" max="100000000" step="1" required readOnly={readOnly} value={form[key]} onChange={e=>setForm(previous=>({...previous,[key]:Number(e.target.value)}))}/></label>;}return <form className="scale-execution-form" onSubmit={submit}><p className="scale-muted">{name} · {date} · 填写厨房实际量，上台补充量由秤另行统计。</p><div className="scale-form-grid execution-main">{quantityField("prepared","实际备料")}{quantityField("added","厨房追加")}{quantityField("kitchenRetained","厨房剩余")}</div><details className="scale-model-details"><summary>厨房报损与备注 <ChevronDown size={14}/></summary><p className="scale-muted">仅填写厨房内的报损，上台后的报损在实时页面记录。</p><div className="scale-form-grid">{quantityField("ageWaste","放置过久")}{quantityField("closingWaste","当日剩余")}{quantityField("otherWaste","其他报损")}</div><label className="scale-field">备注<input readOnly={readOnly} value={form.note} onChange={e=>setForm(previous=>({...previous,note:e.target.value}))} maxLength={500}/></label></details><button className="scale-button secondary small" disabled={busy||readOnly}>{readOnly?"模拟历史记录":busy?"保存中…":"保存实际备料"}</button>{notice&&<Notice error={!notice.includes("已记录")}>{notice}</Notice>}</form>;}
type DailyTab = "overview" | "trends" | "plan";
type DailyFilter = "all" | "attention" | "waste";
function supplyStatus(dish: DailySummary["dishes"][number]) {
  if (dish.unresolved) return { tone: "warning", label: `${dish.unresolved} 项待确认` };
  if (dish.coverage < .8 || (dish.missingIntervals ?? 0) > 0) return { tone: "muted", label: "数据不足" };
  if (dish.emptyMinutes > 0) return { tone: "warning", label: `空碗 ${dish.emptyMinutes<1?"不足 1":Math.round(dish.emptyMinutes)} 分钟` };
  return { tone: "good", label: "供菜充分" };
}

export default function Daily({ source }: { source: Source }) {
  const [date, setDate] = useState(dateToday());
  const [datasetEnd,setDatasetEnd]=useState<string|null>(null);
  const selectedInitialDate = useRef(false);
  const [selectedDish, setSelectedDish] = useState("");
  const [executionOpen, setExecutionOpen] = useState(false);
  const [tab, setTab] = useState<DailyTab>("overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DailyFilter>("all");
  const [sort, setSort] = useState("default");
  const [buffer, setBuffer] = useState(10);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const preferenceUrl = `/api/preferences?source=${source}&asOf=${encodeURIComponent(`${date}T23:59:59+08:00`)}`;
  const [removals,setRemovals]=useState<{dishId?:string;name?:string}|null>(null);
  const preferences = usePolling<PreferenceView>(preferenceUrl, 30000);
  const summary = usePolling<DailySummary>(`/api/scales/summary?source=${source}&date=${date}`, 30000);
  const report = date !== dateToday() && preferences.data?.daily?.dishes.length ? preferences.data.daily
    : summary.data?.dishes.length ? summary.data : preferences.data?.daily ?? summary.data;
  const profiles = preferences.data?.profile ?? [];
  useEffect(() => { let active=true; request<{phase:string|null;end:string|null}>("/api/preferences/history").then(history=>{if(active&&!selectedInitialDate.current&&history.phase==="ready"&&history.end){selectedInitialDate.current=true;setDatasetEnd(history.end);setDate(history.end);}}).catch(()=>{});return()=>{active=false;}; }, []);
  const forecast = preferences.data?.forecasts.find(f => f.originDate === date);
  const dishes = report?.dishes ?? [];
  const hasReport = dishes.some(d => d.coverage > 0 || d.takeG > 0 || d.refillG > 0 || d.wasteG > 0);
  const ageWaste=report?.dishes.every(d=>d.ageWasteG!==undefined)?report.dishes.reduce((n,d)=>n+(d.ageWasteG??0),0):null;
  const totals = dishes.reduce((sum, d) => ({ take: sum.take + d.takeG, refill: sum.refill + d.refillG, waste: sum.waste + d.wasteG }), { take: 0, refill: 0, waste: 0 });
  const attentionCount = dishes.filter(d => supplyStatus(d).tone !== "good").length;
  const profileById = new Map(profiles.map(profile => [profile.dishId, profile]));
  const needle = query.trim().toLocaleLowerCase();
  const shownDishes = dishes.filter(d => d.name.toLocaleLowerCase().includes(needle)
    && (filter === "all" || (filter === "waste" ? d.wasteG > 0 : supplyStatus(d).tone !== "good")));
  if (sort !== "default") shownDishes.sort((a, b) => (sort === "waste" ? b.wasteG - a.wasteG : b.takeG - a.takeG) || a.dishId.localeCompare(b.dishId));
  const shownProfiles = profiles.filter(p => p.name.toLocaleLowerCase().includes(needle));
  const maxTake = Math.max(1, ...dishes.map(d => d.takeG));
  const executionChoices = Array.from(new Map([
    ...dishes.map(d => [d.dishId, { id: d.dishId, name: d.name }] as const),
    ...profiles.map(p => [p.dishId, { id: p.dishId, name: p.name }] as const),
  ]).values());
  const choice = executionChoices.find(d => d.id === selectedDish) ?? executionChoices[0];
  const execution = preferences.data?.executions.find(e => e.date === date && e.dishId === choice?.id);
  const assessment = preferences.data?.assessment?.find(e => e.date === date && e.dishId === choice?.id);
  const dataError = summary.error || preferences.error;
  function changeDate(value: string) {
    if (!value || value === date || value > (datasetEnd??dateToday())) return;
    selectedInitialDate.current = true; setDate(value); setSelectedDish(""); setNotice(""); setExecutionOpen(false);setRemovals(null);
  }
  async function generate() {
    setBusy(true); setNotice("");
    try {
      await request("/api/preferences", { source, action: "generate", origin: date, buffer: buffer / 100, force: !!forecast && Math.abs(forecast.buffer - buffer / 100) > .00001 });
      preferences.refresh();
    } catch (e) { setNotice(e instanceof Error ? e.message : "生成失败"); }
    finally { setBusy(false); }
  }
  const openExecution = (id?: string) => { if (id) setSelectedDish(id); setExecutionOpen(true); };
  return <div className="daily-dashboard">
    <header className="daily-toolbar">
      <div className="daily-heading"><h1>每日总结</h1><span>{summary.loading && preferences.loading ? "正在读取数据" : report?.final ? "营业已结束" : `截至 ${clockTime(report?.asOf)} · 持续更新`}</span></div>
      <div className="daily-toolbar-actions">
        <label className="daily-date"><span>查看日期</span><input type="date" aria-label="查看日期" value={date} max={datasetEnd??dateToday()} onChange={e => changeDate(e.target.value)} /></label>
        <button className="scale-button secondary small" disabled={!executionChoices.length || !preferences.data} onClick={() => openExecution()}><ClipboardCheck size={15} />{preferences.data?.history?.phase==="ready"&&date<=preferences.data.history.manifest.parameters.end?"查看实际备料":"记录实际备料"}</button>
      </div>
    </header>
    {preferences.data?.history?.phase === "ready" && <p className="scale-muted">统一模拟数据 · {preferences.data.history.manifest.parameters.start} 至 {preferences.data.history.manifest.parameters.end} · {preferences.data.history.simulation?.enabled?"实时模拟已开启，历史记录保持只读":"完整模拟场景，非实际经营记录；实时页面为数据集回放"}</p>}
    {dataError && <Notice error>部分数据更新失败，当前保留最近成功读取的结果：{dataError}</Notice>}
    <section className="daily-metrics" aria-label="当日汇总">
      <div><span>取用重量</span><strong>{weight(hasReport ? totals.take : null)}</strong></div>
      <div><span>上台补充</span><strong>{weight(hasReport ? totals.refill : null)}</strong></div>
      <div><span>上台报损</span><strong className={totals.waste > 0 ? "daily-waste-number" : ""}>{weight(hasReport ? totals.waste : null)}</strong><button className="fresh-waste-detail" onClick={()=>setRemovals({})} disabled={!report}>其中放置过久 {weight(ageWaste)}</button></div>
      <div><span>统计菜品</span><strong>{report ? dishes.length : "—"}<small>道</small></strong></div>
      <button type="button" onClick={() => { setTab("overview"); setFilter("attention"); }} disabled={!report} aria-label={`需关注 ${attentionCount} 道菜，查看明细`}><span>需关注 <ArrowUpRight size={13} /></span><strong>{report ? attentionCount : "—"}<small>道</small></strong></button>
    </section>
    <section className="daily-workspace">
      <div className="daily-workspace-bar">
        <div className="daily-tabs" role="tablist" aria-label="每日总结内容">{([
          ["overview", "当日概览"], ["trends", "七日趋势"], ["plan", "备料计划"],
        ] as const).map(([key, label], index) => <button key={key} type="button" id={`daily-tab-${key}`} role="tab" aria-selected={tab === key} aria-controls={`daily-panel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={event => {
          const keys: DailyTab[] = ["overview", "trends", "plan"];
          const target = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : -1;
          if (target >= 0) { event.preventDefault(); setTab(keys[target]); document.getElementById(`daily-tab-${keys[target]}`)?.focus(); }
        }}>{label}</button>)}</div>
        {tab !== "plan" && <label className="daily-search"><Search size={15} /><input type="search" aria-label="搜索总结菜品" placeholder="搜索菜品" value={query} onChange={e => setQuery(e.target.value)} /></label>}
      </div>
      <div role="tabpanel" id="daily-panel-overview" aria-labelledby="daily-tab-overview" hidden={tab !== "overview"}>
        <div className="daily-table-toolbar"><div className="daily-filters">{([ ["all", "全部"], ["attention", "需关注"], ["waste", "有报损"] ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="daily-table-options"><span>{shownDishes.length} / {dishes.length} 道菜</span><select aria-label="菜品排序" value={sort} onChange={e => setSort(e.target.value)}><option value="default">默认顺序</option><option value="take">取用量从高到低</option><option value="waste">报损量从高到低</option></select></div></div>
        {shownDishes.length ? <div className="daily-table-scroll" tabIndex={0} role="region" aria-label="各菜取用与供应"><table className="daily-data-table"><thead><tr><th scope="col">菜品</th><th scope="col">取用重量</th><th scope="col">上台补充</th><th scope="col">剩余</th><th scope="col">报损</th><th scope="col">供应情况</th><th scope="col">七日取用趋势</th><th scope="col"><span title="最近七天取用重量占比，不代表喜爱程度">七日重量占比</span></th><th scope="col">实际备料</th></tr></thead><tbody>{shownDishes.map(dish => {
          const status = supplyStatus(dish); const profile = profileById.get(dish.dishId);
          return <tr key={dish.dishId}><th scope="row" title={dish.name}>{dish.name}</th><td><div className="daily-take-cell"><span>{weight(dish.coverage > 0 || dish.takeG > 0 ? dish.takeG : null)}</span><i aria-hidden="true"><i style={{ width: `${dish.takeG / maxTake * 100}%` }} /></i></div></td><td>{weight(dish.coverage > 0 || dish.refillG > 0 ? dish.refillG : null)}</td><td>{weight(dish.remainingG)}</td><td className={dish.wasteG > 0 ? "daily-waste-number" : ""}>{weight(dish.wasteG)}{(dish.wasteG>0||dish.retainedG>0)&&<button className="fresh-waste-detail" onClick={()=>setRemovals({dishId:dish.dishId,name:dish.name})}>其中放置过久 {weight(dish.ageWasteG)}</button>}</td><td><span className={`daily-status tone-${status.tone}`}>{status.label}</span></td><td className="daily-trend-cell">{profile ? <Sparkline values={profile.history.map(h => h.quantity)} label={`${dish.name}最近七天取用趋势`} /> : <span className="daily-muted">—</span>}</td><td>{profile?.share == null ? "—" : `${(profile.share * 100).toFixed(1)}%`}</td><td><button className="daily-row-action" disabled={!preferences.data} onClick={() => openExecution(dish.dishId)}>记录 <ArrowUpRight size={12} /></button></td></tr>;
        })}</tbody></table></div> : <div className="daily-empty"><h2>{summary.loading && preferences.loading ? "正在读取统计" : dishes.length ? "没有符合条件的菜品" : "这一天还没有称重统计"}</h2><p>{dishes.length ? "试试其他菜名或筛选条件。" : "收到称重记录后，会自动汇总各菜的取用与供应。"}</p>{dishes.length > 0 && <button className="scale-button secondary small" onClick={() => { setQuery(""); setFilter("all"); }}>清除筛选</button>}</div>}
        <p className="daily-footnote">取用条按当日各菜最大取用量对比 · “—”表示暂无有效数据 · 七日重量占比不代表喜爱程度</p>
      </div>
      <div role="tabpanel" id="daily-panel-trends" aria-labelledby="daily-tab-trends" hidden={tab !== "trends"}>
        <div className="daily-table-toolbar"><span className="daily-muted">最近七天 · 近期取用权重更高</span><span className="daily-muted">{shownProfiles.length} 道菜</span></div>
        {shownProfiles.length ? <div className="daily-table-scroll" tabIndex={0} role="region" aria-label="最近七天取用趋势"><table className="daily-data-table daily-profile-table"><thead><tr><th scope="col">菜品</th><th scope="col">七日取用</th><th scope="col">重量占比</th><th scope="col">取用趋势</th><th scope="col">样本天数</th><th scope="col">数据情况</th></tr></thead><tbody>{shownProfiles.map(profile => <tr key={profile.dishId}><th scope="row" title={profile.name}>{profile.name}</th><td>{weight(profile.takeG)}</td><td><div className="daily-share-cell"><span>{profile.share == null ? "—" : `${(profile.share * 100).toFixed(1)}%`}</span><i aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, (profile.share ?? 0) * 100))}%` }} /></i></div></td><td className="daily-trend-cell"><Sparkline values={profile.history.map(h => h.quantity)} label={`${profile.name}最近七天取用趋势`} /></td><td>{profile.samples} 天</td><td className="daily-profile-status">{profile.status}</td></tr>)}</tbody></table></div> : <div className="daily-empty"><h2>{preferences.loading ? "正在读取趋势" : query ? "没有匹配的菜品" : "暂无七日趋势"}</h2><p>积累完整日数据后，显示各菜趋势与重量占比。</p>{query && <button className="scale-button secondary small" onClick={() => setQuery("")}>清除搜索</button>}</div>}
        <p className="daily-footnote">趋势图按各菜自身范围显示，用于观察变化；数据不足的时段留空。</p>
      </div>
      <div role="tabpanel" id="daily-panel-plan" aria-labelledby="daily-tab-plan" hidden={tab !== "plan"}>
        <section className="daily-plan scale-panel">
          {forecast && preferences.data ? <ForecastEditor key={forecast.id + (preferences.data.plans.find(p => p.forecastId === forecast.id)?.at ?? "")} forecast={forecast} preferences={preferences.data} source={source} onDone={preferences.refresh} /> : <div className="scale-section-heading"><div><h2>{nextDate(date)} 备料建议</h2><p className="scale-muted">每天北京时间 20:00 自动生成；数据不足的菜可填写试供量。</p></div><button className="scale-button secondary small" disabled={busy || !preferences.data} onClick={() => void generate()}>{busy ? "生成中…" : "生成建议"}</button></div>}
          <details className="scale-model-details"><summary>调整建议余量 <ChevronDown size={14} /></summary><div className="buffer-setting"><label>建议余量 <input type="number" min="0" max="100" step="1" value={buffer} onChange={e => setBuffer(Number(e.target.value))} /> %</label><button className="scale-button secondary small" disabled={busy || !preferences.data} onClick={() => void generate()}>{busy ? "生成中…" : "应用并生成"}</button></div><p className="scale-muted">10% 是初始经营设置，可根据缺菜与报损调整。</p></details>
          {notice && <Notice error>{notice}</Notice>}
        </section>
      </div>
    </section>
    {removals&&<RemovalDetails key={date+(removals.dishId??"all")} date={date} dishId={removals.dishId} name={removals.name} onClose={()=>setRemovals(null)}/>}
    {executionOpen && <RealtimeDialog drawer title="记录实际备料" description={`${date} · 厨房备料与执行记录`} onClose={() => setExecutionOpen(false)}><div className="daily-execution">
      <label className="scale-field">菜品<select aria-label="记录实际备料的菜品" value={choice?.id ?? ""} onChange={e => setSelectedDish(e.target.value)}>{executionChoices.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
      {preferences.error && <Notice error>数据更新失败，请核对记录后再保存。</Notice>}
      {assessment && <div className="daily-assessment"><div><span>已记录实际备料</span><strong>{weight(assessment.preparedG)}</strong></div><div><span>秤记录上台补充</span><strong>{weight(assessment.scaleRefillG)}</strong></div><div><span>与确认计划差异</span><strong>{assessment.planDifference == null ? "尚无确认计划" : `${assessment.planDifference > 0 ? "+" : ""}${weight(assessment.planDifference)}`}</strong></div><div><span>预测误差</span><strong>{assessment.predictionError == null ? "待完整日核验" : `${assessment.predictionError > 0 ? "+" : ""}${weight(assessment.predictionError)}`}</strong></div><p>计划差异比较首批备料与确认量；预测误差比较完整日取用与预估取用。</p></div>}
      {choice ? <ExecutionForm readOnly={preferences.data?.history?.phase==="ready"&&date<=preferences.data.history.manifest.parameters.end} key={`${source}:${date}:${choice.id}:${execution?.at ?? ""}`} source={source} date={date} dishId={choice.id} name={choice.name} existing={execution} onDone={preferences.refresh} /> : <p className="scale-muted">配置菜品后可记录实际备料。</p>}
    </div></RealtimeDialog>}
  </div>;
}
