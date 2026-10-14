import path from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import { root,web,three,binary,npm,run,assertFree,supervisor,waitReady,openBrowser } from './workspace-runtime.mjs';
const mainPort=Number(process.env.WEB_PORT??5173), businessPort=Number(process.env.OPS_PORT??5183), threePort=Number(process.env.THREE_PORT??4173);
const mainUrl=`http://127.0.0.1:${mainPort}`,businessUrl=`http://127.0.0.1:${businessPort}`,threeUrl=`http://127.0.0.1:${threePort}`;
const processes=supervisor();
try {
 await assertFree([mainPort,businessPort,threePort]);
 npm(['run','build:contracts']); npm(['run','data:extract']);
 const state=path.join(root,'.business-state');mkdirSync(state,{recursive:true,mode:0o700});
 const webConfig=path.join(state,'web-wrangler.json');
 writeFileSync(webConfig,JSON.stringify({name:'zhishan-local-web',compatibility_date:'2026-05-15',d1_databases:[{binding:'DB',database_name:'site-creator-d1',database_id:'00000000-0000-4000-8000-000000000000',migrations_dir:path.join(web,'drizzle')}]}));
 run(process.execPath,[binary('wrangler'),'d1','migrations','apply','DB','--local','--config',webConfig,'--persist-to',path.join(web,'.wrangler/state')],web,{...process.env,CLOUDFLARE_CF_FETCH_ENABLED:'false',WRANGLER_SEND_METRICS:'false'});
 const main=processes.start(['scripts/run-local-with-forecast.mjs','dev'],web);
 await waitReady(mainUrl+'/admin',main);
 const business=processes.start(['--experimental-strip-types','scripts/operations-local.mjs'],web,{...process.env,OPS_TEST_DIRECTORY:path.join(root,'.business-state'),OPS_TEST_PORT:String(businessPort),OPS_TEST_FRONTEND:mainUrl});
 await waitReady(businessUrl+'/api/v2/session',business);
 const visual=processes.start([binary('vite',three),'--host','127.0.0.1','--port',String(threePort),'--strictPort'],three,{...process.env,OPERATIONS_API_TARGET:businessUrl,DEMO_API_TARGET:mainUrl});
 await waitReady(threeUrl+'/',visual);
 console.log(`\n业务工作台 ${businessUrl}/operations\n3D 业务视图 ${threeUrl}/?mode=live\n初始工作站凭证：.business-state/connection.json（仅本机保管）\n业务库默认空白，环境明确标记 test；Ctrl+C 停止。`);
 openBrowser(process.argv.includes('--operations')?businessUrl+'/operations':threeUrl+'/');
} catch(error) {console.error(error.message);process.exitCode=1;processes.stop();}
