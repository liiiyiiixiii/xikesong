'use client';
import {useRef,useState} from 'react';
import Link from 'next/link';
import type {KitchenCard,OperationRequest} from '@zhishan/contracts/operations-v2';
import {plateAlerts,plateAlertText,plateAlertTone} from '@zhishan/contracts/kitchen-display';
import {useResource,errorText,localTime} from './hooks';
import {createOperationsClient} from './client';
import {Panel,QueryStatus} from './ui';
import {OperationForm} from './operations';
import './kitchen-screen.css';
const client=createOperationsClient();
const locationText={estimated:'按固定盘序和轨道运行状态推算',unconfigured:'尚未配置轨道或运行数据',stale:'位置数据已过期，请检查轨道连接',recalibration:'盘序需要重新校准'};
type Receipt={bindingId:string;name:string;body:OperationRequest;status:'pending'|'saved'|'failed';message:string};
function PlateCard({item,index,stale,checked,onCheck,onOpen}:{item:KitchenCard;index:number;stale:boolean;checked:boolean;onCheck:()=>void;onOpen:()=>void}){
 const alerts=plateAlerts({known:!stale&&item.percent!==null,empty:item.bowl.servingState==='empty',refill:['refill','urgent'].includes(item.bowl.recommendation),freshness:stale?null:item.freshness?.state}),primary=alerts[0]??'none';
 return <article className={`k-ten-card tone-${plateAlertTone[primary]}`} data-binding-id={item.bowl.bindingId}><div className="k-ten-top"><span>到达顺序 {index+1}</span><label><input type="checkbox" checked={checked} disabled={stale} onChange={onCheck}/>选择</label></div><button className="k-ten-name" onClick={onOpen} disabled={stale}>{item.bowl.dishName}</button><div className="k-ten-percent">{stale||item.percent===null?'待核实':`${item.estimated?'约 ':''}${item.percent}%`}</div><div className="k-ten-bar"><i style={{width:`${stale?0:Math.min(100,item.percent??0)}%`}}/></div><div className="k-ten-alerts">{alerts.map(a=><strong key={a} className={`tone-${plateAlertTone[a]}`}>{plateAlertText[a]}</strong>)}{!alerts.length&&<span>无需处理</span>}</div><small>{item.bowl.scaleId}{item.freshness?.state==='unconfigured'||!item.freshness?' · 尚未设置更换计时':''}</small></article>;
}
function VisitHistory({bindingId}:{bindingId:string}){
 const query=useResource('kitchenVisits',{query:{bindingId}},5000);
 const status={processing:'后厨处理中',refill:'已识别补菜',unchanged:'未识别到补菜',exception:'已登记例外',pending:'待核实',invalidated:'原识别已失效'};
 return <details><summary>自动识别记录与依据</summary><QueryStatus query={query}/><p>来源：系统推断。补菜识别与任务完成分别核验，补后不足仍会提醒。</p>{query.data?.visits.map(({current,revisions})=><article key={current.id}><strong>{status[current.status]} · 版本 {current.version}</strong><p>{localTime(current.enteredAt)} → {localTime(current.exitedAt)}</p><details><summary>核验依据与历史（{revisions.length} 次修订）</summary><p>{current.reasonCodes.join('、')||'稳定称重、绑定和后厨边界核验通过'}</p><p>{current.evidenceIds.join('、')}</p>{revisions.map(v=><p key={v.version}>版本 {v.version} · {status[v.status]} · {v.reasonCodes.join('、')}</p>)}</details></article>)}{query.data&&!query.data.visits.length&&<p>当前绑定暂无自动识别记录。</p>}</details>;
}
export default function KitchenScreen(){
 const [windowId,setWindowId]=useState(()=>typeof window==='undefined'?'':new URLSearchParams(window.location.search).get('windowId')??''),[selected,setSelected]=useState<string[]>([]),[opened,setOpened]=useState<string|null>(null),[receipts,setReceipts]=useState<Receipt[]>([]),[busy,setBusy]=useState(false);
 const sending=useRef(false);
 const query=useResource('kitchenBoard',{query:windowId?{windowId}:{}},1000),data=query.data,stale=query.stale||!!query.error;
 const bowl=data?.all.find(c=>c.bowl.bindingId===opened)?.bowl;
 const changeWindow=(id:string)=>{setWindowId(id);setSelected([]);const u=new URL(location.href);u.searchParams.set('windowId',id);history.replaceState(null,'',u);};
 async function send(items:Receipt[]){if(sending.current)return;sending.current=true;setBusy(true);setReceipts(items);for(const item of items){if(item.status==='saved')continue;try{await client.request('operation',{body:item.body});item.status='saved';item.message='已登记，等待依据核实';}catch(e){item.status='failed';item.message=errorText(e);}setReceipts(items.map(x=>({...x})));}sending.current=false;setBusy(false);void query.refresh();}
 function exception(type:'ice_add'|'drain'){
  const items=(data?.all??[]).filter(c=>selected.includes(c.bowl.bindingId)).map(c=>({bindingId:c.bowl.bindingId,name:c.bowl.dishName,body:{requestId:crypto.randomUUID(),bindingId:c.bowl.bindingId,occurredAt:new Date().toISOString(),type,quantityStatus:'unknown' as const,weightG:null,evidenceIds:[],note:type==='ice_add'?'后厨快捷登记加冰，数量待核实':'后厨快捷登记排水，数量待核实'},status:'pending' as const,message:'待提交'}));
  if(items.length)void send(items);
 }
 return <><Panel title="即将进入后厨 · 十盘屏" actions={<div className="ops-actions"><button onClick={()=>void document.documentElement.requestFullscreen()}>全屏</button><Link href="/operations?view=kitchen">详细任务与记录</Link></div>}><QueryStatus query={query}/><div className="k-ten-windows">{data?.windows.map(w=><button key={w.id} aria-pressed={data.windowId===w.id} onClick={()=>changeWindow(w.id)}>{w.name}{w.id!==data.windowId&&w.pending>0?` · ${w.pending} 项待处理`:''}</button>)}</div><p role="status">{stale?'连接中断，当前顺序及余量待核实':data?locationText[data.quality]:'正在读取窗口'}</p><small>{data?.automaticRefillEnabled?'普通补菜自动识别；加冰、排水等例外才需要登记。':'自动补菜尚未启用，请在详细任务页处理补菜。'}拿起餐盘后放回原位，补菜不会重置更换计时。</small></Panel>
 <section className="k-ten-grid" aria-label="即将进入后厨的十盘">{data?.upcoming.map((item,index)=><PlateCard key={item.bowl.bindingId} item={item} index={index} stale={stale} checked={selected.includes(item.bowl.bindingId)} onCheck={()=>setSelected(s=>s.includes(item.bowl.bindingId)?s.filter(x=>x!==item.bowl.bindingId):[...s,item.bowl.bindingId])} onOpen={()=>setOpened(item.bowl.bindingId)}/>)}</section>
 {data&&!data.upcoming.length&&<p className="ops-empty">{data.quality==='estimated'?'当前窗口前暂无餐盘。':'等待可靠位置，暂不显示“最近十盘”。'}</p>}
 <Panel title="例外登记"><div className="ops-actions"><span>已选 {selected.length} 盘</span><button disabled={!selected.length||stale||busy} onClick={()=>exception('ice_add')}>登记加冰</button><button disabled={!selected.length||stale||busy} onClick={()=>exception('drain')}>登记排水</button><button disabled={selected.length!==1||stale||busy} onClick={()=>setOpened(selected[0])}>撤菜 / 换盘 / 补充依据</button><button onClick={()=>setSelected([])} disabled={busy}>清除选择</button></div>{receipts.map(r=><p key={r.body.requestId} role="status">{r.name} · {r.message}</p>)}{receipts.some(r=>r.status==='failed')&&<button disabled={busy||stale} onClick={()=>void send(receipts)}>重试未成功的原请求</button>}</Panel>
 <Panel title="已进入后厨 · 待处理">{data?.processing.length?data.processing.map(item=><div className="k-ten-processing" key={item.bowl.bindingId}><label><input type="checkbox" disabled={stale} checked={selected.includes(item.bowl.bindingId)} onChange={()=>setSelected(s=>s.includes(item.bowl.bindingId)?s.filter(x=>x!==item.bowl.bindingId):[...s,item.bowl.bindingId])}/>{item.bowl.dishName}</label><span>{stale?'待核实':plateAlertText[item.alert]}</span><button disabled={stale} onClick={()=>setOpened(item.bowl.bindingId)}>登记例外 / 查看</button></div>):<p>暂无待处理餐盘</p>}</Panel>
 {opened&&bowl&&<Panel title={bowl.dishName} actions={<button onClick={()=>setOpened(null)}>关闭</button>}><VisitHistory bindingId={bowl.bindingId}/><OperationForm key={bowl.bindingId} initialType="ice_add" bowl={bowl} disabled={stale} onSaved={()=>void query.refresh()}/></Panel>}
 </>;
}
