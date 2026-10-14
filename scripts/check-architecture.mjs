import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './workspace-runtime.mjs';
const issues=[];
function files(dir) {return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()&&!['node_modules','dist'].includes(e.name)?files(path.join(dir,e.name)):e.isFile()&&/\.[cm]?[jt]sx?$/.test(e.name)?[path.join(dir,e.name)]:[]);}
function imports(file) {return [...readFileSync(file,'utf8').matchAll(/(?:from\s*|import\s*\(|import\s*)['"]([^'"]+)['"]/g)].map(m=>m[1]);}
for(const [area,forbidden] of [['apps/restaurant-3d/src','apps/web'],['apps/web/app','apps/restaurant-3d'],['apps/web/lib','apps/restaurant-3d']]) {
 for(const file of files(path.join(root,area))) for(const ref of imports(file)) {
  if(ref.startsWith('.')&&path.resolve(path.dirname(file),ref).startsWith(path.join(root,forbidden))) issues.push(`Cross-app runtime import: ${path.relative(root,file)} -> ${ref}`);
 }
}
for(const file of files(path.join(root,'packages/contracts/src'))) for(const ref of imports(file)) {
 if(!ref.startsWith('.')&&ref!=='zod') issues.push(`Contract depends on runtime service: ${ref}`);
 if(ref.startsWith('.')&&!path.resolve(path.dirname(file),ref).startsWith(path.join(root,'packages/contracts/src')+path.sep)) issues.push(`Contract escapes package: ${ref}`);
}
const base=path.join(root,'apps/web/lib/operations-v2'),graph=new Map();
for(const file of files(base))graph.set(file,imports(file).filter(ref=>ref.startsWith('.')).map(ref=>path.resolve(path.dirname(file),ref)));
const visited=new Set(),active=new Set();
function walk(file,trail=[]) {if(active.has(file)){issues.push(`Cycle: ${[...trail,file].map(f=>path.basename(f)).join(' -> ')}`);return;}if(visited.has(file)||!graph.has(file))return;active.add(file);for(const dep of graph.get(file))walk(dep,[...trail,file]);active.delete(file);visited.add(file);}
for(const file of graph.keys())walk(file);
if(issues.length){console.error(issues.join('\n'));process.exitCode=1;}else console.log('Module boundaries passed: shared contracts, no cross-app runtime imports, no operations module cycles.');
