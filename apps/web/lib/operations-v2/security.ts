import { z } from 'zod';
import { environment, id, timestamp } from '@zhishan/contracts/v2/common';
import { actorSchema } from '@zhishan/contracts/v2/operations';
import { type ErrorCode } from '@zhishan/contracts/v2/errors';
import { OperationsStore, type OperationsEnvironment } from './storage.ts';

export class OperationsError extends Error {
  readonly code: ErrorCode;
  readonly currentVersion?: number;
  constructor(code: ErrorCode, currentVersion?: number) {
    super(code);
    this.name = 'OperationsError';
    this.code = code;
    this.currentVersion = currentVersion;
  }
}

const credentialPayload = z.object({
  actor: actorSchema,
  scaleIds: z.array(id).max(1000).nullable(),
  trackIds: z.array(id).max(20).default([]),
}).strict();

export type Principal = Omit<z.infer<typeof credentialPayload>, 'trackIds'> & { trackIds?: string[];
  credentialId: string;
  environment: OperationsEnvironment;
  role: 'device' | 'staff' | 'manager';
};

export type CredentialRow = {
  id: string; token_hash: string; role: Principal['role']; disabled: number;
  expires_at: string | null; payload: string;
};

export function sessionCookieName(value: OperationsEnvironment) {
  return `ops_v2_session_${environment.parse(value)}`;
}

function requestToken(req: Request, scope: OperationsEnvironment) {
  const authorization = req.headers.get('authorization');
  if (authorization !== null) {
    if (!/^Bearer [A-Za-z0-9_-]{32,256}$/.test(authorization)) throw new OperationsError('UNAUTHENTICATED');
    return authorization.slice(7);
  }
  const name = sessionCookieName(scope);
  const values = (req.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (values.length !== 1) throw new OperationsError('UNAUTHENTICATED');
  const token = values[0].slice(name.length + 1);
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new OperationsError('UNAUTHENTICATED');
  // SameSite cookies are defense in depth. Require same-origin writes even if
  // the browser or reverse proxy sends a cookie on a cross-origin request.
  if (!['GET', 'HEAD'].includes(req.method) && req.headers.get('origin') !== new URL(req.url).origin) throw new OperationsError('FORBIDDEN');
  return token;
}

export async function tokenHash(token: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

/** Server configuration is mandatory: never silently route a test instance to live. */
export function configuredEnvironment(value: unknown): OperationsEnvironment {
  const parsed = environment.safeParse(value);
  if (!parsed.success) throw new OperationsError('UNAVAILABLE');
  return parsed.data;
}

/** Credentials are scoped by the configured instance, not a caller-supplied header.
 * Device access must be explicitly scoped to devices; a manager credential cannot
 * impersonate a device and turn fabricated readings into hardware observations. */
export async function authenticateOperations(req: Request, store: OperationsStore, now = new Date().toISOString()): Promise<Principal> {
  timestamp.parse(now);
  const hash = await tokenHash(requestToken(req, store.environment));
  const rows = await store.list<CredentialRow>('credentials', { token_hash: hash });
  const row = rows[0];
  if (!row || row.disabled || row.expires_at !== null && (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.parse(now))) {
    throw new OperationsError('UNAUTHENTICATED');
  }
  let payload: z.infer<typeof credentialPayload>;
  try { payload = credentialPayload.parse(JSON.parse(row.payload)); }
  catch { throw new OperationsError('UNAUTHENTICATED'); }
  if (!['device', 'staff', 'manager'].includes(row.role) || row.role === 'device' && (!(payload.scaleIds?.length || payload.trackIds.length) || payload.actor.kind !== 'system')) {
    throw new OperationsError('UNAUTHENTICATED');
  }
  return { ...payload, credentialId: row.id, environment: store.environment, role: row.role };
}

export function requirePermission(principal: Principal, permission: Principal['role']) {
  const allowed = permission === 'device' ? principal.role === 'device'
    : permission === 'manager' ? principal.role === 'manager'
    : principal.role === 'staff' || principal.role === 'manager';
  if (!allowed) throw new OperationsError('FORBIDDEN');
}

export function requireDeviceScope(principal: Principal, scaleIds: string[]) {
  requirePermission(principal, 'device');
  if (!principal.scaleIds || scaleIds.some(scaleId => !principal.scaleIds!.includes(scaleId))) throw new OperationsError('FORBIDDEN');
}

// Offline provisioning and the future manager service share this validator.
// The raw token is returned only to the provisioning caller, never stored in D1.
export async function credentialRecord(input: {
  id: string; token: string; role: Principal['role']; actor: Principal['actor'];
  scaleIds: string[] | null; trackIds?: string[]; expiresAt?: string | null;
}): Promise<CredentialRow> {
  id.parse(input.id);
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(input.token)) throw new Error('Credential must contain 32–256 URL-safe characters');
  const payload = credentialPayload.parse({ actor: input.actor, scaleIds: input.scaleIds, trackIds: input.trackIds });
  z.enum(['device', 'staff', 'manager']).parse(input.role);
  if (input.role === 'device' && (!(payload.scaleIds?.length || payload.trackIds.length) || payload.actor.kind !== 'system')) throw new Error('Device credentials require explicit device scope and a system actor');
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt !== null) timestamp.parse(expiresAt);
  return { id: input.id, token_hash: await tokenHash(input.token), role: input.role, disabled: 0, expires_at: expiresAt, payload: JSON.stringify(payload) };
}
