import { historyState } from '../preferences/history-state';
import { scenarioContext } from '../preferences/scenario';
import { realtimeProvenance } from '../scales/provenance';

/** Keep report cache namespaces and evidence provenance tied to the same control snapshot. */
export async function analysisDataContext() {
  const state = await historyState();
  if (state?.phase === 'maintenance') throw new Error('数据维护中');
  const scenario = await scenarioContext(state);
  const simulation = scenario ? { enabled: true, provider: 'dataset-replay' } : state?.simulation ?? null;
  const source = scenario ? `scenario:${scenario.datasetId}` : simulation?.enabled ? `simulation:${simulation.provider}:${state?.datasetId ?? 'live'}` : state ? `live:${state.datasetId}` : 'live';
  return {
    source, scenario, simulation,
    asOf: scenario?.asOf ?? new Date().toISOString(),
    provenance: realtimeProvenance({ scenario: scenario ?? undefined, simulation }, state?.datasetId ?? null),
  };
}
