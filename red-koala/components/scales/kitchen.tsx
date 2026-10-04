"use client";
import BrandLogo from "./brand-logo";
import { bowlCards } from "./bowl-view";

import Link from "next/link";
import { FreshnessProvider } from "./freshness-state";
import { KitchenFreshness } from "./kitchen-freshness";
import { CookingPot } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { DishRealtime, Realtime } from "@/lib/scales/types";
import { usePolling, weight, clockTime, request } from "./shared";

import { createOrbit, orbitPoint, dishSlots, orbitFrame, slotTransform, FEATURED_COUNT, ORBIT_DURATION } from "./kitchen-orbit";
import type { Orbit, OrbitSlot } from "./kitchen-orbit";

function DishContent({dish,disconnected}:{dish:DishRealtime;disconnected:boolean}) {
 const unavailable=disconnected||dish.percent===null||["offline","partial","anomaly"].includes(dish.status);
 const percent=unavailable?null:dish.percent;
 const message=disconnected?"连接中断":dish.status==="anomaly"?"称重异常":dish.status==="offline"?"设备离线":dish.status==="partial"?"数据不足":percent===null?"等待稳定":percent<20?"请及时补菜":weight(dish.remainingG)+" 剩余";
 return <>
  <h2 className="k-dock-name">{dish.name}</h2>
  <div className="k-dock-percent">{percent===null?"—":Math.round(percent)}{percent!==null&&<span>%</span>}</div>
  <div className="k-dock-meter" role="progressbar" aria-label={dish.name+"剩余比例"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent===null?undefined:Math.min(100,Math.round(percent))} aria-valuetext={percent===null?message:"剩余 "+Math.round(percent)+"%"}><span style={{width:(percent===null?0:Math.min(100,Math.max(0,percent)))+"%"}}/></div>
  <p className="k-dock-hint">{message}</p>
 </>;
}
export default function Kitchen({demo=false}:{demo?:boolean}){return demo?<KitchenBoard demo/>:<FreshnessProvider><KitchenBoard/></FreshnessProvider>;}
function KitchenBoard({demo=false}:{demo?:boolean}) {
 const [index,setIndex]=useState(0);
 const {data,error,loading,refresh}=usePolling<Realtime & {playback?:{paused:boolean;second:number;cycle:number};customers?:{count:number}}>(demo?"/api/demo/lunch/state":"/api/scales/state",1000);
 const paused=!!data?.playback?.paused;
 const [controlBusy,setControlBusy]=useState(false),[controlError,setControlError]=useState('');
 async function control(action:'pause'|'resume'|'restart') {
  setControlBusy(true);setControlError('');
  try {await request('/api/demo/lunch/control',{action});if(action==='restart')setIndex(0);refresh();}
  catch(e){setControlError(e instanceof Error?e.message:'演示控制失败');}
  finally{setControlBusy(false);}
 }

 const dishes=bowlCards(data?.dishes??[]),count=dishes.length,focusCount=Math.min(FEATURED_COUNT,count),start=index%Math.max(count,1);
 const surface=useRef<HTMLDivElement>(null),cardNodes=useRef(new Map<string,HTMLElement>());
 const previous=useRef<{orbit:Orbit;slots:Map<string,OrbitSlot>;key:string}|null>(null);
 const direction=useRef(1), motionUntil=useRef(0);
 const [bounds,setBounds]=useState({width:0,height:0});
 const orbit=useMemo(()=>createOrbit(count,bounds.width,bounds.height),[count,bounds.width,bounds.height]);
 const slots=useMemo(()=>dishSlots(orbit,start),[orbit,start]);
 const layoutKey=dishes.map(d=>d.id).join("|");
 const advance=useCallback((step:number)=>{
  if(count<=1||performance.now()<motionUntil.current)return;
  direction.current=step;
  const reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  motionUntil.current=performance.now()+(reduce?0:ORBIT_DURATION);
  setIndex(i=>(i+step+count)%count);
 },[count]);
 useEffect(()=>{
  if(paused||data?.playback?.paused||count<=1)return;
  const timer=setInterval(()=>advance(1),5000);
  return()=>clearInterval(timer);
 },[paused,count,advance,data?.playback?.paused]);
 useEffect(()=>{
  const node=surface.current;if(!node||!count)return;
  const resize=()=>{const {width,height}=node.getBoundingClientRect();setBounds({width,height});};
  resize();const observer=new ResizeObserver(resize);observer.observe(node);
  return()=>observer.disconnect();
 },[count]);
 useLayoutEffect(()=>{
  const media=window.matchMedia("(prefers-reduced-motion: reduce)"),nextSlots=new Map<string,OrbitSlot>();
  const oldLayout=previous.current;
  for(const [position,id] of layoutKey.split("|").entries()){
   const node=cardNodes.current.get(id),slot=slots[position];if(!node||!slot)continue;
   node.getAnimations().forEach(animation=>animation.cancel());nextSlots.set(id,slot);
   const old=oldLayout?.slots.get(id);
   if(!old||media.matches||oldLayout?.orbit!==orbit||oldLayout.key!==layoutKey||old.distance===slot.distance)continue;
   const keyframes=Array.from({length:61},(_,step)=>({transform:slotTransform(orbitFrame(orbit,old,slot,step/60,direction.current),orbit.cardSize)}));
   node.animate(keyframes,{duration:ORBIT_DURATION,easing:"cubic-bezier(.4,0,.2,1)"});
  }
  previous.current={orbit,slots:nextSlots,key:layoutKey};
  const stop=()=>{if(media.matches)cardNodes.current.forEach(node=>node.getAnimations().forEach(animation=>animation.cancel()));};
  media.addEventListener("change",stop);
  return()=>media.removeEventListener("change",stop);
 },[orbit,slots,layoutKey]);
 return <main className="scale-kitchen kitchen-board">
  <header className="k-board-header"><Link href="/" className="scale-brand"><BrandLogo/><span>红考拉<span className="brand-sub">厨房端</span></span></Link><span className="k-board-count">{data?.scenario?`数据集回放 ${data.at.slice(0,10)} · `:data?.simulation?.enabled?"数据模拟 · ":""}{data?.dishes.length??0} 种菜品 · {count} 个碗</span></header>
  {!demo&&<KitchenFreshness/>}
  <section className="k-board-stage" aria-label="全部菜品余量">
   {count>0?<div className="k-dock-surface k-carousel-surface" ref={surface}>
    <svg className="k-carousel-track" width="100%" height="100%" aria-hidden="true"><ellipse cx={orbit.cx} cy={orbit.cy} rx={orbit.rx} ry={orbit.ry}/></svg>
    <div className="k-refill-node" style={{left:orbitPoint(orbit,orbit.length*.625).x,top:orbitPoint(orbit,orbit.length*.625).y}} aria-hidden="true"/>
    <div className="k-dock-grid">
     {dishes.map((dish,position)=>{
      const slot=slots[position],featured=slot?.featured??false;
      const unavailable=!!error||dish.percent===null||["offline","partial","anomaly"].includes(dish.status),low=!unavailable&&dish.percent!<20;
      const style={"--dock-tile":orbit.cardSize+"px",transform:slot?slotTransform(slot,orbit.cardSize):undefined,visibility:bounds.width>0?"visible":"hidden"} as CSSProperties;
      return <article key={dish.id} ref={node=>{if(node)cardNodes.current.set(dish.id,node);else cardNodes.current.delete(dish.id);}} style={style} className={"k-dock-tile "+(featured?"k-featured":"k-compact")+(low?" k-low":"")+(unavailable?" k-unavailable":"")} data-dish-id={dish.id} data-track-distance={slot?.distance} title={dish.name} aria-label={dish.name+(featured?" · 即将到达补菜节点":"")}>
       <div className="k-dock-face"><DishContent dish={dish} disconnected={!!error}/></div>
      </article>;
     })}
    </div>
   </div>:<div className="k-board-empty"><CookingPot size={54}/><h1>{loading?"正在连接设备":"等待菜品上台"}</h1><p>{error?"暂时无法连接，正在重试":"管理端配置秤与菜品后，余量将在这里显示。"}</p></div>}
  </section>
  <footer className="k-board-footer"><div className="k-board-update"><span>{error?"连接中断 · 正在重连":"更新于 "+clockTime(data?.at)}</span>{count>0&&<span>{focusCount} 个重点碗 · {paused?"已暂停":"循环展示"}</span>}</div>{demo&&<div className="lunch-demo-controls">
   <span>合成午餐仿真 · {Math.floor((data?.playback?.second??0)/60).toString().padStart(2,'0')}:{((data?.playback?.second??0)%60).toString().padStart(2,'0')} / 10:00 · 在座 {data?.customers?.count??'—'} 人</span>
   <button className="scale-button" disabled={controlBusy||!data} onClick={()=>void control(paused?'resume':'pause')}>{paused?'继续演示':'暂停演示'}</button>
   <button className="scale-button" disabled={controlBusy||!data} onClick={()=>void control('restart')}>重新开始</button>
   {controlError&&<span role="alert">{controlError}</span>}
  </div>}</footer>
 </main>;
}
