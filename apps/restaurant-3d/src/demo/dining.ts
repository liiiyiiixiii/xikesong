import { distance, pointAt, round, segmentDistance, type Point, type Seat, type Track } from './layout.ts';

type CounterContext = { kitchen: { max: Point }; config: { counterWidthM: number } };
const diningSurfaces = new WeakMap<Track, Map<string, { counter: PolygonIndex; rail: PolygonIndex }>>();
export type DiningLayout = {
  curved: boolean;
  grill: { width: number; depth: number; innerWidth: number; innerDepth: number; barDepth: number };
  bowl: { x: number; z: number; radius: number };
  chopsticks: { x: number; z: number; width: number; depth: number };
};

/** The narrow working counter belongs to the kitchen, not every point at the same z. */
export function countertopWidth(m: CounterContext, p: Point) {
  const transition = Math.max(p.x - m.kitchen.max.x, p.z - m.kitchen.max.z);
  // Expand only after clearing the partition; complete the shoulder before the first setting.
  const t = Math.max(0, Math.min(1, (transition - .18) / .12));
  return .60 + (m.config.counterWidthM - .60) * t;
}

function isCurved(track: Track, sM: number, reach = .55) {
  const a = pointAt(track, sM - reach), b = pointAt(track, sM + reach);
  return Math.cos(a.angle - b.angle) < Math.cos(.02);
}

/** Placement and rendered furniture use the same local axes: +z faces the conveyor. */
export function diningPlacement(track: Track, sM: number, normal: Point, offset = .46): Point {
  const at = pointAt(track, sM), r = isCurved(track, sM) ? Math.min(offset, .40) : offset;
  return { x: round(at.x + normal.x * r), z: round(at.z + normal.z * r) };
}

export function diningLayout(seat: Pick<Seat, 'takeWindow' | 'grill' | 'angle'>, track: Track, context?: CounterContext): DiningLayout {
  const curved = isCurved(track, seat.takeWindow.centerSM);
  const layout = {
    curved,
    grill: { width: .58, depth: .30, innerWidth: .47, innerDepth: .24, barDepth: .20 },
    bowl: { x: .40, z: curved ? .04 : 0, radius: .09 },
    chopsticks: { x: curved ? -.42 : .54, z: curved ? .04 : 0, width: .012, depth: .26 },
  };
  if (context && curved && !isCurved(track, seat.takeWindow.centerSM, .05)) {
    // At the straight shoulder of a bend, keep utensils away from the preceding curved setting
    // when the forward side has enough real countertop. Tight U-bends keep the split arrangement.
    const key = `${context.kitchen.max.x}/${context.kitchen.max.z}/${context.config.counterWidthM}`;
    let surfaces = diningSurfaces.get(track); if (!surfaces) { surfaces = new Map(); diningSurfaces.set(track, surfaces); }
    let indexes = surfaces.get(key);
    if (!indexes) { indexes = { counter: new PolygonIndex(ribbonTriangles(track, p => countertopWidth(context, p))), rail: new PolygonIndex(ribbonTriangles(track, () => .46)) }; surfaces.set(key, indexes); }
    const candidate = rectangle(seat.grill, seat.angle, layout.chopsticks.width, layout.chopsticks.depth, .54, layout.chopsticks.z);
    if (!indexes.rail.overlaps(candidate) && footprintSamples(candidate).every(p => indexes!.counter.contains(p))) layout.chopsticks.x = .54;
  }
  if (context && !curved) {
    const widthOnSide = (side: number) => Math.min(...[layout.bowl, layout.chopsticks].map(item => countertopWidth(context, localPoint(seat.grill, seat.angle, item.x * side, item.z))));
    if (widthOnSide(-1) > widthOnSide(1) + .001) { layout.bowl.x *= -1; layout.chopsticks.x *= -1; }
  }
  return layout;
}

export function localPoint(origin: Point, angle: number, x: number, z: number): Point {
  return { x: origin.x + Math.cos(angle) * x + Math.sin(angle) * z, z: origin.z - Math.sin(angle) * x + Math.cos(angle) * z };
}

export function rectangle(origin: Point, angle: number, width: number, depth: number, x = 0, z = 0): Point[] {
  return [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([a, b]) => localPoint(origin, angle, x + a * width, z + b * depth));
}

export function chairFootprint(seat: Pick<Seat, 'position' | 'angle'>): Point[] {
  // Seat extends to +.22; the .07-deep back centered on -.20 extends to -.235.
  return rectangle(seat.position, seat.angle, .46, .455, 0, -.0075);
}

export function pointInPolygon(p: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (segmentDistance(p, a, b) < 1e-8) return true;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonDistance(p: Point, polygon: Point[]) {
  if (pointInPolygon(p, polygon)) return 0;
  return Math.min(...polygon.map((q, i) => segmentDistance(p, q, polygon[(i + 1) % polygon.length])));
}

/** Separating-axis test for the convex furniture footprints and ribbon triangles. */
export function polygonsOverlap(a: Point[], b: Point[], tolerance = 1e-8) {
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], dx = q.x - p.x, dz = q.z - p.z;
    const length = Math.hypot(dx, dz); if (length < 1e-9) continue;
    const project = (points: Point[]) => points.map(r => (r.x * -dz + r.z * dx) / length);
    const pa = project(a), pb = project(b);
    if (Math.max(...pa) <= Math.min(...pb) + tolerance || Math.max(...pb) <= Math.min(...pa) + tolerance) return false;
  }
  return true;
}

export function diningFootprints(seat: Seat, track: Track, context?: CounterContext) {
  const layout = diningLayout(seat, track, context), center = localPoint(seat.grill, seat.angle, layout.bowl.x, layout.bowl.z);
  // A circumscribed polygon includes the whole circular bowl, not just its sampled chords.
  const radius = layout.bowl.radius / Math.cos(Math.PI / 32);
  return [
    { name: 'grill', polygon: rectangle(seat.grill, seat.angle, layout.grill.width, layout.grill.depth) },
    { name: 'bowl', polygon: Array.from({ length: 32 }, (_, i) => ({ x: center.x + Math.cos(i * Math.PI / 16) * radius, z: center.z + Math.sin(i * Math.PI / 16) * radius })) },
    { name: 'chopsticks', polygon: rectangle(seat.grill, seat.angle, layout.chopsticks.width, layout.chopsticks.depth, layout.chopsticks.x, layout.chopsticks.z) },
  ];
}

function bounds(polygon: Point[]) {
  return { minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)), minZ: Math.min(...polygon.map(p => p.z)), maxZ: Math.max(...polygon.map(p => p.z)) };
}

/** Matches restaurant.ts ribbon vertices exactly, including the sampled turn tangents. */
export function ribbonTriangles(track: Track, width: (point: Point) => number): Point[][] {
  const lut = track.arcLengthLut;
  const pairs = lut.map((at, i) => {
    const before = lut[i === 0 ? lut.length - 2 : i - 1], after = lut[i === lut.length - 1 ? 1 : i + 1];
    const angle = Math.atan2(after.x - before.x, after.z - before.z), half = width(at) / 2;
    return [-1, 1].map(side => ({ x: at.x + Math.cos(angle) * half * side, z: at.z - Math.sin(angle) * half * side }));
  });
  return pairs.slice(0, -1).flatMap((pair, i) => [[pair[0], pairs[i + 1][0], pair[1]], [pair[1], pairs[i + 1][0], pairs[i + 1][1]]]);
}

export class PolygonIndex {
  private cells = new Map<string, Point[][]>();
  constructor(polygons: Point[][], private grid = .50) {
    for (const polygon of polygons) {
      const b = bounds(polygon);
      for (let x = Math.floor(b.minX / grid); x <= Math.floor(b.maxX / grid); x++) for (let z = Math.floor(b.minZ / grid); z <= Math.floor(b.maxZ / grid); z++) {
        const key = `${x},${z}`, cell = this.cells.get(key) ?? []; cell.push(polygon); this.cells.set(key, cell);
      }
    }
  }
  contains(p: Point) { return (this.cells.get(`${Math.floor(p.x / this.grid)},${Math.floor(p.z / this.grid)}`) ?? []).some(polygon => pointInPolygon(p, polygon)); }
  within(p: Point, radius: number) {
    const checked = new Set<Point[]>();
    for (let x = Math.floor((p.x - radius) / this.grid); x <= Math.floor((p.x + radius) / this.grid); x++) for (let z = Math.floor((p.z - radius) / this.grid); z <= Math.floor((p.z + radius) / this.grid); z++) {
      for (const polygon of this.cells.get(`${x},${z}`) ?? []) if (!checked.has(polygon)) {
        checked.add(polygon); if (polygonDistance(p, polygon) < radius - 1e-6) return true;
      }
    }
    return false;
  }
  overlaps(polygon: Point[]) {
    const b = bounds(polygon), checked = new Set<Point[]>();
    for (let x = Math.floor(b.minX / this.grid); x <= Math.floor(b.maxX / this.grid); x++) for (let z = Math.floor(b.minZ / this.grid); z <= Math.floor(b.maxZ / this.grid); z++) {
      for (const candidate of this.cells.get(`${x},${z}`) ?? []) if (!checked.has(candidate)) {
        checked.add(candidate); if (polygonsOverlap(polygon, candidate)) return true;
      }
    }
    return false;
  }
}

/** Boundary plus interior samples prevent a supported bounding box from hiding a ribbon gap. */
export function footprintSamples(polygon: Point[], spacing = .025): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], n = Math.max(1, Math.ceil(distance(a, b) / spacing));
    for (let k = 0; k < n; k++) points.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  const b = bounds(polygon);
  for (let x = b.minX + spacing / 2; x < b.maxX; x += spacing) for (let z = b.minZ + spacing / 2; z < b.maxZ; z += spacing) if (pointInPolygon({ x, z }, polygon)) points.push({ x, z });
  return points;
}
