"use client";
import { useEffect,useState } from 'react';
type Result={status:string;title?:string;text?:string;message?:string};
export default function TrendSummary({date,days,dishId,fingerprint}:{date:string;days:number;dishId:string;fingerprint:string}){
 const [result,setResult]=useState<Result|null>(null),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let disposed=false;let retry:ReturnType<typeof setTimeout>|undefined;
 async function run(){try{const response=await fetch('/api/intelligence/trend-summary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,days,dishId,retry:attempt>0})});const value=await response.json() as Result;if(disposed)return;if(!response.ok)throw new Error();setResult(value);if(value.status==='pending')retry=setTimeout(()=>void run(),3000);}catch{if(!disposed)setResult({status:'failed',message:'AI 趋势判断暂不可用，图表仍可查看。'});}}
 const timer=setTimeout(()=>void run(),800);return()=>{disposed=true;clearTimeout(timer);clearTimeout(retry);};
 },[date,days,dishId,fingerprint,attempt]);
 return <div aria-live="polite" className="trend-ai-summary">{result?.status==='ready'?<><strong>AI 判断 · {result.title}</strong><p>{result.text}</p></>:<p className="scale-muted">{result?.message??'AI 正在生成趋势判断…'}</p>}{result?.status==='failed'&&<button className="week-text-button" onClick={()=>{setResult(null);setAttempt(n=>n+1);}}>重试 AI 判断</button>}</div>;
}
