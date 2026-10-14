import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { OperationsStore, type Write } from '../lib/operations-v2/storage.ts';
import { mutate } from '../lib/operations-v2/records.ts';
import { OperationsError, type Principal, authenticateOperations, configuredEnvironment, credentialRecord, requireDeviceScope, requirePermission } from '../lib/operations-v2/security.ts';

const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("isolated test")}}', compatibilityDate: '2026-05-15', d1Databases: { DB: 'operations-foundation-test' } });
let db: D1Database;
let store: OperationsStore;
before(async () => {
  db = await mf.getD1Database('DB') as unknown as D1Database;
  store = new OperationsStore(db, 'test');
  await store.initialize();
});
after(() => mf.dispose());

const device = (id: string, label: string): Write => ({ type: 'insert', table: 'devices', values: { id, enabled: 1, updated_at: '2026-10-12T00:00:00Z', payload: JSON.stringify({ label }) } });
const binding = (id: string, scaleId: string): Write => ({ type: 'insert', table: 'bindings', values: { id, scale_id: scaleId, dish_id: 'dish-1', valid_from: '2026-10-12T00:00:00Z', valid_to: null, version: 0, payload: '{}' } });

test('real D1: explicit environments isolate reads, credentials and writes', async () => {
  assert.throws(() => configuredEnvironment(undefined), /UNAVAILABLE/);
  assert.throws(() => configuredEnvironment('production'), /UNAVAILABLE/);
  const live = new OperationsStore(db, 'live');
  await live.initialize();
  assert.equal(await store.transact(await store.revision(), [device('scale-1', 'test')]), true);
  assert.equal(await live.get('devices', 'scale-1'), null);
  assert.equal(await live.transact(await live.revision(), [device('scale-1', 'actual')]), true);
  assert.equal((await store.get<{ payload: string }>('devices', 'scale-1'))?.payload, '{"label":"test"}');
  assert.equal((await live.get<{ payload: string }>('devices', 'scale-1'))?.payload, '{"label":"actual"}');
  await assert.rejects(() => store.list('devices', { environment: 'live' }), /Invalid operations columns/);
  const revision = await store.revision();
  await assert.rejects(() => store.transact(revision, [{ type: 'update', table: 'devices', id: 'scale-1', values: { environment: 'live' } }]), /Invalid operations columns/);
});

test('real D1: concurrent writers cannot partially write a task, device or receipt', async () => {
  const revision = await store.revision();
  const writes = (label: string): Write[] => [
    { type: 'update', table: 'devices', id: 'scale-1', values: { payload: label } },
    { type: 'insert', table: 'receipts', values: { id: label, caller_id: label, request_id: label, payload_hash: label, created_at: '2026-10-12T00:00:00Z', payload: label } },
  ];
  const result = await Promise.all([store.transact(revision, writes('a')), store.transact(revision, writes('b'))]);
  assert.equal(result.filter(Boolean).length, 1);
  const winner = result[0] ? 'a' : 'b';
  assert.equal((await store.get<{ payload: string }>('devices', 'scale-1'))?.payload, winner);
  assert.equal((await store.list('receipts')).length, 1);
  assert.equal(await store.revision(), revision + 1);
  assert.equal(await store.get('receipts', winner === 'a' ? 'b' : 'a'), null);
});

test('real D1: invariant failures roll back data and revision; replacement is atomic', async () => {
  const initial = await store.revision();
  await assert.rejects(() => store.transact(initial, [binding('binding-a', 'same-scale'), binding('binding-b', 'same-scale')]), /UNIQUE|Overlapping/);
  assert.equal(await store.revision(), initial);
  assert.equal(await store.get('bindings', 'binding-a'), null);
  await store.transact(initial, [binding('binding-a', 'same-scale')]);
  await store.transact(await store.revision(), [
    { type: 'update', table: 'bindings', id: 'binding-a', values: { valid_to: '2026-10-12T01:00:00Z', version: 1 } },
    { type: 'insert', table: 'bindings', values: { id: 'binding-b', scale_id: 'same-scale', dish_id: 'dish-2', valid_from: '2026-10-12T01:00:00Z', valid_to: null, version: 0, payload: '{}' } },
  ]);
  assert.equal((await store.list('bindings', { valid_to: null })).length, 1);
  assert.equal((await store.list('bindings')).length, 2);
  const recovered = new OperationsStore(db, 'test');
  await recovered.initialize();
  assert.equal(await recovered.revision(), await store.revision());
  assert.deepEqual(await recovered.get('bindings', 'binding-b'), await store.get('bindings', 'binding-b'));
});

test('real D1: active tasks and ledger revisions are unique, history remains readable', async () => {
  const task = (id: string): Write => ({ type: 'insert', table: 'tasks', values: { id, binding_id: 'binding-b', status: 'open', version: 0, defer_until: null, updated_at: '2026-10-12T02:00:00Z', payload: '{}' } });
  await store.transact(await store.revision(), [task('task-a')]);
  const revision = await store.revision();
  await assert.rejects(() => store.transact(revision, [task('task-b')]), /UNIQUE/);
  assert.equal(await store.revision(), revision);
  await store.transact(revision, [{ type: 'update', table: 'tasks', id: 'task-a', values: { status: 'resolved', version: 1 } }, task('task-b')]);
  const ledger = (id: string, version: number): Write => ({ type: 'insert', table: 'ledger', values: { id, cycle_id: 'cycle-a', version, current: 1, effective_at: '2026-10-12T02:00:00Z', weight_mg: 200000, payload: '{}' } });
  await store.transact(await store.revision(), [ledger('ledger-a', 0)]);
  const ledgerRevision = await store.revision();
  await assert.rejects(() => store.transact(ledgerRevision, [ledger('ledger-b', 1)]), /UNIQUE/);
  assert.equal(await store.revision(), ledgerRevision);
  await store.transact(ledgerRevision, [{ type: 'update', table: 'ledger', id: 'ledger-a', values: { current: 0 } }, ledger('ledger-b', 1)]);
  assert.equal((await store.list('ledger', { current: 1 })).length, 1);
  assert.equal((await store.list('ledger')).length, 2);
});

test('authentication rejects wrong environment, expired/revoked credentials and role escalation', async () => {
  const token = 'test_' + 'a'.repeat(48), managerToken = 'test_' + 'b'.repeat(48);
  const row = await credentialRecord({ id: 'device-gateway', token, role: 'device', actor: { id: 'gateway', kind: 'system', label: 'Gateway' }, scaleIds: ['scale-1'] });
  const manager = await credentialRecord({ id: 'manager', token: managerToken, role: 'manager', actor: { id: 'manager-1', kind: 'user', label: 'Manager' }, scaleIds: null });
  await store.transact(await store.revision(), [{ type: 'insert', table: 'credentials', values: row }, { type: 'insert', table: 'credentials', values: manager }]);
  const req = (value = token) => new Request('http://127.0.0.1/api/v2/telemetry/samples', { headers: { authorization: `Bearer ${value}`, 'x-environment': 'live' } });
  const deviceUser = await authenticateOperations(req(), store);
  assert.equal(deviceUser.environment, 'test');
  requireDeviceScope(deviceUser, ['scale-1']);
  assert.throws(() => requireDeviceScope(deviceUser, ['scale-2']), /FORBIDDEN/);
  assert.throws(() => requirePermission(deviceUser, 'staff'), /FORBIDDEN/);
  const managerUser = await authenticateOperations(req(managerToken), store);
  requirePermission(managerUser, 'staff');
  requirePermission(managerUser, 'manager');
  assert.throws(() => requirePermission(managerUser, 'device'), /FORBIDDEN/);
  await assert.rejects(() => authenticateOperations(req(), new OperationsStore(db, 'live')), /UNAUTHENTICATED/);
  await assert.rejects(() => authenticateOperations(req('invalid'), store), /UNAUTHENTICATED/);
  await store.transact(await store.revision(), [{ type: 'update', table: 'credentials', id: row.id, values: { expires_at: '2026-10-01T00:00:00Z' } }]);
  await assert.rejects(() => authenticateOperations(req(), store, '2026-10-12T00:00:00Z'), /UNAUTHENTICATED/);
  await store.transact(await store.revision(), [{ type: 'update', table: 'credentials', id: row.id, values: { expires_at: null, disabled: 1 } }]);
  await assert.rejects(() => authenticateOperations(req(), store), /UNAUTHENTICATED/);
  const persisted = await store.get<{ payload: string; token_hash: string }>('credentials', row.id);
  assert(!persisted!.payload.includes(token));
  assert.notEqual(persisted!.token_hash, token);
});


test('real D1: closed binding intervals reject insertion and update overlap; adjacency and environments are independent', async()=>{
 const historical=(id:string,from:string,to:string):Write=>({type:'insert',table:'bindings',values:{id,scale_id:'history-scale',dish_id:'dish-history',valid_from:from,valid_to:to,version:0,payload:'{}'}});
 const first=historical('history-a','2026-10-10T00:00:00Z','2026-10-10T01:00:00Z');
 await store.transact(await store.revision(),[first,historical('history-b','2026-10-10T01:00:00Z','2026-10-10T02:00:00Z')]);
 const revision=await store.revision();
 await assert.rejects(()=>store.transact(revision,[historical('history-overlap','2026-10-10T00:30:00Z','2026-10-10T01:30:00Z')]),/Overlapping/);
 assert.equal(await store.revision(),revision);assert.equal(await store.get('bindings','history-overlap'),null);
 await assert.rejects(()=>store.transact(revision,[{type:'update',table:'bindings',id:'history-a',values:{valid_to:'2026-10-10T01:00:01Z'}}]),/Overlapping/);
 assert.equal(await store.revision(),revision);
 assert.equal((await store.get<{valid_to:string}>('bindings','history-a'))?.valid_to,'2026-10-10T01:00:00Z');
 const other=new OperationsStore(db,'demo');await other.initialize();assert.equal(await other.transact(await other.revision(),[first]),true);
 assert.equal((await other.query('bindings',{where:{scale_id:'history-scale'}})).length,1);
 assert.equal((await store.query('bindings',{where:{scale_id:'history-scale'}})).length,2);
});

test('real D1: query bounds, IN/null, exclusions, cursor and SQL column allowlist',async()=>{
 const rows:Write[]=Array.from({length:5},(_,i)=>({type:'insert',table:'devices',values:{id:`query-${i}`,enabled:i%2,updated_at:`2026-10-12T0${i}:00:00Z`,payload:String(i)}}));
 await store.transact(await store.revision(),rows);
 const range={column:'id',from:'query-0',to:'query-5'};
 const first=await store.query<{id:string}>('devices',{range,limit:2});assert.deepEqual(first.map(r=>r.id),['query-0','query-1']);
 const second=await store.query<{id:string}>('devices',{range,afterId:first.at(-1)!.id,limit:2});assert.deepEqual(second.map(r=>r.id),['query-2','query-3']);
 assert.deepEqual((await store.query<{id:string}>('devices',{range:{...range,from:'query-1',fromInclusive:false,to:'query-3',toInclusive:true}})).map(r=>r.id),['query-2','query-3']);
 assert.deepEqual((await store.query<{id:string}>('devices',{range,where:{id:['query-1','query-2','query-4']},notIn:{id:['query-2']},orderBy:[{column:'id',direction:'desc'}]})).map(r=>r.id),['query-4','query-1']);
 assert.equal((await store.query('devices',{where:{id:[]}})).length,0);
 const nullable=await store.query<{id:string}>('bindings',{where:{scale_id:'same-scale',valid_to:[null]}});assert.deepEqual(nullable.map(r=>r.id),['binding-b']);
 assert.deepEqual((await store.query<{id:string}>('bindings',{where:{scale_id:'same-scale'},notIn:{valid_to:[null]}})).map(r=>r.id),['binding-a']);
 for(const query of [{where:{environment:'live'}},{orderBy:[{column:'id; DROP TABLE ops_devices',direction:'asc' as const}]},{range:{column:'environment',from:'demo'}},{notIn:{environment:['test']}},{limit:10001},{limit:0},{afterId:'x',orderBy:[{column:'updated_at',direction:'desc' as const}]}])await assert.rejects(()=>store.query('devices',query),/Invalid|cursor/);
});

test('real D1: duplicate mutate after a concurrent commit rechecks receipt even when prepare now conflicts',async()=>{
 const principal:Principal={credentialId:'race-staff',environment:'test',role:'staff',actor:{id:'race-user',kind:'user',label:'Race tester'},scaleIds:null};
 const context={store,principal,now:'2026-10-12T03:00:00Z'},requestId=crypto.randomUUID(),input={requestId,expectedVersion:0,action:'claim'};
 let reached!:()=>void,release!:()=>void;const waiting=new Promise<void>(r=>{reached=r;}),gate=new Promise<void>(r=>{release=r;});
 const loser=mutate(context,'task-action',requestId,input,async()=>{reached();await gate;throw new OperationsError('VERSION_CONFLICT',1);});
 await waiting;
 const winner=await mutate(context,'task-action',requestId,input,async revision=>({writes:[device('race-device','exactly-once')],response:{id:'saved-task',version:1,dataRevision:revision+1}}));
 release();assert.deepEqual(await loser,winner);
 assert.deepEqual(await mutate(context,'task-action',requestId,input,async()=>{throw Error('A committed retry must not prepare again');}),winner);
 assert.equal((await store.query('receipts',{where:{caller_id:principal.credentialId,request_id:requestId}})).length,1);
 await assert.rejects(()=>mutate(context,'task-action',requestId,{...input,action:'cancel'},async()=>{throw Error('must not prepare');}),/ID_CONFLICT/);
});
