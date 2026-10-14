import { operationsRoute, operationsRuntime } from '../lib/operations-v2/runtime.ts';
export default {
  fetch(request: Request) {
    if (!new URL(request.url).pathname.startsWith('/api/v2/')) return new Response('Not found', { status: 404 });
    return operationsRoute(request);
  },
  async scheduled(_event: ScheduledController, _env: Cloudflare.Env, context: ExecutionContext) {
    const application = operationsRuntime();
    if (application) context.waitUntil(application.then(runtime => runtime.jobs()));
  },
};
