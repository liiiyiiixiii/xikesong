import { env, waitUntil } from 'cloudflare:workers';
import { createOperationsApplication, operationsUnavailable } from './application.ts';
let application: ReturnType<typeof createOperationsApplication> | undefined;
export function operationsRuntime() {
  if (!env.OPS_DB || !env.OPS_V2_ENVIRONMENT) return null;
  application ??= createOperationsApplication(env.OPS_DB, { environment: env.OPS_V2_ENVIRONMENT, bootstrapToken: env.OPS_V2_BOOTSTRAP_TOKEN }).catch(error => { application = undefined; throw error; });
  return application;
}
export async function operationsRoute(request: Request) {
  const runtime = operationsRuntime(); if (!runtime) return operationsUnavailable();
  try { return await (await runtime).fetch(request, waitUntil); } catch { return operationsUnavailable(); }
}
