import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { post,base } from '../lib/client.mjs';
import { validateBundle } from '../lib/history/validate.mjs';
const dir=resolve(process.argv[2]??'output/unified-36x42-20260903-20261005-v4'),mode=process.argv[3]??'check';
const read=p=>JSON.parse(readFileSync(dir+'/'+p,'utf8')),manifest=read('manifest.json'),hash=s=>createHash('sha256').update(s).digest('hex');
const send=(action,extra={})=>post('/api/preferences/import',{version:2,action,datasetId:manifest.datasetId,...extra});
// Verify every generated file before entering maintenance or replacing old data.
for(const file of read('checksums.json'))assert.equal(hash(readFileSync(dir+'/'+file.path)),file.sha256,file.path);
const expected=new Map();for(let i=1;i<=manifest.expectedBatches;i++){const p=read(`batches/${String(i).padStart(4,'0')}.json`);assert.equal(hash(p.payload),p.checksum);const b=JSON.parse(p.payload);validateBundle(b);assert(!expected.has(b.daily.date+':'+b.daily.dishId));expected.set(b.daily.date+':'+b.daily.dishId,b);}
console.log(`External validation passed: ${manifest.expectedBatches} dish-days; all file checksums match.`);
if(mode==='check')process.exit(0);
if(mode==='begin'){const backupPath=process.argv[4],backup=backupPath?JSON.parse(readFileSync(backupPath,'utf8')):null;if(backup)assert.equal(hash(readFileSync(backup.backup)),backup.sha256);console.log(await send('begin',{manifest,...(backup?{replace:true,backupChecksum:backup.sha256}:{})}));process.exit(0);}
if(mode!=='import')throw new Error('mode must be check / begin / import');
const backupPath=process.argv[4];if(!backupPath)throw new Error('Provide backup.json after beginning maintenance and taking local backup.');const backup=JSON.parse(readFileSync(backupPath,'utf8'));assert.equal(hash(readFileSync(backup.backup)),backup.sha256);
const before=await send('status');
if(before.state.phase==='ready'){assert.equal(before.receipts.length,manifest.expectedBatches);for(const r of before.receipts)assert.equal(read(`batches/${r.batch_id}.json`).checksum,r.checksum);console.log('Already complete: all receipts match, no writes performed.');process.exit(0);}
await send('reset',{backupChecksum:backup.sha256});
const {receipts}=await send('status'),done=new Map(receipts.map(r=>[r.batch_id,r.checksum]));let imported=0;
for(let i=1;i<=manifest.expectedBatches;i++){const batch=read(`batches/${String(i).padStart(4,'0')}.json`);if(done.has(batch.batchId)){assert.equal(done.get(batch.batchId),batch.checksum);continue;}await post('/api/preferences/import',batch);imported++;if(i%manifest.catalog.length===0)console.log(`Imported ${i}/${manifest.expectedBatches}`);}
// Same-content retry must be a no-op. Different content with same key must fail.
const first=read('batches/0001.json');assert.equal((await post('/api/preferences/import',first)).duplicate,true);
const conflict={...first,payload:first.payload+' '};conflict.checksum=hash(conflict.payload);await assert.rejects(()=>post('/api/preferences/import',conflict),/冲突/);
const denied=await fetch(base+'/api/preferences/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(first)});assert.equal(denied.status,401);
const blocked=await fetch(base+'/api/scales/state');assert.equal(blocked.status,503);
console.log('Authentication, idempotency, conflict and maintenance checks passed.');
const dates=[...new Set([...expected.values()].map(b=>b.daily.date))].sort(),forecasts=[];
for(const date of dates){
 const f=await send('replay',{date});forecasts.push(f);
 for(const line of f.lines){if(line.samples<21)assert.equal(line.demand,null);if(line.model?.trainedThrough)assert(line.model.trainedThrough<date);}
 if(f.targetDate<=manifest.parameters.end){await send('confirm',{confirmation:{forecastId:f.id,date:f.targetDate,at:date+'T20:10:00+08:00',lines:manifest.catalog.map(d=>({dishId:d.id,quantity:expected.get(f.targetDate+':'+d.id).execution.prepared,reason:'人工模拟决策：按预设菜品经验配额、星期及渐进趋势确认试供；不是回放预测在历史时点被实际采用。'}))}});}
 console.log('Replayed',date,'numerical dishes',f.lines.filter(l=>l.demand!==null).length);
}
const audit=[];for(const date of dates){
 const actual=await send('audit',{date});assert.equal(actual.days.length,manifest.catalog.length);assert.equal(actual.minutes.length,manifest.catalog.length);assert.equal(actual.summary.dishes.length,manifest.catalog.length);
 for(const d of actual.days){const b=expected.get(date+':'+d.dishId);assert.deepEqual(d,b.daily);const m=actual.minutes.find(m=>m.dish_id===d.dishId),summary=actual.summary.dishes.find(v=>v.dishId===d.dishId);assert.equal(m.n,b.minutes.length);for(const key of ['takeG','refillG','observedSeconds','emptySeconds'])assert.equal(m[key],b.minutes.reduce((a,v)=>a+v[key],0));assert.equal(summary.takeG,m.takeG);assert.equal(summary.refillG,m.refillG);assert.equal(summary.wasteG,b.daily.waste);assert.equal(summary.remainingG,b.daily.closing);assert(Math.abs(summary.emptyMinutes-(b.daily.stockoutMinutes??summary.emptyMinutes))<1e-9);if(d.status==='partial')assert(summary.missingIntervals>0);assert(Math.abs(summary.coverage-m.observedSeconds/(60*b.minutes.length))<1e-9);}
 audit.push({date,passed:true});console.log('Readback verified',date);
}
writeFileSync(dir+'/import-report.json',JSON.stringify({datasetId:manifest.datasetId,at:new Date().toISOString(),imported,resumed:done.size,authentication:true,idempotency:true,conflict:true,maintenance:true,readback:audit,forecasts:forecasts.map(f=>({originDate:f.originDate,numeric:f.lines.filter(l=>l.demand!==null).length,generatedAt:f.generatedAt,provenance:f.provenance})),backup:backupPath},null,2));
await send('finish');console.log('Import and readback complete; maintenance released, business data frozen.');
