/** Single boundary for the main system's authoritative demo-v1 contract. No business reducer here. */
import type { DemoState, DemoEvent, EventsResponse, ManifestResponse, Reports } from '@zhishan/contracts/demo-v1';
import { eventSchema } from '@zhishan/contracts/demo-v1';
import { canonicalManifest } from './demo/digest';
import { inWindow, pointAt, distance, wrap, type Point, type SceneManifest } from './demo/layout';
export type { DemoEvent, Reports };
export type Movement = {path:Point[];startTimeMs:number;endTimeMs:number};
export type State = Omit<DemoState,'customers'|'staff'> & {customers:(DemoState['customers'][number]&{movement?:Movement|null})[];staff:(DemoState['staff'][number]&{position?:Point;movement?:Movement|null})[]};
const fail=(message:string):never=>{throw Error(message);};
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
const id=(v:unknown)=>typeof v==='string'&&v.length>0;
export const identity=(s:Pick<State,'sessionId'|'generation'|'datasetId'|'layoutVersion'>)=>[s.sessionId,s.generation,s.datasetId,s.layoutVersion].join('|');
export async function verifyDigest(scene:SceneManifest){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalManifest(scene)));
 const actual='sha256:'+Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('');
 if(actual!==scene.contentDigest)fail('DIGEST_MISMATCH: 本地场景清单摘要无效');
}
export function validateMovement(movement:Movement|undefined|null){
 if(!movement)return;
 if(!integer(movement.startTimeMs)||!integer(movement.endTimeMs)||movement.endTimeMs<=movement.startTimeMs||!Array.isArray(movement.path)||movement.path.length<2||movement.path.some(p=>!finite(p.x)||!finite(p.z)))fail('SPATIAL_INVALID: 行走路径/时间无效');
}
export function parseState(value:unknown,scene:SceneManifest):State {
 const s=value as State;
 if(!s||s.contractVersion!=='1.0.0'||s.source!=='simulation'||!id(s.datasetId)||!id(s.sessionId)||!integer(s.generation)||!integer(s.revision)||!integer(s.simTimeMs))fail('SCHEMA_INVALID: 元数据或来源不匹配');
 if(s.layoutVersion!==scene.layoutVersion||s.sceneDigest!==scene.contentDigest)fail('DIGEST_MISMATCH: 数据与当前布局不匹配');
 if(!s.playback||!['running','paused','completed'].includes(s.playback.status)||!integer(s.playback.durationMs)||s.simTimeMs>s.playback.durationMs||typeof s.eventCursor!=='string')fail('SCHEMA_INVALID: 播放状态无效');
 if(!Array.isArray(s.plates)||!Array.isArray(s.customers)||!Array.isArray(s.staff)||!Array.isArray(s.tasks)||!Array.isArray(s.activeEvents)||!Array.isArray(s.dishes))fail('SCHEMA_INVALID: 缺少实体列表');
 const plateIds=new Set<string>(),customerIds=new Set<string>(),occupied=new Set<string>();
 for(const p of s.plates){
  const binding=scene.plates.find(b=>b.plateId===p.plateId),slot=scene.slots.find(x=>x.slotId===p.slotId),track=scene.tracks.find(t=>t.trackId===slot?.trackId);
  if(!binding||!slot||!track||binding.slotId!==p.slotId||binding.dishId!==p.dishId||track.trackId!==p.trackId||plateIds.has(p.plateId))fail(`REFERENCE_INVALID: ${p.plateId}`);
  if(!finite(p.fullG)||p.fullG<=0||p.remainingG!==null&&(!finite(p.remainingG)||p.remainingG<0)||!['good','offline','stale','unknown','removed','uncertain'].includes(p.quality)||!['full','half','low','empty','unknown'].includes(p.remainingStatus))fail(`SCHEMA_INVALID: 餐盘 ${p.plateId}`);
  if(p.freshness&&(!['unconfigured','fresh','warning','expired'].includes(p.freshness.state)||(p.freshness.startedAtMs!==null&&!Number.isSafeInteger(p.freshness.startedAtMs))||p.freshness.warningAtMs!==null&&!Number.isSafeInteger(p.freshness.warningAtMs)||p.freshness.expiresAtMs!==null&&!Number.isSafeInteger(p.freshness.expiresAtMs)))fail('SCHEMA_INVALID: 更换时限');
  const expected=wrap(slot!.s0M+(track!.enabled?track!.direction*track!.speedMps*s.simTimeMs/1000:0),track!.lengthM);
  if(!finite(p.sM)||Math.abs(wrap(p.sM-expected+track!.lengthM/2,track!.lengthM)-track!.lengthM/2)>.002)fail(`SPATIAL_INVALID: ${p.plateId} 轨道位置不一致`);
  if(!s.dishes.some(d=>d.dishId===p.dishId))fail('REFERENCE_INVALID: 缺少业务菜品');plateIds.add(p.plateId);
 }
 if(plateIds.size!==scene.plates.length)fail('CAPACITY_INVALID: 物理餐盘缺失');
 for(const c of s.customers){
  if(!id(c.customerId)||customerIds.has(c.customerId)||!['walking','seated','left'].includes(c.status)||!integer(c.enteredAtMs)||c.enteredAtMs>s.simTimeMs||c.status==='left'&&(!integer(c.leftAtMs)||c.leftAtMs!>s.simTimeMs))fail('SCHEMA_INVALID: 顾客记录无效');
  customerIds.add(c.customerId);validateMovement(c.movement);
  if(c.status==='seated'){
   if(!c.seatId||!scene.seats.some(seat=>seat.seatId===c.seatId&&seat.usable)||occupied.has(c.seatId!))fail('CAPACITY_INVALID: 座位无效或重复占用');occupied.add(c.seatId!);
  }
 }
 const expected={carryingPositionCount:scene.slots.filter(x=>x.usable).length,actualPlateCount:scene.plates.length,dishTypeCount:new Set(scene.plates.map(p=>p.dishId)).size,availableSeatCount:scene.seats.filter(x=>x.usable).length,seatedCustomerCount:occupied.size,inStoreCustomerCount:s.customers.filter(c=>c.status!=='left').length,sceneCustomerEntityCount:s.customers.filter(c=>c.status!=='left').length};
 for(const [key,value] of Object.entries(expected))if(s.summary?.[key as keyof typeof expected]!==value)fail(`CAPACITY_INVALID: ${key} 应为 ${value}`);
 for(const staff of s.staff)validateMovement(staff.movement);
 for(const e of s.activeEvents)validateEvent(e,scene);
 return s;
}
export function validateEvent(e:DemoEvent,scene:SceneManifest){
 if(!e||!id(e.eventId)||!id(e.targetEntityId)||!integer(e.startTimeMs)||!integer(e.applyTimeMs)||!integer(e.endTimeMs)||e.startTimeMs>e.applyTimeMs||e.applyTimeMs>e.endTimeMs)fail('SCHEMA_INVALID: 事件时序无效');
 const derived=['task.created','task.ready','task.completed','alert.changed','quality.expired','action.started','action.ended','playback.completed'];
 if(derived.includes(e.eventType)){
  if(e.layer!=='derived'||!('status'in e)||!id(e.status)||('taskId'in e&&e.taskId!==undefined&&!id(e.taskId)))fail('SCHEMA_INVALID: 派生事件无效');
 }else if(!eventSchema.safeParse(e).success)fail('SCHEMA_INVALID: 事件载荷无效');
 if('plateId'in e&&e.plateId!==undefined&&!scene.plates.some(p=>p.plateId===e.plateId))fail('REFERENCE_INVALID: 事件餐盘不存在');
 if('seatId'in e&&!scene.seats.some(s=>s.seatId===e.seatId&&s.usable))fail('REFERENCE_INVALID: 事件座位不存在');
 if(e.eventType==='customer.take'||e.eventType==='staff.refill'){
  const binding=scene.plates.find(p=>p.plateId===e.plateId),slot=scene.slots.find(s=>s.slotId===binding?.slotId),track=scene.tracks.find(t=>t.trackId===slot?.trackId);
  const w=e.eventType==='customer.take'?scene.seats.find(s=>s.seatId===e.seatId)?.takeWindow:scene.servingWindows.find(w=>w.windowId===e.windowId);
  if(!track||!slot||!w||!track.enabled||w.trackId!==track.trackId)fail(`SPATIAL_INVALID: ${e.eventId} 窗口/餐盘无效`);
  const at=wrap(slot!.s0M+track!.direction*track!.speedMps*e.applyTimeMs/1000,track!.lengthM);
  if(!inWindow(track!,at,w!))fail(`SPATIAL_INVALID: ${e.eventId} 生效时餐盘不在窗口内`);
 }
}
export function interpolateMovement(m:Movement,time:number):Point&{angle:number}{
 const lengths=m.path.slice(1).map((p,i)=>distance(p,m.path[i])),total=lengths.reduce((a,b)=>a+b,0);
 let remaining=total*Math.max(0,Math.min(1,(time-m.startTimeMs)/(m.endTimeMs-m.startTimeMs)));
 for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]||i===lengths.length-1){const a=m.path[i],b=m.path[i+1],t=lengths[i]?remaining/lengths[i]:1;return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,angle:Math.atan2(b.x-a.x,b.z-a.z)};}remaining-=lengths[i];}
 return {...m.path.at(-1)!,angle:0};
}
/** Delayed presentation of the shared clock, not an independently integrated simulation.
 * A 900ms buffer absorbs 300ms polls + network jitter. The anchor does not reset at every
 * response, so normal packets cannot create sawtooth motion. Confirmed server time still
 * caps advancement; after disconnection every visual freezes within a finite horizon.
 */
export class SharedClock {
 state:State|null=null;receivedAt=0;
 readonly bufferMs=900;readonly extrapolationLimitMs=250;readonly staleAfterMs=1500;
 private anchorSim=0;private anchorNow=0;private floorSim=0;
 accept(state:State,now:number){
  const old=this.state;
  const reset=!old||identity(old)!==identity(state)||now-this.receivedAt>this.staleAfterMs;
  const controlChange=old&&old.playback.status!==state.playback.status;
  if(reset||controlChange){this.anchorSim=state.simTimeMs;this.anchorNow=now;this.floorSim=state.simTimeMs;}
  this.state=state;this.receivedAt=now;
 }
 time(now:number){const s=this.state;if(!s)return 0;
  // Playback controls are explicit resynchronisation boundaries. All visual domains use this value.
  if(s.playback.status==='paused')return s.simTimeMs;
  if(s.playback.status==='completed')return s.simTimeMs;
  return Math.max(this.floorSim,Math.min(s.playback.durationMs,s.simTimeMs+this.extrapolationLimitMs,this.anchorSim+Math.max(0,now-this.anchorNow)-this.bufferMs));
 }
 stale(now:number){return !this.state||now-this.receivedAt>this.staleAfterMs;}
}
/** State values are selected, never recomputed from weights or business rules.
 * A snapshot becomes visible at its latest effective event. The buffer ensures a normal
 * post-event snapshot is available before the delayed presentation reaches applyTimeMs.
 */
export class PresentationBuffer {
 private frames:{state:State;effectiveMs:number}[]=[];
 add(state:State,events:DemoEvent[]){
  const previous=this.frames.at(-1);
  if(previous&&identity(previous.state)!==identity(state))this.frames=[];
  const same=this.frames.at(-1);
  const effectTimes=events.flatMap(e=>[e.startTimeMs,e.applyTimeMs]).filter(t=>t<=state.simTimeMs);
  const effectiveMs=Math.max(same?.effectiveMs??0,...effectTimes);
  // Repeated paused/completed snapshots share a time boundary. Retain only the
  // latest snapshot there, otherwise a finished demo grows this buffer forever.
  if(same&&same.effectiveMs===effectiveMs)this.frames[this.frames.length-1]={state,effectiveMs};
  else this.frames.push({state,effectiveMs});
  const cut=state.simTimeMs-5000;while(this.frames.length>2&&this.frames[1].state.simTimeMs<cut)this.frames.shift();
 }
 at(time:number):State|null{
  for(let i=this.frames.length-1;i>=0;i--)if(this.frames[i].effectiveMs<=time)return this.frames[i].state;
  return null;
 }
 reset(){this.frames=[];}
}
export class StateSource {
 latest:State|null=null;remoteManifest:ManifestResponse|null=null;reports:Reports|null=null;events=new Map<string,DemoEvent>();clock=new SharedClock();presentation=new PresentationBuffer();error='';connected=false;manifestVerified=false;
 private busy=false;private needsSync=true;private cursor:string|null=null;private inFlight:Promise<void>|null=null;
 constructor(readonly baseUrl:string,readonly scene:SceneManifest,private receive:(state:State)=>void,private fetcher:typeof fetch=globalThis.fetch.bind(globalThis),private now=()=>performance.now()){}
 private async request(path:string,init?:RequestInit){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);try{const r=await this.fetcher(this.baseUrl+path,{...init,cache:'no-store',signal:controller.signal});const body=await r.text();let data;try{data=JSON.parse(body);}catch{throw Error(`HTTP ${r.status}: 主系统未就绪或返回非 JSON`);}if(!r.ok){const code=data?.error?.code;if(['CURSOR_EXPIRED','CURSOR_INVALID','SESSION_CONFLICT'].includes(code))this.needsSync=true;throw Error(`${code??r.status}: ${data?.error?.message??'接口失败'}`);}return data;}finally{clearTimeout(timer);}}
 private apply(value:unknown,incoming:DemoEvent[]=[]){const state=parseState(value,this.scene),changed=!this.latest||identity(state)!==identity(this.latest);
  if(!changed&&state.revision<this.latest!.revision)fail('SCHEMA_INVALID: 旧状态版本');
  if(!changed&&state.simTimeMs<this.latest!.simTimeMs)fail('SCHEMA_INVALID: 共享时间倒退');
  // Validate the whole response before replacing the last good state. A rejected
  // event must not partially advance the clock, cursor or visible event stream.
  const events=new Map(changed?[]:this.events);
  for(const e of [...incoming,...state.activeEvents]){
   validateEvent(e,this.scene);const old=events.get(e.eventId);
   if(old&&JSON.stringify(old)!==JSON.stringify(e))fail(`SCHEMA_INVALID: 事件 ${e.eventId} 内容冲突`);
   events.set(e.eventId,e);
  }
  for(const [key,e]of events)if(e.endTimeMs<state.simTimeMs-5000)events.delete(key);
  if(changed)this.presentation.reset();
  this.events=events;
  this.latest=state;this.clock.accept(state,this.now());this.cursor=state.eventCursor;
  // The contract already embeds reports in the state snapshot. Using that exact
  // revision avoids an extra request and a report outage masking healthy state.
  const reports=state.reports;
  this.reports=reports&&identity(reports)===identity(state)&&reports.revision===state.revision&&reports.simTimeMs===state.simTimeMs?reports:null;
  this.presentation.add(state,[...this.events.values()]);this.receive(state);
 }
 poll():Promise<void>{if(this.inFlight)return this.inFlight;const task=this.pollOnce();this.inFlight=task;void task.finally(()=>{this.inFlight=null;});return task;}
 private async pollOnce(){if(this.busy)return;this.busy=true;try{
  if(this.needsSync){const response=await this.request('/manifest') as ManifestResponse;this.remoteManifest=response;if(response.contractVersion!=='1.0.0'||response.scene.layoutVersion!==this.scene.layoutVersion||response.scene.contentDigest!==this.scene.contentDigest)fail('DIGEST_MISMATCH: 主系统场景版本不匹配');this.manifestVerified=true;this.apply(await this.request('/state'));this.needsSync=false;}
  else {
   // Capture a new snapshot, then drain events from the OLD boundary. Keeping the snapshot
   // cursor (not the newer stream cursor) prevents events in the HTTP gap from being lost.
   const previousCursor=this.cursor,raw=await this.request('/state');
   if(!this.latest||identity(raw)!==identity(this.latest)){this.needsSync=true;this.events.clear();return;}
   const stream=await this.request('/events?after='+encodeURIComponent(previousCursor??'')) as EventsResponse;
   if(identity(stream)!==identity(raw)){this.needsSync=true;this.events.clear();return;}
   if(stream.contractVersion!=='1.0.0'||stream.source!=='simulation'||!Array.isArray(stream.events)||typeof stream.eventCursor!=='string')fail('SCHEMA_INVALID: 事件流无效');
   this.apply(raw,stream.events);
  }
  this.error='';this.connected=true;
 }catch(error){this.error=error instanceof Error?error.message:String(error);this.connected=false;this.needsSync=true;}finally{this.busy=false;}}
 async control(action:'pause'|'resume'|'restart'){
  if(!this.latest)throw Error('尚未连接共享会话');
  // Stop polling during control, then resnapshot to avoid an older in-flight GET overwriting it.
  if(this.inFlight)await this.inFlight;if(this.busy)throw Error('播放控制正在执行');this.busy=true;
  const requestId=crypto.randomUUID(),s=this.latest;
  const init={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,requestId,sessionId:s.sessionId,generation:s.generation})};
  try{let result;try{result=await this.request('/control',init);}catch(e){if(String(e).includes('Abort')||String(e).includes('fetch'))result=await this.request('/control',init);else throw e;}this.apply(result);this.error='';}
  catch(error){this.error=String(error);throw error;}finally{this.needsSync=true;this.busy=false;}
 }
 status(){if(!this.latest)return this.error?`等待主系统 · ${this.error}`:'正在连接主系统';if(this.error)return `连接异常 · ${this.error}`;if(this.clock.stale(this.now()))return '连接中断 · 画面已冻结';return this.latest.playback.status==='paused'?'共享播放已暂停':this.latest.playback.status==='completed'?'本次演示已完成':'仿真数据 · 共享时钟在线（呈现缓冲 0.9s）';}
}
