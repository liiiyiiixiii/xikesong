import { historyState } from '../preferences/history-state';
import { scenarioContext, scenarioRealtime } from '../preferences/scenario';
import { realtime } from './repository';
import type { Realtime } from './types';
import { realtimeProvenance } from './provenance';

type CurrentRealtime = Realtime & { provenance: ReturnType<typeof realtimeProvenance> };
let pending: { key: string; promise: Promise<CurrentRealtime> } | null = null;
let cached: { key: string; state: CurrentRealtime } | null = null;
let completedAt = 0;

/** Share concurrent kitchen/3D reads; cache only for one polling second. */
export async function currentRealtime(): Promise<CurrentRealtime> {
  const history = await historyState();
  if (history?.phase === 'maintenance') throw new Error('历史数据维护中，请稍后刷新');
  const scenario = await scenarioContext(history);
  // Read source control before using the cache: switching datasets/simulation must not reuse another source.
  const key = JSON.stringify({ scenario, datasetId: history?.datasetId, simulation: history?.simulation, completedAt: history?.completedAt });
  if (pending?.key === key) return pending.promise;
  if (cached?.key === key && Date.now() - completedAt < 1000) return cached.state;
  const promise = (async () => {
    const value = scenario
      ? await scenarioRealtime(scenario)
      : { ...await realtime('live'), simulation: history?.simulation ?? null };
    const state = { ...value, provenance: realtimeProvenance(value, history?.datasetId ?? null) };
    cached = { key, state };
    completedAt = Date.now();
    return state;
  })();
  pending = { key, promise };
  try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
}
