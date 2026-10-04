import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {base,post} from '../lib/client.mjs';
async function read(){const t=Date.now(),r=await fetch(base+'/api/scales/state'),d=await r.json(),s=d.dishes.flatMap(x=>x.scales);return {ms:Date.now()-t,at:d.at,online:s.filter(x=>x.status!=='offline').length,weights:s.map(x=>x.netG),enabled:d.simulation?.enabled};}
let a;for(let i=0;i<20;i++){a=await read();if(a.online===42&&a.weights.every(x=>x!==null))break;await delay(1000);}assert.equal(a.online,42);assert(a.enabled);
await delay(12000);const b=await read();assert.equal(b.online,42);assert(b.weights.some((v,i)=>v!==a.weights[i]));
const data=await(await fetch(base+'/api/preferences')).json();const date=new Date(Date.now()+8*3600000).toISOString().slice(0,10);assert.equal(data.days.filter(x=>x.date<='2026-10-03').length,1080);assert.equal(data.executions.filter(x=>x.date===date).length,36);
await assert.rejects(post('/api/scales/ingest',{samples:[{scaleId:'sim-1',bootId:'historical-freeze-check',sequence:1,sampledAt:'2026-10-03T21:59:00+08:00',grossG:500}]}),e=>e.status===409);
const unauthorized=await fetch(base+'/api/preferences/history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false})});assert.equal(unauthorized.status,401);
const report={passed:true,a,b,changed:true,historicalDays:1080,currentExecutions:36,historicalWriteRejected:true,unauthorizedControlRejected:true};writeFileSync(new URL('../output/live-verification.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,a:{...a,weights:undefined},b:{...b,weights:undefined}},null,2));
