import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { kitchenMotion } from "./kitchen-motion";
import {
  box,
  capsule,
  cylinder,
  geo,
  group,
  mat,
  mesh,
  sphere,
  torus,
  C,
} from "./graphics";
const looks = [
  { skin: 0xe8b088, hair: 0x3c3029, shirt: 0xe5a744, pants: 0x546e66 },
  { skin: 0xf1c3a0, hair: 0x513328, shirt: 0x72998b, pants: 0x514a4d },
  { skin: 0xba8060, hair: 0x302b26, shirt: 0xc46d57, pants: 0x405968 },
  { skin: 0xf1c8a5, hair: 0x382c29, shirt: 0x8f91ad, pants: 0x4f6657 },
  { skin: 0xd9a179, hair: 0x76503a, shirt: 0xd5c394, pants: 0x647d7a },
  { skin: 0xe7b897, hair: 0xb09c7e, shirt: 0x6c899c, pants: 0x514b3f },
  { skin: 0xb67e59, hair: 0x2c2923, shirt: 0xd59c8c, pants: 0x7a6350 },
  { skin: 0xf0c6a3, hair: 0x694634, shirt: 0x869e60, pants: 0x3f655d },
];
export class Character {
  root = new T.Group();
  body = new T.Group();
  leftArm = new T.Group();
  rightArm = new T.Group();
  leftLeg = new T.Group();
  rightLeg = new T.Group();
  head = new T.Group();
  handFood = new T.Group();
  private kitchenTools: { knife: T.Group; ladle: T.Group; tongs: T.Group; plate: T.Group; food: T.Mesh } | undefined;
  private limbs: T.Group[] = [];
  private calves: T.Group[] = [];
  private phase = 0;
  private bakedGeometry:T.BufferGeometry[]=[];
  private isStaff = false;
  constructor(index: number, role: "guest" | "chef" | "server" = "guest") {
    const v = looks[index % looks.length],
      staff = role !== "guest";
    this.isStaff = staff;
    const shirt = staff ? (role === "chef" ? C.white : C.teal) : v.shirt;
    this.phase = index * 1.9;
    this.root.add(this.body);
    this.body.position.y = 0.74;
    const width = index % 3 === 0 ? 1.08 : index % 3 === 1 ? 0.94 : 1;
    const torso = capsule(this.body, 0.22, 0.29, shirt, 0, 0.2, 0);
    torso.scale.set(width, 1, 0.78);
    const belly = sphere(this.body, 0.24, shirt, 0, 0.09, 0.035, 1, 1, 0.8);
    belly.scale.x *= width;
    cylinder(this.body, 0.09, 0.1, 0.1, v.skin, 0, 0.49, 0);
    this.head = group(this.body, 0, 0.73, 0);
    sphere(this.head, 0.275, v.skin, 0, 0, 0, 1, 1.09, 0.96);
    sphere(this.head, 0.066, v.skin, -0.263, -0.02, 0, 0.65, 1, 0.65);
    sphere(this.head, 0.066, v.skin, 0.263, -0.02, 0, 0.65, 1, 0.65);
    sphere(this.head, 0.05, v.skin, 0, -0.025, 0.258, 0.9, 0.85, 1.2);
    for (const x of [-0.092, 0.092]) {
      sphere(this.head, 0.027, 0x352f28, x, 0.035, 0.245, 0.75, 1.16, 0.55);
      sphere(this.head, 0.01, 0xffffff, x - 0.005, 0.044, 0.26);
      sphere(this.head, 0.034, 0xdb987c, x * 1.65, -0.073, 0.217, 1, 0.4, 0.35);
    }
    const smile = mesh(
      this.head,
      geo(
        "smile",
        () => new T.TorusGeometry(0.055, 0.009, 5, 12, Math.PI * 0.7),
      ),
      mat(0x986552),
      0.017,
      -0.072,
      0.258,
      false,
    );
    smile.rotation.z = Math.PI * 1.15;
    const hair = mesh(
      this.head,
      geo(
        "haircap",
        () =>
          new T.SphereGeometry(
            0.282,
            16,
            10,
            0,
            Math.PI * 2,
            0,
            Math.PI * 0.55,
          ),
      ),
      mat(v.hair),
      0,
      0.032,
      -0.025,
    );
    hair.rotation.x = -0.17;
    for (let i = 0; i < 3; i++)
      sphere(
        this.head,
        0.108,
        v.hair,
        -0.15 + i * 0.105,
        0.19 - i * 0.01,
        0.15,
        0.95,
        0.7,
        0.7,
      );
    if (index % 4 === 1) {
      sphere(this.head, 0.14, v.hair, 0, 0.08, -0.26, 1, 1.4, 1);
      sphere(this.head, 0.06, C.coral, 0, 0.18, -0.27);
    }
    if (index % 4 === 2 && !staff) {
      for (const x of [-0.094, 0.094]) {
        const glass = torus(this.head, 0.061, 0.009, 0x72513d, x, 0.035, 0.264);
        glass.rotation.x = 0;
      }
      box(this.head, 0.06, 0.012, 0.015, 0x72513d, 0, 0.04, 0.271, 0.003);
    }
    if (role === "chef") {
      cylinder(this.head, 0.225, 0.24, 0.17, C.white, 0, 0.31, 0);
      for (const [x, z] of [
        [0, 0],
        [-0.13, 0],
        [0.13, 0],
        [0, 0.12],
        [0, -0.1],
      ])
        sphere(this.head, 0.153, C.white, x, 0.42, z, 1, 0.88, 1);
    }
    if (role === "server") {
      cylinder(this.head, 0.28, 0.25, 0.09, C.coral, 0, 0.23, 0);
      box(this.head, 0.35, 0.035, 0.18, C.coral, 0, 0.21, 0.22);
    }
    if (staff) {
      box(
        this.body,
        0.31,
        0.47,
        0.035,
        role === "chef" ? 0xe5d9bb : 0xd9b98a,
        0,
        0.13,
        0.205,
      );
      box(
        this.body,
        0.17,
        0.12,
        0.015,
        role === "chef" ? C.white : 0xcbaa7a,
        0,
        0.09,
        0.23,
      );
      box(this.body, 0.022, 0.39, 0.025, C.white, -0.13, 0.34, 0.2);
      box(this.body, 0.022, 0.39, 0.025, C.white, 0.13, 0.34, 0.2);
    } else {
      box(this.body, 0.07, 0.055, 0.018, C.white, -0.1, 0.29, 0.191, 0.01);
    }
    this.leftArm = group(this.body, -0.267, 0.35, 0);
    this.rightArm = group(this.body, 0.267, 0.35, 0);
    this.limbs = [this.leftArm, this.rightArm];
    for (const [i, arm] of this.limbs.entries()) {
      capsule(arm, 0.084, 0.11, shirt, 0, -0.1, 0);
      const fore = group(arm, 0, -0.19, 0);
      capsule(fore, 0.065, 0.1, v.skin, 0, -0.075, 0.015);
      sphere(fore, 0.079, v.skin, 0, -0.155, 0.016, 0.8, 1, 1);
      if (i === 1) {
        if (role === "guest") {
          const stick = box(
            fore,
            0.014,
            0.27,
            0.014,
            0x674c30,
            0.025,
            -0.16,
            0.055,
            0.002,
          );
          stick.rotation.x = 0.6;
          const stick2 = box(
            fore,
            0.014,
            0.27,
            0.014,
            0x674c30,
            -0.016,
            -0.16,
            0.055,
            0.002,
          );
          stick2.rotation.x = 0.6;
        } else if (role === "chef") {
          const knife = group(fore), ladle = group(fore), tongs = group(fore), plate = group(this.leftArm.children[1]);
          box(knife, 0.035, 0.15, 0.04, 0x68563e, 0, -0.2, 0.02);
          box(knife, 0.18, 0.24, 0.025, 0xd8ddca, 0.03, -0.33, 0.02, 0.008);
          box(ladle, 0.025, 0.34, 0.025, 0x8b7e5e, 0, -0.25, 0.02);
          sphere(ladle, 0.077, C.steel, 0, -0.44, 0.03, 1, 0.4, 1);
          for(const x of [-.035,.035])box(tongs,.02,.32,.025,C.steel,x,-.26,.04,.004);
          const food=sphere(tongs,.055,C.coral,0,-.435,.04,1,.65,1);
          plate.position.set(0,-.34,.04);
          cylinder(plate,.19,.16,.033,C.cream);
          torus(plate,.17,.012,C.white,0,.022,0);
          for(let j=0;j<4;j++)sphere(plate,.045,j%2?0x85a361:0xe7ad75,(j%2-.5)*.14,.042,(Math.floor(j/2)-.5)*.12,1,.5,1);
          this.kitchenTools = { knife, ladle, tongs, plate, food };
        }
        fore.add(this.handFood);
        this.handFood.position.set(0, -0.255, 0.1);
        sphere(this.handFood, 0.052, 0xefaa6d);
        this.handFood.visible = false;
      }
    }
    this.leftLeg = group(this.body, -0.115, -0.08, 0);
    this.rightLeg = group(this.body, 0.115, -0.08, 0);
    for (const leg of [this.leftLeg, this.rightLeg]) {
      capsule(leg, 0.092, 0.16, staff ? 0x4a5a50 : v.pants, 0, -0.1, 0);
      const calf = group(leg, 0, -0.23, 0);
      capsule(calf, 0.078, 0.15, staff ? 0x4a5a50 : v.pants, 0, -0.095, 0);
      box(calf, 0.17, 0.105, 0.27, 0x4d4438, 0, -0.245, 0.053, 0.04);
      box(calf, 0.18, 0.028, 0.275, 0xece3cc, 0, -0.29, 0.054, 0.01);
      this.calves.push(calf);
    }
    // Tiny facial geometry does not need independent shadow passes.
    this.head.traverse((o) => {
      if (
        o instanceof T.Mesh &&
        o.geometry === geo("sphere", () => new T.SphereGeometry())
      )
        o.castShadow = o.scale.x > 0.15;
    });
    // Batch rigid pieces inside each bone only; retain limb and tool animation roots.
    const bones:T.Object3D[]=[];this.root.traverse(o=>{if(o instanceof T.Group)bones.push(o);});
    for(const bone of bones){
      const batches=new Map<string,{material:T.Material;meshes:T.Mesh[]}>();
      for(const o of bone.children){
        if(!(o instanceof T.Mesh)||Array.isArray(o.material)||o===this.kitchenTools?.food)continue;
        const key=o.material.uuid+'/'+o.castShadow+'/'+o.receiveShadow;
        let batch=batches.get(key);if(!batch){batch={material:o.material,meshes:[]};batches.set(key,batch);}batch.meshes.push(o);
      }
      for(const {material,meshes}of batches.values()){
        if(meshes.length<2)continue;
        const pieces=meshes.map(o=>{o.updateMatrix();const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();return g.applyMatrix4(o.matrix);});
        const geometry=mergeGeometries(pieces);pieces.forEach(g=>g.dispose());if(!geometry)throw Error('Character batching failed');
        this.bakedGeometry.push(geometry);const merged=new T.Mesh(geometry,material);merged.castShadow=meshes[0].castShadow;merged.receiveShadow=meshes[0].receiveShadow;
        meshes.forEach(o=>o.removeFromParent());bone.add(merged);
      }
    }
  }
  dispose(){this.bakedGeometry.forEach(g=>g.dispose());this.bakedGeometry=[];}
  animate(
    time: number,
    moving: boolean,
    seated: boolean,
    take = 0,
    role = "guest",
  ) {
    if (this.kitchenTools) {
      this.kitchenTools.knife.visible = role === "chop";
      this.kitchenTools.ladle.visible = (role === "cook" || role === "mix");
      this.kitchenTools.tongs.visible = role === "plate";
      this.kitchenTools.plate.visible = role === "plate";
    }
    const t = time * 5.6 + this.phase;
    this.body.position.y = seated
      ? 0.72
      : 0.74 +
        (moving
          ? Math.abs(Math.sin(t)) * 0.037
          : Math.sin(time * 2 + this.phase) * 0.009);
    this.body.rotation.z = moving ? Math.sin(t) * 0.024 : 0;
    this.leftLeg.rotation.x = seated
      ? -Math.PI / 2
      : moving
        ? Math.sin(t) * 0.43
        : 0;
    this.rightLeg.rotation.x = seated
      ? -Math.PI / 2
      : moving
        ? -Math.sin(t) * 0.43
        : 0;
    this.calves.forEach(
      (c, i) =>
        (c.rotation.x = seated
          ? Math.PI / 2
          : moving
            ? Math.max(0, Math.sin(t + (i ? 0 : Math.PI))) * 0.38
            : 0),
    );
    this.head.rotation.y = Math.sin(time * 0.7 + this.phase) * 0.09;
    this.head.rotation.x = seated ? 0.09 : 0;
    this.leftArm.rotation.set(
      seated ? -0.65 : moving ? -Math.sin(t) * 0.35 : -0.12,
      0,
      seated ? 0.12 : 0.05,
    );
    this.rightArm.rotation.set(
      seated
        ? -0.7 + Math.sin(time * 2 + this.phase) * 0.15
        : moving
          ? Math.sin(t) * 0.35
          : -0.12,
      0,
      -0.06,
    );
    if (seated) {
      this.rightArm.rotation.x =
        take > 0
          ? -1.2 - Math.sin((1.15 - take) * 3) * 0.6
          : -0.9 + Math.sin(time * 1.6 + this.phase) * 0.27;
      this.head.rotation.x += Math.sin(time * 4 + this.phase) * 0.025;
    }
    if (this.isStaff && !moving) {
      this.rightArm.rotation.x =
        -1.0 +
        Math.sin(time * (role === "chop" ? 8 : 3) + this.phase) *
          (role === "chop" ? 0.6 : 0.4);
      this.leftArm.rotation.x = -1.05 + Math.sin(time * 3 + this.phase) * 0.16;
      this.head.rotation.x = 0.16;
    }
    if ((role === "cook" || role === "mix")) {
      this.rightArm.rotation.x = -1.18 + Math.sin(time * 2.5) * 0.12;
      this.rightArm.rotation.z = Math.cos(time * 2.5) * 0.17;
    }
    if (role === "fetch" && !moving) {
      this.rightArm.rotation.x = -1.5 + Math.sin(time * 2.8) * 0.38;
      this.body.rotation.x = Math.sin(time * 2.8) * 0.06;
    } else this.body.rotation.x = 0;
    if (role === "plate" && !moving) {
      this.leftArm.rotation.x = -1.3;
      this.rightArm.rotation.y = Math.sin(time * 2.2) * 0.32;
      this.rightArm.rotation.x = -1.25 + Math.sin(time * 4.4) * 0.2;
    }
    if(this.kitchenTools && !moving && ['chop','cook','mix','plate'].includes(role)){
      const pose=kitchenMotion(time,role,this.phase);
      this.rightArm.rotation.set(pose.rightX,pose.rightY,pose.rightZ);
      this.leftArm.rotation.set(pose.leftX,pose.leftY,.06);
      this.body.rotation.x=pose.lean;this.head.rotation.x=pose.head;
      this.kitchenTools.food.visible=pose.food;
      // Keep the held serving plate level as the forearm reaches forward.
      this.kitchenTools.plate.rotation.set(-pose.leftX-pose.lean,0,0);
    }
    this.handFood.visible = take > 0.1;
  }
}
