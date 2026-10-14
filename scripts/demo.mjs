import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { root, web, three, binary, run, npm, assertFree, supervisor, waitReady, openBrowser } from './workspace-runtime.mjs';
const mainPort = Number(process.env.DEMO_PORT ?? 5273), threePort = Number(process.env.THREE_PORT ?? 4273);
const state = path.join(root, '.demo-state'), configPath = path.join(state, 'wrangler.json');
const env = {...process.env, CLOUDFLARE_CF_FETCH_ENABLED:'false', WRANGLER_SEND_METRICS:'false'};
const processes = supervisor();
try {
 await assertFree([mainPort, threePort]);
 npm(['run','build'], root, env);
 mkdirSync(state, {recursive:true, mode:0o700});
 const secretsPath = path.join(state, 'secrets.json');
 const secrets = existsSync(secretsPath) ? JSON.parse(readFileSync(secretsPath,'utf8')) : {
  FORECAST_JOB_TOKEN:randomBytes(32).toString('hex'), ANALYSIS_KEY_SECRET:randomBytes(32).toString('hex'),
 };
 writeFileSync(secretsPath, JSON.stringify(secrets), {mode:0o600});
 const config = JSON.parse(readFileSync(path.join(web,'dist/server/wrangler.json'),'utf8'));
 config.main = path.join(web,'dist/server/index.js');
 config.assets.directory = path.join(web,'dist/client');
 config.vars = {...config.vars, ...secrets};
 config.d1_databases = config.d1_databases.filter(db => db.binding === 'DB').map(db => ({...db,migrations_dir:path.join(web,'drizzle')}));
 delete config.triggers; delete config.services;
 writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 const wrangler = binary('wrangler');
 run(process.execPath,[wrangler,'d1','migrations','apply','DB','--local','--config',configPath,'--persist-to',state],web,env);
 const main = processes.start([wrangler,'dev','--config',configPath,'--local','--persist-to',state,'--ip','127.0.0.1','--port',String(mainPort),'--inspector-port','0'],web,env);
 await waitReady(`http://127.0.0.1:${mainPort}/api/demo/v1/manifest`,main);
 // Historical import is explicit, authenticated, resumable and limited to this isolated state.
 run(process.execPath,['scripts/demo-seed.mjs'],root,{...env,DEMO_PORT:String(mainPort)});
 const initializedPath = path.join(state,'initialized.json');
 if (!existsSync(initializedPath)) {
  const base=`http://127.0.0.1:${mainPort}`;
  const playback=await (await fetch(base+'/api/demo/v1/state')).json();
  const response=await fetch(base+'/api/demo/v1/control',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({action:'restart',requestId:crypto.randomUUID(),sessionId:playback.sessionId,generation:playback.generation})});
  if (!response.ok) throw new Error('Cannot start the initial demo playback');
  writeFileSync(initializedPath,JSON.stringify({datasetId:playback.datasetId}),{mode:0o600});
 }
 const visual = processes.start([binary('vite',three),'preview','--host','127.0.0.1','--port',String(threePort),'--strictPort'],three,{...env,DEMO_API_TARGET:`http://127.0.0.1:${mainPort}`});
 await waitReady(`http://127.0.0.1:${threePort}/`,visual);
 console.log(`\n知膳演示已就绪：\n3D http://127.0.0.1:${threePort}/\n管理端 http://127.0.0.1:${mainPort}/admin\n厨房 http://127.0.0.1:${mainPort}/kitchen\nCtrl+C 停止；数据保存在 .demo-state。`);
 openBrowser(`http://127.0.0.1:${threePort}/`);
} catch(error) {console.error(error.message);process.exitCode=1;processes.stop();}
