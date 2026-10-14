'use client';
import {prepareWrite,type WriteDraft} from './write-draft';
import {z} from 'zod';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {EndpointInput,EndpointName,EndpointResult} from '@zhishan/contracts/operations-v2';
import {createOperationsClient,OperationsClientError,type ResourceState} from './client';
export const operationsClient=createOperationsClient();
export function errorText(error:unknown){return error instanceof z.ZodError?[...new Set(error.issues.map(i=>i.message))].join('；'):error instanceof Error?error.message:'请求失败，请稍后重试';}
export function useResource<K extends EndpointName>(name:K,input:EndpointInput<K>,interval=0,enabled=true){
 const key=JSON.stringify([name,input]),inputRef=useRef(input);inputRef.current=input;
 const [state,setState]=useState<ResourceState<EndpointResult<K>>&{key:string}>({key:'',data:null,loading:true,stale:false,error:null,lastSuccessAt:null});
 const refreshRef=useRef<()=>Promise<void>>(async()=>{});
 useEffect(()=>{
  if(!enabled){refreshRef.current=async()=>{};return;}
  let disposed=false,serial=0,controller:AbortController|null=null,timer:ReturnType<typeof setTimeout>|undefined;
  async function load(){
   const current=++serial;if(timer)clearTimeout(timer);controller?.abort();controller=new AbortController();const active=controller;
   setState(previous=>({...previous,key,data:previous.key===key?previous.data:null,loading:true,error:null,stale:previous.key===key?previous.stale:false,lastSuccessAt:previous.key===key?previous.lastSuccessAt:null}));
   const timeout=setTimeout(()=>active.abort(new Error('请求超时，请重试')),15000);
   try{const data=await operationsClient.request(name,inputRef.current,active.signal);if(!disposed&&current===serial)setState({key,data,loading:false,stale:false,error:null,lastSuccessAt:new Date().toISOString()});}
   catch(error){if(!disposed&&current===serial)setState(previous=>({...previous,key,loading:false,stale:previous.data!==null,error:errorText(active.signal.aborted?active.signal.reason:error)}));}
   finally{clearTimeout(timeout);if(!disposed&&current===serial&&interval)timer=setTimeout(()=>void load(),interval);}
  }
  refreshRef.current=load;void load();
  return()=>{disposed=true;controller?.abort();if(timer)clearTimeout(timer);refreshRef.current=async()=>{};};
  // The serialized input is the query identity. Stable object identity is not required.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,interval,enabled]);
 const refresh=useCallback(()=>refreshRef.current(),[]);
 return {...(state.key===key?state:{data:null,loading:enabled,stale:false,error:null,lastSuccessAt:null}),refresh};
}
export function useWrite<K extends EndpointName>(name:K,onSuccess?:(data:EndpointResult<K>)=>void,onConflict?:()=>void){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<EndpointResult<K>|null>(null),[canRetry,setCanRetry]=useState(false);
 const lock=useRef(false),saved=useRef<WriteDraft<K>|null>(null);
 const [requestId,setRequestId]=useState('');
 function clear(){if(lock.current)return;saved.current=null;setError('');setResult(null);setCanRetry(false);setRequestId('');}
 async function send(input:EndpointInput<K>){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setCanRetry(false);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(new Error('请求超时，结果尚未确认。可用同一请求编号重试。')),20000);
  try{const value=await operationsClient.request(name,input,controller.signal);setResult(value);onSuccess?.(value);}
  catch(e){const error=controller.signal.aborted?controller.signal.reason:e;setError(errorText(error));setResult(null);
   const conflict=e instanceof OperationsClientError&&e.status===409;
   if(conflict){saved.current=null;onConflict?.();setError(`${errorText(e)}。正在刷新当前状态，请核对后重新提交。`);}
   else setCanRetry(!(e instanceof OperationsClientError)||e.detail?.error.retryable===true||e.status>=500);
  }finally{clearTimeout(timeout);lock.current=false;setBusy(false);}
 }
 async function submit(input:EndpointInput<K>){
  if(lock.current)return;
  saved.current=prepareWrite(input,saved.current);setRequestId(saved.current.requestId);
  await send(saved.current!.input);
 }
 return {busy,error,result,requestId,canRetry,submit,retry:()=>saved.current?send(saved.current.input):Promise.resolve(),clear};
}
export function localTime(value:string|null){return value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知';}
export function localInput(){return new Date(Date.now()+8*3600000).toISOString().slice(0,19);}
export function inputTime(value:string){return new Date(value+'+08:00').toISOString();}
export function grams(value:number|null|undefined){return value==null?'未知':`${value.toLocaleString('zh-CN',{maximumFractionDigits:3})} g`;}
export function evidence(value:string){return [...new Set(value.split(/[\s,，]+/).map(v=>v.trim()).filter(Boolean))];}
export function dateToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function shiftDate(date:string,days:number){return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
