import {KitchenWallScreen} from './kitchen-wall-screen';
import {PlateCallouts} from './plate-callouts';
import {plateAlerts,plateAlertText} from '@zhishan/contracts/kitchen-display';
import './style.css';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {createFoodModel,updateFoodModel} from './food-models';
import {createPlateAssembly,createCarrierBrandMaterial} from './plate-model';
import { Character } from './characters';
import { Restaurant } from './restaurant';
import { StateSource, verifyDigest, type State } from './external-state';
import { counts, project } from './simulation';
import type { SceneManifest } from './demo/layout';
const $=<E extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as E;
const text=(id:string,value:string|number)=>{$(id).textContent=String(value);};
const timeText=(ms:number)=>`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(Math.floor(ms)%1000).padStart(3,'0')}`;
const hash=(s:string)=>Array.from(s).reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,0);
const statusNames:Record<string,string>={full:'充足',half:'半盘 · 准备',low:'少量 · 必须补',empty:'空盘 · 紧急',unknown:'未知',good:'正常',offline:'离线',stale:'过期',removed:'已移除',uncertain:'待核实',preparing:'正在备菜',waiting:'已备好 · 等待回厨',completed:'已补菜'};
const eventNames:Record<string,string>={'customer.enter':'顾客进店','customer.seat':'顾客入座','customer.take':'顾客取菜','customer.leave':'顾客离店','customer.depart':'起身离座','staff.refill':'厨房补菜','action.started':'动作开始','action.ended':'动作结束','playback.completed':'演示完成','quality.expired':'观测过期','task.created':'开始备菜','task.ready':'备菜就绪','task.completed':'补菜完成','weight.observed':'重量观测','quality.changed':'质量变化','alert.changed':'余量提醒'};
async function boot(){
 const config=await (await fetch(`${import.meta.env.BASE_URL}data/config.json`,{cache:'no-store'})).json();
 if((new URLSearchParams(location.search).get('mode')??config.mode)==='live'){
  const {bootLive}=await import('./live-main');await bootLive(config.operationsUrl??import.meta.env.OPERATIONS_WORKBENCH_URL??(config.managementUrl?new URL('/operations',config.managementUrl).href:undefined));return;
 }
 const manifestResponse=await fetch(`${import.meta.env.BASE_URL}data/scene-manifest.v1.json`,{cache:'no-store'});if(!manifestResponse.ok)throw Error('场景清单读取失败');
 const manifest=await manifestResponse.json() as SceneManifest;await verifyDigest(manifest);
 const scene=new T.Scene();scene.background=null;
 const renderer=new T.WebGLRenderer({canvas:$<HTMLCanvasElement>('scene'),antialias:true,alpha:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
 const camera=new T.OrthographicCamera(-19,19,13,-13,.1,150);const center=new T.Vector3(manifest.floor.max.x/2,0,manifest.floor.max.z/2);
 const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.copy(center);orbit.enableDamping=true;orbit.minZoom=.5;orbit.maxZoom=3.5;orbit.maxPolarAngle=Math.PI*.47;
 function view(top:boolean){$('kitchen-view').classList.remove('selected');camera.position.set(center.x+(top?0:4),top?38:29,center.z+(top?.01:25));camera.up.set(0,1,0);camera.lookAt(center);orbit.target.copy(center);camera.zoom=1;camera.updateProjectionMatrix();orbit.update();$('top-view').classList.toggle('selected',top);$('perspective').classList.toggle('selected',!top);}
 view(false);
 scene.add(new T.HemisphereLight(0xfff9e8,0x8b998d,2.7));const light=new T.DirectionalLight(0xffefd5,3);light.position.set(-4,24,12);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-25,right:40,top:25,bottom:-25,near:1,far:70});light.shadow.normalBias=.04;scene.add(light);light.target.position.copy(center);scene.add(light.target);
 const restaurant=new Restaurant(manifest);scene.add(restaurant.root);
 const screenUrl=new URL('/operations/kitchen?mode=demo&windowId=supply-main',config.managementUrl??location.href);
 const wallScreen=new KitchenWallScreen(scene,renderer.domElement,screenUrl);
 const people=new Map<string,Character>(),staff=new Map<string,Character>(),plateModels=new Map<string,{root:T.Group;food:T.Group;ring:T.Mesh}>();
 const carrierBrand=createCarrierBrandMaterial();
 for(const binding of manifest.plates){
  const recipe=manifest.dishCatalog.find(d=>d.dishId===binding.dishId)!;
  const basket=['fruit','strawberry','grape','vegetable','tart','cake','puff'].includes(recipe.visual?.shape??'');
  const {root,foodAnchor,ring}=createPlateAssembly(binding.diameterM,binding.heightM,basket?'basket':'metal',carrierBrand);
  root.userData.plateId=binding.plateId;root.userData.slotId=binding.slotId;
  const food=createFoodModel(recipe);foodAnchor.add(food);
  root.traverse(o=>{o.userData.plateId=binding.plateId;});scene.add(root);plateModels.set(binding.plateId,{root,food,ring});
 }
 let state:State|null=null,lastUi=0,selectedPlate:string|null=null,renderedFrames=0,lastFrame=0;
 const callouts=new PlateCallouts(renderer.domElement);
 const activePlateIds=new Set(manifest.plates.filter(p=>{const slot=manifest.slots.find(s=>s.slotId===p.slotId);return manifest.tracks.some(t=>t.trackId===slot?.trackId&&t.enabled);}).map(p=>p.plateId));
 const source=new StateSource(config.apiBaseUrl??'/api/demo/v1',manifest,()=>{});
 const dishName=(dishId:string)=>state?.dishes.find(d=>d.dishId===dishId)?.name??manifest.dishCatalog.find(d=>d.dishId===dishId)?.name??dishId;
 const setLink=(id:string,url:unknown)=>{if(typeof url!=='string'||!url)return;const link=$<HTMLAnchorElement>(id);const target=new URL(url,location.href);if(!['http:','https:'].includes(target.protocol))return;link.href=target.href;link.hidden=false;};
 setLink('kitchen-link',new URL('/operations/kitchen?mode=demo',config.managementUrl??location.href).href);setLink('management-link',config.managementUrl);
 text('scene-version',`${manifest.layoutVersion} · ${manifest.contentDigest.slice(7,19)}`);
 function updateTables(){
  const body=$('plate-rows');body.replaceChildren();
  for(const binding of manifest.plates){const p=state?.plates.find(p=>p.plateId===binding.plateId),tr=document.createElement('tr');tr.dataset.plateId=binding.plateId;tr.classList.toggle('highlight',selectedPlate===binding.plateId);tr.classList.toggle('unknown',!p||p.quality!=='good');
   const fields=[binding.plateId,dishName(binding.dishId),p?.remainingG==null?'未知':`${Math.round(p.remainingG/p.fullG*100)}%`,p?statusNames[p.remainingStatus]:'等待数据',p?statusNames[p.quality]:'未连接'];
   fields.forEach((value,i)=>{const td=document.createElement('td');td.textContent=value;if(i===0){const small=document.createElement('small');small.textContent=binding.slotId;td.append(small);}tr.append(td);});body.append(tr);
  }
 }
 function renderPeople(map:Map<string,Character>,entities:ReturnType<typeof project>['customers']|ReturnType<typeof project>['staff'],time:number,isStaff:boolean){
  const ids=new Set<string>();
  for(const entity of entities){const guest='customerId'in entity?entity:null,worker='staffId'in entity?entity:null,id=guest?.customerId??worker!.staffId;ids.add(id);let c=map.get(id);if(!c){c=new Character(hash(id)%8,isStaff?(worker?.role==='chef'?'chef':'server'):'guest');c.root.scale.set(.75,1,.75);map.set(id,c);scene.add(c.root);}
   c.root.position.set(entity.position.x,0,entity.position.z);c.root.rotation.y=entity.position.angle;
   const moving=!!entity.movement&&time<entity.movement.endTimeMs;
   c.animate(time/1000,moving,guest?.seated??false,guest?.takeProgress==null?0:1.15*(1-guest.takeProgress),worker?.refill?'plate':worker?.action==='preparing'?(worker.kitchenAction??'chop'):'idle');
   // Idle is purely breathing/head motion; no pretend eating, chopping or hand-held food.
   if(guest&&!guest.takeApplied)c.handFood.visible=false;
   if(!moving&&guest?.takeProgress==null&&(!worker||worker.action==='idle'||worker.action==='waiting')){c.leftArm.rotation.set(guest?.seated?-.6:-.12,0,.05);c.rightArm.rotation.set(guest?.seated?-.6:-.12,0,-.05);c.handFood.visible=false;}
  }
  for(const[id,c]of map)if(!ids.has(id)){scene.remove(c.root);c.dispose();map.delete(id);}
 }
 function updateUI(now:number){
  const c=counts(manifest,state);for(const [id,value]of Object.entries({'carrier-count':c.carryingPositions,'plate-count':c.actualPlates,'dish-count':c.dishTypes,'seat-count':c.availableSeats,'seated-count':c.seatedCustomers,'customer-count':c.inStoreCustomers,'entity-count':people.size}))text(id,value??'—');
  const status=source.status();text('scene-status',status);$('scene-status').title=status;
  $<HTMLButtonElement>('pause').disabled=!state||state.playback.status==='completed';$<HTMLButtonElement>('restart').disabled=!state;text('pause',source.latest?.playback.status==='paused'?'继续':'暂停');
  text('clock',state?.simulationWindow?new Date(43200000+source.clock.time(now)).toISOString().slice(11,19):timeText(source.clock.time(now)));text('duration',state?(state.simulationWindow?'/ 12:10:00':`/ ${timeText(state.playback.durationMs)}`):'等待共享时钟');$<HTMLProgressElement>('progress').value=state?state.simTimeMs/state.playback.durationMs:0;text('generation',state?`第 ${state.generation+1} 次播放`:'—');
  const missing=state?.customers.some(c=>c.status==='walking'&&!c.movement);
  const warning=source.error||(!state?'等待主系统共享会话；当前只展示布局，餐盘余量与顾客状态尚未接入。':source.clock.stale(now)?'连接已过期。已耗尽呈现缓冲及250ms外推上限，画面已冻结，正在重新同步。':missing?'主系统缺少行走路径：人物暂留入口并标记异常，未伪造入座。':'');
  $('diagnostic').hidden=!warning;text('diagnostic',warning);
  text('task-count',state?`${state.tasks.filter(t=>t.status!=='completed').length} 项`:'—');
  const tasks=$('kitchen-tasks');tasks.replaceChildren();const pending=state?.tasks.filter(t=>t.status!=='completed')??[];
  for(const task of pending){const card=document.createElement('div');card.className='task';const line=document.createElement('div'),title=document.createElement('b'),status=document.createElement('small');title.textContent=dishName(task.dishId);status.textContent=statusNames[task.status];line.append(title,status);const info=document.createElement('p');info.textContent=`${task.plateId} · ${task.staffId}`;const progress=document.createElement('progress');progress.max=1;progress.value=Math.max(0,Math.min(1,(source.clock.time(now)-task.preparationStartMs)/Math.max(1,task.readyAtMs-task.preparationStartMs)));card.append(line,info,progress);tasks.append(card);}
  if(!pending.length){const empty=document.createElement('p');empty.className='empty';empty.textContent=state?'当前没有待补任务':'等待主系统任务';tasks.append(empty);}
  text('taken',state?`${state.summary.takenG.toFixed(0)} g`:'—');text('refilled',state?`${state.summary.refilledG.toFixed(0)} g`:'—');text('quality-count',state?`${state.summary.qualityIssueCount} 盘`:'—');
  text('data-version',state?`${state.datasetId} · revision ${state.revision}`:'数据包未连接');
  const list=$('event-list');list.replaceChildren();const recent=[...source.events.values()].filter(e=>e.layer!=='observation'&&e.startTimeMs<=source.clock.time(now)).sort((a,b)=>b.startTimeMs-a.startTimeMs).slice(0,6);for(const e of recent){const li=document.createElement('li');li.textContent=`${timeText(e.applyTimeMs).slice(0,5)} ${eventNames[e.eventType]??e.eventType}${e.applyTimeMs>source.clock.time(now)?'（进行中）':''} · ${e.targetEntityId}`;list.append(li);}
 }
 function frame(now:number){requestAnimationFrame(frame);if(document.hidden||now-lastFrame<33)return;const time=source.clock.time(now);const nextState=source.latest?.playback.status==='paused'||source.latest?.playback.status==='completed'?source.latest:source.presentation.at(time);if(nextState!==state){state=nextState;if(dialog.open)updateTables();}const projection=project(manifest,state,time,[...source.events.values()]);restaurant.update(time,projection.staff);
  for(const p of projection.plates){const model=plateModels.get(p.plateId)!;model.root.position.set(p.position.x,.985,p.position.z);model.root.rotation.y=p.position.angle;const ratio=p.state?.remainingG==null?null:Math.min(1,p.state.remainingG/p.state.fullG);updateFoodModel(model.food,ratio);(model.ring.material as T.MeshBasicMaterial).color.setHex(!activePlateIds.has(p.plateId)||!p.state||p.state.quality!=='good'?0xaab2a3:p.state.remainingStatus==='empty'?0xb75a4e:p.state.remainingStatus==='low'?0xcf8c42:p.state.remainingStatus==='half'?0xc5b46a:0xaab98b);}
  renderPeople(people,projection.customers,time,false);renderPeople(staff,projection.staff,time,true);orbit.update();renderer.render(scene,camera);wallScreen.render(camera);
  callouts.render(projection.plates.flatMap(p=>{const model=plateModels.get(p.plateId)!,available=!!p.state&&p.state.quality==='good'&&!source.clock.stale(now)&&!source.error;const alerts=activePlateIds.has(p.plateId)?plateAlerts({known:available,empty:p.state?.remainingStatus==='empty',refill:p.state?.remainingStatus==='low',freshness:source.error?null:p.state?.freshness?.state}).filter(a=>a!=='unknown'||p.plateId===selectedPlate):[];if(!alerts.length&&p.plateId!==selectedPlate)return [];return [{id:p.plateId,selected:p.plateId===selectedPlate,text:dishName(p.dishId)+(alerts.length?'\n'+alerts.map(a=>plateAlertText[a]).join(' · '):!activePlateIds.has(p.plateId)?'\n备用 · 未供餐':p.state?.freshness?.startedAtMs==null?'\n批次未登记':''),alert:alerts[0]??'none',position:model.root.position.clone().add(new T.Vector3(0,.25,0))}];}),camera);renderedFrames++;lastFrame=now;
  if(now-lastUi>150){updateUI(now);lastUi=now;}
 }
 function resize(){const shell=$('scene').parentElement!,w=shell.clientWidth,h=shell.clientHeight;renderer.setSize(w,h,false);wallScreen.resize(w,h);const aspect=w/h,worldWidth=manifest.floor.max.x+4.5,worldHeight=Math.max(22,worldWidth/aspect);camera.left=-worldHeight*aspect/2;camera.right=worldHeight*aspect/2;camera.top=worldHeight/2;camera.bottom=-worldHeight/2;camera.updateProjectionMatrix();}
 new ResizeObserver(resize).observe($('scene').parentElement!);resize();$('loading').remove();updateTables();requestAnimationFrame(frame);
 $('kitchen-view').onclick=()=>{$('kitchen-view').classList.add('selected');$('top-view').classList.remove('selected');$('perspective').classList.remove('selected');const target=new T.Vector3(6.55,0,2.35);camera.position.set(3.5,11,-12);camera.lookAt(target);orbit.target.copy(target);camera.zoom=2;camera.updateProjectionMatrix();orbit.update();};
 $('top-view').onclick=()=>view(true);$('perspective').onclick=()=>view(false);$('fullscreen').onclick=()=>{void $('scene').parentElement!.requestFullscreen();};
 const control=async(action:'pause'|'resume'|'restart')=>{try{await source.control(action);}catch(error){text('diagnostic',String(error));$('diagnostic').hidden=false;}};
 $('pause').onclick=()=>void control(source.latest?.playback.status==='paused'?'resume':'pause');$('restart').onclick=()=>void control('restart');
 const dialog=$<HTMLDialogElement>('plates-dialog');$('show-plates').onclick=()=>{selectedPlate=null;updateTables();dialog.showModal();};$('close-dialog').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
 const raycaster=new T.Raycaster(),pointer=new T.Vector2();let down={x:0,y:0};renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});renderer.domElement.addEventListener('pointerup',e=>{if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects([...plateModels.values()].map(m=>m.root),true)[0];selectedPlate=hit?hit.object.userData.plateId:null;});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void source.poll();});
 document.addEventListener('keydown',e=>{if(e.code==='Space'&&!dialog.open&&e.target===document.body){e.preventDefault();if(state)void control(source.latest?.playback.status==='paused'?'resume':'pause');}});
 // Read-only inspection hook for reproducible browser acceptance; no mutation API.
 Object.defineProperty(window,'__sceneDebug',{value:()=>({selectedPlate,counts:counts(manifest,state),renderedCustomerIds:[...people.keys()],renderedPlateIds:[...plateModels.keys()],state,displayTimeMs:source.clock.time(performance.now()),connection:source.status(),renderedFrames,lastFrame,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,sceneDigest:manifest.contentDigest}),configurable:true});
 let lastManifestCheck=-Infinity;
 async function pollAndRefresh(){await source.poll();
  if(source.error.includes('DIGEST_MISMATCH')&&performance.now()-lastManifestCheck>5000){lastManifestCheck=performance.now();try{const fresh=await(await fetch(`${import.meta.env.BASE_URL}data/scene-manifest.v1.json`,{cache:'no-store'})).json() as SceneManifest;await verifyDigest(fresh);
   // Only rebuild from the locally published authority when BOTH sides agree on the new digest.
   if(fresh.contentDigest!==manifest.contentDigest&&fresh.contentDigest===source.remoteManifest?.scene.contentDigest)location.reload();
  }catch{/* Preserve the explicit mismatch message and frozen scene. */}}
 }
 await pollAndRefresh();setInterval(()=>{if(!document.hidden)void pollAndRefresh();},300);
}
boot().catch(error=>{const status=document.getElementById('loading')??document.getElementById('live-status');if(status)status.textContent=`场景启动失败：${error instanceof Error?error.message:String(error)}`;console.error(error);});
