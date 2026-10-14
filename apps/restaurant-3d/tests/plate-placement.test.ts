import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillPlatePositions, type PlatePlacement } from '../src/demo/plate-placement';
import { buildGeometry, legacyPlatePitchM, type SceneManifest } from '../src/demo/layout';
import { project } from '../src/simulation';

const baseline = JSON.parse(readFileSync('tests/fixtures/plate-bindings-before-full.json', 'utf8')) as PlatePlacement;
const scene = JSON.parse(readFileSync('public/data/scene-manifest.v1.json', 'utf8')) as SceneManifest;

test('both tracks are physically full at the legacy kitchen pitch while existing plate bindings survive', () => {
  const physical=(plates:typeof scene.plates)=>plates.map(({dishId,...p})=>p);
  assert.deepEqual(physical(scene.plates.slice(0, baseline.plates.length)), physical(baseline.plates));
  for (const track of scene.tracks) {
    const slots = scene.slots.filter(slot => slot.trackId === track.trackId && slot.usable);
    const plates = scene.plates.filter(plate => slots.some(slot => slot.slotId === plate.slotId));
    assert.equal(plates.length, slots.length);
    assert.equal(new Set(plates.map(plate => plate.slotId)).size, slots.length);
    assert.equal(slots.length, Math.floor(track.lengthM / legacyPlatePitchM));
    assert.ok(track.lengthM / slots.length >= legacyPlatePitchM);
    assert.ok(track.lengthM / slots.length - legacyPlatePitchM < .01);
  }
  const filled = fillPlatePositions(buildGeometry(), baseline);
  assert.deepEqual(fillPlatePositions(buildGeometry(), filled), filled, 'repeat fill is idempotent');
  assert.deepEqual(physical(filled.plates), physical(scene.plates));
});

test('unconnected full placement renders every plate without inventing weights or activating the standby track', () => {
  const start = project(scene, null, 0), later = project(scene, null, 10000);
  assert.equal(start.plates.length, scene.slots.filter(slot => slot.usable).length);
  assert.ok(start.plates.every(plate => plate.state === null));
  const backupIds = new Set(scene.slots.filter(slot => slot.trackId === 'track-backup').map(slot => slot.slotId));
  for (const plate of start.plates.filter(plate => backupIds.has(plate.slotId))) {
    assert.deepEqual(later.plates.find(next => next.plateId === plate.plateId)?.position, plate.position);
  }
  assert.equal(scene.tracks.find(track => track.trackId === 'track-backup')?.enabled, false);
});
