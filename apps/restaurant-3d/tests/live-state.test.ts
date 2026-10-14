import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiveStateSource,parseSession,parseServing,projectLiveBowls,type LiveSession} from '../src/live-state';
const at='2026-10-12T04:00:00Z';
const session:LiveSession={authenticated:true,actor:{id:'staff-1',label:'测试工作站'},role:'staff',environment:'test'};
function serving(){return {contractVersion:'operations-v2',serverAt:at,dataRevision:'opaque-revision',environment:'test',bowls:[{
 scaleId:'business-scale',bindingId:'binding-real-1',dishId:'business-dish',dishName:'业务菜品',positionOrder:1,bindingVersion:1,freshnessBatchId:null,containerRef:null,tareG:100,
 servingState:'low',recommendation:'refill',quality:'estimated',reasonCodes:['LOW_WEIGHT'],loadNetG:100,foodRemainingG:100,estimatedFoodG:100,confirmedFoodG:200,fullFoodG:1000,
 observedAt:at,confirmedAt:at,zone:'unknown',locationQuality:'unknown',locationObservedAt:null,cycleId:null,taskId:'task-1',ruleVersion:1,
 }]};}
const response=(v:unknown)=>Response.json(v);
test('live source reads only same-origin session and serving with cookies, retaining backend identities',async()=>{
 const paths:string[]=[];const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>{paths.push(String(url));assert.equal(init?.credentials,'same-origin');assert.equal(init?.method,'GET');return response(String(url).endsWith('/session')?session:serving());};
 const source=new LiveStateSource(fetcher as typeof fetch,()=>0);await source.poll();assert.deepEqual(paths,['/api/v2/session','/api/v2/serving/state']);assert.equal(source.usable(),true);
 const rows=projectLiveBowls(source.latest,source.usable());assert.equal(rows[0].bindingId,'binding-real-1');assert.equal(rows[0].bowl.dishId,'business-dish');assert.equal(rows[0].ratio,.1);
 assert.equal('customers'in source.latest!,false);assert.equal('staff'in source.latest!,false);assert.equal('simTimeMs'in source.latest!,false);
});
test('unauthenticated session does not fetch serving and clears prior business entities',async()=>{
 let authenticated=true;const fetcher=async(url:RequestInfo|URL)=>response(String(url).endsWith('/session')?(authenticated?session:{authenticated:false}):serving());
 const source=new LiveStateSource(fetcher as typeof fetch);await source.poll();authenticated=false;await source.poll();assert.equal(source.latest,null);assert.equal(source.usable(),false);
});
test('live parsing rejects duplicate identities, environment mixing, contradictions and future evidence',()=>{
 for(const change of [(s:ReturnType<typeof serving>)=>s.bowls.push(s.bowls[0]),(s:ReturnType<typeof serving>)=>s.environment='live',(s:ReturnType<typeof serving>)=>s.bowls[0].quality='offline',(s:ReturnType<typeof serving>)=>s.bowls[0].observedAt='2027-01-01T00:00:00Z']){const s=serving();change(s);assert.throws(()=>parseServing(s,session));}
 const s=serving();s.bowls.push({...s.bowls[0],scaleId:'second-scale'});assert.throws(()=>parseServing(s,session),/重复绑定/);
 for(const invalid of [{authenticated:true},{authenticated:true,actor:{id:'x',label:'x'},role:'device',environment:'live'},null])assert.throws(()=>parseSession(invalid));
});
test('null and trustworthy zero differ; display order is deterministic and has no moving clock',()=>{
 const s=serving();s.bowls[0].foodRemainingG=0;s.bowls[0].servingState='empty';const parsed=parseServing(s,session),zero=projectLiveBowls(parsed,true);assert.equal(zero[0].ratio,0);
 const unavailable=projectLiveBowls(parsed,false);assert.equal(unavailable[0].ratio,null);assert.equal(unavailable[0].bowl.loadNetG,null);assert.equal(unavailable[0].bowl.foodRemainingG,null);assert.equal(unavailable[0].bowl.zone,'unknown');assert.equal(unavailable[0].bowl.confirmedFoodG,200);
 const two=parseServing({...s,bowls:[{...s.bowls[0],bindingId:'binding-2',scaleId:'scale-2',positionOrder:2},s.bowls[0]]},session);assert.equal(projectLiveBowls(two,true)[0].bindingId,'binding-real-1');assert.deepEqual(projectLiveBowls(two,true),projectLiveBowls({...two,bowls:[...two.bowls].reverse()},true));
});
test('network loss immediately marks all current quantities and positions unknown, then reconnects',async()=>{
 let offline=false,now=0;const fetcher=async(url:RequestInfo|URL)=>{if(offline)throw Error('network unavailable');return response(String(url).endsWith('/session')?session:serving());};
 const source=new LiveStateSource(fetcher as typeof fetch,()=>now);await source.poll();const last=source.latest;offline=true;await source.poll();assert.equal(source.latest,last);assert.equal(source.usable(),false);assert.equal(projectLiveBowls(last,source.usable())[0].ratio,null);
 offline=false;now=1000;await source.poll();assert.equal(source.usable(),true);now=17000;assert.equal(source.usable(),false);
});
test('invalid and rolled-back serving snapshots cannot overwrite the last accepted snapshot',async()=>{
 let value:unknown=serving();const fetcher=async(url:RequestInfo|URL)=>response(String(url).endsWith('/session')?session:value);const source=new LiveStateSource(fetcher as typeof fetch);await source.poll();const accepted=source.latest;
 value={...serving(),bowls:[{}]};await source.poll();assert.equal(source.latest,accepted);assert.equal(source.usable(),false);
 value={...serving(),serverAt:'2026-10-11T04:00:00Z',bowls:[]};await source.poll();assert.equal(source.latest,accepted);assert.match(source.error,/倒退/);
});
test('access revocation clears data, and overlapping polls share a single request sequence',async()=>{
 let revoked=false,count=0;const fetcher=async(url:RequestInfo|URL)=>{count++;if(revoked)return Response.json({error:{message:'expired'}},{status:401});return response(String(url).endsWith('/session')?session:serving());};
 const source=new LiveStateSource(fetcher as typeof fetch);await Promise.all([source.poll(),source.poll(),source.poll()]);assert.equal(count,2);revoked=true;await source.poll();assert.equal(source.latest,null);assert.deepEqual(source.session,{authenticated:false});
});
test('login and logout only change the shared session; credentials are not stored in source state',async()=>{
 const calls:{path:string;method?:string;body?:unknown}[]=[];const token='test-only-workstation-token-0123456789';const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>{calls.push({path:String(url),method:init?.method,body:init?.body});return response(init?.method==='DELETE'?{authenticated:false}:String(url).endsWith('/session')?session:serving());};
 const source=new LiveStateSource(fetcher as typeof fetch);await source.login(token);assert.equal(source.usable(),true);assert.equal(calls[0].path,'/api/v2/session');assert.equal(calls[0].method,'POST');assert.deepEqual(JSON.parse(String(calls[0].body)),{token});assert.equal(JSON.stringify(source).includes(token),false);
 await source.logout();assert.equal(source.latest,null);assert.equal(calls.at(-1)?.method,'DELETE');assert.ok(calls.every(c=>!c.path.includes('/control')));
});
test('switching identity clears the former identity snapshot even when the next serving read fails',async()=>{
 let switched=false;const fetcher=async(url:RequestInfo|URL)=>{if(String(url).endsWith('/session'))return response(switched?{...session,actor:{id:'different-staff',label:'另一工作站'}}:session);if(switched)throw Error('unavailable');return response(serving());};
 const source=new LiveStateSource(fetcher as typeof fetch);await source.poll();assert.ok(source.latest);switched=true;await source.poll();assert.equal(source.latest,null);assert.equal(source.usable(),false);
});

test('extended live source uses kitchen and track contracts, rejects mixed environments without committing partial state',async()=>{
 const s=serving();const board={...s,windowId:null,quality:'unconfigured',windows:[],upcoming:[],processing:[],all:s.bowls.map(bowl=>({bowl,percent:10,estimated:true,freshness:null,alert:'refill',distanceM:null}))};delete (board as {bowls?:unknown}).bowls;
 let environment='test';const paths:string[]=[];const fetcher=async(url:RequestInfo|URL)=>{paths.push(String(url));return response(String(url).endsWith('/session')?session:String(url).endsWith('/kitchen/board')?board:{contractVersion:s.contractVersion,serverAt:s.serverAt,dataRevision:s.dataRevision,environment,tracks:[]});};
 const source=new LiveStateSource(fetcher as typeof fetch,()=>0,5000,true);await source.poll();assert(source.usable());assert.deepEqual(paths,['/api/v2/session','/api/v2/kitchen/board','/api/v2/conveyor/state']);const accepted=source.kitchen;
 environment='live';await source.poll();assert(!source.usable());assert.equal(source.kitchen,accepted);assert.match(source.error,/环境/);
});
