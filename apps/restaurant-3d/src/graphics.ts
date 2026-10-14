import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
const materials = new Map<string, T.MeshStandardMaterial>();
const geometries = new Map<string, T.BufferGeometry>();
export const C = {
  cream: 0xfff3d5,
  wall: 0xeadab8,
  teal: 0x437c74,
  darkTeal: 0x315f58,
  coral: 0xd57350,
  rust: 0xb55438,
  wood: 0xc4935e,
  dark: 0x3d4237,
  gold: 0xd3aa57,
  steel: 0x99b3aa,
  white: 0xfff8e5,
};
export function mat(color: number, roughness = 0.75, metalness = 0) {
  const key = [color, roughness, metalness].join("/");
  if (!materials.has(key))
    materials.set(
      key,
      new T.MeshStandardMaterial({ color, roughness, metalness }),
    );
  return materials.get(key)!;
}
export function geo(key: string, make: () => T.BufferGeometry) {
  if (!geometries.has(key)) geometries.set(key, make());
  return geometries.get(key)!;
}
export function mesh(
  parent: T.Object3D,
  g: T.BufferGeometry,
  m: T.Material,
  x = 0,
  y = 0,
  z = 0,
  shadow = true,
) {
  const o = new T.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
export function box(
  p: T.Object3D,
  w: number,
  h: number,
  d: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
  r = 0.04,
) {
  return mesh(
    p,
    geo(`b${w}/${h}/${d}/${r}`, () =>
      r
        ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2))
        : new T.BoxGeometry(w, h, d),
    ),
    mat(color),
    x,
    y,
    z,
  );
}
export function sphere(
  p: T.Object3D,
  r: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
  sx = 1,
  sy = 1,
  sz = 1,
) {
  const o = mesh(
    p,
    geo("sphere", () => new T.SphereGeometry(1, 16, 12)),
    mat(color),
    x,
    y,
    z,
  );
  o.scale.set(r * sx, r * sy, r * sz);
  return o;
}
export function cylinder(
  p: T.Object3D,
  rt: number,
  rb: number,
  h: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
) {
  return mesh(
    p,
    geo(`c${rt}/${rb}/${h}`, () => new T.CylinderGeometry(rt, rb, h, 24)),
    mat(color),
    x,
    y,
    z,
  );
}
export function torus(
  p: T.Object3D,
  r: number,
  tube: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
) {
  const o = mesh(
    p,
    geo(`t${r}/${tube}`, () => new T.TorusGeometry(r, tube, 6, 24)),
    mat(color),
    x,
    y,
    z,
  );
  o.rotation.x = Math.PI / 2;
  return o;
}
export function capsule(
  p: T.Object3D,
  r: number,
  len: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
) {
  return mesh(
    p,
    geo(`cap${r}/${len}`, () => new T.CapsuleGeometry(r, len, 3, 10)),
    mat(color),
    x,
    y,
    z,
  );
}
export function group(parent: T.Object3D, x = 0, y = 0, z = 0) {
  const g = new T.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
export function canvasTexture(
  w: number,
  h: number,
  draw: (c: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const t = new T.CanvasTexture(canvas);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
export function label(
  p: T.Object3D,
  text: string,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  bg = "#fff1cf",
  fg = "#3a6255",
  fontSize = 75,
) {
  const texture = canvasTexture(1024, 256, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, 1024, 256);
    c.fillStyle = fg;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = `700 ${fontSize}px "Microsoft YaHei", sans-serif`;
    c.fillText(text, 512, 130);
  });
  return mesh(
    p,
    new T.PlaneGeometry(w, h),
    new T.MeshStandardMaterial({ map: texture, roughness: 1 }),
    x,
    y,
    z,
    false,
  );
}
// Merge only the static scenery. Animation nodes and transparent effects stay separate.
export function batchStatic(root: T.Group) {
  root.updateMatrixWorld(true);
  const buckets = new Map<T.Material, T.BufferGeometry[]>();
  root.traverse((o) => {
    if (o instanceof T.Mesh && !Array.isArray(o.material)) {
      const g = (
        o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
      ).applyMatrix4(o.matrixWorld);
      g.deleteAttribute("uv1");
      const list = buckets.get(o.material) || [];
      list.push(g);
      buckets.set(o.material, list);
    }
  });
  root.clear();
  for (const [material, parts] of buckets) {
    const merged = mergeGeometries(parts, false);
    if (merged) {
      const m = new T.Mesh(merged, material);
      m.castShadow = true;
      m.receiveShadow = true;
      root.add(m);
    }
    parts.forEach((p) => p.dispose());
  }
}
export function steamTexture(strength = 1) {
  return canvasTexture(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 31);
    g.addColorStop(0, `rgba(255,255,250,${Math.min(1, 0.5 * strength)})`);
    g.addColorStop(0.4, `rgba(255,255,250,${Math.min(1, 0.22 * strength)})`);
    g.addColorStop(1, "rgba(255,255,245,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });
}
