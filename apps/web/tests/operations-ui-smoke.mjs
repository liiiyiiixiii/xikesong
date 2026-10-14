// Browser fixture regression, deliberately separate from actual HTTP integration.
// Every API is intercepted and unexpected requests fail; fixture state is not a business service.
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {endpoints,matchEndpoint,apiError} from '@zhishan/contracts/operations-v2';
import {fixture,servingScenarios,openTask} from './ui/fixtures/operations-v2.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_BASE_URL;assert(base,'UI_BASE_URL must point to an isolated app instance');
const shots=process.env.UI_SCREENSHOT_DIR||path.join(tmpdir(),'red-koala-operations-fixture');await mkdir(shots,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
const errors=[],unexpected=[],operationBodies=[],reportQueries=[];let authenticated=false,role='manager',outage=false,conflict=true,operationAttempt=0,slowRead=true,evidenceReadFailed=false,task={...openTask,priority:'urgent',responsibility:'front',allowedActions:['claim','defer','handoff','cancel']};
const actor={id:'ui-manager',kind:'workstation',label:'测试管理工作站'},meta={contractVersion:'operations-v2',serverAt:'2026-10-12T04:00:00Z',dataRevision:'fixture:12'};
const serving=structuredClone(servingScenarios.fourStates);
serving.bowls[0].dishName='超长菜名金汤菌菇鲜虾嫩豆腐与时蔬测试菜';
for(const name of ['unknown','offline','unstable','stale','removed','estimated'])serving.bowls.push({...servingScenarios[name].bowls[0],scaleId:'quality-'+name,bindingId:'binding-'+name});
const credentials=[],devices=[];let retentionPolicy=fixture('retention').response.policy;
let regenerated=false;const archiveWrites=[];
const archives=[1,2].map(version=>({id:'archive-v'+version,date:'2026-10-04',source:'fixture-history',createdAt:meta.serverAt,late:true,archiveVersion:version,supersedesId:version===1?null:'archive-v1',scenario:{id:'fixture'},analysis:null,status:'pending',error:null,
 profile:{asOf:'2026-10-04T15:59:59Z',startDate:'2026-09-03',endDate:'2026-10-04',modeledCount:1,learningCount:0,dishes:[{dishId:'archived-dish',name:'档案测试菜',estimateG:version===1?1000:1200,currentShare:1,samples:30,status:'modeled'}]},
 snapshot:{source:'fixture-history',basis:'legacy_delta_v1',algorithmVersion:'fixture-model',asOf:'2026-10-04T15:59:59Z',fingerprint:'fingerprint-'+version,currentness:version===1?'outdated':'current',checkedAt:meta.serverAt}}));
page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(()=>{window.testBeeps=0;window.AudioContext=class{state='running';currentTime=0;destination={};async resume(){}async close(){}createOscillator(){return{frequency:{setValueAtTime(){}},connect(){},start(){window.testBeeps++},stop(){}}}createGain(){return{connect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}}}}};});
await context.route('**/api/**',async route=>{
 const req=route.request(),url=new URL(req.url()),p=url.pathname,method=req.method();
 if(p==='/api/v2/session'){
  if(method==='POST'){assert.deepEqual(req.postDataJSON(),{token:'fixture-login-token'});authenticated=true;}else if(method==='DELETE')authenticated=false;else assert.equal(method,'GET');
  return route.fulfill({json:authenticated?{authenticated,actor,role,environment:'test'}:{authenticated:false}});
 }
 // Legacy portrait regression: server cutoff predates the machine clock; a read must omit date initially.
 if(p==='/api/preferences/history')return route.fulfill({json:{phase:'ready',mode:'scenario',start:'2026-09-03',end:'2026-10-05',simulation:{enabled:false}}});
 if(p==='/api/scales/state')return route.fulfill({json:{source:'live',at:meta.serverAt,dishes:[],pending:[]}});
 if(p==='/api/freshness')return route.fulfill({json:{at:meta.serverAt,timers:[],rules:[],catalog:[],feedback:[],suggestions:[],decisions:[]}});
 if(p==='/api/intelligence/daily-visual'&&method==='GET'){reportQueries.push('portrait:'+url.search);return route.fulfill({json:{record:null,pending:true,dates:['2026-10-04'],asOf:'2026-10-05T14:00:00Z'}});}
 if(p==='/api/intelligence/config')return route.fulfill({json:{configured:false,model:'mock',message:'不调用外部模型'}});
 if(p==='/api/intelligence/archives'){
  if(method==='POST'){const body=req.postDataJSON();assert.deepEqual(body,{id:'archive-v1',action:'regenerate'});archiveWrites.push(body);regenerated=true;return route.fulfill({json:{id:'archive-v2',status:'pending',archiveVersion:2,created:true}});}
  assert.equal(method,'GET');const visible=regenerated?[archives[1],archives[0]]:[archives[0]],id=url.searchParams.get('id');
  return route.fulfill({json:id?{...visible.find(a=>a.id===id),versions:visible}: {items:visible,next:null,availableRange:{startDate:'2026-09-03',endDate:'2026-10-04'}}});
 }
 const matched=matchEndpoint(p,method);if(!matched){unexpected.push(method+' '+p);return route.fulfill({status:500,json:{error:'Unexpected test API'}});}
 const {name}=matched,endpoint=endpoints[name];
 try{
  endpoint.params.parse(matched.params);const query=endpoint.query.parse(Object.fromEntries(url.searchParams)),body=endpoint.body.parse(method==='GET'?undefined:req.postDataJSON());
  let result=fixture(name).response;
  if(name==='serving'){if(slowRead){slowRead=false;await new Promise(resolve=>setTimeout(resolve,6500));}if(outage)return route.fulfill({status:503,json:apiError('UNAVAILABLE')});result={...serving,...meta};}
  if(name==='tasks')result={...meta,rows:query.responsibility&&query.responsibility!==task.responsibility?[]:[task],nextCursor:null};
  if(name==='task')result={...meta,task,deferLimitSeconds:60,history:[],systemHistory:[{at:meta.serverAt,event:'created',fromVersion:null,toVersion:1,evidenceIds:['sample-1']}],evidenceIds:['sample-1']};
  if(name==='taskAction'){
   if(conflict){conflict=false;task={...task,version:task.version+1};return route.fulfill({status:409,json:apiError('VERSION_CONFLICT',body.requestId,{currentVersion:task.version})});}
   assert.equal(body.expectedVersion,task.version);
   if(body.action==='claim')task={...task,status:'claimed',assignee:actor,version:task.version+1,allowedActions:['defer','handoff','report_complete','cancel']};
   if(body.action==='defer')task={...task,status:'deferred',deferUntil:body.until,version:task.version+1,allowedActions:['claim','handoff','cancel']};
   if(body.action==='handoff')task={...task,status:'open',assignee:null,deferUntil:null,responsibility:body.responsibility,version:task.version+1,allowedActions:['claim','defer','cancel']};
   if(body.action==='report_complete')task={...task,status:'verifying',deferUntil:null,version:task.version+1,allowedActions:['verify_manual']};
   if(body.action==='verify_manual')task={...task,status:'resolved',deferUntil:null,verificationMethod:'manual',version:task.version+1,allowedActions:[]};
   if(body.action==='cancel')task={...task,status:'cancelled',deferUntil:null,version:task.version+1,allowedActions:[]};
   result={...meta,task};
  }
  if(name==='operation'){
   operationBodies.push(body);operationAttempt++;
   if(operationAttempt===1)return route.fulfill({status:503,json:apiError('UNAVAILABLE',body.requestId)});
   result={...meta,operation:{id:'ui-operation',version:1,input:body,actor,recordedAt:meta.serverAt,status:'pending_review'},affectedCycleIds:[],projectionStatus:'ready'};
  }
  if(name==='evidence'&&!evidenceReadFailed){evidenceReadFailed=true;return route.fulfill({status:503,json:apiError('UNAVAILABLE')});}
  if(name==='boundary')result={...fixture(name).response,...meta,eventId:body.requestId};
  if(name==='cycles')result={...meta,rows:[],nextCursor:null};
  if(name==='retention')result={...fixture(name).response,policy:retentionPolicy};
  if(name==='saveRetention'){retentionPolicy={version:body.expectedVersion+1,updatedAt:meta.serverAt,config:body.config};result={...fixture(name).response,policy:retentionPolicy};}
  if(name==='devices')result={...meta,devices};
  if(name==='saveDevice'){const device={...body,version:body.expectedVersion+1,createdAt:meta.serverAt,updatedAt:meta.serverAt};delete device.requestId;delete device.expectedVersion;devices.push(device);result={...meta,device};}
  if(name==='credentials')result={...meta,credentials};
  if(name==='issueCredential'){const credential={id:body.id,role:body.role,actor:body.actor,scaleIds:body.scaleIds,expiresAt:body.expiresAt,disabled:false};credentials.push(credential);result={...meta,credential};}
  if(name==='revokeCredential'){const credential=credentials.find(c=>c.id===matched.params.id);credential.disabled=true;result={...meta,credential};}
  if(name==='report'){reportQueries.push(query);result={...fixture(name).response,...meta,scope:{...fixture(name).response.scope,startDate:query.startDate,endDate:query.endDate}};}
  if(name==='aiEvidence'){assert.equal(query.dataRevision,meta.dataRevision);assert.equal(query.snapshotAt,meta.serverAt);result={...fixture(name).response,...meta,report:{...fixture(name).response.report,...meta,scope:{...fixture(name).response.report.scope,startDate:query.startDate,endDate:query.endDate}}};}
  if(name==='exportReport'){assert.equal(query.dataRevision,meta.dataRevision);assert.equal(query.snapshotAt,meta.serverAt);reportQueries.push(query);result='菜品,确认取用克,数据版本\r\n示例菜,,fixture:12\r\n';}
  endpoint.response.parse(result);return route.fulfill({body:endpoint.format==='csv'?result:JSON.stringify(result),contentType:endpoint.format==='csv'?'text/csv;charset=utf-8':'application/json'});
 }catch(e){unexpected.push(method+' '+p+': '+e.message);return route.fulfill({status:500,json:{error:'Fixture schema violation'}});}
});
try{
 await page.goto(base+'/operations');await page.getByRole('heading',{name:'登录工作台'}).waitFor();assert.equal(await page.getByRole('heading',{name:'全部碗位'}).count(),0);
 await page.getByLabel('工作站凭证',{exact:true}).fill('fixture-login-token');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('heading',{name:'全部碗位'}).waitFor();
 await page.locator('.ops-bowl').first().waitFor();assert.equal(await page.locator('.ops-bowl').count(),10);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage}).includes('fixture-login-token')),false);
 assert.equal(await page.evaluate(()=>window.testBeeps),0);await page.getByRole('button',{name:'开启补菜提示音'}).click();await page.waitForFunction(()=>window.testBeeps===1);await page.getByRole('button',{name:'刷新任务',exact:true}).click();assert.equal(await page.evaluate(()=>window.testBeeps),1);const second=await context.newPage();await second.goto(base+'/operations');await second.getByRole('button',{name:'开启补菜提示音'}).click();await second.waitForTimeout(200);assert.equal(await second.evaluate(()=>window.testBeeps),0);await second.close();
 await page.getByRole('button',{name:'查看 / 处理任务'}).click();await page.getByLabel('任务操作',{exact:true}).waitFor();await page.getByRole('button',{name:'接手',exact:true}).click();await page.getByRole('alert').filter({hasText:'正在刷新当前状态'}).waitFor();
 await page.getByRole('button',{name:'接手',exact:true}).click();await page.getByRole('status').filter({hasText:'服务端已保存：已接手'}).waitFor();
 await page.getByLabel('任务操作',{exact:true}).selectOption('defer');await page.getByLabel('暂缓至（北京时间）').fill('2026-10-12T12:00:30');await page.getByLabel('处理说明',{exact:true}).fill('半盘继续观察');await page.getByRole('button',{name:'暂缓',exact:true}).click();await page.getByRole('status').filter({hasText:'服务端已保存：已暂缓'}).waitFor();
 await page.getByLabel('任务操作',{exact:true}).selectOption('handoff');await page.getByLabel('交接责任区域').selectOption('kitchen');await page.getByRole('button',{name:'交接',exact:true}).click();await page.getByRole('status').filter({hasText:'服务端已保存：待处理'}).waitFor();
 await page.getByRole('button',{name:'接手',exact:true}).click();await page.getByRole('status').filter({hasText:'服务端已保存：已接手'}).waitFor();
 await page.getByLabel('任务操作',{exact:true}).selectOption('report_complete');await page.getByLabel('已登记补菜操作编号').fill('fixture-refill');await page.getByRole('button',{name:'报告完成',exact:true}).click();await page.getByText('已报告完成，正在等待后端核验。此任务尚未完成。').waitFor();
 await page.getByLabel('处理说明',{exact:true}).fill('人工检查食物已补充');await page.getByLabel('人工核实依据编号').fill('fixture-evidence');await page.getByRole('button',{name:'人工核实完成',exact:true}).click();await page.getByRole('status').filter({hasText:'服务端已保存：已完成'}).waitFor();
 await page.locator('.ops-bowl').first().click();const form=page.locator('.ops-panel').filter({has:page.getByRole('heading',{name:/^登记操作 ·/})});await form.getByLabel('操作类型').selectOption('ice_add');await form.getByLabel('操作说明').fill('未称重加冰，等待核实');await form.getByRole('button',{name:'确认登记'}).click();await form.getByRole('button',{name:'重试同一请求'}).click();await form.getByRole('status').filter({hasText:'ui-operation'}).waitFor();assert.deepEqual(operationBodies[0],operationBodies[1]);assert.equal(operationBodies[0].weightG,null);
 await form.getByRole('button',{name:'读取前后称重依据'}).click();await form.getByRole('button',{name:'重新读取',exact:true}).click();assert.equal(operationBodies.length,2,'Retrying an evidence read must not submit the surrounding operation form');await form.getByLabel(/毛重 800 g/).check();await form.getByLabel(/毛重 1,100 g/).check();assert.equal((await form.getByLabel('依据编号（空格或逗号分隔，可留空）').inputValue()),'sample-before, sample-after');
 await page.getByText('操作记录（1）与修订（0）',{exact:true}).click();await page.getByRole('button',{name:'更正此操作',exact:true}).click();await page.getByLabel('更正后重量依据').selectOption('measured');await page.getByLabel('更正后重量（克）').fill('300');await page.getByLabel('更正说明').fill('补入真实称重依据');await page.getByRole('button',{name:'保存更正记录'}).click();await page.getByRole('status').filter({hasText:'更正已保存'}).waitFor();assert.equal(operationBodies.at(-1).correctsOperationId,'operation-01');assert.equal(operationBodies.at(-1).expectedVersion,1);
 await page.screenshot({path:path.join(shots,'operation-retry.png'),fullPage:true});await page.getByRole('button',{name:'关闭碗位详情'}).click();
 outage=true;await page.getByRole('button',{name:'刷新状态',exact:true}).click();await page.getByRole('alert').filter({hasText:'已过期'}).waitFor();assert((await page.locator('.ops-bowl-weight').allTextContents()).every(t=>t.includes('未知')));outage=false;await page.getByRole('button',{name:'刷新状态',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ops-bowl-weight')?.textContent.includes('1,000'));
 await page.getByRole('link',{name:'取用报表',exact:true}).click();await page.getByRole('button',{name:'近 15 天'}).click();await page.getByRole('button',{name:'下载同版本 CSV'}).waitFor();await page.waitForFunction(()=>document.querySelector('.ops-metrics strong')?.textContent==='未知');
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'下载同版本 CSV'}).click();const download=await downloadPromise;assert((await readFile(await download.path(),'utf8')).includes('fixture:12'));
 const evidenceDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载同版本 AI 依据'}).click();const evidenceFile=await evidenceDownload,aiEvidence=JSON.parse(await readFile(await evidenceFile.path(),'utf8'));assert.equal(aiEvidence.externalModelCalled,false);assert.equal(aiEvidence.training.enabled,false);assert.equal(aiEvidence.dataRevision,'fixture:12');
 await page.getByRole('button',{name:'自然月',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ops-section-heading h3')?.textContent.includes('10-31'));
 await page.getByRole('link',{name:'设置与诊断'}).click();await page.getByLabel('设备编号',{exact:true}).fill('ui-new');await page.getByLabel('设备名称',{exact:true}).fill('界面测试设备');await page.getByRole('button',{name:'保存设备配置'}).click();await page.getByLabel('编辑设备').selectOption('ui-new');assert.equal(devices[0].measurement,null);
 await page.getByLabel('原始称重至少保留（小时）').fill('48');await page.getByRole('button',{name:'保存保留策略',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('p')].some(p=>p.textContent.startsWith('当前版本 1 · 更新')));assert.equal(retentionPolicy.config.enabled,false);assert.equal(retentionPolicy.config.rawRetentionHours,48);
 await page.getByText('发放新凭证',{exact:true}).click();await page.getByLabel('新凭证编号').fill('ui-staff');await page.getByLabel('使用者编号').fill('staff-2');await page.getByLabel('使用者名称').fill('前厅员工');await page.getByRole('button',{name:'生成并登记凭证'}).click();await page.getByLabel('一次性显示的新凭证').waitFor();const issued=await page.getByLabel('一次性显示的新凭证').inputValue();assert.equal(issued.length,64);assert.equal(await page.evaluate(secret=>JSON.stringify({...localStorage}).includes(secret),issued),false);await page.getByRole('button',{name:'已保存，隐藏凭证'}).click();assert.equal(await page.getByLabel('一次性显示的新凭证').count(),0);
 await page.getByRole('button',{name:'退出登录'}).click();role='staff';await page.getByLabel('工作站凭证',{exact:true}).fill('fixture-login-token');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByText('此页面需要管理权限。请使用管理工作站凭证登录。').waitFor();
 await page.getByRole('link',{name:'前厅任务',exact:true}).click();await page.getByRole('heading',{name:'全部碗位'}).waitFor();await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(shots,'front-mobile.png'),fullPage:true});
 await page.goto(base+'/admin?view=intelligence');await page.getByLabel('画像日期').waitFor();await page.waitForFunction(()=>document.querySelector('select[aria-label="画像日期"]')?.value==='2026-10-05');assert(reportQueries.includes('portrait:'));assert.equal(await page.getByLabel('画像日期').locator('option').filter({hasText:'2026-10-12'}).count(),0);await page.getByLabel('画像日期').selectOption('2026-10-04');await page.waitForFunction(()=>document.querySelector('select[aria-label="画像日期"]')?.value==='2026-10-04');
 await page.getByRole('button',{name:'查看画像档案与版本',exact:true}).click();await page.getByRole('button',{name:/2026-10-04 · v1 · 模拟数据/}).click();await page.getByRole('heading',{name:'2026-10-04 · 数值档案 v1',exact:true}).waitFor();
 await page.getByRole('button',{name:'按当前依据保存新版本',exact:true}).click();await page.getByRole('heading',{name:'2026-10-04 · 数值档案 v2',exact:true}).waitFor();assert.equal(archiveWrites.length,1);await page.getByLabel('画像档案版本').selectOption('archive-v1');await page.getByRole('heading',{name:'2026-10-04 · 数值档案 v1',exact:true}).waitFor();await page.screenshot({path:path.join(shots,'archive-version-preserved.png'),fullPage:true});
 assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,mode:'schema-validated browser fixtures only',checks:['login and role','four states and seven qualities','conflict refresh','defer handoff complete verifying manual verification','immutable operation retry','sample selection and versioned correction','stale failure recovery','range and version CSV','device and secret handling','mobile','server cutoff portrait'],screenshots:shots}));
}catch(error){await page.screenshot({path:path.join(shots,'failure.png'),fullPage:true});console.error({errors,unexpected,body:(await page.locator('body').innerText()).slice(-5000)});throw error;}finally{await browser.close();}
