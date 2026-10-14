import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { manifestSchema,validateHistoryBundle,checksum,type HistoryBundle } from '../lib/preferences/history-contract.ts';
const root=new URL('./fixtures/history/',import.meta.url);
const manifest=manifestSchema.parse(JSON.parse(readFileSync(new URL('manifest.json',root),'utf8')));
const packet=JSON.parse(readFileSync(new URL('batches/0001.json',root),'utf8'));
test('v2 validates a complete generated dish day',async()=>{assert.equal(await checksum(packet.payload),packet.checksum);assert.equal(validateHistoryBundle(JSON.parse(packet.payload),manifest).minutes.length,660);});
test('v2 refuses mismatched mapping, daily totals and invented observation',()=>{
 for(const mutate of [(b:HistoryBundle)=>b.events[0].scaleId='other',(b:HistoryBundle)=>b.daily.takeFinal=(b.daily.takeFinal??0)+1,(b:HistoryBundle)=>b.minutes[20].remainingG=(b.minutes[20].remainingG??0)+1,(b:HistoryBundle)=>b.minutes[20].observedSeconds=0]){const b=JSON.parse(packet.payload);mutate(b);assert.throws(()=>validateHistoryBundle(b,manifest));}
});

test('36 logical dishes retain 42 physical bowls and enforce each bowl minute stream',()=>{
 const m=manifestSchema.parse(JSON.parse(readFileSync(new URL('manifest-36.json',root),'utf8'))),p=JSON.parse(readFileSync(new URL('batches/two-bowls.json',root),'utf8')),b=JSON.parse(p.payload);
 assert.equal(m.catalog.length,36);assert.equal(m.mapping.length,42);assert.equal(validateHistoryBundle(b,m).minutes.length,1320);
 const missing=structuredClone(b);missing.minutes.pop();assert.throws(()=>validateHistoryBundle(missing,m));
 const duplicate=structuredClone(b);duplicate.minutes[1]=duplicate.minutes[0];assert.throws(()=>validateHistoryBundle(duplicate,m));
});

test('unified scenario accepts 33 days and rejects mismatched batch totals',()=>{
 const raw={...manifest,datasetId:'unified-33',parameters:{...manifest.parameters,start:'2026-09-03',end:'2026-10-05',mode:'scenario'},expectedBatches:manifest.catalog.length*33};
 assert.equal(manifestSchema.parse(raw).expectedBatches,manifest.catalog.length*33);
 assert.throws(()=>manifestSchema.parse({...raw,expectedBatches:manifest.catalog.length*30}));
 assert.throws(()=>manifestSchema.parse({...raw,parameters:{...raw.parameters,end:'2026-09-01'}}));
});
