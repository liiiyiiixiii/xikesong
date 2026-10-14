'use client';
import {useEffect,useRef,useState} from 'react';
import type {RefillTask} from '@zhishan/contracts/operations-v2';
export function AlertSound({eventKeys,unavailable,environment,kind}:{eventKeys:string[];unavailable:boolean;environment:string;kind:'refill'|'freshness'}){
 const [enabled,setEnabled]=useState(false),[error,setError]=useState('');
 const audio=useRef<AudioContext|null>(null),played=useRef(new Set<string>());
 const key=[...eventKeys].sort().join('|'),label=kind==='refill'?'补菜':'更换时限';
 useEffect(()=>()=>{void audio.current?.close();},[]);
 useEffect(()=>{
  if(!enabled||unavailable||!key)return;
  let active=true;
  function play(){
   const context=audio.current;if(!active||context?.state!=='running')return;
   const storageKey=`red-koala:${kind}-audio:${environment}`;
   let saved:string[]=[];try{const value=JSON.parse(localStorage.getItem(storageKey)??'[]');if(Array.isArray(value))saved=value.filter(v=>typeof v==='string');}catch{/* Sound is optional when browser storage is unavailable. */}
   const prior=new Set([...saved,...played.current]),fresh=key.split('|').filter(id=>!prior.has(id));if(!fresh.length)return;
   fresh.forEach(id=>{prior.add(id);played.current.add(id);});
   try{localStorage.setItem(storageKey,JSON.stringify([...prior].slice(-1000)));}catch{/* In-memory deduplication still applies. */}
   const oscillator=context.createOscillator(),gain=context.createGain();oscillator.frequency.setValueAtTime(kind==='refill'?660:440,context.currentTime);oscillator.connect(gain);gain.connect(context.destination);gain.gain.setValueAtTime(.1,context.currentTime);gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+.3);oscillator.start();oscillator.stop(context.currentTime+.3);
  }
  if(navigator.locks)void navigator.locks.request(`red-koala:${kind}-audio:${environment}`,()=>play());else play();
  return()=>{active=false;};
 },[enabled,unavailable,key,environment,kind]);
 return <div className="ops-alert-controls"><button onClick={async()=>{if(enabled){setEnabled(false);return;}try{audio.current??=new AudioContext();await audio.current.resume();if(audio.current.state!=='running')throw Error();setEnabled(true);setError('');}catch{setError('浏览器未允许声音，任务列表仍会更新。');}}}>{enabled?'关闭'+label+'提示音':'开启'+label+'提示音'}</button><small className="ops-muted">{label}提示 · 仅当前页面打开时有效。</small>{error&&<span role="status">{error}</span>}</div>;
}

export default function TaskAlert({tasks,unavailable,environment}:{tasks:RefillTask[];unavailable:boolean;environment:string}){
 return <AlertSound kind="refill" environment={environment} unavailable={unavailable} eventKeys={tasks.filter(t=>['open','claimed'].includes(t.status)&&t.priority!=='normal').map(t=>`${t.id}:${t.version}`)}/>;
}
