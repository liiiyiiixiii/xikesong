import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Dish} from '@zhishan/contracts/demo-v1';
export const foodShapes=new Set(['strip','tongue','rib','broccoli','slice','belly','chunk','shrimp','sausage','vegetable','mushroom','cube','snack','cake','fruit','wing','ring','tentacle','shell','fish','ball','stick','disc','wedge','corn','lotus','enoki','roll','burger','fries','tart','pizza','swiss','puff','waffle','brownie','pudding','bowl','strawberry','pod','watermelon','grape']);
const materials=new Map<number,T.MeshStandardMaterial>();
function mat(color:number){if(!materials.has(color))materials.set(color,new T.MeshStandardMaterial({color,roughness:.78}));return materials.get(color)!;}
/** Four serving clusters, each batched by material. Recipe geometry remains inside a 32cm plate. */
export function createFoodModel(dish:Pick<Dish,'dishId'|'visual'>){
 const root=new T.Group(),v=dish.visual??{shape:'chunk',color:0xb96b49,variant:1};root.name=dish.dishId;root.userData.recipe=v;
 for(let part=0;part<4;part++){
  const g=new T.Group();g.position.set((part%2?1:-1)*.054,0,(part<2?1:-1)*.052);g.rotation.y=(v.variant*.33+part*.7)%(Math.PI*2);root.add(g);
  const add=(geometry:T.BufferGeometry,color:number,x=0,y=.022,z=0,rx=0,ry=0,rz=0)=>{const mesh=new T.Mesh(geometry,mat(color));mesh.position.set(x,y,z);mesh.rotation.set(rx,ry,rz);g.add(mesh);return mesh;};
  const box=(w:number,h:number,d:number,c=v.color,x=0,y=h/2,z=0)=>add(new T.BoxGeometry(w,h,d),c,x,y,z);
  const ball=(r:number,c=v.color,x=0,y=r,z=0)=>add(new T.SphereGeometry(r,10,7),c,x,y,z);
  const disc=(r:number,h:number,c=v.color,x=0,y=h/2,z=0)=>add(new T.CylinderGeometry(r,r,h,12),c,x,y,z);
  const ring=(r:number,t:number,c=v.color,x=0,y=t,z=0,arc=Math.PI*2)=>add(new T.TorusGeometry(r,t,5,16,arc),c,x,y,z,Math.PI/2);
  switch(v.shape){
   case 'slice':case 'belly':{for(let i=0;i<2;i++){const m=ball(.039,v.color,(i-.5)*.025,.013+i*.008,(i-.5)*.025);m.scale.set(1,.24,.63);for(let k=0;k<(v.shape==='belly'?3:2);k++)box(.054,.0025,.003,0xf2d5bd,(i-.5)*.025,.023+i*.008,(k-1)*.011+(i-.5)*.025);}break;}
   case 'strip':for(let i=0;i<3;i++){box(.019,.016,.069,v.color,(i-1)*.025,.008,0);box(.004,.002,.064,0xf0d1ac,(i-1)*.025,.017,0);}break;
   case 'tongue':for(let i=0;i<2;i++){const m=ball(.032,v.color,(i-.5)*.03,.01,(i-.5)*.025);m.scale.set(.75,.23,1.25);box(.002,.001,.043,0xe2a7a0,(i-.5)*.03,.018,(i-.5)*.025);}break;
   case 'rib':for(let i=0;i<2;i++){box(.028,.028,.063,v.color,(i-.5)*.039,.014,0);box(.009,.009,.082,0xefdbaf,(i-.5)*.039,.016,0);}break;
   case 'broccoli':for(let i=0;i<3;i++){const x=(i-1)*.026,z=(i%2-.5)*.026;box(.008,.027,.009,0xa2be69,x,.014,z);for(let k=0;k<4;k++)ball(.014,v.color,x+Math.sin(k*2)*.01,.033,z+Math.cos(k*2)*.01);}break;
   case 'shrimp':ring(.025,.012,v.color,0,.017,0,Math.PI*1.55);box(.027,.01,.018,0xcd775e,.026,.018,-.021);for(let k=0;k<4;k++)box(.008,.002,.027,0xf7c5a9,-.025+k*.012,.03,0);break;
   case 'ring':ring(.027,.009);ring(.023,.008,v.color,.014,.023,.017);break;
   case 'tentacle':for(let i=0;i<4;i++){const m=ring(.019,.006,v.color,(i-1.5)*.018,.008,0,Math.PI*1.4);m.rotation.z=i*.2;}ball(.025,v.color,0,.028,-.023);break;
   case 'shell':{const m=ball(.044,0x586f61,0,.013,0);m.scale.set(1,.22,.8);const n=ball(.033,0xf4cba1,0,.023,0);n.scale.y=.3;ball(.015,0xe9a261,0,.034,0);break;}
   case 'fish':{const b=ball(.04,0xa2a697);b.scale.set(.4,.35,1.35);add(new T.ConeGeometry(.021,.035,3),0x7b8c86,0,.015,.05,Math.PI/2);ball(.003,0x222b23,.009,.029,-.029);break;}
   case 'sausage':case 'stick':case 'fries':case 'enoki':{const n=v.shape==='enoki'?9:v.shape==='fries'?6:3;for(let i=0;i<n;i++){const x=(i%3-1)*.019,z=(Math.floor(i/3)-1)*.016;if(v.shape==='sausage'){const m=ball(.015,v.color,x,.016,z);m.scale.z=2.2;box(.002,.002,.025,0xe5b082,x,.029,z);}else {box(v.shape==='enoki'?.004:.013,.012,.067,v.shape==='enoki'?0xeee1be:v.color,x,.008,z);if(v.shape==='enoki')ball(.008,0xf5e9d0,x,.012,z-.035);}}break;}
   case 'vegetable':for(let i=0;i<5;i++){const b=ball(.031,v.color,(i%3-1)*.021,.009+(i%2)*.012,(i%2-.5)*.032);b.scale.set(.8,.23,1.3);box(.003,.002,.045,0xc4d698,(i%3-1)*.021,.018+(i%2)*.012,(i%2-.5)*.032);}break;
   case 'mushroom':for(let i=0;i<2;i++){disc(.009,.026,0xe5d3b3,(i-.5)*.042,.013,0);const cap=ball(.029,v.color,(i-.5)*.042,.03,0);cap.scale.y=.42;box(.026,.002,.002,0xf0dfc2,(i-.5)*.042,.043,0);}break;
   case 'disc':case 'lotus':for(let i=0;i<2;i++){disc(.034,.012,v.color,(i-.5)*.022,.006+i*.01,(i-.5)*.022);if(v.shape==='lotus')for(let k=0;k<6;k++){const a=k*Math.PI/3;disc(.004,.001,0x9f895f,(i-.5)*.022+Math.cos(a)*.018,.013+i*.01,(i-.5)*.022+Math.sin(a)*.018);}}break;
   case 'corn':disc(.026,.046,0xe8be4f);for(let row=0;row<3;row++)for(let k=0;k<8;k++){const a=k*Math.PI/4;ball(.007,0xf3d369,Math.cos(a)*.025,.008+row*.014,Math.sin(a)*.025);}break;
   case 'wing':{const m=ball(.033,v.color,-.013,.021,0);m.scale.z=1.3;const n=ball(.021,v.color,.028,.013,.025);n.scale.x=1.4;break;}
   case 'ball':case 'puff':case 'pod':for(let i=0;i<3;i++){const b=ball(.023,v.shape==='puff'?0xd5a366:v.color,(i-1)*.025,.022,(i%2-.5)*.027);if(v.shape==='pod')b.scale.set(.65,.8,1.25);if(v.shape==='puff')disc(.016,.005,0xffeed4,(i-1)*.025,.018,(i%2-.5)*.027);}break;
   case 'burger':disc(.033,.014,0xc58638,0,.007);disc(.034,.008,0x689145,0,.018);disc(.032,.009,0x784b30,0,.026);{const b=ball(.034,0xe1af67,0,.035);b.scale.y=.55;}for(let k=0;k<5;k++)box(.003,.002,.006,0xf9e6b9,Math.sin(k*2)*.02,.053,Math.cos(k*2)*.02);break;
   case 'pizza':case 'wedge':case 'watermelon':{const color=v.shape==='watermelon'?0xe65354:v.color;add(new T.CylinderGeometry(.045,.045,.016,3),color);if(v.shape==='watermelon'){add(new T.CylinderGeometry(.047,.047,.008,3),0x689044,0,.01);for(let i=0;i<4;i++)ball(.0025,0x54382c,(i-1.5)*.01,.032,0);}if(v.shape==='pizza'){for(let i=0;i<3;i++)ball(.011,0xf4d887,(i-1)*.018,.036,0);}break;}
   case 'roll':case 'swiss':{const b=disc(.026,.066,v.shape==='swiss'?0xd7b07b:v.color);b.rotation.x=Math.PI/2;b.position.y=.028;if(v.shape==='swiss'){ring(.015,.005,0xfff0d7,0,.028,.034).rotation.x=0;ball(.006,0xe8b899,0,.028,.035);}break;}
   case 'waffle':box(.068,.018,.065,0xd6a452);for(let x=0;x<3;x++)for(let z=0;z<3;z++)box(.012,.001,.012,0xa97332,(x-1)*.019,.019,(z-1)*.019);ball(.012,0xd65d57,.021,.024,.019);break;
   case 'tart':disc(.035,.022,0xc98e43);disc(.027,.006,0xf3cb59,0,.025);ball(.007,0x9e5a30,.011,.029,.006);break;
   case 'cake':case 'brownie':box(.06,.042,.057,v.shape==='brownie'?0x62402e:0xefcb89);box(.061,.008,.058,v.shape==='brownie'?0x442a23:0xffeaca,0,.046);ball(.008,0xce5040,0,.056,0);break;
   case 'pudding':disc(.034,.012,0xefefda,0,.006);add(new T.CylinderGeometry(.027,.032,.035,12),0xf4c158,0,.03);break;
   case 'bowl':disc(.036,.025,0xf5ece2,0,.0125);disc(.03,.003,0xf6e8d7,0,.027);for(let k=0;k<8;k++)ball(.004,0xc9c3a8,Math.sin(k*2)*.02,.03,Math.cos(k*2)*.02);break;
   case 'strawberry':for(let i=0;i<3;i++){add(new T.ConeGeometry(.019,.036,10),0xd83d3d,(i-1)*.026,.019,(i%2-.5)*.026,0,0,Math.PI);disc(.012,.003,0x579448,(i-1)*.026,.038,(i%2-.5)*.026);for(let j=0;j<3;j++)ball(.0015,0xf6d083,(i-1)*.026+.012,.015+j*.006,(i%2-.5)*.026);}break;
   case 'grape':for(let i=0;i<7;i++)ball(.014,v.color,Math.sin(i*2)*.022,.014+(i%2)*.012,Math.cos(i*2)*.022);box(.003,.014,.003,0x70843d,0,.034,0);break;
   default:for(let i=0;i<3;i++){const m=box(.026,.022,.03,v.color,(i-1)*.027,.014,(i%2-.5)*.026);m.rotation.y=i*.5;}break;
  }
  // Seasoning distinguishes recipes sharing a base shape without changing the food's identity.
  if(['beef','pork','poultry'].includes(dish.dishId)||v.variant<=30)for(let k=0;k<3;k++)box(.004,.002,.006,v.variant%3===0?0x739446:0xb74d32,Math.sin(k*2+v.variant)*.025,.048,Math.cos(k*2)*.025);
  const batches=new Map<T.Material,T.BufferGeometry[]>();
  for(const child of [...g.children]){if(!(child instanceof T.Mesh))continue;child.updateMatrix();const geom=child.geometry.clone().applyMatrix4(child.matrix);const material=child.material as T.Material;batches.set(material,[...(batches.get(material)??[]),geom]);child.geometry.dispose();g.remove(child);}
  for(const [material,geometries]of batches){const combined=mergeGeometries(geometries);geometries.forEach(x=>x.dispose());if(combined)g.add(new T.Mesh(combined,material));}
 }
 return root;
}
export function updateFoodModel(root:T.Group,ratio:number|null){root.visible=ratio===null||ratio>0;for(const [i,part]of root.children.entries()){const fraction=ratio===null?1:Math.max(0,Math.min(1,ratio*4-i));part.visible=fraction>0;part.scale.setScalar(Math.cbrt(fraction));}}
