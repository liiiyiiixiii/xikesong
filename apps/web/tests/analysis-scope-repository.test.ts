import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Dataset, DishDay } from '../lib/preferences/types.ts';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../drizzle/0007_blushing_kingpin.sql', import.meta.url), 'utf8'));
sqlite.exec('CREATE TABLE IF NOT EXISTS intelligence_reports(id TEXT PRIMARY KEY,payload TEXT,lease_until TEXT NOT NULL)');
class Statement {
  readonly sql: string; readonly args: SQLInputValue[];
  constructor(sql: string, args: SQLInputValue[] = []) { this.sql = sql; this.args = args; }
  bind(...args: SQLInputValue[]) { return new Statement(this.sql, args); }
  async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; }
  async run() { return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.args).changes) } }; }
}
const fixture = {
  history: null as null | { datasetId: string; phase: string; manifest: { parameters: { mode: string; start: string; end: string } }; simulation?: { enabled: boolean; provider: string } },
  data: { catalog: [], stores: [], days: [] } as Dataset,
  profileTimes: [] as string[], modelCalls: [] as { startDate: string; endDate: string; question: string }[],
  modelEnabled: false, realtimeCalls: 0, profileRevision: 0, profileUnavailable: false,
};
const fakeDB = { exec: async (sql: string) => { sqlite.exec(sql); }, prepare: (sql: string) => new Statement(sql) };
Object.assign(globalThis, { analysisScopeFixture: fixture, analysisScopeDB: fakeDB });
const modules: Record<string, string> = {
  '/lib/preferences/history-state.ts': 'export const historyState=async()=>globalThis.analysisScopeFixture.history;export const historyGuard=async()=>null;',
  '/lib/preferences/repository.ts': 'export const readDataset=async()=>globalThis.analysisScopeFixture.data;',
  '/lib/scales/repository.ts': "export const realtime=async()=>{globalThis.analysisScopeFixture.realtimeCalls++;return {source:'live',at:new Date().toISOString(),dishes:[],pending:[]};};export const readMinutes=async()=>[];export const readEvents=async()=>[];export const readSettings=async()=>({openTime:'11:00',closeTime:'22:00'});",
  '/lib/analysis/overall-repository.ts': "export const loadOverallProfile=async(asOf)=>{globalThis.analysisScopeFixture.profileTimes.push(asOf);if(globalThis.analysisScopeFixture.profileUnavailable)throw new Error('unavailable');return {asOf,version:'test',parameters:{revision:globalThis.analysisScopeFixture.profileRevision},dishes:[],modeledCount:0,learningCount:0};};",
  '/lib/analysis/credentials.ts': "export const resolveModelConfig=async()=>({apiKey:globalThis.analysisScopeFixture.modelEnabled?'test-only':'',model:'stub'});",
  '/lib/analysis/provider.ts': "export const createCompletion=()=>async()=>{throw new Error('No model request may be made in these tests');};",
  '/lib/analysis/tools.ts': 'export const createTools=(input)=>async()=>({title:"dates",data:input});',
  '/lib/analysis/agent.ts': "export const runAgent=async(input,_model,_complete,execute)=>{globalThis.analysisScopeFixture.modelCalls.push(input);return {answer:input.question,evidence:[await execute('daily_statistics',{})]};};",
};
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env={DB:globalThis.analysisScopeDB}', shortCircuit: true };
  let url: URL | undefined;
  if (specifier.startsWith('@/')) url = new URL('../' + specifier.slice(2), import.meta.url);
  else if (specifier.startsWith('.')) url = new URL(specifier, context.parentURL);
  if (url?.protocol === 'file:') {
    if (!url.pathname.endsWith('.ts') && existsSync(fileURLToPath(url) + '.ts')) url = new URL(url.href + '.ts');
    const replacement = Object.entries(modules).find(([path]) => url!.pathname.endsWith(path));
    if (replacement) return { url: 'data:text/javascript,' + encodeURIComponent(replacement[1]), shortCircuit: true };
    if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
  }
  return next(specifier, context);
} });
const archive = await import('../lib/analysis/archive-repository.ts');
const visual = await import('../lib/analysis/daily-visual-repository.ts');
const rangeRoute = await import('../app/api/intelligence/range-report/route.ts');
const { currentRealtime } = await import('../lib/scales/current.ts');
type RangeResponse = { startDate: string | null; endDate: string | null; result: unknown; availableRange: { startDate: string; endDate: string } | null; reason?: string };

function scenario(id = 'dataset-a') { return { datasetId: id, phase: 'ready', manifest: { parameters: { mode: 'scenario', start: '2027-02-01', end: '2027-02-10' } } }; }
beforeEach(() => {
  sqlite.exec('DELETE FROM portrait_archives; DELETE FROM intelligence_reports;');
  if(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='portrait_archive_versions'").get())sqlite.exec('DELETE FROM portrait_archive_versions');
  fixture.history = scenario(); fixture.profileTimes = []; fixture.modelCalls = []; fixture.modelEnabled = false; fixture.profileRevision = 0; fixture.profileUnavailable = false;
  fixture.data = { catalog: [], stores: [], days: Array.from({ length: 10 }, (_, index) => { const date = `2027-02-${String(index + 1).padStart(2, '0')}`; return { date, dishId: 'dish', finalAt: date + 'T23:00:00+08:00', takeFinal: 100 } as DishDay; }) };
});

test('archives support dates outside the old demo window, isolate datasets, and preserve the requested cutoff', async () => {
  const saved = await archive.generateDailyArchive('2027-02-07');
  assert.equal(fixture.profileTimes[0], '2027-02-07T15:59:59.000Z');
  assert.equal((await archive.listArchives()).items[0].date, '2027-02-07');
  assert.equal((await archive.listArchives()).availableRange?.endDate, '2027-02-10');
  assert.equal((await archive.listArchives(undefined, { startDate: '2027-02-08' })).items.length, 0);
  fixture.history = scenario('dataset-b');
  assert.equal((await archive.listArchives()).items.length, 0);
  assert.equal(await archive.readArchive(saved.id), null);
  await assert.rejects(() => archive.analyzeArchive(saved.id), /当前数据源/);
  await assert.rejects(() => archive.generateDailyArchive('2027-02-11'), /尚无/);
});

test('daily replay panels use the dataset date and never create wall-clock copies', async () => {
  const result = await visual.generateDailyVisual();
  assert.equal(result.record?.date, '2027-02-10');
  assert.equal(result.record?.profile.asOf, '2027-02-10T23:59:59+08:00');
  assert.equal(result.record?.status, 'unconfigured');
  await visual.generateDailyVisual();
  assert.equal(fixture.profileTimes.length, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM intelligence_reports').get()!.n, 1);
  assert.equal((await visual.readDailyVisual()).record?.date, '2027-02-10');
  await assert.rejects(() => visual.readDailyVisual('2027-02-11'), /截止/);
});

test('old panels with a mismatched data date are excluded from trend history without deleting them', async () => {
  const payload = { date: '2027-02-09', profile: { asOf: '2027-02-08T23:00:00+08:00', version: 'test', parameters: {}, dishes: [] } };
  sqlite.prepare('INSERT INTO intelligence_reports(id,payload,lease_until) VALUES(?,?,?)').run('daily-panel:scenario:dataset-a:2027-02-09', JSON.stringify(payload), '');
  assert.equal((await visual.readVisualTrend('2027-02-10')).length, 0);
  assert.equal((await visual.readDailyVisual('2027-02-09')).record, null);
  assert.deepEqual((await visual.readDailyVisual()).dates, []);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM intelligence_reports').get()!.n, 1);
});

test('range reports default to available dates, honor requests, and separate changed evidence and sources', async () => {
  let response = await rangeRoute.GET(new Request('http://local/api/intelligence/range-report'));
  let result = await response.json() as RangeResponse;
  assert.deepEqual([result.startDate, result.endDate], ['2027-02-04', '2027-02-10']);
  fixture.modelEnabled = true;
  const request = () => new Request('http://local/api/intelligence/range-report', { method: 'POST', body: JSON.stringify({ startDate: '2027-02-01', endDate: '2027-02-03' }) });
  response = await rangeRoute.POST(request()); assert.equal(response.status, 200);
  result = await response.json() as RangeResponse; assert.deepEqual([result.startDate, result.endDate], ['2027-02-01', '2027-02-03']);
  assert.equal(fixture.modelCalls.length, 1);
  await rangeRoute.POST(request()); assert.equal(fixture.modelCalls.length, 1, 'same evidence reuses its report');
  fixture.data.days[0].takeFinal = 150;
  await rangeRoute.POST(request()); assert.equal(fixture.modelCalls.length, 2, 'changed evidence needs a new report');
  fixture.history = scenario('dataset-b');
  await rangeRoute.POST(request()); assert.equal(fixture.modelCalls.length, 3, 'another dataset never reuses a report');
  const invalid = await rangeRoute.POST(new Request('http://local/api/intelligence/range-report?startDate=2027-02-10&endDate=2027-02-11', { method: 'POST' }));
  assert.equal(invalid.status, 400); assert.equal(fixture.modelCalls.length, 3);
});

test('empty datasets return explicit no-data metadata without calling a model', async () => {
  fixture.data.days = [];
  const response = await rangeRoute.GET(new Request('http://local/api/intelligence/range-report'));
  assert.equal(response.status, 200);
  const result = await response.json() as RangeResponse; assert.equal(result.result, null); assert.equal(result.availableRange, null); assert(result.reason);
  assert.equal(fixture.modelCalls.length, 0);
});

test('realtime cache shares reads but invalidates when source control changes', async () => {
  fixture.history = null; fixture.realtimeCalls = 0;
  const reads = await Promise.all([currentRealtime(), currentRealtime()]);
  assert.equal(fixture.realtimeCalls, 1); assert.equal(reads[0].provenance.kind, 'unverified');
  fixture.history = { ...scenario('simulated'), manifest: { parameters: { mode: 'history', start: '2027-02-01', end: '2027-02-10' } }, simulation: { enabled: true, provider: 'sample-provider' } };
  const simulated = await currentRealtime(); assert.equal(simulated.provenance.kind, 'simulation'); assert.equal(fixture.realtimeCalls, 2);
  fixture.history = scenario('replay');
  assert.equal((await currentRealtime()).provenance.datasetId, 'replay'); assert.equal(fixture.realtimeCalls, 3);
  fixture.history.phase = 'maintenance';
  await assert.rejects(() => currentRealtime(), /维护/);
});


test('D10 archive and daily numerical fingerprints detect corrections without overwriting snapshots or confirmed plans', async () => {
  sqlite.exec('CREATE TABLE IF NOT EXISTS weight_plans(id TEXT PRIMARY KEY,source TEXT NOT NULL,date TEXT NOT NULL,payload TEXT NOT NULL)');
  const plan = JSON.stringify({ forecastId: 'frozen-forecast', lines: [{ dishId: 'dish', quantity: 500, reason: 'confirmed' }] });
  sqlite.prepare('INSERT OR REPLACE INTO weight_plans VALUES(?,?,?,?)').run('confirmed-plan', 'live', '2027-02-11', plan);
  const saved = await archive.generateDailyArchive('2027-02-07');
  await visual.generateDailyVisual();
  const beforeArchive = sqlite.prepare('SELECT payload FROM portrait_archives WHERE id=?').get(saved.id)!.payload;
  const beforeVisual = sqlite.prepare('SELECT payload FROM intelligence_reports').get()!.payload;
  let detail = (await archive.readArchive(saved.id))!;
  assert.equal(detail.snapshot?.basis, 'legacy_delta_v1');
  assert.equal(detail.snapshot?.includesV2Ledger, false);
  assert.equal(detail.snapshot?.currentness, 'current');
  assert.equal(detail.snapshot?.fingerprint.length, 64);
  assert.equal((await archive.listArchives()).items[0].snapshot?.currentness, 'unchecked');
  fixture.profileRevision = 1;
  detail = (await archive.readArchive(saved.id))!;
  assert.equal(detail.snapshot?.currentness, 'outdated');
  assert.notEqual(detail.snapshot?.fingerprint, detail.snapshot?.currentFingerprint);
  assert.equal(detail.profile.asOf, '2027-02-07T15:59:59.000Z');
  assert.equal((await visual.readDailyVisual()).record?.snapshot?.currentness, 'outdated');
  assert.equal(sqlite.prepare('SELECT payload FROM portrait_archives WHERE id=?').get(saved.id)!.payload, beforeArchive);
  assert.equal(sqlite.prepare('SELECT payload FROM intelligence_reports').get()!.payload, beforeVisual);
  assert.equal(sqlite.prepare('SELECT payload FROM weight_plans WHERE id=?').get('confirmed-plan')!.payload, plan);
  assert.equal(fixture.modelCalls.length, 0);
  fixture.profileUnavailable = true;
  assert.equal((await archive.readArchive(saved.id))!.snapshot?.currentness, 'unknown');
  assert.equal((await visual.readDailyVisual()).record?.snapshot?.currentness, 'unknown');
});

test('D10 old archives derive their immutable fingerprint without requiring a data migration', async () => {
  const saved = await archive.generateDailyArchive('2027-02-07');
  const row = sqlite.prepare('SELECT payload FROM portrait_archives WHERE id=?').get(saved.id)!;
  const payload = JSON.parse(row.payload as string); delete payload.snapshot;
  const immutable = JSON.stringify(payload);
  sqlite.prepare('UPDATE portrait_archives SET payload=? WHERE id=?').run(immutable, saved.id);
  assert.equal((await archive.readArchive(saved.id))!.snapshot?.currentness, 'current');
  fixture.profileRevision = 2;
  assert.equal((await archive.readArchive(saved.id))!.snapshot?.currentness, 'outdated');
  assert.equal(sqlite.prepare('SELECT payload FROM portrait_archives WHERE id=?').get(saved.id)!.payload, immutable);
});


test('D10 explicit archive regeneration preserves originals and plans, versions corrections, and never calls a model', async () => {
  const original = await archive.generateDailyArchive('2027-02-07');
  const before = sqlite.prepare('SELECT payload FROM portrait_archives WHERE id=?').get(original.id)!.payload;
  assert.deepEqual(await archive.regenerateArchive(original.id), { id: original.id, status: 'pending', archiveVersion: 1, created: false });
  fixture.profileRevision = 1;
  const [a, b] = await Promise.all([archive.regenerateArchive(original.id), archive.regenerateArchive(original.id)]);
  assert.equal(a.id, b.id); assert.equal(a.archiveVersion, 2); assert.equal(Number(a.created) + Number(b.created), 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM portrait_archive_versions').get()!.n, 1);
  assert.equal(sqlite.prepare('SELECT payload FROM portrait_archives WHERE id=?').get(original.id)!.payload, before);
  assert.equal((await archive.readArchive(original.id))!.snapshot?.currentness, 'outdated');
  const current = (await archive.readArchive(a.id))!;
  assert.equal(current.snapshot?.currentness, 'current'); assert.equal(current.supersedesId, original.id);
  assert.deepEqual(current.versions!.map(v => v.archiveVersion), [2, 1]);
  assert.equal(current.profile.asOf, '2027-02-07T15:59:59.000Z');
  assert.deepEqual((await archive.listArchives()).items.map(v => v.archiveVersion), [2, 1]);
  assert.deepEqual((await archive.listArchives(a.id)).items.map(v => v.archiveVersion), [1]);
  fixture.profileRevision = 2;
  const third = await archive.regenerateArchive(original.id);
  assert.equal(third.archiveVersion, 3); assert.equal((await archive.readArchive(third.id))!.supersedesId, a.id);
  assert.equal(fixture.modelCalls.length, 0);
  fixture.history = scenario('different-source');
  assert.equal(await archive.readArchive(third.id), null);
  await assert.rejects(() => archive.regenerateArchive(third.id), /当前数据源/);
});
