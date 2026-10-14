// Screen-space clockwise ellipse. Distances start at the right-hand entry.
export const FEATURED_COUNT = 10;
export const ORBIT_DURATION = 500;
export type OrbitSlot = { x: number; y: number; distance: number; size: number; featured: boolean };
export type Orbit = {
  cx: number; cy: number; rx: number; ry: number; length: number;
  samples: { distance: number; angle: number }[];
  slots: OrbitSlot[]; cardSize: number;
};
const mod = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;
export function orbitPoint(orbit: Orbit, distance: number) {
  const target = mod(distance, orbit.length);
  let low = 0, high = orbit.samples.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (orbit.samples[middle].distance < target) low = middle; else high = middle;
  }
  const a = orbit.samples[low], b = orbit.samples[high];
  const angle = a.angle + (b.angle - a.angle) * (target - a.distance) / (b.distance - a.distance);
  return { x: orbit.cx + orbit.rx * Math.cos(angle), y: orbit.cy + orbit.ry * Math.sin(angle) };
}
export function orbitFrame(orbit: Orbit, from: OrbitSlot, to: OrbitSlot, progress: number, direction = 1) {
  const distance = direction > 0
    ? mod(to.distance - from.distance, orbit.length)
    : -mod(from.distance - to.distance, orbit.length);
  // Shrink before joining the dense upper arc; grow only after clearing it.
  const growth = from.size < to.size ? progress ** 6 : 1 - (1 - progress) ** 6;
  return { ...orbitPoint(orbit, from.distance + distance * progress), size: from.size + (to.size - from.size) * growth };
}
export function createOrbit(count: number, width: number, height: number): Orbit {
  width = Math.max(1, width); height = Math.max(1, height);
  const cardSize = Math.max(1, Math.min(280, width * .18, height * .36));
  const inset = Math.max(1, Math.min(120, width * .075, height * .17));
  const orbit: Orbit = {
    cx: width / 2, cy: height / 2,
    rx: Math.max(1, width / 2 - inset), ry: Math.max(1, height / 2 - inset),
    samples: [{ distance: 0, angle: 0 }], length: 0, slots: [], cardSize,
  };
  let last = { x: orbit.rx, y: 0 };
  for (let i = 1; i <= 720; i++) {
    const angle = i * Math.PI / 360, point = { x: orbit.rx * Math.cos(angle), y: orbit.ry * Math.sin(angle) };
    // Spacing follows upright square footprints rather than uniform angles.
    orbit.length += Math.max(Math.abs(point.x - last.x), Math.abs(point.y - last.y));
    orbit.samples.push({ angle, distance: orbit.length }); last = point;
  }
  const focus = Math.min(count, FEATURED_COUNT), normal = count - focus;
  const featuredArc = orbit.length * .75;
  const compactArc = orbit.length - featuredArc;
  const exit = orbit.length * .625;
  const small = Math.min(cardSize * .25, compactArc / Math.max(1, normal) * .68);
  // Reserve the upper quarter for compact cards; the remaining arc and sides
  // give the ten featured cards room to grow. Increasing the carousel
  // index moves every dish one slot clockwise, including the first/last seam.
  orbit.slots = Array.from({ length: count }, (_, offset) => {
    const featured = offset < focus;
    const distance = featured ? mod(exit - (offset + .5) * featuredArc / focus, orbit.length) : orbit.length * .875 - (offset - focus + .5) * compactArc / normal;
    return { ...orbitPoint(orbit, distance), distance, size: featured ? cardSize : small, featured };
  });
  // Keep axis-aligned cards separate throughout a step, not just at rest.
  // A single scale preserves the ratio of the two sizes and square typography.
  let fit = Math.min(1, inset * 2 / cardSize);
  const gap = Math.min(12, width * .006);
  for (let frame = 0; frame <= 60; frame++) {
    const cards = orbit.slots.map((slot, i) => orbitFrame(orbit, slot, orbit.slots[mod(i - 1, count)], frame / 60));
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      fit = Math.min(fit, (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) - Math.min(gap, Math.min(a.size, b.size) * .12)) / ((a.size + b.size) / 2));
    }
  }
  fit = Math.max(.01, fit * .97);
  orbit.slots = orbit.slots.map(slot => ({ ...slot, size: slot.size * fit }));
  return orbit;
}
export function dishSlots(orbit: Orbit, start: number) {
  return orbit.slots.map((_, index) => orbit.slots[mod(index - start, orbit.slots.length)]);
}
export function slotTransform(slot: { x: number; y: number; size: number }, baseSize: number) {
  return `translate(${slot.x - slot.size / 2}px, ${slot.y - slot.size / 2}px) scale(${slot.size / baseSize})`;
}
