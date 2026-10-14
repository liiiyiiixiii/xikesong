import type {SceneManifest,DemoState} from '@zhishan/contracts/demo-v1';
import {plateAlerts} from '@zhishan/contracts/kitchen-display';
const wrap=(n:number,length:number)=>((n%length)+length)%length;
type Point={x:number;z:number};
const inside=(p:Point,polygon:Point[])=>{let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)yes=!yes;}return yes;};
const crossingsCache=new WeakMap<SceneManifest,Map<string,number[]>>();
function kitchenCrossings(scene:SceneManifest,track:SceneManifest['tracks'][number]){
 let cache=crossingsCache.get(scene);if(!cache){cache=new Map();crossingsCache.set(scene,cache);}const cached=cache.get(track.trackId);if(cached)return cached;
 const hits:number[]=[],poly=scene.kitchen.boundary;
 for(let i=1;i<track.arcLengthLut.length;i++){
  const a=track.arcLengthLut[i-1],b=track.arcLengthLut[i],dx=b.x-a.x,dz=b.z-a.z;
  for(let j=0;j<poly.length;j++){const c=poly[j],d=poly[(j+1)%poly.length],ex=d.x-c.x,ez=d.z-c.z,den=dx*ez-dz*ex;if(Math.abs(den)<1e-10)continue;const t=((c.x-a.x)*ez-(c.z-a.z)*ex)/den,u=((c.x-a.x)*dz-(c.z-a.z)*dx)/den;if(t>=0&&t<=1&&u>=0&&u<=1)hits.push(wrap(a.sM+(b.sM-a.sM)*t,track.lengthM));}
 }
 const result=[...new Set(hits.map(x=>Math.round(x*1e8)/1e8))];cache.set(track.trackId,result);return result;
}
function point(track:SceneManifest['tracks'][number],s:number){const lut=track.arcLengthLut;let i=1;while(i<lut.length-1&&lut[i].sM<s)i++;const a=lut[i-1],b=lut[i],f=(s-a.sM)/(b.sM-a.sM);return {x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f};}
export function demoKitchenView(scene:SceneManifest,state:DemoState,windowId?:string,time=state.simTimeMs){
 const window=scene.servingWindows.find(w=>w.windowId===windowId)??scene.servingWindows[0],track=scene.tracks.find(t=>t.trackId===window?.trackId);
 const entry=track&&window?kitchenCrossings(scene,track).sort((a,b)=>wrap((window.centerSM-a)*track.direction,track.lengthM)-wrap((window.centerSM-b)*track.direction,track.lengthM))[0]??window.centerSM:0;
 const cards=state.plates.map(p=>{const slot=scene.slots.find(s=>s.slotId===p.slotId),t=scene.tracks.find(t=>t.trackId===p.trackId),sM=slot&&t?wrap(slot.s0M+(t.enabled?t.direction*t.speedMps*time/1000:0),t.lengthM):p.sM;
  return {id:p.plateId,trackId:p.trackId,name:state.dishes.find(d=>d.dishId===p.dishId)?.name??p.dishId,percent:p.quality==='good'&&p.remainingG!==null?Math.round(p.remainingG/p.fullG*100):null,alerts:t?.enabled?plateAlerts({known:p.quality==='good'&&p.remainingG!==null,empty:p.remainingStatus==='empty',refill:p.remainingStatus==='low',freshness:p.freshness?.state}):[],distanceM:track&&window?wrap((entry-sM)*track.direction,track.lengthM):null,inWindow:!!t&&inside(point(t,sM),scene.kitchen.boundary)};});
 return {windowId:window?.windowId??null,windows:scene.servingWindows.map((w,i)=>({id:w.windowId,name:`补菜窗口 ${i+1}${scene.tracks.find(t=>t.trackId===w.trackId)?.enabled?'':' · 未启用'}`,pending:cards.filter(c=>c.trackId===w.trackId&&c.alerts.length>0).length})),upcoming:cards.filter(c=>track?.enabled&&c.trackId===track?.trackId&&!c.inWindow).sort((a,b)=>a.distanceM!-b.distanceM!||a.id.localeCompare(b.id)).slice(0,10),processing:cards.filter(c=>c.trackId===track?.trackId&&c.inWindow&&c.alerts.length>0)};
}
