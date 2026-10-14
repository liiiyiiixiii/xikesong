import { mkdirSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parameters,simulateDay } from '../lib/history/generate.mjs';
import { validateBundle } from '../lib/history/validate.mjs';
import { anomalyPolicy,concurrentAnomalies } from '../lib/anomaly-policy.mjs';
import { dishes,bowls } from '../lib/dishes.mjs';
const dir=resolve(process.argv[2]??'output/unified-36x42-20260903-20261005-v4');mkdirSync(dir,{recursive:true});mkdirSync(dir+'/batches',{recursive:true});mkdirSync(dir+'/truth',{recursive:true});
const sha=s=>createHash('sha256').update(s).digest('hex'),files=[],reports=[];
const save=(path,value)=>{const raw=JSON.stringify(value);writeFileSync(dir+'/'+path,raw);files.push({path,bytes:Buffer.byteLength(raw),sha256:sha(raw)});return raw;};
const dayCount=Math.round((Date.parse(parameters.end)-Date.parse(parameters.start))/86400000)+1;
const manifest={datasetId:'restaurant-36x42-20260903-20261005-v4.0',parameters,catalog:dishes.map(d=>({id:d.id,name:d.name,category:d.category,unit:'g',pieceWeightG:null,launchDate:parameters.start})),mapping:bowls.map(({id,scaleId,position})=>({dishId:id,scaleId,position})),expectedBatches:dishes.length*dayCount};
save('manifest.json',manifest);let n=0;
for(let day=0;day<dayCount;day++){
 const result=simulateDay(day);
 const intervals=result.bundles.flatMap(b=>[...b.minutes.filter(m=>m.observedSeconds<60).map(m=>({scaleId:m.scaleId,from:Date.parse(m.minute),to:Date.parse(m.minute)+60000})),...b.events.filter(e=>e.kind==='pending').map(e=>({scaleId:e.scaleId,from:Date.parse(e.at),to:Date.parse(e.resolvedAt)}))]);
 if(concurrentAnomalies(intervals)>anomalyPolicy.maxConcurrentBowls)throw new Error(`${result.date} 同时异常碗位超过上限`);
 reports.push(result.report);save(`truth/${result.date}.json`,{events:result.truth,guests:result.guests,secondSamples:result.sampled});
 for(const bundle of result.bundles){validateBundle(bundle);const payload=JSON.stringify(bundle),batch={version:2,action:'batch',datasetId:manifest.datasetId,batchId:String(++n).padStart(4,'0'),checksum:sha(payload),payload};if(Buffer.byteLength(JSON.stringify(batch))>=2000000)throw new Error('批次过大');save(`batches/${batch.batchId}.json`,batch);}
 console.log(result.date,result.report.guests,result.report.meanIntakeG.toFixed(0),result.report.anomalies.length);
}
save('validation.json',{passed:true,parameters,days:dayCount,dishes:dishes.length,bowls:bowls.length,dishDays:n,averageGuests:reports.reduce((a,r)=>a+r.guests,0)/dayCount,checks:['seat_limit','guest_target','plate_mass_balance','kitchen_mass_balance','observations_derive_from_events','event_minute_day_equality','snapshot_cutoff','coverage_and_stockout','36_dishes_42_bowls_each_day'],daily:reports});
writeFileSync(dir+'/checksums.json',JSON.stringify(files,null,2));console.log('Validated output:',dir);
