import { z } from 'zod';
import { apiError, errorDefinitions, matchEndpoint, uuid, type ErrorCode } from '@zhishan/contracts/operations-v2';

function response(code: ErrorCode, requestId: string | null = null, issues?: z.ZodIssue[]) {
  const payload = apiError(code, requestId, issues ? { issues: issues.slice(0, 50).map(i => ({ path: i.path.join('.').slice(0, 300), message: i.message.slice(0, 500) })) } : {});
  return Response.json(payload, { status: errorDefinitions[code].status, headers: { 'Cache-Control': 'no-store', 'X-Operations-Stage': 'M0-contract-only', ...(payload.error.retryAfterSeconds ? { 'Retry-After': String(payload.error.retryAfterSeconds) } : {}) } });
}

async function boundedText(req: Request, maxBytes: number) {
  if (Number(req.headers.get('content-length')) > maxBytes) throw new RangeError('body');
  const reader = req.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, result = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new RangeError('body'); }
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally { reader.releaseLock(); }
}

/** M0 deliberately has no database or auth imports and never acknowledges persistence.
 * M1 must install authentication before connecting any read/write service here.
 */
export async function contractRoute(req: Request): Promise<Response> {
  const url = new URL(req.url), match = matchEndpoint(url.pathname, req.method);
  if (!match) {
    const exists = ['GET', 'POST', 'PUT'].some(method => matchEndpoint(url.pathname, method));
    return response(exists ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND');
  }
  let requestId: string | null = null;
  try {
    match.endpoint.params.parse(match.params);
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      if (Object.hasOwn(query, key)) return response('INVALID_REQUEST');
      query[key] = value;
    }
    match.endpoint.query.parse(query);
    if (match.endpoint.method !== 'GET') {
      if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return response('UNSUPPORTED_MEDIA_TYPE');
      const raw: unknown = JSON.parse(await boundedText(req, match.endpoint.maxBytes));
      if (raw && typeof raw === 'object' && 'requestId' in raw && uuid.safeParse(raw.requestId).success) requestId = raw.requestId as string;
      match.endpoint.body.parse(raw);
    }
    return response('NOT_IMPLEMENTED', requestId);
  } catch (error) {
    if (error instanceof z.ZodError) return response('INVALID_REQUEST', requestId, error.issues);
    if (error instanceof RangeError) return response('PAYLOAD_TOO_LARGE', requestId);
    if (error instanceof SyntaxError || error instanceof TypeError) return response('INVALID_REQUEST', requestId);
    return response('INTERNAL_ERROR', requestId);
  }
}
