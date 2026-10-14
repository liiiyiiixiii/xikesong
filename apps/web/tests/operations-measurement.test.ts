import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectBindingMeasurement, gramsToMg, mgToGrams, type MeasurementInput, type MeasurementSample, type MeasurementEvent, type MeasurementOperation } from '../lib/operations-v2/measurement.ts';
import { cycleSchema, type OperationRequest } from '@zhishan/contracts/v2/operations';

const epoch = Date.parse('2026-10-12T04:00:00Z');
const time = (seconds: number) => new Date(epoch + seconds * 1000).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(Math.round(n * 1000)).padStart(12, '0')}`;
function sample(seconds: number, netG: number, sequence = seconds + 1, bootId = 'boot-1'): MeasurementSample {
  return { id: `sample:${bootId}:${sequence}`, receivedAt: time(seconds), sample: { scaleId: 'scale-1', bootId, sequence, sampledAt: time(seconds), measurementStatus: 'ok', grossG: netG + 100 } };
}
function boundary(seconds: number, type: 'exit_kitchen' | 'enter_kitchen', s?: MeasurementSample, id = seconds + 1): MeasurementEvent {
  return { receivedAt: time(seconds), origin: 'device', event: { eventId: uuid(id), scaleId: 'scale-1', bootId: s?.sample.bootId ?? 'boot-1', eventSequence: id, occurredAt: time(seconds), type, ...(s ? { sampleRef: { bootId: s.sample.bootId, sequence: s.sample.sequence } } : {}) } };
}
function deviceEvent(seconds: number, type: 'device_fault' | 'device_recovered', bootId = 'boot-1'): MeasurementEvent {
  return { receivedAt: time(seconds), origin: 'device', event: { eventId: uuid(1000 + seconds), scaleId: 'scale-1', bootId, eventSequence: seconds, occurredAt: time(seconds), type, reasonCode: 'sensor_fault' } };
}
function operation(seconds: number, type: OperationRequest['type'], weightG: number | null): MeasurementOperation {
  const removal = ['partial_remove', 'remove_container', 'replace_container'].includes(type) ? { disposition: 'waste', reason: 'other', expectedBindingVersion: 1, freshnessBatchId: null } : {};
  const replacement = type === 'replace_container' ? { newBinding: { dishId: 'dish-2', containerRef: null, tareG: 100, fullFoodG: 1000 }, newBatch: null } : {};
  return { id: `operation:${seconds}`, version: 1, recordedAt: time(seconds), status: weightG === null ? 'pending_review' : 'matched', input: { requestId: uuid(2000 + seconds), bindingId: 'binding-1', occurredAt: time(seconds), type, quantityStatus: weightG === null ? 'unknown' : 'measured', weightG, evidenceIds: weightG === null ? [] : [`operation-evidence:${seconds}`], note: 'explicit measurement fixture', ...removal, ...replacement } as OperationRequest };
}
function input(): MeasurementInput {
  const samples = [sample(0, 800), sample(5, 750), sample(10, 700), sample(15, 650), sample(20, 600)];
  return { binding: { id: 'binding-1', scaleId: 'scale-1', dishId: 'dish-1', validFrom: time(-10), validTo: null, tareG: 100, fullFoodG: 1000, foodOnly: true }, samples,
    events: [boundary(0, 'exit_kitchen', samples[0]), boundary(20, 'enter_kitchen', samples[4])], operations: [], asOf: time(20), version: 1,
    config: { boundaryWindowMs: 1000, maxSampleGapMs: 6000, freshMs: 6000, locationFreshMs: 10000, stableWindowMs: 10000, stableMinSamples: 3, stableToleranceG: 1, negativeToleranceG: 1, maxStepG: 200, timeZone: 'Asia/Shanghai', ruleVersion: 'test-explicit-rules-1' } };
}
const project = (i = input()) => projectBindingMeasurement(i);
function pending(i: MeasurementInput, reason?: string) {
  const p = project(i); assert.ok(p.cycles.length > 0); assert.ok(p.cycles.every(c => c.status === 'pending' && c.confirmedTakeG === null));
  if (reason) assert.ok(p.cycles.some(c => c.qualityReasons.includes(reason as never)), reason);
  return p;
}

test('T01 complete continuous 800 to 600 cycle confirms exactly 200 once, without mutating input', () => {
  const i = input(), before = structuredClone(i), p = project(i);
  assert.equal(p.cycles.length, 1); assert.equal(p.cycles[0].confirmedTakeG, 200); assert.equal(p.cycles[0].status, 'confirmed');
  assert.equal(p.cycleCalculations[0].rawBalanceMg, 200000); assert.equal(p.cycleCalculations[0].closingDate, '2026-10-12');
  assert.equal(p.boundaryResults.every(b => b.processingStatus === 'applied'), true); cycleSchema.parse(p.cycles[0]);
  assert.deepEqual(i, before);
  assert.deepEqual(project({ ...i, samples: [...i.samples, ...i.samples].reverse(), events: [...i.events, ...i.events].reverse() }), p);
});

test('T02 known ice and drain yield 250; ice is not food refill and mixed load is not food remaining', () => {
  const i = input(); i.samples = [sample(0, 800), sample(5, 750), sample(10, 800), sample(15, 650), sample(20, 600)];
  i.operations = [operation(7, 'ice_add', 100), operation(12, 'drain', 50)];
  const p = project(i); assert.equal(p.cycles[0].confirmedTakeG, 250); assert.equal(p.cycleCalculations[0].foodRefillMg, 0);
  assert.equal(p.cycleCalculations[0].increaseMg, 100000); assert.equal(p.cycleCalculations[0].nonCustomerDecreaseMg, 50000);
  assert.equal(p.observation.loadNetG, 600); assert.equal(p.observation.foodRemainingG, null); assert.equal(p.observation.estimatedFoodG, null);
  assert.equal(p.observation.quality, 'pending');
  i.operations = [operation(7, 'ice_add', null), operation(12, 'drain', 50)]; pending(i, 'UNKNOWN_OPERATION');
});

test('food refill and partial removal are distinct signed adjustments with traceable evidence', () => {
  const i = input(); i.samples = [sample(0, 800), sample(5, 750), sample(10, 800), sample(15, 650), sample(20, 600)];
  i.operations = [operation(7, 'food_refill', 100), operation(12, 'partial_remove', 50)];
  const p = project(i); assert.equal(p.cycles[0].confirmedTakeG, 250); assert.equal(p.cycleCalculations[0].foodRefillMg, 100000);
  assert.equal(p.observation.foodRemainingG, 600); assert.ok(p.cycles[0].evidenceIds.includes('operation-evidence:7'));
});

test('T03 kitchen withdrawal before exit changes the baseline but is not customer take', () => {
  const i = input(); i.samples = [sample(0, 900), sample(5, 800), sample(10, 750), sample(15, 700), sample(20, 600)];
  i.events = [boundary(5, 'exit_kitchen', i.samples[1]), boundary(20, 'enter_kitchen', i.samples[4])]; i.operations = [operation(1, 'partial_remove', 100)];
  const p = project(i); assert.equal(p.cycles[0].outG, 800); assert.equal(p.cycles[0].confirmedTakeG, 200); assert.deepEqual(p.cycleCalculations[0].operationIds, []);
});

test('T04 continuous decrease updates the current estimate while retaining separately dated confirmation', () => {
  const i = input(); i.samples = [sample(0, 800), sample(5, 800), sample(10, 800), sample(15, 790), sample(20, 780), sample(25, 770)]; i.events = []; i.asOf = time(25);
  const p = project(i); assert.deepEqual(p.cycles, []); assert.equal(p.observation.estimatedFoodG, 770); assert.equal(p.observation.foodRemainingG, 770);
  assert.equal(p.observation.observedAt, time(25)); assert.equal(p.observation.confirmedFoodG, 800); assert.equal(p.observation.confirmedAt, time(10)); assert.equal(p.observation.quality, 'estimated');
});

test('explicit sampleRef is preferred; absent referenced sample never falls back to a nearby reading', () => {
  const i = input(); i.samples = [...i.samples, sample(19.5, 610, 20)];
  assert.equal(project(i).cycles[0].confirmedTakeG, 200);
  i.events = [i.events[0], boundary(20, 'enter_kitchen', sample(20, 600, 999))];
  const p = pending(i, 'MISSING_SAMPLE'); assert.equal(p.boundaryResults[1].processingStatus, 'waiting_sample');
});

test('old referenced sample cannot certify a new boundary even when its identity is valid', () => {
  const i = input(); i.events = [i.events[0], boundary(20, 'enter_kitchen', i.samples[0])];
  const p = pending(i, 'MISSING_SAMPLE'); assert.equal(p.cycles[0].inG, null); assert.equal(p.boundaryResults[1].sampleId, null);
});

test('one sample within two boundary windows cannot certify both boundaries or a zero cycle', () => {
  const i = input(), shared = sample(10, 800); i.samples = [shared]; i.events = [boundary(9.5, 'exit_kitchen', shared, 10), boundary(10.5, 'enter_kitchen', shared, 11)]; i.asOf = time(11);
  const p = pending(i, 'BOUNDARY_CONFLICT'); assert.ok(p.boundaryResults.every(b => b.sampleId === null));
});

test('unreferenced boundaries require an explicit window and exactly one usable reading', () => {
  const i = input(); i.events = [boundary(0, 'exit_kitchen'), boundary(20, 'enter_kitchen')]; assert.equal(project(i).cycles[0].confirmedTakeG, 200);
  i.config.boundaryWindowMs = null; pending(i, 'MISSING_SAMPLE');
  i.config.boundaryWindowMs = 1000; i.samples = [...i.samples, sample(19.5, 610, 100)]; pending(i, 'BOUNDARY_CONFLICT');
});

test('unconfigured clock window accepts only exact-time references, never a guessed tolerance', () => {
  const i = input(); i.config.boundaryWindowMs = null; assert.equal(project(i).cycles[0].confirmedTakeG, 200);
  i.events = [i.events[0], boundary(20.5, 'enter_kitchen', i.samples[4])]; i.asOf = time(20.5); pending(i, 'MISSING_SAMPLE');
});

test('boundary matching does not cross an operation, another boundary, or a boot identity', () => {
  const i = input(); i.events = [i.events[0], boundary(20.5, 'enter_kitchen', i.samples[4])]; i.asOf = time(20.5); i.operations = [operation(20.25, 'partial_remove', 1)]; pending(i, 'MISSING_SAMPLE');
  i.operations = []; i.events = [...i.events, boundary(20.25, 'exit_kitchen', undefined, 999)]; pending(i, 'BOUNDARY_CONFLICT');
  const j = input(); const e = j.events[1]; j.events = [j.events[0], { ...e, event: { ...e.event, bootId: 'another-boot' } } as MeasurementEvent]; pending(j, 'MISSING_SAMPLE');
});

test('T09 missing continuity, faults, removal and replacement cannot become confirmed take', () => {
  const gap = input(); gap.samples = [gap.samples[0], gap.samples[4]]; pending(gap, 'DATA_GAP');
  const fault = input(); fault.events = [...fault.events, deviceEvent(7, 'device_fault'), deviceEvent(12, 'device_recovered')]; pending(fault, 'DATA_GAP');
  const bad = input(); bad.samples = bad.samples.map((s, i) => i === 2 ? { ...s, sample: { ...s.sample, measurementStatus: 'overload', grossG: null } } : s); pending(bad, 'DATA_GAP');
  for (const type of ['remove_container', 'replace_container'] as const) { const i = input(); i.operations = [operation(7, type, 100)]; pending(i, 'BINDING_CHANGED'); }
  const removed = input(); removed.samples = removed.samples.map((s, i) => i === 2 ? sample(10, -50) : s); pending(removed, 'DATA_GAP');
});

test('T09 reboot with otherwise plausible weights cannot bridge a cycle', () => {
  const i = input(); i.samples = i.samples.map((s, index) => index >= 2 ? sample(index * 5, 800 - index * 50, index, 'boot-2') : s);
  i.events = [i.events[0], boundary(20, 'enter_kitchen', i.samples[4])]; pending(i, 'DATA_GAP');
  const j = input(); j.events = [...j.events, deviceEvent(10, 'device_recovered', 'boot-2')]; pending(j, 'DATA_GAP');
});

test('fault recovery without a subsequent sample cannot reactivate the pre-fault food reading', () => {
  const i = input(); i.events = [deviceEvent(21, 'device_fault'), deviceEvent(22, 'device_recovered')]; i.asOf = time(22);
  const p = project(i); assert.equal(p.observation.foodRemainingG, null); assert.equal(p.observation.estimatedFoodG, null); assert.equal(p.observation.quality, 'pending');
});

test('registered refill waits for a subsequent observation; an unmatched operation stays unknown', () => {
  const i = input(); i.events = []; i.operations = [operation(21, 'food_refill', 100)]; i.asOf = time(22); assert.equal(project(i).observation.estimatedFoodG, null);
  i.samples = [...i.samples, sample(22, 700)]; assert.equal(project(i).observation.estimatedFoodG, 700);
  i.operations = [{ ...i.operations[0], status: 'recorded' }]; assert.equal(project(i).observation.estimatedFoodG, null);
});

test('T10 late referenced samples rebuild a pending cycle without inventing a boundary reading', () => {
  const i = input(); i.samples = i.samples.map((s, index) => index === 4 ? { ...s, receivedAt: time(25) } : s);
  pending(i, 'MISSING_SAMPLE'); i.asOf = time(25); assert.equal(project(i).cycles[0].confirmedTakeG, 200);
});

test('T10 late historical return rebuilds the old cycle but latest zone and sample do not roll back', () => {
  const i = input(); i.samples = [...i.samples, sample(25, 550), sample(30, 500)];
  i.events = [i.events[0], { ...i.events[1], receivedAt: time(31) }, boundary(25, 'exit_kitchen', i.samples[5])]; i.asOf = time(31);
  const p = project(i); assert.equal(p.cycles[0].confirmedTakeG, 200); assert.equal(p.cycles[1].status, 'open');
  assert.equal(p.observation.observedAt, time(30)); assert.equal(p.observation.foodRemainingG, 500); assert.equal(p.observation.zone, 'customer'); assert.equal(p.observation.locationObservedAt, time(25));
});

test('T10 consecutive, missing and simultaneous boundaries preserve pending records', () => {
  const i = input(); i.events = [i.events[0], boundary(10, 'exit_kitchen', i.samples[2]), i.events[1]]; pending(i, 'BOUNDARY_CONFLICT');
  i.events = [input().events[1]]; pending(i, 'MISSING_EXIT');
  i.events = [boundary(0, 'exit_kitchen', i.samples[0]), boundary(0, 'enter_kitchen', i.samples[0], 2)]; pending(i, 'BOUNDARY_CONFLICT');
  const closed = input(); closed.events = [closed.events[0]]; closed.binding.validTo = time(20); pending(closed, 'MISSING_RETURN');
});

test('asOf excludes future event times and facts not yet received, including corrections', () => {
  const i = input(), baseline = project(i); const op = operation(7, 'ice_add', 100); op.recordedAt = time(21);
  const p = project({ ...i, samples: [...i.samples, sample(25, 400), { ...sample(19, 100, 999), receivedAt: time(25) }], events: [...i.events, deviceEvent(25, 'device_fault'), { ...deviceEvent(19, 'device_fault'), receivedAt: time(25) }], operations: [op] });
  assert.deepEqual(p, baseline);
});

test('T12 cross-midnight cycle is assigned to return date and retains CROSS_DAY evidence', () => {
  const i = input(), shift = (s: string) => new Date(Date.parse(s) + (11 * 3600 + 59 * 60 + 50) * 1000).toISOString();
  i.binding.validFrom = shift(i.binding.validFrom); i.asOf = shift(i.asOf); i.samples = i.samples.map(s => ({ ...s, receivedAt: shift(s.receivedAt), sample: { ...s.sample, sampledAt: shift(s.sample.sampledAt) } }));
  i.events = i.events.map(e => ({ ...e, receivedAt: shift(e.receivedAt), event: { ...e.event, occurredAt: shift(e.event.occurredAt) } }));
  const p = project(i); assert.equal(p.cycles[0].confirmedTakeG, 200); assert.ok(p.cycles[0].qualityReasons.includes('CROSS_DAY')); assert.equal(p.cycleCalculations[0].closingDate, '2026-10-13');
});

test('T13 correction supersedes the old classification, keeps lineage and changes only later knowledge', () => {
  const i = input(), original = operation(7, 'partial_remove', 50); i.operations = [original]; assert.equal(project(i).cycles[0].confirmedTakeG, 150);
  const correction: MeasurementOperation = { ...operation(7, 'partial_remove', 40), id: 'correction-1', version: 2, recordedAt: time(25), input: { ...operation(7, 'partial_remove', 40).input, correctsOperationId: original.id, expectedVersion: 1 } };
  i.operations = [original, correction]; assert.equal(project(i).cycles[0].confirmedTakeG, 150);
  i.asOf = time(25); const p = project(i); assert.equal(p.cycles[0].confirmedTakeG, 160); assert.deepEqual(p.cycleCalculations[0].operationIds, [original.id, correction.id]);
  assert.equal(original.input.weightG, 50); assert.equal(p.cycleCalculations[0].asOf, time(25));
});

test('correction chains and duplicate identities reject conflicts instead of choosing input order', () => {
  const i = input(); assert.throws(() => project({ ...i, samples: [...i.samples, { ...i.samples[0], sample: { ...i.samples[0].sample, measurementStatus: 'ok', grossG: 999 } }] }), /Conflicting/);
  const original = operation(7, 'drain', 50), broken = operation(8, 'drain', 40); broken.input.correctsOperationId = original.id; broken.input.expectedVersion = 9;
  assert.throws(() => project({ ...i, operations: [original, broken] }), /correction chain/);
  const duplicate = { ...i.samples[0], id: 'another-row-id', receivedAt: time(1) };
  assert.deepEqual(project({ ...i, samples: [...i.samples, duplicate] }), project({ ...i, samples: [duplicate, ...i.samples].reverse() }));
});

test('T14 no samples and trusted zero remain distinct; ended binding is not currently available', () => {
  const i = input(); const empty = pending({ ...i, samples: [] }, 'MISSING_SAMPLE'); assert.equal(empty.observation.foodRemainingG, null); assert.equal(empty.observation.quality, 'offline');
  i.samples = [sample(0, 0), sample(5, 0), sample(10, 0), sample(15, 0), sample(20, 0)];
  const zero = project(i); assert.equal(zero.cycles[0].confirmedTakeG, 0); assert.equal(zero.observation.foodRemainingG, 0); assert.equal(zero.observation.quality, 'good');
  i.binding.validTo = time(21); i.asOf = time(22); const ended = project(i); assert.equal(ended.observation.quality, 'removed'); assert.equal(ended.observation.foodRemainingG, null);
});

test('D04/D06 location expires independently of fresh weight and missing configuration stays unknown', () => {
  const i = input(); i.events = [i.events[0]]; i.config.locationFreshMs = 10000;
  const stale = project(i); assert.equal(stale.observation.observedAt, time(20)); assert.equal(stale.observation.locationQuality, 'stale'); assert.equal(stale.observation.zone, 'unknown');
  delete i.config.locationFreshMs; assert.equal(project(i).observation.locationQuality, 'unknown');
  i.config.locationFreshMs = 30000; assert.equal(project(i).observation.zone, 'customer');
  i.events = [{ receivedAt: time(0), origin: 'manual', event: { eventId: uuid(1), scaleId: 'scale-1', occurredAt: time(0), type: 'exit_kitchen', sampleRef: { bootId: 'boot-1', sequence: 1 } } }]; assert.equal(project(i).observation.locationQuality, 'manual');
});

test('unmatched boundary, fault recovery, reboot and weight gaps do not establish a current zone', () => {
  const i = input(); i.events = [boundary(20, 'enter_kitchen', sample(20, 600, 999))]; assert.equal(project(i).observation.zone, 'unknown');
  const j = input(); j.events = [...j.events, deviceEvent(21, 'device_fault'), deviceEvent(22, 'device_recovered')]; j.samples = [...j.samples, sample(23, 600)]; j.asOf = time(23); assert.equal(project(j).observation.zone, 'unknown');
  const k = input(); k.samples = [...k.samples, sample(23, 600, 1, 'boot-2')]; k.asOf = time(23); assert.equal(project(k).observation.zone, 'unknown');
  const shifted = input(); shifted.events = [shifted.events[0], boundary(20.5, 'enter_kitchen', shifted.samples[4])]; shifted.samples = [...shifted.samples, sample(23, 600, 1, 'boot-2')]; shifted.asOf = time(23); assert.equal(project(shifted).observation.zone, 'unknown');
  const recovery = input(); recovery.events = [...recovery.events, deviceEvent(21, 'device_recovered', 'boot-2')]; recovery.asOf = time(22); assert.equal(project(recovery).observation.zone, 'unknown');
  const gap = input(); gap.samples = [...gap.samples, sample(27, 600)]; gap.asOf = time(27); assert.equal(project(gap).observation.zone, 'unknown');
});

test('freshness expires current quantities while preserving clearly dated historical confirmation', () => {
  const i = input(); i.samples = [sample(0, 800), sample(5, 800), sample(10, 800)]; i.events = []; i.asOf = time(20);
  const p = project(i); assert.equal(p.observation.quality, 'stale'); assert.equal(p.observation.foodRemainingG, null); assert.equal(p.observation.estimatedFoodG, null); assert.equal(p.observation.confirmedFoodG, 800); assert.equal(p.observation.confirmedAt, time(10));
});

test('unexplained increases and negative balance stay pending except explicitly configured small tolerance', () => {
  const i = input(); i.samples = [sample(0, 800), sample(5, 800), sample(10, 800), sample(15, 800), sample(20, 850)]; pending(i, 'NEGATIVE_BALANCE'); assert.equal(project(i).observation.estimatedFoodG, null);
  i.samples = [sample(0, 800), sample(5, 800), sample(10, 800), sample(15, 800), sample(20, 800.5)]; const p = project(i); assert.equal(p.cycles[0].confirmedTakeG, 0); assert.equal(p.cycleCalculations[0].rawBalanceMg, -500); assert.equal(p.cycleCalculations[0].appliedToleranceMg, 500);
  i.config.negativeToleranceG = 0; pending(i, 'NEGATIVE_BALANCE');
});

test('milligram arithmetic preserves decimals and refuses invalid precision or unset operational windows', () => {
  assert.equal(gramsToMg(0.123), 123); assert.equal(mgToGrams(123), 0.123); assert.throws(() => gramsToMg(0.0001)); assert.throws(() => mgToGrams(Number.MAX_SAFE_INTEGER + 1));
  const i = input(); i.samples = [sample(0, 800.001), sample(5, 750.001), sample(10, 700.001), sample(15, 650.001), sample(20, 600.002)]; assert.equal(project(i).cycleCalculations[0].rawBalanceMg, 199999);
  assert.throws(() => project({ ...i, config: { ...i.config, maxSampleGapMs: 0 } }), /configured/); assert.throws(() => project({ ...i, config: { ...i.config, locationFreshMs: -1 } }), /window/);
});

test('large evidence sets retain every basis in the calculation and expose a schema-valid bundle reference', () => {
  const i = input(); i.samples = Array.from({ length: 121 }, (_, n) => sample(n, 800 - n)); i.events = [boundary(0, 'exit_kitchen', i.samples[0]), boundary(120, 'enter_kitchen', i.samples[120])]; i.asOf = time(120);
  const p = project(i); assert.equal(p.cycles[0].confirmedTakeG, 120); assert.ok(p.cycleCalculations[0].evidenceIds.length > 100); assert.deepEqual(p.cycles[0].evidenceIds, [p.cycleCalculations[0].evidenceBundleId]); cycleSchema.parse(p.cycles[0]);
});

test('D04 prior unrecovered device fault survives binding replacement without invented boundary time', () => {
  const i = input(), prior = deviceEvent(-15, 'device_fault'); i.priorFault = prior;
  const before = structuredClone(i), p = pending(i, 'DATA_GAP');
  assert.equal(p.observation.quality, 'offline'); assert.equal(p.observation.foodRemainingG, null); assert.equal(p.observation.confirmedFoodG, null);
  assert.equal(p.observation.zone, 'unknown'); assert.ok(p.observation.evidenceIds.includes(prior.event.eventId));
  assert.ok(p.cycleCalculations[0].evidenceIds.includes(prior.event.eventId)); assert.deepEqual(i, before);
  assert.equal(prior.event.occurredAt, time(-15));
});

test('D04 prior recovery or a later genuine recovery clears carried fault and starts a fresh observation window', () => {
  const i = input(); i.priorFault = deviceEvent(-15, 'device_recovered');
  assert.equal(project(i).cycles[0].confirmedTakeG, 200);
  i.priorFault = deviceEvent(-15, 'device_fault'); i.events = [deviceEvent(-5, 'device_recovered'), ...i.events];
  const p = project(i); assert.equal(p.cycles[0].confirmedTakeG, 200); assert.equal(p.observation.foodRemainingG, 600);
  assert.ok(p.observation.evidenceIds.includes(i.priorFault.event.eventId));
  assert.ok(p.observation.evidenceIds.includes(i.events[0].event.eventId));
});

test('priorFault respects scale, type, binding interval and asOf knowledge cutoff', () => {
  const i = input(), baseline = project(i), prior = deviceEvent(-15, 'device_fault');
  for (const invalid of [
    { ...prior, receivedAt: time(21) }, { ...prior, origin: 'manual' as const },
    { ...prior, event: { ...prior.event, scaleId: 'other-scale' } }, deviceEvent(0, 'device_fault'), boundary(-15, 'exit_kitchen'),
  ]) assert.deepEqual(project({ ...i, priorFault: invalid }), baseline);
  const future = { ...i, binding: { ...i.binding, validFrom: time(30) }, priorFault: deviceEvent(25, 'device_fault') };
  assert.deepEqual(project(future), project({ ...future, priorFault: null }));
});

test('same-timestamp device recovery follows its boot sequence instead of random event IDs', () => {
  const i = input(), fault = deviceEvent(11, 'device_fault'), recovered = deviceEvent(11, 'device_recovered');
  fault.event = { ...fault.event, eventId: uuid(900), eventSequence: 1 } as typeof fault.event;
  recovered.event = { ...recovered.event, eventId: uuid(800), eventSequence: 2 } as typeof recovered.event;
  i.events = [...i.events, recovered, fault]; i.config.stableWindowMs = 0; i.config.stableMinSamples = 1;
  const p = project(i); assert.equal(p.observation.quality, 'good'); assert.equal(p.observation.foodRemainingG, 600);
  assert.equal(p.cycles[0].status, 'pending', 'recovery cannot repair the earlier interrupted cycle');
  assert.deepEqual(project({ ...i, events: [...i.events].reverse() }), p);
  recovered.event = { ...recovered.event, bootId: 'different-boot' } as typeof recovered.event;
  i.events = [fault, recovered]; assert.equal(project(i).observation.quality, 'offline', 'simultaneous conflicting boots do not prove recovery');
});
