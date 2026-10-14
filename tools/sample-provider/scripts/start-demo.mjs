import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { base,post } from '../lib/client.mjs';
mkdirSync(new URL('../output/',import.meta.url),{recursive:true});
const history=await (await fetch(base+'/api/preferences/history')).json();
if(history.mode==='scenario'){console.log('统一模拟数据集已启用，页面自动回放已有分钟记录；不启动独立实时模拟。');process.exit(0);}
const endpoints={menu:'/api/scales/devices',historical:'/api/preferences?asOf=2026-10-03T23:59:59%2B08:00',weekly:'/api/intelligence/portrait?week=2026-09-21',overall:'/api/intelligence/portrait?scope=overall',model:'/api/intelligence'};
const checks={};for(const [key,path] of Object.entries(endpoints)){const r=await fetch(base+path);if(!r.ok)throw new Error(`${key} 数据入口不可用：${r.status}`);const data=await r.json();checks[key]={status:r.status,...(key==='model'?{configured:data.configured}:{}),...(key==='historical'?{days:data.days.length,executions:data.executions.length,forecasts:data.forecasts.length}:{}),...(key==='menu'?{bowls:data.configs.filter(c=>c.enabled).length,types:new Set(data.configs.filter(c=>c.enabled).map(c=>c.dishId)).size}:{})};}
if(checks.menu.bowls!==42||checks.menu.types!==36)throw new Error('模拟菜单必须为36种菜、42个碗位');
writeFileSync(new URL('../output/connection-report.json',import.meta.url),JSON.stringify({at:new Date().toISOString(),provider:'sample-provider',checks},null,2));
await post('/api/preferences/history',{enabled:true});
try {await import('./simulate-scales.mjs');}
finally {
 let owned=true;try{const pid=Number(readFileSync(new URL('../output/simulation.lock',import.meta.url),'utf8'));if(pid!==process.pid){try{process.kill(pid,0);owned=false;}catch{}}}catch{}
 if(owned)await post('/api/preferences/history',{enabled:false}).catch(()=>{});
}
