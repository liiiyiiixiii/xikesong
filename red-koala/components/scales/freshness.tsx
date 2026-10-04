'use client';
import { useRef, useState } from 'react';
import type { FreshnessTimer, FreshnessView, SupplySuggestion } from '@/lib/freshness/model';
import { RealtimeDialog } from './realtime-dialog';
import { clockTime, Notice, request } from './shared';
const labels={running:'计时中',soon:'即将到时',overdue:'请立即撤下',unknown:'上台时间待确认',waiting:'等待新盘'};
export function timerText(timer:FreshnessTimer,now:string){
  if(!timer.batch)return labels[timer.status];
  const left=Math.ceil((Date.parse(timer.batch.deadlineAt)-Date.parse(now))/60000);
  return left<=0?`已到时${left<0?' · 超时 '+Math.abs(left)+' 分钟':''}`:`距更换 ${left} 分钟`;
}
export function FreshnessActionForm({timer,onClose,onDone,disconnected,eventId,initialWeight,initialDisposition,initialReason}:{timer:FreshnessTimer;onClose:()=>void;onDone:()=>void;disconnected:boolean;eventId?:string;initialWeight?:number;initialDisposition?:'waste'|'retain';initialReason?:string}){
  const id=useRef(crypto.randomUUID()),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [scope,setScope]=useState<'full'|'partial'>(eventId?'partial':'full');
  const [remaining,setRemaining]=useState(initialWeight===undefined?'':String(initialWeight)),[opening,setOpening]=useState(''),[replace,setReplace]=useState(false),[disposition,setDisposition]=useState(initialDisposition??'waste'),[reason,setReason]=useState(initialReason??'display_age'),[confirmed,setConfirmed]=useState(false);
  const [started,setStarted]=useState(()=>new Date(Date.now()+8*3600000).toISOString().slice(0,16));
  const active=!!timer.batch;
  async function submit(event:React.FormEvent){event.preventDefault();if(busy||disconnected)return;setBusy(true);setError('');try{
    await request('/api/freshness',active&&scope==='partial'?{action:'partial',requestId:id.current,batchId:timer.batch!.id,weightG:Number(remaining),eventId,disposition,reason,confirmed}:active?{action:'close',requestId:id.current,batchId:timer.batch!.id,remainingG:Number(remaining),disposition,reason,replace,newOpeningG:opening===''?null:Number(opening),confirmed}:{action:'start',requestId:id.current,scaleId:timer.scaleId,startedAt:new Date(started+':00+08:00').toISOString(),openingG:opening===''?null:Number(opening),confirmed});onDone();onClose();
  }catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}}
  return <RealtimeDialog title={`${active?'处理当前批次':'登记上台'} · ${timer.name}`} description={`碗位 ${timer.scaleId}`} onClose={()=>{if(!busy)onClose();}}><form onSubmit={submit} onChange={()=>{id.current=crypto.randomUUID();}}>
    <fieldset disabled={busy} className="fresh-fieldset">
    {active?<><label className="scale-field">撤下范围<select value={scope} onChange={e=>{setScope(e.target.value as 'full'|'partial');setReplace(false);setConfirmed(false);}}><option value="full">本批次全部撤下</option><option value="partial">只撤下一部分，继续原计时</option></select></label><p className="scale-muted">{scope==='full'?'先将整盘从秤上取下，再确认处理；换盘请在保存成功后放上新盘。':'先完成部分撤下并等待重量稳定，系统将对应重量从取用中改记为撤下；本盘截止时间保持不变。'}</p><p>上台 {clockTime(timer.batch!.startedAt)} · 截止 {clockTime(timer.batch!.deadlineAt)}</p>
      <label className="scale-field">本次撤下余量（克）<input type="number" min={scope==="partial"?0.1:0} max="10000000" step="0.1" value={remaining} required onChange={e=>setRemaining(e.target.value)}/></label>
      <label className="scale-field">撤下去向<select value={disposition} onChange={e=>setDisposition(e.target.value as "waste"|"retain")}><option value="waste">丢弃并记为报损</option><option value="retain">撤下保留（不代表可以继续供餐）</option></select></label>
      <label className="scale-field">撤下原因<select value={reason} onChange={e=>setReason(e.target.value)}><option value="display_age">放置过久</option><option value="closing">闭店撤下</option><option value="other">其他／已取完</option></select></label>
      {scope==='full'&&<label className="fresh-check"><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/>同时登记新盘，保存后立即上台</label>}
    </>:<><p className="scale-muted">仅登记全新一盘，或核实本盘真实上台时间。向旧盘补菜不能重新计时。时间不明时请先撤下核实。</p><label className="scale-field">实际上台时间（北京时间，最近24小时）<input type="datetime-local" value={started} required onChange={e=>setStarted(e.target.value)}/></label></>}
    {(!active||replace)&&<label className="scale-field">{active?'新盘':'本盘上台时的'}重量（克，可留空）<input type="number" min="0" max="10000000" step="0.1" value={opening} onChange={e=>setOpening(e.target.value)}/><small>不清楚时留空，不会把未知重量当成零。</small></label>}
    <label className="fresh-check"><input type="checkbox" checked={confirmed} required onChange={e=>setConfirmed(e.target.checked)}/>{active?(scope==='partial'?'确认只撤下一部分，重量与去向已核实':'确认本批次旧菜已全部撤下，重量与去向已核实'):'确认是独立批次，上台时间已核实'}</label>
    </fieldset>
    {error&&<Notice error>{error}</Notice>}{disconnected&&<Notice error>连接中断，恢复后才能保存。</Notice>}
    <div className="scale-modal-actions"><button type="button" className="scale-button secondary" disabled={busy} onClick={onClose}>取消</button><button className="scale-button" disabled={busy||disconnected||!confirmed}>{busy?'保存中…':active?scope==='partial'?'记录部分撤下':replace?'撤下旧盘并开始新计时':'确认撤下':'开始计时'}</button></div>
  </form></RealtimeDialog>;
}
export function FreshnessRuleForm({data,onDone,disconnected}:{data:FreshnessView;onDone:()=>void;disconnected:boolean}){
  const [dishId,setDishId]=useState(data.catalog[0]?.id??''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const rule=data.rules.find(r=>r.dishId===dishId);
  return <details className="fresh-rules"><summary>菜品时限设置</summary><p className="scale-muted">同一道菜设置一次、各碗分别计时。填写门店已确认的时限；修改只影响下一批次，在台批次继续沿用原截止时间。</p>
    <label className="scale-field">菜品<select value={dishId} onChange={e=>{setDishId(e.target.value);setMessage('');setError('');}}>{data.catalog.map(c=><option key={c.id} value={c.id}>{c.name} · {c.id}</option>)}</select></label>
    <form key={dishId+String(rule?.updatedAt)} onSubmit={async e=>{e.preventDefault();const fields=new FormData(e.currentTarget);setBusy(true);setMessage('');setError('');try{await request('/api/freshness',{action:'rule',dishId,enabled:fields.get('enabled')==='on',maxMinutes:Number(fields.get('maxMinutes')),warningMinutes:Number(fields.get('warningMinutes'))});setMessage('规则已保存，同菜各碗分别计时，下次上盘生效。');onDone();}catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}}}>
      <fieldset disabled={busy||disconnected} className="fresh-fieldset"><label className="fresh-check"><input name="enabled" type="checkbox" defaultChecked={rule?.enabled??true}/>开启时限管理</label><div className="fresh-rule-fields"><label className="scale-field">最长上台时间（分钟）<input name="maxMinutes" type="number" min="1" max="1440" required defaultValue={rule?.maxMinutes} placeholder="填写已确认的时限"/></label><label className="scale-field">提前提醒（分钟）<input name="warningMinutes" type="number" min="0" max="1439" required defaultValue={rule?.warningMinutes??30}/></label><button className="scale-button" disabled={!dishId}>保存规则</button></div></fieldset>
    </form>{message&&<Notice>{message}</Notice>}{error&&<Notice error>{error}</Notice>}
  </details>;
}
export function DecisionForm({suggestion,onClose,onDone,disconnected}:{suggestion:SupplySuggestion;onClose:()=>void;onDone:()=>void;disconnected:boolean}){
  const id=useRef(crypto.randomUUID()),[choice,setChoice]=useState('reduce'),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <RealtimeDialog title={`记录供应决策 · ${suggestion.name}`} onClose={()=>{if(!busy)onClose();}}><form onChange={()=>{id.current=crypto.randomUUID();}} onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await request('/api/freshness',{action:'decision',requestId:id.current,dishId:suggestion.dishId,period:suggestion.period,choice,note,evidenceIds:suggestion.evidenceIds});onDone();onClose();}catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}}}>
    <p className="scale-muted">将决策发送给主体分析并留档，供厨房按说明执行；不会自动改写备料计划或停用菜品。</p><fieldset disabled={busy||disconnected} className="fresh-fieldset"><label className="scale-field">{suggestion.period}供应安排<select value={choice} onChange={e=>setChoice(e.target.value)}><option value="reduce">减少供应</option><option value="trial_pause">试行暂停供应</option><option value="keep">维持供应并观察</option></select></label><label className="scale-field">执行安排与复查说明<textarea value={note} onChange={e=>setNote(e.target.value)} required maxLength={500} placeholder="例如：晚间每盘减至300克，连续观察三天后复查。"/></label></fieldset>{error&&<Notice error>{error}</Notice>}<div className="scale-modal-actions"><button type="button" className="scale-button secondary" disabled={busy} onClick={onClose}>取消</button><button className="scale-button" disabled={busy||disconnected||!note.trim()}>{busy?'保存中…':'确认并记录决策'}</button></div>
  </form></RealtimeDialog>;
}
