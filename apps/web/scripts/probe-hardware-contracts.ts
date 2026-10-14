import { pathToFileURL } from 'node:url';
import { errorResponseSchema } from '@zhishan/contracts/v2/errors';
import { normalizeHardwareBase } from './send-hardware-jsonl.ts';

/** No credentials, telemetry, generated identities or write requests. */
export async function probeHardwareContracts(base: string, fetcher: typeof fetch = fetch) {
  const origin = normalizeHardwareBase(base), results = [];
  for (const path of ['/api/v2/serving/state', '/api/v2/devices/diagnostics']) {
    const response = await fetcher(origin + path, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
    const parsed = errorResponseSchema.safeParse(await response.json());
    const code = parsed.success ? parsed.data.error.code : null;
    if (!((response.status === 401 && code === 'UNAUTHENTICATED') || (response.status === 503 && code === 'UNAVAILABLE'))) {
      throw new Error(`只读认证探针不符合预期：${path} HTTP ${response.status}；未证明接入成功`);
    }
    results.push({ path, status: response.status, code, finding: response.status === 401 ? '认证保护存在；未验证设备写入' : '服务尚未配置或暂不可用；不能接入' });
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--base') throw new Error('用法：node --experimental-strip-types scripts/probe-hardware-contracts.ts --base <测试实例源地址>');
    for (const result of await probeHardwareContracts(args[1])) console.log(JSON.stringify(result));
    console.log('仅完成未认证 GET 检查；未发送样本、边界或凭证，未验证真实硬件及业务计量。');
  } catch (error) {
    console.error(error instanceof Error && error.message.startsWith('用法：') ? error.message : '认证探针失败；检查地址、网络及服务配置。未证明接入成功。');
    process.exitCode = 1;
  }
}
