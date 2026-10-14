import {PlateCallouts} from './plate-callouts';
import {plateAlerts,plateAlertText} from '@zhishan/contracts/kitchen-display';
import {livePositions} from './live-position';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createPlateAssembly,createCarrierBrandMaterial} from './plate-model';
import {LiveStateSource,projectLiveBowls} from './live-state';
import {qualityLabels} from '@zhishan/contracts/v2/serving';
import './live-style.css';

export async function bootLive(workbenchUrl?:unknown){
 document.title='红考拉 · 供餐业务 3D';document.querySelector('#plates-dialog')?.remove();
 const app=document.getElementById('app')!;
 app.innerHTML=`<header class="live-header"><div class="brand-mark">考</div><div><span class="eyebrow">KOALA FARM · SERVING</span><h1>红考拉<span>供餐业务 3D</span></h1></div><nav><a href="./">演示模式</a><a href="/operations/kitchen" id="live-kitchen" target="_blank" rel="noopener">后厨十盘屏 ↗</a><a href="/operations" id="live-workbench" target="_blank" rel="noopener">业务工作台 ↗</a></nav></header>
 <main class="live-layout"><section><div class="scene-toolbar"><strong id="live-status" role="status">正在核验会话</strong><div class="view-controls"><button id="live-perspective">立体</button><button id="live-top">俯视</button><button id="live-refresh">刷新</button></div></div><div class="live-scene"><canvas id="live-canvas" aria-label="当前供餐碗位固定排列图"></canvas><p id="live-diagnostic" role="alert" hidden></p></div><p class="live-note" id="live-position-note">等待轨道信息。未校准时仅展示固定排列。</p><div id="live-summary" class="live-summary"></div></section>
 <aside class="live-aside"><div id="live-identity"></div><form id="live-login"><h2>登录供餐视图</h2><label>工作站凭证<input id="live-token" type="password" autocomplete="off" required></label><button type="submit">登录</button><p>会话与业务工作台共用。凭证仅用于本次登录。</p></form><button id="live-logout" hidden>退出登录</button><p id="live-meta"></p><label id="live-search-label" hidden>查找菜品或设备<input id="live-search" type="search" placeholder="菜品、设备、绑定"></label><div id="live-list" class="live-list"></div></aside></main>`;
 const $=<E extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as E;
 const write=(id:string,value:string)=>{$(id).textContent=value;};
 if(typeof workbenchUrl==='string'){const target=new URL(workbenchUrl,location.href);if(['http:','https:'].includes(target.protocol)){$<HTMLAnchorElement>('live-workbench').href=target.href;$<HTMLAnchorElement>('live-kitchen').href=new URL('/operations/kitchen',target).href;}}
 // The workbench is served by the same business host via the deployment proxy.
 const source=new LiveStateSource(globalThis.fetch.bind(globalThis),()=>performance.now(),5000,true),canvas=$<HTMLCanvasElement>('live-canvas');
 const renderer=new T.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.outputColorSpace=T.SRGBColorSpace;
 const callouts=new PlateCallouts(canvas);
 const scene=new T.Scene();scene.background=new T.Color(0xebe8df);scene.add(new T.HemisphereLight(0xfff8e7,0x778679,3));
 const light=new T.DirectionalLight(0xffffff,3);light.position.set(-2,5,4);scene.add(light);
 const camera=new T.OrthographicCamera(-3,3,3,-3,.01,100),orbit=new OrbitControls(camera,canvas);orbit.enableDamping=true;orbit.minZoom=.5;orbit.maxZoom=4;orbit.maxPolarAngle=Math.PI*.48;
 const brand=createCarrierBrandMaterial();
 type Model={root:T.Group;food:T.Mesh<T.CylinderGeometry,T.MeshStandardMaterial>;ring:T.Mesh;label:T.Sprite;labelText:string};
 const models=new Map<string,Model>();let extent=3,centerZ=0,selected:string|null=null,lastUi=-Infinity,renderedFrames=0,viewTop=false;
 const stamp=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'无观测';
 const env={test:'测试环境',demo:'模拟环境',live:'实际运行环境'};
 function view(){orbit.target.set(0,0,centerZ);camera.position.set(viewTop?0:2,viewTop?8:5,centerZ+(viewTop?.001:5));camera.lookAt(orbit.target);camera.zoom=1;camera.updateProjectionMatrix();orbit.update();}
 function resize(){const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);const ratio=w/h;camera.left=-extent*ratio;camera.right=extent*ratio;camera.top=extent;camera.bottom=-extent;camera.updateProjectionMatrix();}
 function label(text:string){const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d')!;ctx.fillStyle='#f8f5eb';ctx.fillRect(0,0,512,128);ctx.fillStyle='#304c3c';ctx.font='bold 38px sans-serif';ctx.textAlign='center';const lines=text.split('\n');ctx.fillText(lines[0],256,48,495);ctx.font='28px sans-serif';ctx.fillText(lines[1]??'',256,94,495);const map=new T.CanvasTexture(c);return map;}
 function syncModels(){const projected=projectLiveBowls(source.latest,source.usable()),positions=source.usable()?livePositions(source.conveyor,performance.now()-(source.lastSuccessAt??performance.now())):new Map<string,{x:number;z:number}>(),ids=new Set(projected.map(p=>p.bindingId));
  for(const [id,m]of models)if(!ids.has(id)){scene.remove(m.root);m.food.geometry.dispose();m.food.material.dispose();(m.label.material as T.SpriteMaterial).map?.dispose();m.label.material.dispose();models.delete(id);}
  for(const p of projected){let m=models.get(p.bindingId);if(!m){const plate=createPlateAssembly(.32,.08,'metal',brand),food=new T.Mesh(new T.CylinderGeometry(.095,.095,.1,24),new T.MeshStandardMaterial({color:0x83a08e,transparent:true,opacity:.85}));plate.foodAnchor.add(food);const sprite=new T.Sprite(new T.SpriteMaterial({depthTest:false}));sprite.position.set(0,.3,0);sprite.scale.set(.5,.125,1);plate.root.add(sprite);plate.root.traverse(o=>o.userData.bindingId=p.bindingId);m={root:plate.root,food,ring:plate.ring,label:sprite,labelText:''};scene.add(m.root);models.set(p.bindingId,m);}
   const position=positions.get(p.bowl.scaleId);m.root.position.set(position?.x??p.x,0,position?.z??p.z);m.root.scale.setScalar(selected===p.bindingId?1.08:1);m.food.visible=p.ratio!==null&&p.ratio>0;m.food.scale.y=p.ratio??0;m.food.position.y=.05*(p.ratio??0);
   const color=p.bowl.servingState==='empty'?0xb75a4e:p.bowl.servingState==='low'?0xcf8c42:p.bowl.servingState==='half'?0xc5b46a:p.bowl.servingState==='full'?0x7b9c7d:0xa5aaa4;(m.ring.material as T.MeshBasicMaterial).color.setHex(color);
   m.label.visible=false;const name=p.bowl.dishName;if(name!==m.labelText){const material=m.label.material as T.SpriteMaterial;material.map?.dispose();material.map=label(name);material.needsUpdate=true;m.labelText=name;}
  }
  const list=[...models.values()].map(m=>m.root.position),moving=positions.size>0,nextCenter=moving?2.2:list.length?Math.max(...list.map(p=>p.z))/2:0,nextExtent=moving?Math.max(2.7,(source.conveyor!.tracks.length-1)*2.4+2.5):Math.max(.7,nextCenter+.4,...list.map(p=>Math.abs(p.x)+.4));if(nextCenter!==centerZ||nextExtent!==extent){centerZ=nextCenter;extent=nextExtent;view();resize();}
  return projected;
 }
 function update(){const rows=syncModels(),authenticated=source.session?.authenticated===true,usable=source.usable();$('live-login').hidden=authenticated;$('live-logout').hidden=!authenticated;$('live-search-label').hidden=!authenticated;
  const session=source.session;write('live-identity',session?.authenticated?`${session.actor.label} · ${env[session.environment]}`:'');
  write('live-status',source.error?'读取异常':!authenticated?'请登录查看业务数据':!source.latest?'等待供餐数据':!usable?'数据已过期':`供餐状态 · ${rows.length} 个有效绑定`);
  const warning=source.error||source.latest&&!usable?'当前数据读取中断，余量和区域已标记未知。'+(source.error?' '+source.error:''):'';write('live-diagnostic',warning);$('live-diagnostic').hidden=!warning;
  write('live-position-note',source.conveyor?.tracks.some(t=>t.quality==='estimated')?'圆环为轨道位置示意，按运行状态推算，不代表门店实测平面。未校准或过期的轨道保留固定排列，不能作为实际位置。':'轨道尚未接入、已过期或需要校准；当前只显示固定排列，不表示实际位置。');
  write('live-meta',source.latest?`${env[source.latest.environment]} · 服务器 ${stamp(source.latest.serverAt)} · 版本 ${source.latest.dataRevision}`:'');
  write('live-summary',source.latest?`${rows.length} 个碗位 · ${new Set(rows.map(p=>p.bowl.dishId)).size} 道菜 · ${rows.filter(p=>p.ratio===null).length} 个余量待核实`:'登录后显示已配置的有效绑定。客流与人员轨迹未接入。');
  const list=$('live-list'),query=$<HTMLInputElement>('live-search').value.trim().toLowerCase();list.replaceChildren();
  if(authenticated&&source.latest&&rows.length===0){const p=document.createElement('p');p.textContent='尚无有效绑定，请在业务工作台配置设备与菜品。';list.append(p);}
  for(const p of rows){const b=p.bowl;if(query&&!`${b.dishName} ${b.scaleId} ${b.bindingId}`.toLowerCase().includes(query))continue;const card=document.createElement('button');card.className='live-bowl';card.dataset.bindingId=b.bindingId;card.classList.toggle('selected',selected===b.bindingId);const heading=document.createElement('strong');heading.textContent=b.dishName;card.append(heading);
   const detail=source.kitchen?.all.find(c=>c.bowl.bindingId===b.bindingId);const alerts=plateAlerts({known:usable&&p.ratio!==null,empty:b.servingState==='empty',refill:['refill','urgent'].includes(b.recommendation),freshness:usable?detail?.freshness?.state:null});
   for(const value of [...alerts.map(a=>plateAlertText[a]),...(selected===b.bindingId?[qualityLabels[b.quality]]:[])]){const line=document.createElement('small');line.textContent=value;card.append(line);}
   card.onclick=()=>{selected=b.bindingId;update();};list.append(card);}
 }
 async function refresh(){await source.poll();update();}
 $('live-refresh').onclick=()=>void refresh();$('live-top').onclick=()=>{viewTop=true;view();};$('live-perspective').onclick=()=>{viewTop=false;view();};$('live-search').oninput=()=>update();
 $('live-login').onsubmit=async e=>{e.preventDefault();const field=$<HTMLInputElement>('live-token'),button=$('live-login').querySelector('button')!;button.disabled=true;const token=field.value;field.value='';try{await source.login(token);}catch(e){source.error=e instanceof Error?e.message:String(e);}finally{button.disabled=false;update();}};
 $('live-logout').onclick=async()=>{try{await source.logout();}catch(e){source.error=e instanceof Error?e.message:String(e);}update();};
 const raycaster=new T.Raycaster(),pointer=new T.Vector2();let down={x:0,y:0};canvas.addEventListener('pointerdown',e=>down={x:e.clientX,y:e.clientY});canvas.addEventListener('pointerup',e=>{if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects([...models.values()].map(m=>m.root),true)[0];if(hit){selected=hit.object.userData.bindingId;update();Array.from($('live-list').children).find(c=>(c as HTMLElement).dataset.bindingId===selected)?.scrollIntoView({block:'nearest'});}});
 view();new ResizeObserver(resize).observe(canvas);resize();function frame(now:number){requestAnimationFrame(frame);if(document.hidden)return;orbit.update();const projected=syncModels();renderer.render(scene,camera);
 const usable=source.usable();callouts.render(projected.flatMap(p=>{const detail=source.kitchen?.all.find(c=>c.bowl.bindingId===p.bindingId),alerts=plateAlerts({known:usable&&p.ratio!==null,empty:p.bowl.servingState==='empty',refill:['refill','urgent'].includes(p.bowl.recommendation),freshness:usable?detail?.freshness?.state:null}).filter(a=>a!=='unknown'||p.bindingId===selected);if(!alerts.length&&p.bindingId!==selected)return [];return [{id:p.bindingId,selected:p.bindingId===selected,text:p.bowl.dishName+(alerts.length?'\n'+alerts.map(a=>plateAlertText[a]).join(' · '):''),alert:alerts[0]??'none',position:models.get(p.bindingId)!.root.position.clone().add(new T.Vector3(0,.2,0))}];}),camera);renderedFrames++;if(now-lastUi>1000){update();lastUi=now;}}requestAnimationFrame(frame);
 Object.defineProperty(window,'__liveSceneDebug',{value:()=>({bindingIds:[...models.keys()],renderedFrames,usable:source.usable(),environment:source.latest?.environment??null,customerCount:null,staffCount:null,layout:source.usable()&&livePositions(source.conveyor,source.lastSuccessAt===null?0:performance.now()-source.lastSuccessAt).size?'server-track-schematic':'fixed-arrangement',error:source.error}),configurable:true});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});await refresh();setInterval(()=>{if(!document.hidden)void refresh();},1000);
}
