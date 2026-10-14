import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { checkOrigin, failure } from '@/lib/http';
import { dateSchema } from '@/lib/preferences/contract';
import { readDataset } from '@/lib/preferences/repository';
import { createTools } from '@/lib/analysis/tools';
import { runAgent } from '@/lib/analysis/agent';
import { createCompletion } from '@/lib/analysis/provider';
import { resolveModelConfig } from '@/lib/analysis/credentials';
import { analysisDataContext } from '@/lib/analysis/source-context';
import { availableDateRange, reportDateRange, type DateRange } from '@/lib/analysis/date-scope';

const requestSchema = z.object({ startDate: dateSchema.optional(), endDate: dateSchema.optional() }).strict();
async function context(requested: Partial<DateRange>) {
  if (!env.DB) throw new Error('数据库未连接');
  const source = await analysisDataContext();
  const data = await readDataset('live');
  const availableRange = availableDateRange(data, source.asOf);
  const range = availableRange ? reportDateRange(requested, availableRange) : null;
  if (!range && (requested.startDate || requested.endDate)) throw new Error('暂无可供分析的日记录');
  // Cache only within this source, date range, and set of completed business records.
  const evidence = range ? { catalog: data.catalog, days: data.days.filter(day => day.date >= range.startDate && day.date <= range.endDate && Date.parse(day.finalAt) <= Date.parse(source.asOf)), stores: data.stores.filter(day => day.date >= range.startDate && day.date <= range.endDate) } : null;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(evidence)));
  const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  const id = `range-report-v2:${source.source}:${range?.startDate}:${range?.endDate}:${digest}`;
  await env.DB.exec('CREATE TABLE IF NOT EXISTS intelligence_reports(id TEXT PRIMARY KEY,payload TEXT,lease_until TEXT NOT NULL);');
  return { db: env.DB, id, range, metadata: { ...source, availableRange, startDate: range?.startDate ?? null, endDate: range?.endDate ?? null } };
}
function queryRange(req: Request) {
  const params = new URL(req.url).searchParams;
  return { startDate: params.get('startDate') ?? undefined, endDate: params.get('endDate') ?? undefined };
}
export async function GET(req: Request) {
  try {
    const { db, id, range, metadata } = await context(requestSchema.parse(queryRange(req)));
    const row = range ? await db.prepare('SELECT payload FROM intelligence_reports WHERE id=?').bind(id).first<{ payload: string | null }>() : null;
    return Response.json({ ...(row?.payload ? JSON.parse(row.payload) : { result: null }), ...metadata, ...(!range ? { reason: '暂无可供分析的日记录' } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error, 400); }
}
export async function POST(req: Request) {
  let release: (() => Promise<unknown>) | undefined;
  let scopeValidated = false;
  try {
    checkOrigin(req);
    const text = await req.text();
    if (text.length > 1000) throw new Error('请求过大');
    const fromBody = text.trim() ? requestSchema.parse(JSON.parse(text)) : {};
    const requested = requestSchema.parse({ ...queryRange(req), ...fromBody });
    const { db, id, range, metadata } = await context(requested);
    scopeValidated = true;
    if (!range) return Response.json({ result: null, ...metadata, error: '暂无可供分析的日记录' }, { status: 400 });
    const existing = await db.prepare('SELECT payload FROM intelligence_reports WHERE id=?').bind(id).first<{ payload: string | null }>();
    if (existing?.payload) return Response.json({ ...JSON.parse(existing.payload), ...metadata });
    const now = new Date().toISOString(), lease = new Date(Date.now() + 120000).toISOString();
    await db.prepare('INSERT OR IGNORE INTO intelligence_reports(id,lease_until) VALUES(?,?)').bind(id, '').run();
    const claimed = await db.prepare('UPDATE intelligence_reports SET lease_until=? WHERE id=? AND payload IS NULL AND lease_until<=?').bind(lease, id, now).run();
    if (!claimed.meta.changes) return Response.json({ error: '解读正在生成，请稍后查看', ...metadata }, { status: 409 });
    release = () => db.prepare('UPDATE intelligence_reports SET lease_until=? WHERE id=? AND lease_until=?').bind('', id, lease).run();
    const config = await resolveModelConfig();
    if (!config.apiKey) throw new Error('请先连接模型');
    const input = { ...range, question: `仅根据北京时间${range.startDate}至${range.endDate}已观测的具体菜品取用数据，推测一个大概的门店群体取用画像。不要逐日长篇分析，不要枚举所有菜品；用不超过350字总结取用构成、时段倾向、稳定或变化特征及限制。没有顾客个体记录，不推断年龄、身份、人数比例或喜爱分数。数据不足明确说明；不能把范围以外的日期当成本期依据。先查询 daily_statistics 和适用的 period_statistics，不能以整周数据替代本期。` };
    const execute = createTools(input, metadata.asOf);
    const result = await runAgent(input, config.model, createCompletion(config), async (name, args) => {
      if (!['daily_statistics', 'period_statistics'].includes(name)) throw new Error('本次仅允许所选日期的日统计和时段统计');
      const evidence = await execute(name, args);
      return { ...evidence, data: { provenance: metadata.provenance, scenario: metadata.scenario, note: metadata.provenance.kind === 'unverified' ? 'live为业务命名空间，不证明数据来自真实硬件。' : '模拟或回放数据，并非实际经营记录。', observations: evidence.data } };
    }, AbortSignal.any([req.signal, AbortSignal.timeout(90000)]), metadata.asOf);
    const payload = { result, ...metadata };
    await db.prepare('UPDATE intelligence_reports SET payload=? WHERE id=? AND lease_until=?').bind(JSON.stringify(payload), id, lease).run();
    return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error, scopeValidated ? 502 : 400); } finally { await release?.(); }
}
