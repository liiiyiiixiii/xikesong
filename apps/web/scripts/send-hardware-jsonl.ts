import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { limits } from '@zhishan/contracts/v2/common';
import { errorDefinitions, errorResponseSchema } from '@zhishan/contracts/v2/errors';
import { samplesRequestSchema, eventsRequestSchema, samplesResponseSchema, eventsResponseSchema, type SamplesRequest, type EventsRequest } from '@zhishan/contracts/v2/telemetry';

export type HardwareBatch = { line: number; kind: 'samples'; payload: SamplesRequest; body: string } | { line: number; kind: 'events'; payload: EventsRequest; body: string };
export type HardwareSendOptions = { base: string; token: string; maxAttempts: number; timeoutMs: number };
type Report = Record<string, unknown>;
type Transport = { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; report?: (value: Report) => void };
const tokenPattern = /^[A-Za-z0-9_-]{32,256}$/;
class HardwareInputError extends Error {}

export function normalizeHardwareBase(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new HardwareInputError('base 必须是明确的实例源地址'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new HardwareInputError('base 只接受 HTTPS 源地址或本机 HTTP 源地址，不允许凭证、路径、查询及片段');
  }
  return url.origin;
}

/** Validate the entire file before sending anything. No generated truth or IDs. */
export function parseHardwareJsonl(input: string): HardwareBatch[] {
  const batches: HardwareBatch[] = [], seen = new Map<string, string>();
  for (const [offset, source] of input.split(/\r?\n/).entries()) {
    if (!source.trim()) continue;
    const line = offset + 1;
    let raw: unknown;
    try { raw = JSON.parse(source); } catch { throw new HardwareInputError(`第 ${line} 行不是合法 JSON`); }
    const sample = samplesRequestSchema.safeParse(raw), event = eventsRequestSchema.safeParse(raw);
    if (!sample.success && !event.success) throw new HardwareInputError(`第 ${line} 行不符合 v2 原始样本或事件 envelope；禁止业务 truth 和未知字段`);
    const kind = sample.success ? 'samples' : 'events';
    const payload = sample.success ? sample.data : event.success ? event.data : undefined;
    if (!payload) throw new HardwareInputError(`第 ${line} 行无有效报文`);
    const body = JSON.stringify(payload), maxBytes = kind === 'samples' ? limits.sampleBytes : limits.eventBytes;
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new HardwareInputError(`第 ${line} 行超过协议请求体上限`);
    // The backend's receipt identity is credential + request ID across endpoints.
    const key = payload.batchId;
    if (seen.has(key) && seen.get(key) !== body) throw new HardwareInputError(`第 ${line} 行复用了不同内容的批次编号`);
    seen.set(key, body);
    batches.push({ line, kind, payload, body } as HardwareBatch);
  }
  if (!batches.length) throw new HardwareInputError('输入文件没有报文');
  return batches;
}

function validateOptions(options: HardwareSendOptions) {
  const base = normalizeHardwareBase(options.base);
  if (!tokenPattern.test(options.token)) throw new HardwareInputError('设备凭证格式无效');
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 5) throw new HardwareInputError('max-attempts 必须为 1 至 5');
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 60_000) throw new HardwareInputError('timeout-ms 必须为 100 至 60000');
  return base;
}

/** Bounded sequential delivery; every retry reuses the exact body and batchId. */
export async function sendHardwareBatches(batches: HardwareBatch[], options: HardwareSendOptions, transport: Transport = {}): Promise<boolean> {
  const base = validateOptions(options), fetcher = transport.fetcher ?? fetch;
  const sleep = transport.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))), report = transport.report ?? (() => {});
  const validated = parseHardwareJsonl(batches.map(batch => batch.body).join('\n'));
  if (validated.length !== batches.length || validated.some((batch, i) => batch.kind !== batches[i].kind || batch.payload.batchId !== batches[i].payload.batchId)) throw new HardwareInputError('批次元数据与报文不一致');
  let allAccepted = true;
  for (const [index, checked] of validated.entries()) {
    const batch = { ...checked, line: batches[index].line };
    let delivered = false;
    const context = { line: batch.line, kind: batch.kind, batchId: batch.payload.batchId };
    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await fetcher(`${base}/api/v2/telemetry/${batch.kind}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token}` }, body: batch.body, signal: AbortSignal.timeout(options.timeoutMs) });
      } catch {
        report({ ...context, attempt, outcome: 'transport_unknown', retrying: attempt < options.maxAttempts });
        if (attempt < options.maxAttempts) { await sleep(1000 * 2 ** (attempt - 1)); continue; }
        break;
      }
      let raw: unknown;
      try { raw = await response.json(); } catch (error) {
        const interrupted = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError' || error instanceof TypeError);
        const retrying = interrupted && attempt < options.maxAttempts;
        report({ ...context, attempt, httpStatus: response.status, outcome: interrupted ? 'transport_unknown' : 'invalid_response', retrying });
        if (retrying) { await sleep(1000 * 2 ** (attempt - 1)); continue; }
        break;
      }
      if (response.status !== 200) {
        const error = errorResponseSchema.safeParse(raw);
        const valid = error.success && errorDefinitions[error.data.error.code].status === response.status;
        const retryable = valid && [429, 503].includes(response.status) && error.data.error.retryable;
        const header = response.headers.get('retry-after');
        const headerDelay = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - Date.now() : 0;
        const delay = Math.max(valid ? (error.data.error.retryAfterSeconds ?? 1) * 1000 : 0, Number.isFinite(headerDelay) ? headerDelay : Infinity);
        const retrying = retryable && attempt < options.maxAttempts && delay <= 60_000;
        report({ ...context, attempt, httpStatus: response.status, outcome: 'http_error', code: valid ? error.data.error.code : 'UNKNOWN_RESPONSE', retrying });
        if (retrying) { await sleep(delay); continue; }
        return false;
      }
      const parsed = batch.kind === 'samples' ? samplesResponseSchema.safeParse(raw) : eventsResponseSchema.safeParse(raw);
      if (!parsed.success || parsed.data.batchId !== batch.payload.batchId || parsed.data.results.length !== (batch.kind === 'samples' ? batch.payload.samples.length : batch.payload.events.length)) {
        report({ ...context, attempt, outcome: 'invalid_receipts', retrying: false });
        return false;
      }
      for (const receipt of parsed.data.results) {
        const matches = batch.kind === 'samples' && 'scaleId' in receipt
          ? (() => { const sample = batch.payload.samples[receipt.index]; return sample.scaleId === receipt.scaleId && sample.bootId === receipt.bootId && sample.sequence === receipt.sequence; })()
          : batch.kind === 'events' && 'eventId' in receipt && batch.payload.events[receipt.index].eventId === receipt.eventId;
        if (!matches) { report({ ...context, attempt, outcome: 'receipt_identity_mismatch', retrying: false }); return false; }
      }
      for (const receipt of parsed.data.results) report({ ...context, attempt, outcome: 'receipt', ...receipt });
      const retrying = parsed.data.results.some(receipt => receipt.retryable);
      if (retrying && attempt < options.maxAttempts) { await sleep(1000 * 2 ** (attempt - 1)); continue; }
      delivered = parsed.data.results.every(receipt => receipt.status === 'accepted' || receipt.status === 'duplicate');
      break;
    }
    allAccepted &&= delivered;
    if (!delivered) {
      report({ ...context, outcome: 'incomplete', message: '该批存在拒绝、忽略或结果未知；保留原文件与编号排查，不表示业务计量已确认' });
      return false;
    }
  }
  return allAccepted;
}

export function parseHardwareArgs(args: string[]) {
  const options = new Map<string, string>();
  let validateOnly = false;
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--validate-only') { if (validateOnly) throw new HardwareInputError('validate-only 不可重复'); validateOnly = true; continue; }
    if (!['--base', '--input', '--token-env', '--token-file', '--max-attempts', '--timeout-ms'].includes(name) || options.has(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new HardwareInputError('参数无效或重复；请使用 --help');
    options.set(name, args[++i]);
  }
  const input = options.get('--input');
  if (!input) throw new HardwareInputError('必须显式提供 --input');
  const base = options.get('--base'), tokenEnv = options.get('--token-env'), tokenFile = options.get('--token-file');
  if (tokenEnv && tokenFile) throw new HardwareInputError('凭证来源只能选择 token-env 或 token-file');
  if (tokenEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv)) throw new HardwareInputError('token-env 必须是环境变量名称');
  if (!validateOnly && (!base || (!tokenEnv && !tokenFile))) throw new HardwareInputError('发送必须显式提供 --base、--token-env 或 --token-file，以及 --input；不会读取默认凭证');
  return { input, base, tokenEnv, tokenFile, validateOnly, maxAttempts: Number(options.get('--max-attempts') ?? 3), timeoutMs: Number(options.get('--timeout-ms') ?? 10000) };
}

export async function hardwareCli(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    console.log('校验：--validate-only --input <raw.jsonl>\n发送：--base <https://实例> (--token-env <变量名> | --token-file <私有凭证文件>) --input <raw.jsonl> [--max-attempts 1..5] [--timeout-ms 100..60000]\n每行一个 v2 samples 或 events envelope；固定原始时间、ID 和内容。无默认地址/凭证，不接收 truth。');
    return 0;
  }
  try {
    const options = parseHardwareArgs(args), data = await readFile(options.input);
    const batches = parseHardwareJsonl(new TextDecoder('utf-8', { fatal: true }).decode(data));
    if (options.validateOnly) { console.log(JSON.stringify({ outcome: 'validated_only', batches: batches.length, sent: false })); return 0; }
    const token = options.tokenEnv ? process.env[options.tokenEnv] ?? '' : (await readFile(options.tokenFile!, 'utf8')).trim();
    const ok = await sendHardwareBatches(batches, { base: options.base!, token, maxAttempts: options.maxAttempts, timeoutMs: options.timeoutMs }, { report: value => console.log(JSON.stringify(value)) });
    console.log(JSON.stringify({ outcome: 'finished', allItemsStoredOrDuplicate: ok, hardwareVerified: false, message: '回执只说明协议接收结果，不确认真实硬件或业务计量精度' }));
    return ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof HardwareInputError ? error.message : '发送前校验或执行失败；检查参数、JSONL 格式与私有凭证文件。保留原始编号，不换号重试。使用 --help 查看格式。');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await hardwareCli(process.argv.slice(2));
