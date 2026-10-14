import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsClient,createLatestResource,OperationsClientError} from '../components/scales/operations-v2/client.ts';
import {prepareWrite} from '../components/scales/operations-v2/write-draft.ts';
import {createFixtureTransport} from './ui/fixtures/operations-v2-transport.ts';
import {fixture,servingScenarios} from './ui/fixtures/operations-v2.ts';
import {endpoints,type EndpointName} from '@zhishan/contracts/operations-v2';

test('all registered endpoint fixtures validate both request and response; no fixture is a service',async()=>{
 const client=createOperationsClient(createFixtureTransport('normal'));
 for(const name of Object.keys(endpoints) as EndpointName[]){const {input}=fixture(name);await client.request(name,input);}
});
test('serving quality fixtures preserve unknown versus zero and all seven qualities',async()=>{
 for(const [name,expected] of Object.entries(servingScenarios)){const result=await createOperationsClient(createFixtureTransport(name as keyof typeof servingScenarios)).request('serving');assert.deepEqual(result,expected);}
 const unknown=await createOperationsClient(createFixtureTransport('unknown')).request('serving');assert.equal(unknown.bowls[0].foodRemainingG,null);assert.equal(unknown.bowls[0].servingState,'unknown');
});
test('errors, conflicts and wrong response formats cannot become empty success',async()=>{
 await assert.rejects(()=>createOperationsClient(createFixtureTransport('conflict')).request('serving'),e=>e instanceof OperationsClientError&&e.status===409&&e.detail?.error.code==='VERSION_CONFLICT');
 await assert.rejects(()=>createOperationsClient(createFixtureTransport('error')).request('serving'),e=>e instanceof OperationsClientError&&e.status===503);
 await assert.rejects(()=>createOperationsClient(async()=>new Response('<html>proxy error</html>',{headers:{'content-type':'text/html'}})).request('serving'),OperationsClientError);
 await assert.rejects(()=>createOperationsClient(async()=>Response.json({bowls:[]})).request('serving'),/约定格式/);
});
test('latest resource ignores late stale response and retains marked data after real failure',async()=>{
 const resource=createLatestResource<number>(()=>{},()=> '2026-10-12T00:00:00Z');let finish!:(n:number)=>void;
 const old=resource.load(()=>new Promise<number>(resolve=>{finish=resolve;}));await resource.load(async()=>2);finish(1);await old;assert.equal(resource.getState().data,2);
 await resource.load(async()=>{throw Error('disconnected');});assert.deepEqual(resource.getState(),{data:2,loading:false,stale:true,error:'disconnected',lastSuccessAt:'2026-10-12T00:00:00Z'});resource.dispose();
});
test('retry and unchanged submit retain a deep snapshot; changed operation gets a new request id',()=>{
 const first=fixture('operation').input;
 const draft=prepareWrite(first,null);assert(draft.requestId);
 assert.equal(prepareWrite({...first,body:{...first.body!,requestId:crypto.randomUUID()}},draft),draft);
 first.body!.evidenceIds.push('changed-after-submit');assert.deepEqual(draft.input.body!.evidenceIds,[]);
 const changed=prepareWrite(first,draft);assert.notEqual(changed.requestId,draft.requestId);
});
