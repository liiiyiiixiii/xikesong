import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildCurrentProfile } from '../red-koala/lib/analysis/current-profile.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'sample-provider/output/unified-36x42-20260903-20261005-v4');
const read = name => JSON.parse(readFileSync(path.join(directory, name), 'utf8'));
const manifest = read('manifest.json'), days = [], stores = new Map();
for (let i = 1; i <= manifest.expectedBatches; i++) {
 const packet = read(`batches/${String(i).padStart(4, '0')}.json`);
 assert.equal(createHash('sha256').update(packet.payload).digest('hex'), packet.checksum);
 const { daily } = JSON.parse(packet.payload);
 days.push(daily);
 stores.set(daily.date, { date: daily.date, status: 'open', snapshotAt: daily.snapshotAt, finalAt: daily.finalAt });
}
// The model receives observations only; simulated guest intentions in truth/ are not inputs.
const asOf = `${manifest.parameters.end}T23:59:59+08:00`;
const profile = buildCurrentProfile({ catalog: manifest.catalog, stores: [...stores.values()], days }, asOf, [], undefined, undefined, true);
const result = { synthetic: true, datasetId: manifest.datasetId, asOf, inputDishDays: days.length, note: '离线日观测画像；不加载模拟顾客隐藏意图，不包含实时修正或分钟时段视图。', profile };
assert.equal(profile.dishes.length, manifest.catalog.length);
const available = profile.dishes.filter(d => d.currentShare !== null);
if (available.length) assert(Math.abs(available.reduce((sum, d) => sum + d.currentShare, 0) - 1) < 1e-9);
const output = path.join(root, 'sample-provider/output/profile-simulation.json');
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ datasetId: result.datasetId, dishDays: days.length, modeled: profile.modeledCount, learning: profile.learningCount, state: profile.current.state, output: 'sample-provider/output/profile-simulation.json' }, null, 2));
