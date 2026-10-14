import { z } from 'zod';
import { endpoints, errorResponseSchema, errorDefinitions, type EndpointInput, type EndpointName, type EndpointResult, type ApiErrorResponse } from '@zhishan/contracts/operations-v2';

export type ContractFetch = (url: string, init: RequestInit) => Promise<Response>;
export class OperationsClientError extends Error {
  readonly status: number;
  readonly detail: ApiErrorResponse | null;
  constructor(message: string, status: number, detail: ApiErrorResponse | null = null) {
    super(message); this.name = 'OperationsClientError'; this.status = status; this.detail = detail;
  }
}

export function createOperationsClient(fetcher: ContractFetch = (url, init) => fetch(url, init)) {
  return {
    async request<K extends EndpointName>(name: K, input: EndpointInput<K> = {}, signal?: AbortSignal): Promise<EndpointResult<K>> {
      const endpoint = endpoints[name];
      const params = endpoint.params.parse(input.params ?? {}) as Record<string, string>;
      const query = endpoint.query.parse(input.query ?? {}) as Record<string, string | number>;
      const body: unknown = endpoint.body.parse(input.body);
      const path = endpoint.path.replace(/\{([^}]+)\}/g, (_, key: string) => encodeURIComponent(params[key]));
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) if (value !== undefined) search.set(key, String(value));
      const response = await fetcher(path + (search.size ? `?${search}` : ''), {
        method: endpoint.method, cache: 'no-store', credentials: 'same-origin', signal,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        let detail: ApiErrorResponse | null = null;
        try {
          const parsed = errorResponseSchema.safeParse(await response.json());
          if (parsed.success && errorDefinitions[parsed.data.error.code].status === response.status) detail = parsed.data;
        } catch { /* Preserve the HTTP failure even for a proxy's non-JSON body. */ }
        throw new OperationsClientError(detail?.error.message ?? `请求失败（HTTP ${response.status}）`, response.status, detail);
      }
      try {
        const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (contentType !== (endpoint.format === 'csv' ? 'text/csv' : 'application/json')) throw new Error('Unexpected content type');
        const raw: unknown = endpoint.format === 'csv' ? await response.text() : await response.json();
        return endpoint.response.parse(raw) as EndpointResult<K>;
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw new OperationsClientError(error instanceof z.ZodError ? '接口返回数据不符合已约定格式' : '无法读取接口响应', response.status);
      }
    },
  };
}

export interface ResourceState<T> { data: T | null; loading: boolean; stale: boolean; error: string | null; lastSuccessAt: string | null; }
/** A01 read adapter: latest request wins; errors keep, but mark, the last result. */
export function createLatestResource<T>(onChange: (state: ResourceState<T>) => void, now = () => new Date().toISOString()) {
  let state: ResourceState<T> = { data: null, loading: false, stale: false, error: null, lastSuccessAt: null };
  let serial = 0, controller: AbortController | null = null, disposed = false;
  const publish = (next: ResourceState<T>) => { state = next; onChange({ ...state }); };
  return {
    getState: () => ({ ...state }),
    async load(loader: (signal: AbortSignal) => Promise<T>, reset = false) {
      if (disposed) return;
      const current = ++serial;
      controller?.abort(); controller = new AbortController();
      publish({ ...state, ...(reset ? { data: null, lastSuccessAt: null } : {}), loading: true, stale: !reset && state.data !== null, error: null });
      try {
        const data = await loader(controller.signal);
        if (!disposed && current === serial) publish({ data, loading: false, stale: false, error: null, lastSuccessAt: now() });
      } catch (error) {
        if (!disposed && current === serial) publish({ ...state, loading: false, stale: state.data !== null, error: error instanceof Error ? error.message : '请求失败' });
      }
    },
    dispose() { disposed = true; serial++; controller?.abort(); },
  };
}
