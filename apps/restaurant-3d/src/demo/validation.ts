import { distance, nearest, pointAt, segmentDistance, type SceneManifest } from './layout.ts';
import { chairFootprint, countertopWidth, diningFootprints, footprintSamples, polygonDistance, polygonsOverlap, PolygonIndex, rectangle, ribbonTriangles } from './dining.ts';
import { validateInterior } from './interior-validation';

/** Seating-only checks are fast enough for focused tests and candidate-layout iteration. */
export function validateSeating(m: SceneManifest): string[] {
 const errors: string[] = [];
 if (m.navigation.rejectedUnreachableSeats > 0) errors.push(`Unreachable seats omitted from publication: ${m.navigation.rejectedUnreachableSeats}`);
 for (const zone of m.seatingZones ?? []) {
  const actual = m.seats.filter(seat => seat.zoneId === zone.zoneId).length;
  if (actual < zone.minimumSeats) errors.push(`${zone.zoneId}: seating coverage ${actual} below minimum ${zone.minimumSeats}`);
 }
 const counters = new PolygonIndex(m.tracks.flatMap(track => ribbonTriangles(track, p => countertopWidth(m, p))));
 const rails = new PolygonIndex(m.tracks.flatMap(track => ribbonTriangles(track, () => .46)));
 const wallFootprints = m.walls.map(w => rectangle({ x: (w.from.x + w.to.x) / 2, z: (w.from.z + w.to.z) / 2 }, -Math.atan2(w.to.z - w.from.z, w.to.x - w.from.x), distance(w.from, w.to), w.thicknessM));
 const chairs = m.seats.map(seat => ({ seat, polygon: chairFootprint(seat) }));
 const fixtures = [m.kitchen, m.sauce, m.drinks].map(rect => rectangle({ x: (rect.min.x + rect.max.x) / 2, z: (rect.min.z + rect.max.z) / 2 }, 0, rect.max.x - rect.min.x, rect.max.z - rect.min.z));
 const settings: { seatId: string; name: string; polygon: ReturnType<typeof chairFootprint> }[] = [];
 const finitePoint = (p: { x: number; z: number }) => Number.isFinite(p.x) && Number.isFinite(p.z);
 const routeCache = new Map<string, string | undefined>();
 const obstacle = (p: { x: number; z: number }) => {
  const key = `${p.x.toFixed(6)},${p.z.toFixed(6)}`;
  if (routeCache.has(key)) return routeCache.get(key);
  const r = m.config.walkingRadiusM;
  let reason: string | undefined;
  if (p.x < m.floor.min.x + r || p.x > m.floor.max.x - r || p.z < m.floor.min.z + r || p.z > m.floor.max.z - r) reason = 'floor boundary';
  else if (m.walls.some(w => segmentDistance(p, w.from, w.to) < r + w.thicknessM / 2 - 1e-6)) reason = 'wall';
  else if (fixtures.some(polygon => polygonDistance(p, polygon) < r - 1e-6)) reason = 'fixture';
  else if (counters.within(p, r)) reason = 'counter';
  routeCache.set(key, reason); return reason;
 };
 for (const { seat, polygon } of chairs) {
  const track = m.tracks.find(t => t.trackId === seat.trackId);
  if (!track) { errors.push(`${seat.seatId}: unknown seating track`); continue; }
  if (!finitePoint(seat.position) || !finitePoint(seat.grill) || !Number.isFinite(seat.angle)) { errors.push(`${seat.seatId}: non-finite furniture placement`); continue; }
  const at = pointAt(track, seat.takeWindow.centerSM);
  if (seat.takeWindow.trackId !== track.trackId || distance(at, seat.takeWindow.position) > .00001) errors.push(`${seat.seatId}: take window does not match track`);
  const forward = { x: Math.sin(seat.angle), z: Math.cos(seat.angle) };
  for (const target of [at, seat.grill]) {
   const dx = target.x - seat.position.x, dz = target.z - seat.position.z, length = Math.hypot(dx, dz);
   if (length < .001 || (dx * forward.x + dz * forward.z) / length < .999) errors.push(`${seat.seatId}: dining setting does not face take window`);
  }
  if (polygon.some(p => p.x < m.floor.min.x || p.x > m.floor.max.x || p.z < m.floor.min.z || p.z > m.floor.max.z)) errors.push(`${seat.seatId}: chair outside floor`);
  if (wallFootprints.some(wall => polygonsOverlap(polygon, wall))) errors.push(`${seat.seatId}: chair-wall collision`);
  if (fixtures.some(f => polygonsOverlap(polygon, f))) errors.push(`${seat.seatId}: chair-fixture collision`);
  if (counters.overlaps(polygon)) errors.push(`${seat.seatId}: chair-counter collision`);
  for (const footprint of diningFootprints(seat, track, m)) {
   settings.push({ seatId: seat.seatId, ...footprint });
   if (footprintSamples(footprint.polygon).some(p => !counters.contains(p))) errors.push(`${seat.seatId}: ${footprint.name} unsupported by counter`);
   if (rails.overlaps(footprint.polygon)) errors.push(`${seat.seatId}: ${footprint.name} overlaps conveyor`);
   if (wallFootprints.some(wall => polygonsOverlap(footprint.polygon, wall))) errors.push(`${seat.seatId}: ${footprint.name} overlaps wall`);
  }
  const path = seat.approachPath;
  if (path.length < 2 || path.some(p => !finitePoint(p))) { errors.push(`${seat.seatId}: no valid approach route`); continue; }
  if (distance(path[0], m.entry) > m.navigation.gridM * Math.SQRT2 + .001 || distance(path.at(-1)!, seat.position) > .00001) errors.push(`${seat.seatId}: route endpoints do not connect entry and chair`);
  let routeError: string | undefined;
  for (let i = 1; i < path.length && !routeError; i++) {
   const a = path[i - 1], b = path[i], steps = Math.max(1, Math.ceil(distance(a, b) / .025));
   for (let k = 0; k <= steps; k++) {
    const p = { x: a.x + (b.x - a.x) * k / steps, z: a.z + (b.z - a.z) * k / steps };
    routeError = obstacle(p);
    if (!routeError) for (const other of chairs) {
     // Only the final, explicit ingress segment may enter its own chair footprint.
     if (other.seat.seatId === seat.seatId && i === path.length - 1) continue;
     if (distance(p, other.seat.position) > m.config.walkingRadiusM + .34) continue;
     if (polygonDistance(p, other.polygon) < m.config.walkingRadiusM - 1e-6) { routeError = `chair ${other.seat.seatId}`; break; }
    }
    if (routeError) break;
   }
  }
  if (routeError) errors.push(`${seat.seatId}: approach route collides with ${routeError}`);
 }
 for (let i = 0; i < chairs.length; i++) for (let j = i + 1; j < chairs.length; j++) {
  if (polygonsOverlap(chairs[i].polygon, chairs[j].polygon) || distance(chairs[i].seat.position, chairs[j].seat.position) < m.config.chairRadiusM * 2 + .05 - 1e-6) errors.push(`${chairs[i].seat.seatId}/${chairs[j].seat.seatId}: chairs overlap`);
 }
 for (let i = 0; i < settings.length; i++) for (let j = i + 1; j < settings.length; j++) if (polygonsOverlap(settings[i].polygon, settings[j].polygon)) errors.push(`${settings[i].seatId}/${settings[j].seatId}: ${settings[i].name}-${settings[j].name} collision`);
 return [...new Set(errors)];
}

export function validateGeometry(m:SceneManifest) {
 const errors:string[]=[...validateSeating(m),...validateInterior(m)];
 for(const t of m.tracks){
  if(distance(t.arcLengthLut[0],t.arcLengthLut.at(-1)!)>1e-5)errors.push(`${t.trackId}: open loop`);
  if(t.arcLengthLut.some((p,i)=>!Number.isFinite(p.sM)||i>0&&p.sM<=t.arcLengthLut[i-1].sM))errors.push(`${t.trackId}: invalid LUT`);
 }
 // Check every carrier (including empty positions), all phase offsets within one slot pitch.
 // Because slots are equally spaced, this covers a full lap up to permutation.
 let minPlateSeparationM=Infinity;
 for(const t of m.tracks){
  const slots=m.slots.filter(s=>s.trackId===t.trackId),pitch=t.lengthM/slots.length;
  const steps=Math.ceil(pitch/.002);
  for(let step=0;step<=steps;step++){
   const points=slots.map(s=>pointAt(t,s.s0M+step*pitch/steps));
   for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)minPlateSeparationM=Math.min(minPlateSeparationM,distance(points[i],points[j]));
  }
 }
 // Movement of each centre between phase samples is <= .002m, so subtract .004m for conservative bound.
 const conservativePlateClearanceM=minPlateSeparationM-.004-m.plateDimensions.diameterM;
 if(conservativePlateClearanceM<.01)errors.push('Plates can collide on turns or parallel returns');
 for(const w of m.servingWindows){const p=w.position;const track=m.tracks.find(t=>t.trackId===w.trackId)!;const at=pointAt(track,w.centerSM);if(distance(at,p)>1e-5)errors.push(`${w.windowId}: window does not match path coordinates`);if(p.x<m.kitchen.min.x||p.x>m.kitchen.max.x||p.z<m.kitchen.min.z||p.z>m.kitchen.max.z)errors.push(`${w.windowId}: outside kitchen`);}
 for(const w of m.servingWindows){const p=w.staffPosition;if(!p){errors.push('Missing staffPosition');continue;}if(p.x<m.kitchen.min.x+.27||p.x>m.kitchen.max.x-.27||p.z<m.kitchen.min.z+.27||p.z>m.kitchen.max.z-.27)errors.push(`${w.windowId}: staff outside kitchen`);if(m.tracks.some(t=>nearest(t,p).d<.60/2+.27)||m.walls.some(w=>segmentDistance(p,w.from,w.to)<.27+w.thicknessM/2))errors.push(`${w.windowId}: staff collision`);if(distance(p,w.position)>.85)errors.push(`${w.windowId}: staff out of reach`);}
 const unique=(key:string,values:string[])=>{if(new Set(values).size!==values.length)errors.push(`Duplicate ${key}`);};
 unique('slotId',m.slots.map(s=>s.slotId));unique('seatId',m.seats.map(s=>s.seatId));unique('plateId',m.plates.map(s=>s.plateId));unique('occupied slot',m.plates.map(s=>s.slotId));
 for(const p of m.plates)if(!m.slots.some(s=>s.slotId===p.slotId)||!m.dishCatalog.some(d=>d.dishId===p.dishId))errors.push(`Unknown plate binding ${p.plateId}`);
 return {errors,minPlateSeparationM,conservativePlateClearanceM,carrierPositions:m.slots.length,actualPlates:m.plates.length,dishTypes:new Set(m.plates.map(p=>p.dishId)).size,availableSeats:m.seats.length};
}
