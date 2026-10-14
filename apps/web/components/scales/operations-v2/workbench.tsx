'use client';
import KitchenScreen from './kitchen-screen';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {environmentLabels,servingLabels,qualityLabels,recommendationLabels,zoneLabels,locationLabels,servingReasonLabels,type Bowl} from '@zhishan/contracts/operations-v2';
import BrandLogo from '../brand-logo';
import {useResource,errorText,grams,localTime} from './hooks';
import {Panel,Field,QueryStatus,Empty} from './ui';
import TaskBoard from './tasks';
import {OperationForm,BoundaryForm,BowlCycles} from './operations';
import Reports from './reports';
import Settings from './settings';
import Freshness,{FreshnessNotice} from './freshness';
import OperationHistory from './operation-history';
import './workbench.css';

const sessionSchema=z.object({authenticated:z.boolean(),actor:z.object({id:z.string(),label:z.string()}).optional(),role:z.enum(['staff','manager']).optional(),environment:z.enum(['test','demo','live']).optional()}).refine(v=>!v.authenticated||!!(v.actor&&v.role&&v.environment),'登录响应缺少身份或环境');
type Session=z.infer<typeof sessionSchema>;
const views={kitchenScreen:'后厨十盘屏',live:'实时总览',kitchen:'后厨任务',front:'前厅任务',reports:'取用报表',freshness:'时限与报损',settings:'设置与诊断'};
async function sessionRequest(method:'GET'|'POST'|'DELETE',token?:string){
 const response=await fetch('/api/v2/session',{method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}:{})});
 const body:unknown=await response.json();if(!response.ok){const error=z.object({error:z.union([z.string(),z.object({message:z.string()})])}).safeParse(body);throw Error(error.success?(typeof error.data.error==='string'?error.data.error:error.data.error.message):`登录服务不可用（HTTP ${response.status}）`);}
 return sessionSchema.parse(body);
}
function BowlBoard({bowls,stale,onSelect}:{bowls:Bowl[];stale:boolean;onSelect:(b:Bowl)=>void}){
 const [search,setSearch]=useState(''),[filter,setFilter]=useState('all');
 const rows=bowls.filter(b=>(!search||`${b.dishName} ${b.scaleId}`.toLowerCase().includes(search.toLowerCase()))&&(filter==='all'||filter==='attention'&&['urgent','refill','verify'].includes(b.recommendation)||b.servingState===filter));
 return <Panel title="全部碗位"><div className="ops-filters"><Field label="搜索菜品或碗位"><input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></Field><Field label="供餐状态"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部状态</option><option value="attention">需要处理</option>{Object.entries(servingLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field></div>{rows.length===0&&<Empty>{bowls.length?'没有匹配的碗位。':'尚无有效绑定，请由管理者配置设备与菜品。'}</Empty>}<div className="ops-bowl-grid">{rows.map(b=>{
  const known=!stale&&['good','estimated'].includes(b.quality)&&b.servingState!=='unknown';
  return <button key={b.bindingId} className={`ops-bowl state-${known?b.servingState:'unknown'}`} onClick={()=>onSelect(b)} aria-label={`${b.dishName} ${b.scaleId} 详情`}><span className="ops-actions"><strong>{b.dishName}</strong><span className="ops-badge">{known?servingLabels[b.servingState]:'待核实'}</span></span><small>{b.scaleId} · {stale?'位置需重新读取':zoneLabels[b.zone]}</small><span className="ops-bowl-weight">{known?grams(b.foodRemainingG):'当前余量未知'}{known&&b.quality==='estimated'&&<small>估计值</small>}</span><span>{stale?'数据已过期':recommendationLabels[b.recommendation]} · {stale?'读取中断':qualityLabels[b.quality]}</span><small>最近观测 {localTime(b.observedAt)}</small></button>;
 })}</div></Panel>;
}
function Workspace({view,session}:{view:keyof typeof views;session:Session}){
 const serving=useResource('serving',{},5000,view==='live'||view==='kitchen'||view==='front'),[selected,setSelected]=useState<string|null>(null);
 const bowl=serving.data?.bowls.find(b=>b.bindingId===selected),manager=session.role==='manager';
 return <>{view==='kitchenScreen'?<KitchenScreen/>:view==='reports'?<Reports manager={manager}/>:view==='freshness'?<Freshness/>:view==='settings'?<Settings manager={manager}/>:<><Panel title={views[view]} actions={<button onClick={()=>void serving.refresh()}>刷新状态</button>}><QueryStatus query={serving}/>{serving.data&&<p className="ops-muted">{environmentLabels[serving.data.environment]} · 后端时间 {localTime(serving.data.serverAt)} · 数据版本 {serving.data.dataRevision}{serving.lastSuccessAt&&<> · 最后成功读取 {localTime(serving.lastSuccessAt)}</>}</p>}<p className="ops-muted">按后端任务处理；显示顺序不代表餐盘实际位置。页面关闭后不会发出浏览器提示音。</p></Panel><TaskBoard key={view} environment={session.environment!} defaultResponsibility={view==='live'?'all':view} bowls={serving.data?.bowls??[]} onBowl={b=>setSelected(b.bindingId)}/><FreshnessNotice environment={session.environment!}/>{serving.data&&<BowlBoard bowls={serving.data.bowls} stale={serving.stale} onSelect={b=>setSelected(b.bindingId)}/>} {selected&&<section className="ops-detail" aria-label="碗位详情"><div className="ops-section-heading"><h2>碗位详情</h2><button onClick={()=>setSelected(null)}>关闭碗位详情</button></div>{bowl?<><Panel title={`${bowl.dishName} · ${bowl.scaleId}`}><dl className="ops-facts"><dt>食物余量</dt><dd>{serving.stale?'当前余量未知（读取中断）':bowl.servingState==='unknown'||!['good','estimated'].includes(bowl.quality)?'当前余量未知':grams(bowl.foodRemainingG)} · {serving.stale?'数据过期':qualityLabels[bowl.quality]}</dd><dt>历史确认余量</dt><dd>{grams(bowl.confirmedFoodG)} · {localTime(bowl.confirmedAt)}</dd><dt>位置依据</dt><dd>{zoneLabels[bowl.zone]} · {locationLabels[bowl.locationQuality]} · {localTime(bowl.locationObservedAt)}</dd><dt>当前原因</dt><dd>{bowl.reasonCodes.map(r=>servingReasonLabels[r]).join('、')||'无'}</dd><dt>绑定</dt><dd>{bowl.bindingId} · v{bowl.bindingVersion}</dd><dt>时限批次</dt><dd>{bowl.freshnessBatchId??'未登记'}</dd></dl></Panel><OperationForm key={'operation:'+bowl.bindingId} bowl={bowl} disabled={serving.stale||!!serving.error} onSaved={()=>void serving.refresh()}/><BoundaryForm key={'boundary:'+bowl.bindingId} bowl={bowl} disabled={serving.stale||!!serving.error} onSaved={()=>void serving.refresh()}/><OperationHistory key={'history:'+bowl.bindingId} bindingId={bowl.bindingId} onSaved={()=>void serving.refresh()}/><BowlCycles key={'cycles:'+bowl.bindingId} bowl={bowl} manager={manager} onSaved={()=>void serving.refresh()}/></>:<Empty>该绑定已不在当前有效列表中。请刷新并选择当前碗位。</Empty>}</section>}</>}</>;
}
export default function Workbench({view:requested}:{view:string}){
 const view: keyof typeof views=requested in views?requested as keyof typeof views:'live';
 const sessionSerial=useRef(0),sessionBusy=useRef(false);
 const [session,setSession]=useState<Session|null>(null),[token,setToken]=useState(''),[busy,setBusy]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let active=true;async function read(){if(sessionBusy.current)return;const serial=++sessionSerial.current;try{const s=await sessionRequest('GET');if(active&&serial===sessionSerial.current){setSession(s);setError('');}}catch(e){if(active&&serial===sessionSerial.current)setError(errorText(e));}finally{if(active&&serial===sessionSerial.current)setBusy(false);}}void read();const timer=setInterval(()=>void read(),60000);return()=>{active=false;clearInterval(timer);};},[]);
 async function login(e:React.FormEvent){e.preventDefault();if(sessionBusy.current||busy)return;sessionBusy.current=true;sessionSerial.current++;setBusy(true);setError('');try{setSession(await sessionRequest('POST',token));}catch(e){setError(errorText(e));}finally{setToken('');setBusy(false);sessionBusy.current=false;}}
 async function logout(){if(sessionBusy.current)return;sessionBusy.current=true;sessionSerial.current++;setBusy(true);setError('');try{setSession(await sessionRequest('DELETE'));}catch(e){setError(errorText(e));}finally{setBusy(false);sessionBusy.current=false;}}
 return <main className="ops-workbench"><header className="ops-header"><Link href="/" className="ops-brand"><BrandLogo/><strong>红考拉 · 业务工作台</strong></Link>{session?.authenticated&&<div className="ops-actions"><span>{session.actor!.label} · {session.role==='manager'?'管理者':'员工'} · {environmentLabels[session.environment!]}</span><button disabled={busy} onClick={()=>void logout()}>退出登录</button></div>}</header>{error&&<p role="alert" className="ops-notice error">{error}</p>}{!session?.authenticated?<Panel title="登录工作台"><p>使用门店分配的员工或管理工作站凭证登录。身份和环境由服务器核验。</p><form className="ops-login" onSubmit={login}><Field label="工作站凭证"><input autoComplete="off" type="password" required value={token} onChange={e=>setToken(e.target.value)} disabled={busy}/></Field><button className="ops-primary" disabled={busy}>{busy?'正在核验…':'登录'}</button></form><p className="ops-muted">凭证仅用于本次登录，会话由同源安全 Cookie 管理。接口不可用时请联系部署管理者。</p></Panel>:<><nav className="ops-nav" aria-label="业务工作台导航">{Object.entries(views).map(([id,label])=><Link key={id} href={id==='kitchenScreen'?'/operations/kitchen':`/operations?view=${id}`} aria-current={view===id?'page':undefined}>{label}</Link>)}<Link href="/admin?view=daily">原有备料与报损</Link><Link href="/admin?view=intelligence">客群画像</Link></nav><Workspace key={view+':'+session.actor!.id} view={view} session={session}/></>}</main>;
}
