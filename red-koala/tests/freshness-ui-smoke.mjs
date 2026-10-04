// Local browser regression. Every browser API request is intercepted. Pure model
// functions create fixture portraits in memory; no business data is read or written.
import assert from 'node:assert/strict';
import {buildCurrentProfile} from '../lib/analysis/current-profile.ts';
import {buildWeeklyPortrait} from '../lib/analysis/weeks.ts';
import {shiftDate} from '../lib/preferences/types.ts';
import {mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_BASE_URL||'http://127.0.0.1:5173',shots=path.join(tmpdir(),'red-koala-embedded-freshness');await mkdir(shots,{recursive:true});
const now=new Date(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
const dates=Array.from({length:35},(_,i)=>shiftDate(today,i-35));
const dataset={catalog:[{id:'lamb',name:'羊肉',category:'',unit:'g',pieceWeightG:null,launchDate:dates[0]}],stores:dates.map(date=>({date,status:'open',snapshotAt:date+'T20:00:00+08:00',finalAt:date+'T23:00:00+08:00'})),days:dates.map(date=>({date,dishId:'lamb',status:'complete',takeFinal:1000,takeG:1000,take20:700,opening:0,replenished:1000,waste:0,closing:0,supply:'adequate',stockoutMinutes:0,snapshotAt:date+'T20:00:00+08:00',finalAt:date+'T23:00:00+08:00'}))};
const overall=buildCurrentProfile(dataset,now.toISOString()),weekly=buildWeeklyPortrait(dataset,today,now.toISOString());
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}),page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[],actions=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 window.testBeeps=0;
 window.AudioContext=class{state='running';currentTime=0;destination={};async resume(){}async close(){}createOscillator(){return{connect(){},start(){window.testBeeps++},stop(){}}}createGain(){return{connect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}}}}};
});
const scales=Array.from({length:42},(_,i)=>({id:'bowl-'+i,dishId:i<2?'lamb':'dish-'+i,dishName:i<2?'羊肉':'菜品'+i,tareG:300,fullG:1000,noiseG:3,enabled:true,updatedAt:now.toISOString(),position:i+1,netG:650,percent:65,status:i===0?'offline':'active',lastAt:now.toISOString()}));
const state={source:'live',at:now.toISOString(),pending:[{id:'pending-1',scaleId:'bowl-1',dishId:'lamb',kind:'pending',weightG:50,at:now.toISOString(),receivedAt:now.toISOString()}],dishes:[...new Set(scales.map(s=>s.dishId))].map(id=>{const bowls=scales.filter(s=>s.dishId===id);return {id,name:bowls[0].dishName,remainingG:650*bowls.length,fullG:1000*bowls.length,percent:65,rateGPerMinute:10,coverage:1,status:'okay',overfull:false,scales:bowls,trend:[]};})};
const batch=(id,minutes)=>({id:'batch-'+id,scaleId:'bowl-'+id,dishId:scales[id].dishId,dishName:scales[id].dishName,startedAt:new Date(now-180*60000).toISOString(),deadlineAt:new Date(+now+minutes*60000).toISOString(),warningMinutes:30,openingG:1000,status:'active'});
let enabled=false,freshnessError=false,timers=[{scaleId:'bowl-0',dishId:'lamb',name:'羊肉',batch:batch(0,-5),status:'overdue',deviceEnabled:true},{scaleId:'bowl-1',dishId:'lamb',name:'羊肉',batch:batch(1,20),status:'soon',deviceEnabled:true},{scaleId:'bowl-2',dishId:'dish-2',name:'菜品2',batch:batch(2,120),status:'running',deviceEnabled:true},{scaleId:'bowl-3',dishId:'dish-3',name:'菜品3',batch:null,status:'unknown',deviceEnabled:true}];
const feedback=[0,1,2].map(i=>({...batch(0,-5),id:'closed-'+i,status:'closed',closedAt:now.toISOString(),remainingG:600,disposition:'waste',reason:'display_age',quality:'usable',observedTakeG:400,observedRefillG:0}));
const suggestion={dishId:'lamb',name:'羊肉',period:'晚间',level:'reduce',message:'多个可比营业日晚间超时剩余，建议减少单盘量。',batches:3,usableBatches:3,affectedDays:3,wasteG:1800,remainingRatio:.6,evidenceIds:feedback.map(b=>b.id)};
const empty={at:now.toISOString(),timers:[],rules:[],feedback:[],suggestions:[],decisions:[],catalog:scales.filter((s,i)=>i!==1).map(s=>({id:s.dishId,name:s.dishName}))};
const dailyRows=state.dishes.map(d=>({dishId:d.id,name:d.name,takeG:1000,refillG:2000,wasteG:d.id==='lamb'?300:0,ageWasteG:d.id==='lamb'?200:0,retainedG:d.id==='lamb'?100:0,remainingG:650,coverage:1,emptyMinutes:0,unresolved:0}));
await page.route('**/api/**',async route=>{
 const u=new URL(route.request().url()),q=u.searchParams,p=u.pathname;requests.push(u.pathname+u.search);
 if(route.request().method()==='POST'){
  const input=route.request().postDataJSON();actions.push({path:p,...input});
  if(input.action==='partial'&&input.eventId)state.pending=[];
  if(input.action==='start'){const t=timers.find(t=>t.scaleId===input.scaleId);t.batch={...batch(3,180),id:input.requestId};t.status='running';}
  if(input.action==='close'){const t=timers.find(t=>t.batch?.id===input.batchId);t.batch=null;t.status='waiting';}
  return route.fulfill({json:{success:true}});
 }
 if(p==='/api/freshness'){
  if(freshnessError)return route.fulfill({status:503,json:{error:'测试反馈中断'}});
  if(q.has('date'))return route.fulfill({json:{...empty,removals:q.get('date')===today?[{id:'withdrawal',dishId:'lamb',name:'羊肉',scaleId:'bowl-0',at:now.toISOString(),weightG:200,disposition:'waste',reason:'display_age',startedAt:batch(0,0).startedAt,scope:'partial',batchId:'closed-0'},{id:'retained',dishId:'lamb',name:'羊肉',scaleId:'bowl-0',at:now.toISOString(),weightG:100,disposition:'retain',reason:'other'}]:[]}});
  if(q.has('startDate'))return route.fulfill({json:{...empty,scope:{from:q.get('startDate'),to:q.get('endDate')}}});
  return route.fulfill({json:{...empty,timers:enabled?timers:[],feedback:q.get('mode')==='feedback'?feedback:[],suggestions:q.get('mode')==='feedback'?[suggestion]:[]}});
 }
 if(p==='/api/scales/state')return route.fulfill({json:state});
 if(p==='/api/scales/summary')return route.fulfill({json:{source:'live',date:q.get('date'),asOf:now.toISOString(),final:false,dishes:dailyRows}});
 if(p==='/api/preferences/history')return route.fulfill({json:{phase:null}});
 if(p==='/api/preferences')return route.fulfill({json:{source:'live',asOf:now.toISOString(),dates:[today],profile:[],forecasts:[],plans:[],executions:[]}});
 if(p==='/api/scales/devices')return route.fulfill({json:{configs:scales,settings:{openTime:'11:00',closeTime:'22:00'},credentialConfigured:false}});
 if(p==='/api/intelligence/portrait')return route.fulfill({json:q.get('scope')==='overall'?overall:weekly});
 if(p.startsWith('/api/intelligence'))return route.fulfill({json:{configured:false,model:'mock',message:'测试不调用模型'}});
 return route.fulfill({json:{}});
});
try{
 console.log('checking live');await page.goto(base+'/admin?view=freshness');await page.locator('.live-dish').first().waitFor();assert(new URL(page.url()).searchParams.get('view')==='live');
 assert.deepEqual(await page.locator('.scale-main-nav button').allTextContents(),['实时','每日总结','智能分析']);
 const before=await page.locator('.live-dish').first().boundingBox();assert.equal(await page.locator('.fresh-card-badge').count(),0);
 enabled=true;await page.getByRole('button',{name:'已到时 1 个碗，查看待更换菜品'}).waitFor();
 const after=await page.locator('.live-dish').first().boundingBox();assert.equal(after.height,before.height);assert.equal(after.width,before.width);assert.equal(await page.locator('.fresh-card-badge').count(),3);
 assert(await page.locator('.live-dish').first().getAttribute('class').then(c=>c.includes('status-offline')));
 await page.screenshot({path:path.join(shots,'live-desktop.png')});
 assert.equal(await page.evaluate(()=>window.testBeeps),0);
 await page.getByRole('button',{name:'开启更换提示音',exact:true}).click();await page.waitForFunction(()=>window.testBeeps===1);
 await page.getByRole('button',{name:'每日总结',exact:true}).click();await page.getByRole('button',{name:'实时',exact:true}).click();assert.equal(await page.evaluate(()=>window.testBeeps),1);
 await page.getByRole('button',{name:'知道了，静音本次'}).click();assert.equal(await page.locator('.fresh-card-badge').count(),3);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('red-koala:freshness-audio')).muted.length),2);
 await page.getByRole('button',{name:'关闭更换提示音',exact:true}).click();
 await page.getByRole('button',{name:/^待确认/}).click();await page.getByRole('button',{name:'处理',exact:true}).click();await page.getByRole('button',{name:'确认处理',exact:true}).click();
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'记录部分撤下'}).click();await page.locator('.live-action-dialog').waitFor({state:'detached'});assert.equal(actions.at(-1).eventId,'pending-1');await page.locator('.live-drawer').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'已到时 1 个碗，查看待更换菜品'}).click();assert.equal(await page.locator('.live-dish').count(),1);await page.getByRole('button',{name:'显示全部',exact:true}).click();
 await page.locator('.live-dish').nth(1).click();await page.locator('#bowl-detail-bowl-1.fresh-selected-bowl').waitFor();await page.locator('#bowl-detail-bowl-1').getByRole('button',{name:'撤下 / 换新盘'}).click();
 let dialog=page.getByRole('dialog').last();await dialog.getByLabel('撤下范围').selectOption('partial');await dialog.getByLabel('本次撤下余量（克）').fill('100');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'记录部分撤下'}).click();assert.equal(actions.at(-1).action,'partial');await page.locator('.live-action-dialog').waitFor({state:'detached'});await page.locator('.live-drawer').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'记录撤下',exact:true}).click();await page.getByRole('button',{name:'继续处理此碗'}).click();dialog=page.getByRole('dialog').last();await dialog.getByLabel('本次撤下余量（克）').fill('650');await dialog.getByRole('checkbox',{name:'确认本批次旧菜已全部撤下，重量与去向已核实'}).check();await dialog.getByRole('button',{name:'确认撤下',exact:true}).click();assert.equal(actions.at(-1).action,'close');await page.waitForFunction(()=>!document.querySelector('.fresh-nav-count'));
 await page.locator('.live-dish').nth(3).click();await page.getByRole('button',{name:'登记上盘',exact:true}).click();dialog=page.getByRole('dialog').last();await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'开始计时'}).click();assert.equal(actions.at(-1).action,'start');await page.locator('.live-action-dialog').waitFor({state:'detached'});await page.locator('.live-drawer').getByRole('button',{name:'关闭',exact:true}).click();
 console.log('checking daily');await page.getByRole('button',{name:'每日总结',exact:true}).click();await page.locator('.daily-data-table').first().waitFor();await page.locator('#daily-panel-overview tr').filter({hasText:'羊肉'}).getByRole('button',{name:'其中放置过久 200 g'}).click();await page.getByText('部分撤下',{exact:false}).waitFor();await page.getByText('旧记录未关联批次，上台时间未知').waitFor();await page.screenshot({path:path.join(shots,'daily-removals.png')});await page.keyboard.press('Escape');
 await page.getByLabel('查看日期',{exact:true}).fill(yesterday);await page.locator('#daily-panel-overview tr').filter({hasText:'羊肉'}).getByRole('button',{name:'其中放置过久 200 g'}).click();await page.getByText(/该日期没有可追溯/).waitFor();assert.equal(await page.locator('.fresh-history li').count(),0);await page.keyboard.press('Escape');
 console.log('checking analysis');await page.getByRole('button',{name:'智能分析',exact:true}).click();await page.getByRole('heading',{name:'当前客群画像'}).waitFor();await page.locator('#overall-dish-lamb .dish-name-link').click();await page.getByText(suggestion.message,{exact:false}).waitFor();await page.getByRole('button',{name:'记录供应安排'}).click();dialog=page.getByRole('dialog').last();await dialog.getByLabel('执行安排与复查说明').fill('晚间改为小盘，三天后复核。');await dialog.getByRole('button',{name:'确认并记录决策'}).click();assert.equal(actions.at(-1).action,'decision');await page.screenshot({path:path.join(shots,'dish-advice.png')});
 await page.getByRole('button',{name:'查看历史周／日画像'}).click();await page.locator('.week-library button').click();await page.locator('#dish-row-lamb .dish-name-link').click();assert.equal(await page.getByText(suggestion.message,{exact:false}).count(),0);assert(requests.some(r=>r.includes('startDate=')&&r.includes('endDate=')));
 await page.getByRole('button',{name:'实时',exact:true}).click();freshnessError=true;await page.getByText(/时限提醒暂不可用/).waitFor();assert.equal(await page.locator('.live-dish').count(),42);assert.equal(await page.locator('.fresh-nav-unknown').count(),1);await page.getByRole('button',{name:'每日总结',exact:true}).click();await page.locator('#daily-panel-overview tbody tr').first().waitFor();assert.equal(await page.locator('#daily-panel-overview tbody tr').count(),41);
 freshnessError=false;await page.getByRole('button',{name:'实时',exact:true}).click();await page.getByText(/时限提醒暂不可用/).waitFor({state:'hidden'});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,'live-mobile.png')});
 await page.setViewportSize({width:1366,height:768});await page.goto(base+'/kitchen');await page.locator('.k-dock-tile').first().waitFor();await page.locator('.fresh-kitchen-strip').waitFor();const strip=await page.locator('.fresh-kitchen-strip').boundingBox();assert(strip.height<80);assert.equal(await page.locator('.k-dock-tile').count(),42);assert(await page.locator('.k-board-footer').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1));await page.screenshot({path:path.join(shots,'kitchen-strip.png')});
 assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({passed:true,shots,actions:actions.map(a=>a.action),checks:'three tabs; old URL; original card dimensions; exception badges; independent bowls; pending/partial/full/start; opt-in sound and tab deduplication; acknowledgement retains status; daily date drilldown; inline current/historical advice; failure isolation; mobile; kitchen orbit'}));
}catch(e){await page.screenshot({path:path.join(shots,'failure.png')});console.log((await page.locator('body').innerText()).slice(-4000));console.log({errors,actions});throw e;}finally{await browser.close();}
