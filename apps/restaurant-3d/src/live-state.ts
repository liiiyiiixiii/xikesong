import {kitchenBoardSchema,conveyorStateSchema} from '@zhishan/contracts/v2/kitchen';
import { servingResponseSchema, type ServingView, type Bowl } from '@zhishan/contracts/v2/serving';

export type LiveSession = { authenticated: false } | { authenticated: true; actor: { id: string; label: string }; role: 'staff' | 'manager'; environment: ServingView['environment'] };
export function parseSession(value: unknown): LiveSession {
 const v = value as Record<string, any> | null;
 if (v?.authenticated === false) return { authenticated: false };
 if (v?.authenticated !== true || !v.actor || typeof v.actor.id !== 'string' || !v.actor.id || typeof v.actor.label !== 'string' || !v.actor.label || !['staff','manager'].includes(v.role) || !['test','demo','live'].includes(v.environment)) throw Error('会话响应格式无效');
 return { authenticated: true, actor: { id: v.actor.id, label: v.actor.label }, role: v.role, environment: v.environment };
}
export function parseServing(value: unknown, session: LiveSession): ServingView {
 const result = servingResponseSchema.safeParse(value);
 if (!result.success) throw Error('供餐响应不符合业务契约');
 const state = result.data;
 if (!session.authenticated || state.environment !== session.environment) throw Error('会话与供餐数据环境不一致');
 if (new Set(state.bowls.map(b => b.bindingId)).size !== state.bowls.length) throw Error('供餐响应含重复绑定');
 if (state.bowls.some(b => [b.observedAt,b.confirmedAt,b.locationObservedAt].some(t => t !== null && Date.parse(t) > Date.parse(state.serverAt)))) throw Error('供餐依据时间晚于服务器时间');
 return state;
}
/** A display arrangement, never a claim about a bowl's physical location. */
export function projectLiveBowls(state: ServingView | null, usable: boolean) {
 const bowls = [...(state?.bowls ?? [])].sort((a,b) => (a.positionOrder ?? Infinity) - (b.positionOrder ?? Infinity) || a.scaleId.localeCompare(b.scaleId) || a.bindingId.localeCompare(b.bindingId));
 const columns = Math.max(1,Math.min(8,Math.ceil(Math.sqrt(bowls.length))));
 return bowls.map((b,index) => {
  const bowl: Bowl = usable ? b : { ...b, quality:'stale', servingState:'unknown', recommendation:'verify', loadNetG:null, foodRemainingG:null, estimatedFoodG:null, zone:'unknown', locationQuality:'stale' };
  const known = usable && ['good','estimated'].includes(bowl.quality) && bowl.foodRemainingG !== null;
  return { bindingId:b.bindingId, bowl, x:(index % columns-(columns-1)/2)*.55, z:Math.floor(index/columns)*.58,
   ratio:known ? Math.min(1,bowl.foodRemainingG!/bowl.fullFoodG) : null };
 });
}
class HttpFailure extends Error { constructor(readonly status:number,message:string){super(message);} }
export class LiveStateSource {
 kitchen:ReturnType<typeof kitchenBoardSchema.parse>|null=null; conveyor:ReturnType<typeof conveyorStateSchema.parse>|null=null;
 session:LiveSession|null=null; latest:ServingView|null=null; error=''; lastSuccessAt:number|null=null;
 private inFlight:Promise<void>|null=null;
 constructor(private fetcher:typeof fetch=globalThis.fetch.bind(globalThis),private now=()=>performance.now(),readonly responseFreshMs=15000,readonly extended=false){}
 private async request(path:string,method:'GET'|'POST'|'DELETE'='GET',token?:string){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try { const r=await this.fetcher('/api/v2/'+path,{method,cache:'no-store',credentials:'same-origin',signal:controller.signal,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}:{})});
   let body:unknown;try{body=JSON.parse(await r.text());}catch{throw Error(`HTTP ${r.status}：业务接口未返回 JSON`);}
   if(!r.ok)throw new HttpFailure(r.status,(body as {error?:{message?:string}})?.error?.message??`业务接口 HTTP ${r.status}`);return body;
  } finally { clearTimeout(timer); }
 }
 private clear(){this.kitchen=null;this.conveyor=null;this.latest=null;this.lastSuccessAt=null;}
 usable(){return !!this.latest && this.session?.authenticated===true && !this.error && this.lastSuccessAt!==null && this.now()-this.lastSuccessAt<=this.responseFreshMs;}
 poll():Promise<void>{if(this.inFlight)return this.inFlight;const task=this.read();this.inFlight=task;void task.finally(()=>{this.inFlight=null;});return task;}
 private async read(){try{
  const session=parseSession(await this.request('session'));
  if(session.authenticated&&this.session?.authenticated&&session.actor.id!==this.session.actor.id)this.clear();this.session=session;
  if(!session.authenticated){this.clear();this.error='';return;}
  if(this.latest&&this.latest.environment!==session.environment)this.clear();
  let next:ServingView;let nextKitchen=this.kitchen,nextConveyor=this.conveyor;
  if(this.extended){
   const board=kitchenBoardSchema.parse(await this.request('kitchen/board')),conveyor=conveyorStateSchema.parse(await this.request('conveyor/state'));
   if(board.environment!==session.environment||conveyor.environment!==session.environment)throw Error('轨道与会话环境不一致');
   next=parseServing({contractVersion:board.contractVersion,serverAt:board.serverAt,dataRevision:board.dataRevision,environment:board.environment,bowls:board.all.map(c=>c.bowl)},session);
   nextKitchen=board;nextConveyor=conveyor;
  }else next=parseServing(await this.request('serving/state'),session);
  if(this.latest&&Date.parse(next.serverAt)<Date.parse(this.latest.serverAt))throw Error('拒绝倒退的供餐快照');
  this.kitchen=nextKitchen;this.conveyor=nextConveyor;this.latest=next;this.lastSuccessAt=this.now();this.error='';
 }catch(error){this.error=error instanceof Error?error.message:String(error);if(error instanceof HttpFailure&&[401,403].includes(error.status)){this.session={authenticated:false};this.clear();}}}
 async login(token:string){if(this.inFlight)await this.inFlight;this.clear();this.session=parseSession(await this.request('session','POST',token));this.error='';await this.poll();}
 async logout(){if(this.inFlight)await this.inFlight;this.session=parseSession(await this.request('session','DELETE'));this.clear();this.error='';}
}
