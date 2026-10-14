import { z } from 'zod';
import { endpoints, matchEndpoint, apiError, errorDefinitions, uuid, type EndpointName, type EndpointResult } from '@zhishan/contracts/operations-v2';
import { authenticateOperations, OperationsError, requirePermission, type Principal } from './security.ts';
import { type OperationsStore } from './storage.ts';

export type EndpointContext<K extends EndpointName> = {
  params: z.output<(typeof endpoints)[K]['params']>;
  query: z.output<(typeof endpoints)[K]['query']>;
  body: z.output<(typeof endpoints)[K]['body']>;
  principal: Principal;
  store: OperationsStore;
  now: string;
};
export type OperationsServices = { [K in EndpointName]?: (context: EndpointContext<K>) => Promise<EndpointResult<K>> };

export async function readRequestJson(req: Request, maxBytes: number): Promise<unknown> {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new OperationsError('UNSUPPORTED_MEDIA_TYPE');
  const size = req.headers.get('content-length');
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > maxBytes)) throw new OperationsError('PAYLOAD_TOO_LARGE');
  const reader = req.body?.getReader();
  if (!reader) throw new OperationsError('INVALID_REQUEST');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new OperationsError('PAYLOAD_TOO_LARGE'); }
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof OperationsError) throw error;
    throw new OperationsError('INVALID_REQUEST');
  } finally { reader.releaseLock(); }
}

export function operationsFailure(error: unknown, requestId: string | null = null): Response {
  const code = error instanceof OperationsError ? error.code : error instanceof z.ZodError ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
  const payload = apiError(code, requestId, error instanceof z.ZodError ? {
    issues: error.issues.slice(0, 50).map(issue => ({ path: issue.path.join('.').slice(0, 300), message: issue.message.slice(0, 500) })),
  } : error instanceof OperationsError && error.currentVersion !== undefined ? { currentVersion: error.currentVersion } : {});
  return Response.json(payload, { status: errorDefinitions[code].status, headers: {
    'Cache-Control': 'no-store',
    ...(payload.error.retryAfterSeconds ? { 'Retry-After': String(payload.error.retryAfterSeconds) } : {}),
  } });
}

/** The transport handles identity and wire validation; injected services own
 * durable business transactions. A missing service remains an explicit 501. */
export function createOperationsRouter(store: OperationsStore, services: OperationsServices, clock = () => new Date().toISOString()) {
  return async (req: Request): Promise<Response> => {
    let requestId: string | null = null;
    try {
      const url = new URL(req.url), match = matchEndpoint(url.pathname, req.method);
      if (!match) {
        const exists = ['GET', 'POST', 'PUT'].some(method => matchEndpoint(url.pathname, method));
        throw new OperationsError(exists ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND');
      }
      const principal = await authenticateOperations(req, store, clock());
      requirePermission(principal, match.endpoint.permission);
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin) throw new OperationsError('FORBIDDEN');
      const params = match.endpoint.params.parse(match.params);
      const rawQuery: Record<string, string> = {};
      for (const [key, value] of url.searchParams) {
        if (Object.hasOwn(rawQuery, key)) throw new OperationsError('INVALID_REQUEST');
        rawQuery[key] = value;
      }
      const query = match.endpoint.query.parse(rawQuery);
      let rawBody: unknown;
      if (match.endpoint.method !== 'GET') {
        rawBody = await readRequestJson(req, match.endpoint.maxBytes);
        if (rawBody && typeof rawBody === 'object' && 'requestId' in rawBody && uuid.safeParse(rawBody.requestId).success) requestId = rawBody.requestId as string;
      }
      const body = match.endpoint.body.parse(rawBody);
      const handler = services[match.name];
      if (!handler) throw new OperationsError('NOT_IMPLEMENTED');
      // Each input above has been validated against the same registry entry.
      const context = { params, query, body, principal, store, now: clock() };
      const value = await (handler as (input: typeof context) => Promise<unknown>)(context);
      // A programming error in a service is a 500, never a client's 400.
      const result = match.endpoint.response.safeParse(value);
      if (!result.success) throw new OperationsError('INTERNAL_ERROR');
      return match.endpoint.format === 'csv'
        ? new Response(String(result.data), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="consumption.csv"' } })
        : Response.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return operationsFailure(error, requestId); }
  };
}
