import { readdirSync, readFileSync, lstatSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './workspace-runtime.mjs';
const excluded=new Set(['.git','node_modules','dist','.next','.vinext','.wrangler','.sites-runtime','.agents','.codex','.demo-state','.business-state','.local-run','output','outputs','backups','coverage','tmp']);
const dataRoots=new Set(['apps/web/data','tools/sample-provider/data']);
const issues=[],files=[];
function walk(dir='') {
 for(const name of readdirSync(path.join(root,dir))) {
  const relative=dir?`${dir}/${name}`:name;
  if(excluded.has(name)||dataRoots.has(relative)||name==='.DS_Store'||name.endsWith('.tsbuildinfo'))continue;
  const full=path.join(root,relative),info=lstatSync(full);
  if(info.isSymbolicLink()){issues.push(`Symlink: ${relative}`);continue;}
  if(info.isDirectory()){walk(relative);continue;}
  if(/^\.env(?:\.|$)/.test(name)&&name!=='.env.example'){issues.push(`Private environment file: ${relative}`);continue;}
  files.push(relative);
  if(/\.(?:tgz|tar|gz|bak)$/.test(name)||(/\.zip$/.test(name)&&!relative.startsWith('datasets/')))issues.push(`Unexpected archive or backup: ${relative}`);
  if(info.size>50*1024*1024)issues.push(`Oversized file: ${relative}`);
  if(/\.(?:db|sqlite|pem|key)(?:-|$)/.test(name))issues.push(`Private runtime file: ${relative}`);
  if(/\.(?:png|jpe?g|gif|webp|zip|mp4|webm|pdf|woff2?)$/i.test(name))continue;
  const content=readFileSync(full,'utf8');
  if([/-----BEGIN [A-Z ]*PRIVATE KEY-----/,/\bsk-[A-Za-z0-9_-]{20,}/,/\bgh[pousr]_[A-Za-z0-9]{20,}/,/\bAKIA[A-Z0-9]{16}\b/].some(re=>re.test(content)))issues.push(`Possible secret: ${relative}`);
  if(/\/Users\/[^/]+\//.test(content))issues.push(`Author machine path: ${relative}`);
 }
}
walk();files.sort();
if(process.argv.includes('--write-manifest'))writeFileSync(path.join(root,'PUBLIC_FILES.json'),JSON.stringify(files,null,2)+'\n');
const allowed=new Set(JSON.parse(readFileSync(path.join(root,'PUBLIC_FILES.json'),'utf8')));
for(const file of files)if(!allowed.has(file))issues.push(`Not in release manifest: ${file}`);
for(const file of allowed)if(!files.includes(file))issues.push(`Missing manifest file: ${file}`);
if(issues.length){console.error(issues.join('\n'));process.exitCode=1;}else console.log(`Release inventory passed: ${files.length} files. Secret patterns are heuristic; dataset contents are checked separately.`);
