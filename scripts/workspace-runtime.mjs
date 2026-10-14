import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const web = path.join(root, 'apps/web');
export const three = path.join(root, 'apps/restaurant-3d');
export function binary(name, from = web) {
 for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
  const file = path.join(dir, 'node_modules', name, 'package.json');
  if (existsSync(file)) {
   const pkg = JSON.parse(readFileSync(file, 'utf8'));
   const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[name] ?? Object.values(pkg.bin ?? {})[0];
   if (!bin) throw new Error(`No executable for ${name}`);
   return path.resolve(path.dirname(file), bin);
  }
  if (dir === path.dirname(dir)) throw new Error(`Missing ${name}; run npm ci at the repository root`);
 }
}
export function run(command, args, cwd = root, env = process.env) {
 const result = spawnSync(command, args, {cwd, env, stdio:'inherit'});
 if (result.error) throw result.error;
 if (result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(' ')}`);
}
export function npm(args, cwd = root, env = process.env) {
 if (!process.env.npm_execpath) throw new Error('Use npm run to launch this command.');
 run(process.execPath, [process.env.npm_execpath, ...args], cwd, env);
}
export async function assertFree(ports) {
 for (const port of ports) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid port: ${port}`);
  const occupied = await new Promise(resolve => {
   const socket = net.connect({host:'127.0.0.1', port});
   socket.setTimeout(1000);
   const finish = value => {socket.destroy(); resolve(value);};
   socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.once('timeout', () => finish(true));
  });
  if (occupied) throw new Error(`Port ${port} is occupied. Stop that instance or choose another port; no process was replaced.`);
 }
 if (new Set(ports).size !== ports.length) throw new Error('Service ports must be distinct');
}
export function supervisor() {
 const children = []; let stopped = false;
 function stop() {
  if (stopped) return; stopped = true;
  for (const child of children.reverse()) {try {process.kill(-child.pid, 'SIGTERM');} catch(error) {if(error.code !== 'ESRCH') console.error(error.message);}}
 }
 for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {stop(); process.exitCode = 0;});
 process.once('exit', stop);
 return {
  start(args, cwd = root, env = process.env) {
   const child = spawn(process.execPath, args, {cwd, env, stdio:'inherit', detached:true}); children.push(child);
   child.once('error', error => {console.error(error.message); process.exitCode = 1; stop();});
   child.once('exit', code => {if (!stopped) {process.exitCode = code || 1; stop();}});
   return child;
  }, stop,
 };
}
export async function waitReady(url, child, timeout = 120000) {
 const deadline = Date.now() + timeout;
 while (Date.now() < deadline) {
  if (child.exitCode !== null) throw new Error(`Service stopped before ready: ${url}`);
  try {const response = await fetch(url, {signal:AbortSignal.timeout(3000)}); await response.body?.cancel(); if(response.ok) return;} catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
 }
 throw new Error(`Startup timed out: ${url}`);
}
export function openBrowser(url) {
 if (process.argv.includes('--no-open') || process.env.CI) return;
 const executable = process.platform === 'darwin' ? 'open' : 'xdg-open';
 const child = spawn(executable, [url], {stdio:'ignore'}); child.on('error', () => {}); child.unref();
}
