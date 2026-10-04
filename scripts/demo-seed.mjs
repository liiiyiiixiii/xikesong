import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const provider = path.join(root, 'sample-provider');
const state = path.join(root, '.demo-state');
const port = Number(process.env.DEMO_PORT ?? 5273);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid DEMO_PORT');
const base = `http://127.0.0.1:${port}`;
if (!existsSync(path.join(state, 'wrangler.json'))) throw new Error('Start the isolated server first: npm run demo');
const env = { ...process.env, SCALE_BASE_URL: base };
function run(command, args, cwd = root) {
 const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
 if (result.error) throw result.error;
 if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${command}`);
}
run('python3', ['scripts/dataset.py']);
const directory = 'output/unified-36x42-20260903-20261005-v4';
const importer = 'scripts/import-unified-history.mjs';
run(process.execPath, [importer, directory, 'check'], provider);
const historyResponse = await fetch(base + '/api/preferences/history', { signal: AbortSignal.timeout(10000) });
const history = await historyResponse.json();
if (!historyResponse.ok && !history.maintenance) throw new Error('Demo backend is not ready');
if (!history.phase && !history.maintenance) run(process.execPath, ['scripts/setup.mjs'], provider);
const saved = Object.fromEntries(readFileSync(path.join(provider, '.env'), 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i=l.indexOf('='); return [l.slice(0,i),l.slice(i+1).trim()]; }));
if (saved.SCALE_BASE_URL !== base || !saved.SCALE_DEVICE_TOKEN) throw new Error('Saved demo credential does not match the isolated server');
env.SCALE_DEVICE_TOKEN = saved.SCALE_DEVICE_TOKEN;
const manifest = JSON.parse(readFileSync(path.join(provider, directory, 'manifest.json'), 'utf8'));
if (!history.phase && !history.maintenance) {
 run(process.execPath, [importer, directory, 'begin'], provider);
 run('python3', ['scripts/demo-backup.py']);
} else {
 const response = await fetch(base + '/api/preferences/import', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.SCALE_DEVICE_TOKEN}`}, body:JSON.stringify({version:2,action:'status',datasetId:manifest.datasetId}),signal:AbortSignal.timeout(10000) });
 if (!response.ok) throw new Error('Cannot read matching authenticated demo import state');
 const status = await response.json();
 if (status.state?.datasetId !== manifest.datasetId) throw new Error('A different dataset is present; refusing to replace it automatically');
 if (!status.state.reset && !existsSync(path.join(state, 'seed-backup-path.txt'))) run('python3', ['scripts/demo-backup.py']);
}
const pointer = path.join(state, 'seed-backup-path.txt');
if (!existsSync(pointer)) throw new Error('Missing initial demo backup; do not reset manually');
const backup = readFileSync(pointer, 'utf8').trim();
if (!backup.startsWith(state + path.sep)) throw new Error('Backup is outside isolated demo state');
run(process.execPath, [importer, directory, 'import', backup], provider);
console.log(`Full dataset ready: ${base}/admin and ${base}/admin?view=intelligence`);
