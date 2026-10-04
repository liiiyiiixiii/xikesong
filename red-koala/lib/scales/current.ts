import { historyState } from '../preferences/history-state';
import { scenarioContext, scenarioRealtime } from '../preferences/scenario';
import { realtime } from './repository';
import type { Realtime } from './types';

let pending: Promise<Realtime> | null = null;
let cached: Realtime | null = null;
let completedAt = 0;

/** Share concurrent kitchen/3D reads; cache only for one polling second. */
export async function currentRealtime(): Promise<Realtime> {
  if (pending) return pending;
  if (cached && Date.now() - completedAt < 1000) return cached;
  pending = (async () => {
    const state = await scenarioContext()
      ? await scenarioRealtime()
      : { ...await realtime('live'), simulation: (await historyState())?.simulation ?? null };
    cached = state;
    completedAt = Date.now();
    return state;
  })();
  try { return await pending; } finally { pending = null; }
}
