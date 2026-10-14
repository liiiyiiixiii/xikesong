import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { OperationsStore } from '../lib/operations-v2/storage.ts';
import { createOperationsBackup, restoreOperationsBackup } from '../lib/operations-v2/backup.ts';
const [action, directory, file, environment, databaseId] = process.argv.slice(2);
if (!['backup', 'restore'].includes(action) || !directory || !file || !['test', 'demo', 'live'].includes(environment) || !databaseId || process.argv.length !== 7) {
  throw new Error('Usage: node --experimental-strip-types scripts/operations-backup.mjs backup|restore <offline D1 directory> <backup.json> test|demo|live <D1 database identifier>');
}
// The caller must stop the instance first. Restore requires a new empty path;
// the library additionally refuses a populated DB or environment mismatch.
const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("offline maintenance")}}', compatibilityDate: '2026-05-15', d1Databases: { DB: databaseId }, d1Persist: path.resolve(directory) });
try {
  const store = new OperationsStore(await mf.getD1Database('DB'), environment); await store.initialize();
  if (action === 'backup') {
    const backup = await createOperationsBackup(store); await writeFile(path.resolve(file), JSON.stringify(backup), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ action, environment, sourceRevision: backup.data.revision, sha256: backup.sha256, file: path.resolve(file) }));
  } else { await restoreOperationsBackup(store, JSON.parse(await readFile(path.resolve(file), 'utf8'))); console.log(JSON.stringify({ action, environment, verified: true, directory: path.resolve(directory) })); }
} finally { await mf.dispose(); }
