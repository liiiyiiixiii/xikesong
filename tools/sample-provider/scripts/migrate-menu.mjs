// Applies the current menu locally without generating or uploading consumption.
import { readFile,writeFile,mkdir,copyFile } from "node:fs/promises";
import { migrateRestaurant,layout } from "../lib/restaurant.mjs";
const output=new URL('../output/',import.meta.url);
try {const pid=Number(await readFile(new URL('simulation.lock',output),'utf8'));try{process.kill(pid,0);throw new Error('请先停止正在运行的模拟器再迁移菜单');}catch(e){if(e.code!=='ESRCH')throw e;}}catch(e){if(e.code!=='ENOENT')throw e;}
const archive=new URL(`archive/menu-before-42-${Date.now()}/`,output);await mkdir(archive,{recursive:true});
for(const name of ['state.json','layout.json','events.ndjson','session.ndjson','session-summary.json']){
 try{await copyFile(new URL(name,output),new URL(name,archive));}catch(e){if(e.code!=='ENOENT')throw e;}
}
try{const checkpoint=JSON.parse(await readFile(new URL('state.json',output),'utf8'));const migrated=migrateRestaurant(checkpoint.state);if(migrated!==checkpoint.state)await writeFile(new URL("events.ndjson",output),"");checkpoint.state=migrated;await writeFile(new URL('state.json',output),JSON.stringify(checkpoint));}catch(e){if(e.code!=='ENOENT')throw e;}
await writeFile(new URL('layout.json',output),JSON.stringify(layout,null,2));
console.log(`菜单已迁移为 ${layout.dishes.length} 道菜；旧输出备份于 ${archive.pathname}`);
