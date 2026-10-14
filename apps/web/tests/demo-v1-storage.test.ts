import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {d1Store,timeOf} from '../lib/demo-v1/session.ts';
import type {Control} from '@zhishan/contracts/demo-v1';
test('real isolated D1: concurrent controls, idempotent restart, receipt conflict and persistent recovery',async()=>{
 const mf=new Miniflare({modules:true,script:'export default { fetch(){return new Response("test")} }',compatibilityDate:'2026-05-15',d1Databases:{DB:'demo-v1-test'}});
 try{
  const db=await mf.getD1Database('DB') as unknown as D1Database;let now=1000;
  const a=d1Store(db,'dataset','fingerprint',100000,()=>now),s=await a.read();now=20000;
  const input:Control={action:'restart',requestId:crypto.randomUUID(),sessionId:s.sessionId,generation:s.generation};
  const duplicates=await Promise.all(Array.from({length:8},()=>a.control(input)));assert.ok(duplicates.every(r=>r.generation===1));assert.equal((await a.read()).generation,1);
  const current=await a.read(),requestId=crypto.randomUUID();
  // Barrier: both requests must first observe a missing receipt before either can CAS.
  let arrivals=0;let release:()=>void=()=>{};const barrier=new Promise<void>(r=>{release=r;});
  const gated=new Proxy(db,{get(target,key){if(key!=='prepare'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}return (sql:string)=>{const stmt=target.prepare(sql);if(!sql.startsWith('SELECT signature,session_id'))return stmt;return {bind(...args:unknown[]){const bound=stmt.bind(...args);if(args[0]!==requestId)return bound;return {async first(){const result=await bound.first();if(arrivals<2){arrivals++;if(arrivals===2)release();await barrier;}return result;}};}};};}}) as D1Database;
  const racing=d1Store(gated,'dataset','fingerprint',100000,()=>now);
  const conflicting=await Promise.allSettled([racing.control({action:'pause',requestId,sessionId:s.sessionId,generation:1}),racing.control({action:'resume',requestId,sessionId:s.sessionId,generation:1})]);
  assert.equal(conflicting.filter(r=>r.status==='fulfilled').length,1);assert.equal(conflicting.filter(r=>r.status==='rejected').length,1);
  const stored=await a.read(),receipt=await db.prepare('SELECT signature FROM demo_v1_controls WHERE request_id=?').bind(requestId).first<{signature:string}>();assert.equal(stored.paused,JSON.parse(receipt!.signature).action==='pause');
  assert.equal(stored.controlRevision-current.controlRevision,stored.paused?1:0);
  const paused=await a.control({action:'pause',requestId:crypto.randomUUID(),sessionId:s.sessionId,generation:1});now=90000;
  const recovered=d1Store(db,'dataset','fingerprint',100000,()=>now);assert.deepEqual(await recovered.read(),paused);assert.equal(timeOf(await recovered.read(),now,100000),paused.offsetMs);
  const replacement=d1Store(db,'dataset-v2','changed',100000,()=>now);assert.notEqual((await replacement.read()).sessionId,s.sessionId);
 }finally{await mf.dispose();}
});
