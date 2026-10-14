import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cylinder, mat } from './graphics';
import { Interior } from './interior';
import { positionAt, type SceneManifest, type Track, type Point } from './demo/layout';
import { countertopWidth, diningLayout } from './demo/dining';

function ribbon(track:Track,width:(point:Point)=>number,y:number,color:number) {
 const vertices:number[]=[],indices:number[]=[],lut=track.arcLengthLut;
 for(let i=0;i<lut.length;i++){
  const at=lut[i],before=lut[i===0?lut.length-2:i-1],after=lut[i===lut.length-1?1:i+1];
  const angle=Math.atan2(after.x-before.x,after.z-before.z),half=width(at)/2;
  for(const side of [-1,1])vertices.push(at.x+Math.cos(angle)*half*side,y,at.z-Math.sin(angle)*half*side);
  if(i<lut.length-1){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
 const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({color,roughness:.7,side:T.DoubleSide}));mesh.receiveShadow=true;mesh.castShadow=true;return mesh;
}
export class Restaurant {
 root=new T.Group();
 private slats:{track:Track;mesh:T.InstancedMesh;count:number}[]=[];
 private matrix=new T.Object3D();
 readonly interior:Interior;
 constructor(readonly manifest:SceneManifest){
  const m=manifest,w=m.floor.max.x,h=m.floor.max.z;
  box(this.root,w,.18,h,0xd2c6ad,w/2,-.10,h/2,.04);
  box(this.root,w-.12,.03,h-.12,0xe9e3d5,w/2,0,h/2,.01);
  for(let x=0;x<w;x+=1){const line=box(this.root,.014,.008,h-.1,0xdad3c5,x,.018,h/2,0);line.castShadow=false;}
  for(let z=0;z<h;z+=1){const line=box(this.root,w-.1,.008,.014,0xdad3c5,w/2,.018,z,0);line.castShadow=false;}
  box(this.root,m.kitchen.max.x,.025,m.kitchen.max.z,0xc5d3c9,m.kitchen.max.x/2,.025,m.kitchen.max.z/2,.01);
  for(const wall of m.walls){const dx=wall.to.x-wall.from.x,dz=wall.to.z-wall.from.z;const height=wall.wallId==='wall-2'?2.25:wall.wallId==='wall-1'||wall.wallId==='wall-3'?.85:1.7;
   const mesh=box(this.root,Math.hypot(dx,dz),height,wall.thicknessM,0xd9c5a3,(wall.from.x+wall.to.x)/2,height/2,(wall.from.z+wall.to.z)/2,.02);mesh.rotation.y=-Math.atan2(dz,dx);
   const cap=box(this.root,Math.hypot(dx,dz),.07,wall.thicknessM+.035,0x416153,mesh.position.x,height,mesh.position.z,.02);cap.rotation.y=mesh.rotation.y;
  }
  for(const t of m.tracks){
   const counterWidth=(p:Point)=>countertopWidth(m,p);
   this.root.add(ribbon(t,counterWidth,.92,0x493e33));
   this.root.add(ribbon(t,p=>counterWidth(p)+.04,.89,0x251f1a));
   this.root.add(ribbon(t,()=>.46,.944,0x8c8c7c));
   this.root.add(ribbon(t,()=>.37,.955,t.enabled?0xf3eee0:0xd2d5ce));
   // Continuous sealed cabinet, inset from the countertop for seated knee clearance.
   const lut=t.arcLengthLut,vertices:number[]=[],indices:number[]=[];
   for(let i=0;i<lut.length;i++){
    const at=lut[i],before=lut[i===0?lut.length-2:i-1],after=lut[i===lut.length-1?1:i+1];
    const angle=Math.atan2(after.x-before.x,after.z-before.z),half=Math.max(.23,counterWidth(at)/2-.13);
    for(const side of [-1,1])for(const y of [.06,.89])vertices.push(at.x+Math.cos(angle)*half*side,y,at.z-Math.sin(angle)*half*side);
    if(i<lut.length-1){const k=i*4;for(const o of [0,2])indices.push(k+o,k+o+4,k+o+1,k+o+1,k+o+4,k+o+5);indices.push(k,k+2,k+4,k+2,k+6,k+4);}
   }
   const body=new T.BufferGeometry();body.setAttribute('position',new T.Float32BufferAttribute(vertices,3));body.setIndex(indices);body.computeVertexNormals();
   const cabinet=new T.Mesh(body,new T.MeshStandardMaterial({color:0x657467,roughness:.85,side:T.DoubleSide}));cabinet.castShadow=true;cabinet.receiveShadow=true;this.root.add(cabinet);
   const count=Math.ceil(t.lengthM/.16),slats=new T.InstancedMesh(new T.BoxGeometry(.35,.012,.012),mat(t.enabled?0xb5b4a5:0x9daca3),count);this.slats.push({track:t,mesh:slats,count});this.root.add(slats);
  }
  for(const seat of m.seats){
   const layout=diningLayout(seat,m.tracks.find(t=>t.trackId===seat.trackId)!,m);
   const setting=new T.Group();setting.position.set(seat.position.x,0,seat.position.z);setting.rotation.y=seat.angle;this.root.add(setting);
   box(setting,.46,.13,.44,seat.trackId==='track-main'?0x8d542f:0x727568,0,.62,0,.075);
   box(setting,.46,.34,.07,seat.trackId==='track-main'?0xa96d43:0x888d7c,0,.86,-.20,.04);
   for(const x of [-.16,.16])for(const z of [-.15,.15])box(setting,.045,.59,.045,0x343a32,x,.295,z,.01);
   const grill=new T.Group();grill.position.set(seat.grill.x,.939,seat.grill.z);grill.rotation.y=seat.angle;this.root.add(grill);
   box(grill,layout.grill.width,.026,layout.grill.depth,0x99998a,0,0,0,.035);box(grill,layout.grill.innerWidth,.033,layout.grill.innerDepth,0x252c29,0,.016,0,.015);
   for(let x=-.19;x<=.2;x+=.045)box(grill,.012,.015,layout.grill.barDepth,0x67695c,x,.039,0,.003);
   cylinder(grill,layout.bowl.radius,layout.bowl.radius,.018,0xf4ead3,layout.bowl.x,.025,layout.bowl.z);box(grill,layout.chopsticks.width,.012,layout.chopsticks.depth,0x8b6540,layout.chopsticks.x,.04,layout.chopsticks.z,.001);
  }
  const facility=(rect:typeof m.sauce,height:number,color:number)=>box(this.root,rect.max.x-rect.min.x,height,rect.max.z-rect.min.z,color,(rect.min.x+rect.max.x)/2,height/2,(rect.min.z+rect.max.z)/2,.06);
  facility(m.drinks,.94,0x6d5742);facility(m.sauce,.88,0x567360);
  this.interior=new Interior(m);this.root.add(this.interior.scenery);
  // Bake static fixtures by shared material to avoid hundreds of individual draw calls.
  this.root.updateMatrixWorld(true);
  const batches=new Map<string,{material:T.Material;geometries:T.BufferGeometry[];meshes:T.Mesh[];cast:boolean;receive:boolean}>();
  this.root.traverse(o=>{if(!(o instanceof T.Mesh)||o instanceof T.InstancedMesh||Array.isArray(o.material))return;const key=o.material.uuid+'/'+o.castShadow+'/'+o.receiveShadow;let batch=batches.get(key);if(!batch){batch={material:o.material,geometries:[],meshes:[],cast:o.castShadow,receive:o.receiveShadow};batches.set(key,batch);}const geometry=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();geometry.applyMatrix4(o.matrixWorld);batch.geometries.push(geometry);batch.meshes.push(o);});
  for(const batch of batches.values()){if(batch.geometries.length<2){batch.geometries.forEach(g=>g.dispose());continue;}const merged=mergeGeometries(batch.geometries);batch.geometries.forEach(g=>g.dispose());if(!merged)throw Error('Static geometry merge failed');const mesh=new T.Mesh(merged,batch.material);mesh.castShadow=batch.cast;mesh.receiveShadow=batch.receive;batch.meshes.forEach(o=>o.removeFromParent());this.root.add(mesh);}
  this.root.add(this.interior.actors);
  this.update(0);
 }
 update(simTimeMs:number,staff:readonly {position:Point}[]=[]){this.interior.update(simTimeMs,staff);for(const {track,mesh,count} of this.slats){for(let i=0;i<count;i++){const p=positionAt(track,i*track.lengthM/count,simTimeMs);this.matrix.position.set(p.x,.966,p.z);this.matrix.rotation.set(0,p.angle,0);this.matrix.updateMatrix();mesh.setMatrixAt(i,this.matrix.matrix);}mesh.instanceMatrix.needsUpdate=true;}}
}
