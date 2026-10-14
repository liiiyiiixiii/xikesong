import { z } from 'zod';
import { authenticateOperations, OperationsError, requirePermission, sessionCookieName } from './security.ts';
import { operationsFailure, readRequestJson } from './router.ts';
import type { OperationsStore } from './storage.ts';

const loginSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/) }).strict();

export function createSessionHandler(store: OperationsStore, clock = () => new Date().toISOString()) {
  return async (req: Request): Promise<Response> => {
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    const cookie = (token: string, logout = false) => {
      const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
      return `${sessionCookieName(store.environment)}=${token}; Path=/api/v2; HttpOnly; SameSite=Strict${logout ? '; Max-Age=0' : ''}${secure}`;
    };
    try {
      if (!['GET', 'POST', 'DELETE'].includes(req.method)) throw new OperationsError('METHOD_NOT_ALLOWED');
      if (new URL(req.url).search) throw new OperationsError('INVALID_REQUEST');
      if (req.method !== 'GET' && req.headers.get('origin') !== new URL(req.url).origin) throw new OperationsError('FORBIDDEN');
      if (req.method === 'DELETE') {
        headers.set('Set-Cookie', cookie('', true));
        return Response.json({ authenticated: false }, { headers });
      }
      let request = req, token: string | undefined;
      if (req.method === 'POST') {
        ({ token } = loginSchema.parse(await readRequestJson(req, 4096)));
        const authHeaders = new Headers(req.headers);
        authHeaders.set('authorization', `Bearer ${token}`);
        request = new Request(req.url, { headers: authHeaders });
      }
      const principal = await authenticateOperations(request, store, clock());
      requirePermission(principal, 'staff');
      if (token) headers.set('Set-Cookie', cookie(token));
      return Response.json({ authenticated: true, actor: principal.actor, role: principal.role, environment: principal.environment }, { headers });
    } catch (error) {
      if (req.method === 'GET' && error instanceof OperationsError && error.code === 'UNAUTHENTICATED') return Response.json({ authenticated: false }, { headers });
      return operationsFailure(error);
    }
  };
}
