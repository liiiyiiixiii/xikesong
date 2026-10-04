import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const app = path.join(root, 'red-koala');
const state = path.join(root, '.demo-state');
const config = path.join(state, 'wrangler.json');
const wrangler = path.join(app, 'node_modules/wrangler/bin/wrangler.js');
const port = Number(process.env.DEMO_PORT ?? 5273);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('DEMO_PORT must be an integer between 1024 and 65535');
process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= 'false';
process.env.WRANGLER_SEND_METRICS = 'false';
function run(command, args, cwd = root) {
 const result = spawnSync(command, args, { cwd, env: process.env, stdio: 'inherit' });
 if (result.error) throw result.error;
 if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${command}`);
}
const action = process.argv[2] ?? 'start';
if (!['start', 'prepare'].includes(action)) throw new Error('Expected start or prepare');
if (!existsSync(wrangler)) throw new Error('Install dependencies first: npm run install:all');
run(process.execPath, [path.join(app, 'scripts/generate-lunch-demo.mjs')], app);
// Rebuild from current source; no private database or deployment credentials are copied.
run(process.execPath, [path.join(app, 'scripts/run-framework.mjs'), 'build'], app);
mkdirSync(state, { recursive: true, mode: 0o700 });
const secretsPath = path.join(state, 'secrets.json');
const secrets = existsSync(secretsPath) ? JSON.parse(readFileSync(secretsPath, 'utf8')) : {
 FORECAST_JOB_TOKEN: randomBytes(32).toString('hex'), ANALYSIS_KEY_SECRET: randomBytes(32).toString('hex'),
};
writeFileSync(secretsPath, JSON.stringify(secrets), { mode: 0o600 });
const runtime = JSON.parse(readFileSync(path.join(app, 'dist/server/wrangler.json'), 'utf8'));
runtime.main = path.join(app, 'dist/server/index.js');
runtime.assets.directory = path.join(app, 'dist/client');
runtime.vars = { ...runtime.vars, ...secrets };
runtime.d1_databases = runtime.d1_databases.map(db => ({ ...db, migrations_dir: path.join(app, 'drizzle') }));
writeFileSync(config, JSON.stringify(runtime), { mode: 0o600 });
run(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', config, '--persist-to', state]);
if (action === 'prepare') { console.log('Isolated demo database is ready.'); process.exit(0); }
console.log(`\nDemo game: http://127.0.0.1:${port}/demo/lunch/kitchen\nAdmin: http://127.0.0.1:${port}/admin\nBackend and frontend share this origin. Demo state is isolated in .demo-state.\n`);
const child = spawn(process.execPath, [wrangler, 'dev', '--config', config, '--local', '--persist-to', state, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0'], { cwd: root, env: process.env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
