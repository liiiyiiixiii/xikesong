import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBatch,timerStatus,supplySuggestions,type FreshnessBatch } from '../lib/freshness/model.ts';
import { freshnessAction } from '../lib/freshness/contract.ts';
const config={id:'bowl-1',dishId:'lamb',dishName:'羊肉卷',tareG:300,fullG:1000,noiseG:3,enabled:true,updatedAt:''};
const rule={dishId:'lamb',enabled:true,maxMinutes:180,warningMinutes:30,updatedAt:''};
const at='2026-10-01T09:00:00Z';
test('independent bowls retain deadlines at warning and expiry boundaries, across reloads',()=>{
 const a=makeBatch('a',config,rule,at,1000),b=makeBatch('b',{...config,id:'bowl-2'},rule,'2026-10-01T10:00:00Z',1000);
 assert.equal(timerStatus(a,'2026-10-01T11:29:59Z'),'running');assert.equal(timerStatus(a,'2026-10-01T11:30:00Z'),'soon');
 assert.equal(timerStatus(a,'2026-10-01T12:00:00Z'),'overdue');assert.equal(timerStatus(b,'2026-10-01T12:00:00Z'),'running');
 assert.equal(timerStatus(JSON.parse(JSON.stringify(a)),'2026-10-02T00:00:00Z'),'overdue');
});
function closed(day:number,patch:Partial<FreshnessBatch>={}):FreshnessBatch {const started=`2026-09-${String(day).padStart(2,'0')}T09:00:00Z`;return {...makeBatch('batch-'+day,config,rule,started,1000),status:'closed',closedAt:started.replace('09:00','12:00'),remainingG:800,observedTakeG:200,observedRefillG:0,coverage:1,quality:'usable',reason:'display_age',disposition:'waste',...patch};}
test('one event, repeated bowls on one day, missing observations and different periods cannot trigger reduction',()=>{
 assert.equal(supplySuggestions([closed(1)])[0].level,'observe');
 assert.equal(supplySuggestions([closed(1),closed(1,{id:'other'}),closed(1,{id:'third'})])[0].level,'observe');
 assert.equal(supplySuggestions([1,2,3].map(d=>closed(d,{quality:'incomplete'})))[0].level,'observe');
 assert.equal(supplySuggestions([closed(1),closed(2),closed(3,{startedAt:'2026-09-03T04:00:00Z'})]).filter(s=>s.level!=='observe').length,0);
});
test('repeated comparable days suggest reduction and later review, never automatic cancellation',()=>{
 assert.equal(supplySuggestions([1,2,3].map(d=>closed(d)))[0].level,'reduce');
 assert.equal(supplySuggestions([1,2,3,4,5,6,7].map(d=>closed(d)))[0].level,'review_pause');
 assert.equal(supplySuggestions([1,2,3].map(d=>closed(d,{reason:'closing'})))[0].level,'observe');
 assert.equal(supplySuggestions([1,2,3].map(d=>closed(d,{closedAt:'2026-09-01T09:01:00Z'})))[0].level,'observe');
});
test('many healthy batches dilute isolated age waste; refills count in supplied denominator',()=>{
 const rows=[1,2,3].map(d=>closed(d));for(let i=0;i<10;i++)rows.push(closed(4,{id:'healthy'+i,remainingG:0,observedTakeG:1000,reason:'other'}));
 assert.equal(supplySuggestions(rows)[0].level,'observe');
 assert.equal(supplySuggestions([1,2,3].map(d=>closed(d,{observedRefillG:3000})))[0].level,'observe');
});
test('mutations require explicit physical confirmation, finite nonnegative weights and bounded rules',()=>{
 const input={action:'start',requestId:crypto.randomUUID(),scaleId:'bowl-1',startedAt:at,openingG:null,confirmed:true};
 assert(freshnessAction.safeParse(input).success);
 for(const patch of [{confirmed:false},{openingG:-1},{openingG:Infinity},{requestId:'x'}])assert(!freshnessAction.safeParse({...input,...patch}).success);
 assert(!freshnessAction.safeParse({action:'rule',dishId:'x',enabled:true,maxMinutes:0,warningMinutes:5}).success);
});
