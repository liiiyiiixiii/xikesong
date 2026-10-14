import { readFileSync, writeFileSync } from 'node:fs';
import { buildGeometry } from '../src/demo/layout';
import { fillPlatePositions, type PlatePlacement } from '../src/demo/plate-placement';
import { validateGeometry } from '../src/demo/validation';

const path = 'public/data/plate-bindings.v1.json';
const scene = buildGeometry();
const placement = fillPlatePositions(scene, JSON.parse(readFileSync(path, 'utf8')) as PlatePlacement);
scene.plates = placement.plates; scene.dishCatalog = placement.dishCatalog;
const report = validateGeometry(scene);
if (report.errors.length) throw Error(report.errors.join('; '));
writeFileSync(path, JSON.stringify(placement, null, 2) + '\n');
console.log(JSON.stringify({ total: scene.plates.length, tracks: scene.tracks.map(track => ({ trackId: track.trackId,
  plates: scene.plates.filter(plate => scene.slots.find(slot => slot.slotId === plate.slotId)?.trackId === track.trackId).length })) }, null, 2));
