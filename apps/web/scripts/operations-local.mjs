import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { createOperationsApplication } from '../lib/operations-v2/application.ts';

// Standalone, explicitly test-only instance. Never opens the legacy D1 database
// or rewrites .env files. The browser can use an existing Vite frontend read-only.
const port = Number(process.env.OPS_TEST_PORT ?? 5183);
const directory = path.resolve(process.env.OPS_TEST_DIRECTORY ?? '.wrangler/operations-test');
const frontend = process.env.OPS_TEST_FRONTEND ?? 'http://127.0.0.1:5173';
await mkdir(directory, { recursive: true });
let savedToken;
try { savedToken = JSON.parse(await readFile(path.join(directory, 'connection.json'), 'utf8')).token; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const token = process.env.OPS_TEST_TOKEN ?? savedToken ?? randomBytes(32).toString('base64url');
const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("isolated operations test")}}', compatibilityDate: '2026-05-15', d1Databases: { OPS_DB: 'operations-isolated-test' }, d1Persist: path.join(directory, 'd1') });
const app = await createOperationsApplication(await mf.getD1Database('OPS_DB'), { environment: 'test', bootstrapToken: token });
// Reuse only this isolated instance's secret across restarts; never overwrite a
// persisted credential to make a new token appear valid.
await writeFile(path.join(directory, 'connection.json'), JSON.stringify({ url: `http://127.0.0.1:${port}`, token, environment: 'test' }), { mode: 0o600 });
const server = http.createServer(async (req, res) => {
  try {
    const url = `http://${req.headers.host}${req.url}`;
    if (!req.url.startsWith('/api/v2')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(403); res.end('Test proxy is read-only outside /api/v2'); return; }
      const upstream = await fetch(new URL(req.url, frontend), { headers: { accept: req.headers.accept ?? '*/*' } });
      res.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([key]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(key)))); res.end(Buffer.from(await upstream.arrayBuffer())); return;
    }
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
    const request = new Request(url, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error instanceof Error ? error.message : 'request failed'); res.writeHead(500); res.end('Request failed'); }
});
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try { await app.jobs(); }
  catch { console.error('Operations background jobs unavailable; retrying on the next tick.'); }
  finally { running = false; }
}, 5000);
server.listen(port, '127.0.0.1', () => console.log(`Operations test instance: http://127.0.0.1:${port}; credentials saved in ${path.join(directory, 'connection.json')}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { clearInterval(timer); server.close(); await mf.dispose(); process.exit(0); });
