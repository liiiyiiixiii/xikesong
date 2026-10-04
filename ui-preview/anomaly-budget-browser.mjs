import {chromium} from 'playwright';
import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';
const samples=[];
for(let i=0;i<20;i++){
 const d=await(await fetch('http://127.0.0.1:5173/api/scales/state')).json(),scales=d.dishes.flatMap(x=>x.scales);
 const r={at:d.at,online:scales.filter(x=>x.status!=='offline').length,anomalies:scales.filter(x=>['anomaly','removed'].includes(x.status)).length,unknown:scales.filter(x=>x.netG===null).length,pendingBowls:new Set(d.pending.map(x=>x.scaleId)).size};samples.push(r);await delay(1000);
}
for(const s of samples.slice(-10)){assert.equal(s.online,42);assert(s.anomalies<=1);assert(s.pendingBowls<=1);assert(s.unknown<=1);}
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})}),page=await browser.newPage({viewport:{width:1366,height:768}});await page.goto('http://127.0.0.1:5173/kitchen');await page.waitForFunction(()=>document.querySelectorAll('.k-dock-tile').length===42);await page.screenshot({path:'ui-preview/kitchen-anomaly-tuned.png',fullPage:true});await browser.close();writeFileSync('sample-provider/output/anomaly-live-verification.json',JSON.stringify({passed:true,samples},null,2));console.log(samples.slice(-10));
