import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {anomalyPolicy,concurrentAnomalies} from '../lib/anomaly-policy.mjs';
const dir=new URL('../output/unified-36x42-20260903-20261005-v4/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',dir))),days=new Map();
for(let i=1;i<=manifest.expectedBatches;i++){
 const batch=JSON.parse(readFileSync(new URL(`batches/${String(i).padStart(4,'0')}.json`,dir))),b=JSON.parse(batch.payload),intervals=days.get(b.daily.date)||[];
 for(const m of b.minutes)if(m.observedSeconds<60)intervals.push({scaleId:m.scaleId,from:Date.parse(m.minute),to:Date.parse(m.minute)+60000,type:'missing'});
 for(const e of b.events)if(e.kind==='pending')intervals.push({scaleId:e.scaleId,from:Date.parse(e.at),to:Date.parse(e.resolvedAt),type:'pending'});
 days.set(b.daily.date,intervals);
}
const daily=[...days].map(([date,intervals])=>({date,maximum:concurrentAnomalies(intervals),intervals}));
for(const d of daily)assert(d.maximum<=anomalyPolicy.maxConcurrentBowls,`${d.date}: ${d.maximum}`);
const report={passed:true,policy:anomalyPolicy,days:daily.length,maximum:Math.max(...daily.map(d=>d.maximum)),daily};writeFileSync(new URL('../output/anomaly-budget-report.json',import.meta.url),JSON.stringify(report,null,2));console.log({passed:true,days:daily.length,maximum:report.maximum});
