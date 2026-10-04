'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FreshnessView } from '@/lib/freshness/model';
import { timerStatus } from '@/lib/freshness/model';
import { usePolling } from './shared';

function useFreshnessState(){
 const query=usePolling<FreshnessView>('/api/freshness?mode=timers',5000);
 const [now,setNow]=useState(()=>new Date().toISOString()),[sound,setSound]=useState(false),[soundError,setSoundError]=useState('');
 const audio=useRef<AudioContext|null>(null),muted=useRef(new Set<string>());
 useEffect(()=>{const timer=setInterval(()=>setNow(new Date().toISOString()),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>()=>{void audio.current?.close();},[]);
 const timers=(query.data?.timers??[]).map(t=>({...t,status:t.batch?timerStatus(t.batch,now):t.status}));
 const alertIds=timers.filter(t=>t.batch&&(t.status==='soon'||t.status==='overdue')).map(t=>t.batch!.id+':'+t.status).sort();
 const alertKey=alertIds.join('|');
 useEffect(()=>{
   if(!sound||!alertKey||query.error)return;
   async function tick(){
     const play=()=>{
       const ctx=audio.current;if(!ctx||ctx.state!=='running')return;
       const at=Date.now(),ids=alertKey.split('|');
       let saved:{muted?:string[];last?:Record<string,number>}={};
       try{saved=JSON.parse(localStorage.getItem('red-koala:freshness-audio')??'{}');}catch{/* Audio remains usable without storage. */}
       const acknowledged=new Set([...(saved.muted??[]),...muted.current]),last=saved.last??{};
       const due=ids.filter(id=>!acknowledged.has(id)&&at-(last[id]??0)>=60000);if(!due.length)return;
       try{localStorage.setItem('red-koala:freshness-audio',JSON.stringify({muted:[...acknowledged].slice(-500),last:Object.fromEntries([...Object.entries(last).filter(([,value])=>at-value<86400000),...due.map(id=>[id,at])])}));}catch{/* Storage is optional. */}
       const osc=ctx.createOscillator(),gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);gain.gain.setValueAtTime(.12,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.5);osc.start();osc.stop(ctx.currentTime+.5);
     };
     if(navigator.locks)await navigator.locks.request('red-koala:freshness-sound',{ifAvailable:true},lock=>{if(lock)play();});else play();
   }
   void tick();const timer=setInterval(()=>void tick(),5000);return()=>clearInterval(timer);
 },[sound,alertKey,query.error]);
 async function toggleSound(){if(sound){setSound(false);return;}try{audio.current??=new AudioContext();await audio.current.resume();if(audio.current.state!=='running')throw new Error();setSound(true);setSoundError('');}catch{setSoundError('声音未获浏览器允许，屏幕提醒仍有效。');}}
 function acknowledge(){alertIds.forEach(id=>muted.current.add(id));try{const saved=JSON.parse(localStorage.getItem('red-koala:freshness-audio')??'{}');localStorage.setItem('red-koala:freshness-audio',JSON.stringify({...saved,muted:[...new Set([...(saved.muted??[]),...alertIds])].slice(-500)}));}catch{/* Session acknowledgement still applies. */}}
 return {...query,now,timers,overdue:query.error||query.loading?null:timers.filter(t=>t.status==='overdue').length,sound,soundError,toggleSound,acknowledge};
}
const Context=createContext<ReturnType<typeof useFreshnessState>|null>(null);
export function FreshnessProvider({children}:{children:ReactNode}){const state=useFreshnessState();return <Context.Provider value={state}>{children}</Context.Provider>;}
export function useFreshness(){const value=useContext(Context);if(!value)throw new Error('FreshnessProvider is required');return value;}
export function FreshnessSound(){const state=useFreshness();return <span className="fresh-sound"><button type="button" className="scale-text-button" onClick={()=>void state.toggleSound()}>{state.sound?'关闭更换提示音':'开启更换提示音'}</button>{state.sound&&state.timers.some(t=>t.status==='soon'||t.status==='overdue')&&<button type="button" className="scale-text-button" onClick={state.acknowledge}>知道了，静音本次</button>}{state.soundError&&<small role="status">{state.soundError}</small>}</span>;}
