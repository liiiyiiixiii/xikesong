"use client";
import BrandLogo from "./brand-logo";
import Link from "next/link";
import { Settings as SettingsIcon, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { Realtime, Source } from "@/lib/scales/types";
import Daily from "./daily";
import Intelligence from "./intelligence";
import RealtimePanel from "./realtime";
import Settings from "./settings";
import { FreshnessProvider,FreshnessSound,useFreshness } from './freshness-state';
import { usePolling } from "./shared";
type View='live'|'daily'|'intelligence';
export default function Admin({initialView='live'}:{initialView?:View}){return <FreshnessProvider><AdminContent initialView={initialView}/></FreshnessProvider>;}
function AdminContent({initialView}:{initialView:View}){
 const source:Source='live',freshness=useFreshness();
 const [view,setView]=useState(initialView),[settings,setSettings]=useState(false),[dueFilter,setDueFilter]=useState(0);
 const realtime=usePolling<Realtime>(view==='live'?'/api/scales/state?source=live':null,1000);
 return <div className={`scale-admin${view==='live'?' scale-admin-live':view==='daily'?' scale-admin-daily':''}`}>
  <header className="scale-admin-header"><Link href="/" className="scale-brand"><BrandLogo/><span>红考拉<span className="brand-sub">菜品管理</span></span></Link>
   <nav className="scale-main-nav" aria-label="主要功能"><span className="live-nav-entry"><button className={view==='live'?'active':''} onClick={()=>{setView('live');setDueFilter(0);}}>实时</button>{freshness.overdue!==null&&freshness.overdue>0?<button className="fresh-nav-count" aria-label={`已到时 ${freshness.overdue} 个碗，查看待更换菜品`} onClick={()=>{setView('live');setDueFilter(n=>n+1);}}>{freshness.overdue}</button>:freshness.error?<span className="fresh-nav-unknown" title="更换提醒暂不可用" aria-label="更换提醒暂不可用">!</span>:null}</span><button className={view==='daily'?'active':''} onClick={()=>setView('daily')}>每日总结</button><button className={view==='intelligence'?'active':''} onClick={()=>setView('intelligence')}>智能分析</button></nav>
   <div className="scale-header-actions">{freshness.timers.length>0&&<FreshnessSound/>}<button className="scale-icon-button" aria-label="设备与菜品设置" onClick={()=>setSettings(true)}><SettingsIcon size={19}/></button><Link className="scale-kitchen-link" href="/kitchen" target="_blank">厨房屏幕 <ExternalLink size={14}/></Link></div>
  </header>
  <main className="scale-admin-content">{view==='live'?<RealtimePanel source={source} data={realtime.data} loading={realtime.loading} error={realtime.error} onRefresh={()=>{realtime.refresh();freshness.refresh();}} onSettings={()=>setSettings(true)} dueFilter={dueFilter}/>:view==='daily'?<Daily source={source}/>:<Intelligence/>}</main>
  <footer className="scale-admin-footer">按重量记录取用，持续调整供菜。</footer>
  {settings&&<Settings source={source} onClose={()=>setSettings(false)} onChanged={()=>{realtime.refresh();freshness.refresh();}}/>}
 </div>;
}
