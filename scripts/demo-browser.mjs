import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const base=`http://127.0.0.1:${Number(process.env.DEMO_PORT??5273)}`;
const visual=`http://127.0.0.1:${Number(process.env.THREE_PORT??4273)}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:900,height:650}}),errors=[];
page.setDefaultTimeout(120000);
page.on('pageerror',error=>errors.push(error.message));
page.on('response',response=>{if(response.status()>=400 && [base,visual].some(origin=>response.url().startsWith(origin)))errors.push(`${response.status()} ${response.url()}`);});
await mkdir('output/browser',{recursive:true});
try {
 console.log('Browser: loading 3D');
 await page.goto(visual,{waitUntil:'domcontentloaded'});
 await page.locator('#restart:enabled').waitFor();
 await page.locator('#restart').click();
 await page.locator('#pause:enabled').waitFor();
 console.log('Browser: shared playback connected');
 const state=()=>fetch(base+'/api/demo/v1/state').then(r=>r.json());
 if((await state()).playback.status==='paused')await page.locator('#pause').click();
 await page.getByRole('button',{name:'暂停',exact:true}).waitFor();
 await page.locator('#pause').click();await page.getByRole('button',{name:'继续',exact:true}).waitFor();
 assert.equal((await state()).playback.status,'paused');
 await page.locator('#pause').click();await page.getByRole('button',{name:'暂停',exact:true}).waitFor();
 const generation=(await state()).generation;await page.locator('#restart').click();
 await page.waitForFunction(previous=>Number(document.querySelector('#generation')?.textContent.match(/\d+/)?.[0])>previous+1,generation);
 assert.equal((await state()).generation,generation+1);
 console.log('Browser: playback controls passed');
 await page.screenshot({path:'output/browser/restaurant-3d.png',fullPage:true});
 for(const route of ['/admin','/kitchen','/admin?view=intelligence']) {
  await page.goto(base+route,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.innerText.length>100);
  await page.locator('img').evaluateAll(images=>Promise.all(images.map(img=>img.decode().catch(()=>{}))));
  assert((await page.locator('body').innerText()).length>100,route);
  assert.equal(await page.locator('img').evaluateAll(images=>images.filter(img=>!img.complete||img.naturalWidth===0).length),0,`Broken images: ${route}`);
 }
 await page.screenshot({path:'output/browser/intelligence.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Browser passed: rendered 3D, shared pause/resume/restart, admin, kitchen, intelligence, images and local HTTP resources.');
} finally {await browser.close();}
