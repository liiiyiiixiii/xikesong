import test from 'node:test';
import assert from 'node:assert/strict';
import { realtimeProvenance, restaurantState } from '../lib/scales/provenance.ts';
import { availableDateRange, reportDateRange, archiveSnapshotAt } from '../lib/analysis/date-scope.ts';
import type { Realtime } from '../lib/scales/types.ts';
import type { Dataset, DishDay } from '../lib/preferences/types.ts';

test('the 3D bridge preserves replay/simulator identity and never attests hardware from live alone', () => {
  const state: Realtime = { source: 'live', at: '2026-10-05T11:00:00Z', dishes: [], pending: [] };
  const live = restaurantState(state, '2026-10-12T00:00:00Z');
  assert.equal(live.source, 'live');
  assert.equal(live.provenance.kind, 'unverified');
  assert.equal(live.provenance.hardwareVerified, false);
  assert.equal(live.customers, null);
  const simulator = restaurantState({ ...state, simulation: { enabled: true, provider: 'sample-provider' } }, live.generatedAt);
  assert.equal(simulator.source, 'simulation');
  assert.equal(simulator.simulation?.provider, 'sample-provider');
  const scenario = { datasetId: 'frozen-a', start: '2026-09-01', end: '2026-10-05', asOf: '2026-10-05T23:59:59+08:00' };
  const replay = restaurantState({ ...state, scenario, simulation: { enabled: true, provider: 'dataset-replay' } }, live.generatedAt);
  assert.equal(replay.source, 'dataset-replay');
  assert.deepEqual(replay.scenario, scenario);
  assert.equal(replay.datasetId, scenario.datasetId);
  assert.equal(realtimeProvenance({ simulation: { enabled: false, provider: 'sample-provider' } }).kind, 'unverified');
});

test('the 3D bridge leaves missing weights and observation timestamps intact', () => {
  const state: Realtime = { source: 'live', at: '2026-10-05T11:00:00Z', pending: [], dishes: [{ id: 'dish', name: '菜', remainingG: null, fullG: 1000, percent: null, rateGPerMinute: null, coverage: 0, status: 'offline', overfull: false, trend: [], scales: [{ id: 'scale', dishId: 'dish', dishName: '菜', tareG: 100, fullG: 1000, noiseG: 3, enabled: true, position: 8, updatedAt: '', status: 'offline', netG: null, percent: null, lastAt: '2026-10-01T00:00:00Z' }] }] };
  const result = restaurantState(state, '2026-10-12T00:00:00Z');
  assert.equal(result.plates[0].remainingG, null);
  assert.equal(result.plates[0].status, 'offline');
  assert.equal(result.plates[0].observedAt, '2026-10-01T00:00:00Z');
});

test('report boundaries use completed observations in Beijing time and allow arbitrary valid dates', () => {
  const data: Dataset = { catalog: [], stores: [], days: [
    { date: '2027-02-01', finalAt: '2027-02-01T23:00:00+08:00' },
    { date: '2027-02-10', finalAt: '2027-02-10T23:00:00+08:00' },
    { date: '2027-02-11', finalAt: '2027-02-11T23:00:00+08:00' },
  ] as DishDay[] };
  const available = availableDateRange(data, '2027-02-10T15:30:00Z')!;
  assert.deepEqual(available, { startDate: '2027-02-01', endDate: '2027-02-10' });
  assert.deepEqual(reportDateRange({}, available), { startDate: '2027-02-04', endDate: '2027-02-10' });
  assert.deepEqual(reportDateRange({ startDate: '2027-02-01', endDate: '2027-02-02' }, available), { startDate: '2027-02-01', endDate: '2027-02-02' });
  assert.throws(() => reportDateRange({ startDate: '2027-02-01' }, available), /同时/);
  assert.throws(() => reportDateRange({ startDate: '2027-02-01', endDate: '2027-02-10' }, available), /最多/);
  assert.throws(() => reportDateRange({ startDate: '2027-02-10', endDate: '2027-02-11' }, available), /超出/);
  assert.throws(() => archiveSnapshotAt('2027-02-30', '2027-03-01T00:00:00Z', available));
  assert.equal(availableDateRange({ catalog: [], stores: [], days: [] }, '2027-02-10T00:00:00Z'), null);
});

test('a backfilled archive uses that day’s cutoff, never the current day’s model', () => {
  const available = { startDate: '2026-10-01', endDate: '2026-10-05' };
  assert.equal(archiveSnapshotAt('2026-10-04', '2026-10-05T12:00:00+08:00', available), '2026-10-04T15:59:59.000Z');
  assert.equal(archiveSnapshotAt('2026-10-05', '2026-10-05T12:00:00+08:00', available), '2026-10-05T04:00:00.000Z');
  assert.throws(() => archiveSnapshotAt('2026-10-06', '2026-10-12T00:00:00Z', available), /尚无/);
});
