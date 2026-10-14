import type { Realtime } from './types.ts';

/** `live` is a storage namespace; it does not attest that a physical device produced a sample. */
export function realtimeProvenance(state: Pick<Realtime, 'scenario' | 'simulation'>, datasetId: string | null = null) {
  const replay = !!state.scenario;
  const simulated = !!state.simulation?.enabled;
  return {
    kind: replay ? 'dataset-replay' as const : simulated ? 'simulation' as const : 'unverified' as const,
    namespace: 'live' as const,
    provider: replay ? 'dataset-replay' : simulated ? state.simulation!.provider : null,
    datasetId: state.scenario?.datasetId ?? datasetId,
    hardwareVerified: false as const,
  };
}

export function restaurantState(state: Realtime & { provenance?: ReturnType<typeof realtimeProvenance> }, generatedAt: string) {
  const provenance = state.provenance ?? realtimeProvenance(state);
  return {
    schemaVersion: 2,
    revision: Date.parse(generatedAt),
    generatedAt,
    observedAt: state.at,
    source: provenance.kind === 'unverified' ? 'live' : provenance.kind,
    datasetId: provenance.datasetId,
    provenance,
    simulation: state.simulation ?? null,
    scenario: state.scenario ?? null,
    // The scale ledger has no observation of customer occupancy or customer actions.
    customers: null,
    plates: state.dishes.flatMap(dish => dish.scales.filter(scale => scale.enabled).map(scale => ({
      slotId: scale.position, scaleId: scale.id, dishId: dish.id, dishName: dish.name,
      remainingG: scale.netG, fullG: scale.fullG, status: scale.status, observedAt: scale.lastAt,
    }))).sort((a, b) => (a.slotId ?? Infinity) - (b.slotId ?? Infinity)),
  };
}
