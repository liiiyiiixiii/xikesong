import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5173/admin?view=daily');await page.waitForFunction(()=>document.querySelector('input[type=date]')?.value==='2026-10-03');await page.waitForTimeout(3500);await page.screenshot({path:'ui-preview/history-daily.png',fullPage:true});
console.log('daily needs attention',await page.getByRole('button',{name:'需关注 3 道菜，查看明细'}).count());
await page.getByRole('tab',{name:'备料计划',exact:true}).click().catch(()=>{});await page.waitForTimeout(1000);await page.screenshot({path:'ui-preview/history-plan.png',fullPage:true});
await page.goto('http://127.0.0.1:5173/admin');await page.waitForTimeout(2000);await page.screenshot({path:'ui-preview/history-offline.png',fullPage:true});console.log('horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'page errors',errors);
await browser.close();
