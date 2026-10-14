import * as T from 'three';
import { box, cylinder, sphere, torus, group, label, steamTexture, C } from './graphics';
import { Character } from './characters';
import type { SceneManifest, Point } from './demo/layout';
import { kitchenChefs, kitchenFixtures, wallPlanters, mixedCounterStaff } from './demo/interior-layout';

function plant(parent:T.Object3D,x:number,y:number,z:number,scale=1){
 const p=group(parent,x,y,z);p.scale.setScalar(scale);
 cylinder(p,.21,.15,.35,C.coral,0,.175);cylinder(p,.18,.18,.02,0x534632,0,.36);
 for(let i=0;i<8;i++){const a=i*2.4,leaf=sphere(p,.21,i%2?0x6c9057:0x8da568,Math.cos(a)*.12,.54+i*.025,Math.sin(a)*.12,.48,1.65,.65);leaf.rotation.z=Math.cos(a)*.55;leaf.rotation.x=Math.sin(a)*.55;}
}
function plates(p:T.Object3D,x:number,y:number,z:number){for(let i=0;i<6;i++){cylinder(p,.19,.17,.027,C.white,x,y+i*.035,z);torus(p,.165,.009,0xc7c9ac,x,y+.016+i*.035,z);}}
function bottle(p:T.Object3D,x:number,y:number,z:number,color:number){
 cylinder(p,.065,.065,.23,color,x,y+.115,z);cylinder(p,.029,.03,.08,C.darkTeal,x,y+.27,z);box(p,.085,.07,.008,C.cream,x,y+.12,z+.064,.003);
}
function tray(p:T.Object3D,x:number,y:number,z:number,color:number){
 box(p,.59,.055,.40,C.steel,x,y,z,.025);box(p,.50,.018,.32,0x536e61,x,y+.034,z,.02);
 for(let i=0;i<6;i++)sphere(p,.072,color,x-.16+(i%3)*.16,y+.08,z-.09+Math.floor(i/3)*.18,1.05,.6,1);
}
function cabinet(p:T.Object3D,w:number,d:number){
 box(p,w,.74,d,C.teal,0,.47,0,.035);box(p,w+.025,.075,d+.025,0xc4d0c4,0,.875,0,.025);
 for(const x of [-w/2+.13,w/2-.13])for(const z of [-d/2+.12,d/2-.12])box(p,.065,.18,.065,C.dark,x,.11,z,.01);
 const count=Math.max(1,Math.round(w/.8));for(let i=0;i<count;i++){const x=-w/2+(i+.5)*w/count;box(p,w/count-.045,.57,.025,0x71948a,x,.48,d/2+.015,.02);box(p,.22,.025,.045,C.cream,x,.68,d/2+.04,.005);}
}
function rawMeat(p:T.Object3D,x:number,y:number,z:number){
 tray(p,x,y,z,0xd98e8d);
 for(let i=0;i<3;i++){box(p,.32,.026,.07,0xeaa5a1,x,y+.095,z-.10+i*.10,.02);box(p,.29,.008,.012,0xf2d1ba,x,y+.111,z-.10+i*.10,.005);}
}
function pizza(p:T.Object3D,x:number,y:number,z:number){
 cylinder(p,.27,.27,.045,0xd4a45a,x,y,z);cylinder(p,.235,.235,.018,0xe8bd65,x,y+.03,z);
 for(let i=0;i<7;i++){const a=i*2.4;cylinder(p,.038,.038,.013,0xaf5842,x+Math.cos(a)*.16,y+.045,z+Math.sin(a)*.16);}
}

/** Static room detail and explicitly scenic kitchen team. Business staff stay server-owned. */
export class Interior {
 readonly scenery=new T.Group();
 readonly actors=new T.Group();
 private chefs:{character:Character;action:string}[]=[];
 private supply:{character:Character;position:Point}[]=[];
 private steam:T.Sprite[]=[];
 private noodleOrigin={x:0,z:0};
 readonly ready:Promise<unknown>;
 constructor(m:SceneManifest){
  const s=this.scenery;
  // Open kitchen: rear production line, middle circulation, low plating island.
  for(let x=.35;x<m.kitchen.max.x;x+=.55)box(s,.012,.008,4.45,0xa5b9a7,x,.045,2.4,0);
  for(let z=.3;z<4.8;z+=.55)box(s,12.7,.008,.012,0xa5b9a7,6.55,.045,z,0);
  for(const f of kitchenFixtures){
   const p=group(s,f.x,0,f.z);p.name=f.id;
   if(f.kind==='fridge'){
    box(p,f.width,1.92,f.depth,0x93a99b,0,.99,0,.05);
    for(const x of [-.32,.32]){box(p,.60,1.7,.045,0xd6ddc9,x,1,.50,.025);box(p,.035,.55,.045,C.darkTeal,x+(x<0?.20:-.20),1.02,.54,.008);}
    box(p,1.17,.13,.035,C.darkTeal,0,1.83,.53,.01);
   }else if(f.kind==='shelf'){
    for(const x of [-.49,.49])for(const z of [-.60,.60])box(p,.05,1.85,.05,C.darkTeal,x,.95,z,.008);
    for(const y of [.2,.75,1.3,1.85]){box(p,1.1,.045,1.4,C.wood,0,y,0,.01);if(y<1.8)for(const z of [-.35,.32]){box(p,.75,.23,.49,0xc39b61,0,y+.15,z,.02);for(let i=0;i<3;i++)sphere(p,.10,y<.3?0xbf7452:0x8ba967,-.23+i*.23,y+.29,z,1,.9,1);}}
   }else{
    cabinet(p,f.width,f.depth);
    if(f.kind==='sink'){
     for(const x of [-.50,.38]){box(p,.73,.035,.60,C.steel,x,.93,0,.06);box(p,.61,.020,.46,0x55746b,x,.95,0,.05);box(p,.49,.008,.33,0x9bb6aa,x,.962,0,.03);}
     cylinder(p,.024,.024,.32,C.steel,0,1.1,-.32);const tap=torus(p,.12,.024,C.steel,0,1.26,-.2);tap.rotation.set(0,Math.PI/2,0);bottle(p,.95,.92,.10,C.gold);
    }else if(f.kind==='prep'){
     box(p,1,.035,.58,C.wood,0,.94,.06,.03);tray(p,-.81,.95,.02,0x89a658);
     for(let i=0;i<5;i++){const carrot=cylinder(p,.028,.025,.16,0xe5a34f,-.28+i*.13,.99,.08);carrot.rotation.z=Math.PI/2;}
     box(p,.28,.018,.095,0xd6ddce,.65,.96,.08,.005);box(p,.16,.035,.04,C.dark,.86,.97,.08,.01);bottle(p,.93,.92,-.25,C.coral);
    }else if(f.kind==='meat'){
     box(p,.9,.035,.58,0xb47870,-.65,.94,.06,.025);rawMeat(p,-.65,.97,.06);
     cylinder(p,.30,.22,.18,C.steel,.1,1.02,0);cylinder(p,.27,.27,.018,0xc98583,.1,1.115,0);
     rawMeat(p,.93,.95,0);
     for(let i=0;i<4;i++)box(p,.34,.018,.016,C.wood,.92,.99,-.13+i*.08,.003);
    }else if(f.kind==='island'){
     for(const x of [-1.1,-.37,.37])rawMeat(p,x,.95,0);tray(p,1.1,.95,0,0x87a25b);
     plates(p,-1.2,.26,0);plates(p,1.15,.26,0);
    }else{
     // Cooked food is separated from the raw portioning island.
     box(p,1.03,.55,.67,0x686b62,-.45,1.20,-.02,.04);box(p,.87,.31,.018,0x282e29,-.45,1.21,.325,.02);
     box(p,.62,.03,.035,C.steel,-.45,1.41,.36,.008);pizza(p,.62,.96,.03);plates(p,.64,.26,0);
    }
   }
  }
  // Utensil rail and seasoning shelf along the rear production line.
  box(s,3.5,.045,.04,C.steel,5.65,1.67,.23,.008);
  for(let i=0;i<7;i++){const x=4.2+i*.47;box(s,.024,.28,.025,C.dark,x,1.51,.27,.005);if(i%2)sphere(s,.075,C.steel,x,1.33,.27,1,1.1,.3);else box(s,.11,.14,.025,C.steel,x,1.30,.27,.02);}
  box(s,2.25,.06,.28,C.wood,3.1,1.79,.24,.01);for(let i=0;i<7;i++)bottle(s,2.2+i*.3,1.83,.28,[C.coral,C.gold,0x819761][i%3]);
  for(const spec of kitchenChefs){const character=new Character(this.chefs.length+2,'chef');character.root.position.set(spec.x,0,spec.z);character.root.rotation.y=spec.angle;character.root.scale.set(.85,1,.85);character.root.name=spec.id;this.actors.add(character.root);this.chefs.push({character,action:spec.action});}
  const steamMap=steamTexture();
  for(let i=0;i<5;i++){const puff=new T.Sprite(new T.SpriteMaterial({map:steamMap,transparent:true,depthWrite:false,opacity:.4}));this.actors.add(puff);this.steam.push(puff);}

  for(const [i,w]of m.servingWindows.entries()){const character=new Character(i+5,'server'),at=w.staffPosition!;character.root.position.set(at.x,0,at.z);character.root.rotation.y=Math.atan2(w.position.x-at.x,w.position.z-at.z);character.root.scale.set(.75,1,.75);character.root.name=`scenic-${w.windowId}`;this.actors.add(character.root);this.supply.push({character,position:at});}

  // Legacy farm palette: wainscot, framed farm image, menu boards and warm pendants.
  box(s,28.6,.64,.055,C.teal,14.5,.43,.21,.01);box(s,28.6,.045,.08,C.wood,14.5,.78,.23,.005);
  for(let x=.5;x<28.6;x+=.48)box(s,.016,.52,.012,C.darkTeal,x,.44,.246,0);
  const sign=group(s,18.4,1.55,.225);box(sign,5.8,.94,.06,C.wood,0,0,0,.035);label(sign,'红 考 拉 农 场',5.58,.67,0,.10,.038,'#437c74','#fff3d5',92);label(sign,'不敷衍 · 源自农场',4.9,.18,0,-.30,.04,'#437c74','#eadab8',50);
  const posterMaterial=new T.MeshStandardMaterial({color:0xffffff,roughness:1});
  box(s,2.8,1.58,.08,C.wood,23.6,1.39,.23,.03);const poster=new T.Mesh(new T.PlaneGeometry(2.61,1.4),posterMaterial);poster.position.set(23.6,1.39,.279);s.add(poster);
  this.ready=new T.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}art/koala-farm-reference.png`).then(t=>{t.colorSpace=T.SRGBColorSpace;posterMaterial.map=t;posterMaterial.needsUpdate=true;}).catch(()=>{posterMaterial.color.set(C.teal);});
  box(s,2.15,1.50,.07,C.wood,27,1.39,.23,.03);label(s,'今日鲜选',1.96,.32,27,1.90,.27,'#315f58','#fff3d5',70);
  for(const [i,text]of ['原切鲜肉','时令蔬菜','现备现供'].entries())label(s,text,1.96,.30,27,1.53-i*.33,.27,'#315f58','#e8dcc0',58);
  for(const x of [16,20.4,25.2]){box(s,.025,.48,.025,C.dark,x,2.82,.62,.003);cylinder(s,.14,.34,.27,C.coral,x,2.46,.62);cylinder(s,.29,.29,.023,0xffe0a0,x,2.31,.62);}
  // Everything in the dining area stays on existing counters or attached to walls.
  const dz=(m.drinks.min.z+m.drinks.max.z)/2;
  // Self-service drinks on the left; staffed drinks and cooked pickup on the right.
  for(let i=0;i<2;i++){const x=m.drinks.min.x+.4+i*.65;cylinder(s,.17,.17,.50,i?0xb87842:0xe6b14d,x,1.2,dz);cylinder(s,.19,.19,.04,C.darkTeal,x,1.47,dz);box(s,.035,.10,.08,C.dark,x,1.10,dz+.20,.01);}
  for(let i=0;i<4;i++)cylinder(s,.075,.053,.15,C.cream,m.drinks.min.x+1.6+i*.17,1.035,dz);
  pizza(s,m.drinks.min.x+2.75,1.0,dz);tray(s,m.drinks.min.x+3.45,.98,dz,0xd4a86b);
  plates(s,m.drinks.max.x-.42,.98,dz);
  const server=new Character(9,'server');server.root.position.set(mixedCounterStaff.x,0,mixedCounterStaff.z);server.root.scale.set(.75,1,.75);server.root.name=mixedCounterStaff.id;this.actors.add(server.root);this.supply.push({character:server,position:{x:server.root.position.x,z:server.root.position.z}});
  const sx=(m.sauce.min.x+m.sauce.max.x)/2,sz=m.sauce.min.z,length=m.sauce.max.z-sz,split=sz+length*.4;
  // Upper 40% condiments; lower 60% noodle cooking and snack pickup.
  for(let z=sz+.35;z<split-.15;z+=.55)for(const x of [m.sauce.min.x+.4,m.sauce.max.x-.4]){box(s,.43,.07,.36,C.steel,x,.93,z,.04);cylinder(s,.12,.10,.045,0xb28444,x,.98,z);box(s,.025,.025,.23,C.steel,x+.1,1.0,z+.1,.005);}
  for(let z=sz+.5;z<split-.2;z+=.8)bottle(s,sx,.93,z,C.coral);
  box(s,m.sauce.max.x-m.sauce.min.x-.12,.025,.035,C.wood,sx,.93,split,.005);
  this.noodleOrigin={x:sx,z:split+.65};
  for(const z of [split+.65,split+1.55])for(const x of [sx-.39,sx+.39]){
   box(s,.64,.05,.65,C.dark,x,.945,z,.03);cylinder(s,.24,.21,.25,C.steel,x,1.085,z);cylinder(s,.21,.21,.015,0xd9b76c,x,1.215,z);
   for(let i=0;i<4;i++)torus(s,.065+i*.017,.009,0xf1d389,x,1.23,z);
   box(s,.06,.05,.22,C.dark,x,1.16,z+.29,.008);
  }
  for(let i=0;i<4;i++){box(s,.22,.30,.08,i%2?0xbd5141:0xd6aa54,sx-.36+i*.24,1.08,split+2.25,.015);}
  for(const x of [sx-.4,sx+.4]){plates(s,x,.94,m.sauce.max.z-.35);tray(s,x,.96,m.sauce.max.z-1.0,0xdfb06f);}
  // Recessed wall planters add greenery without taking space from guest routes.
  for(const f of wallPlanters){box(s,f.width,.25,f.depth,C.wood,f.x,.63,f.z,.02);for(const d of [-.28,0,.28])plant(s,f.x+.03,.77,f.z+d,.42);}
 }
 update(timeMs:number,staff:readonly {position:Point}[]=[]){
  for(const {character,action}of this.chefs){character.root.visible=!staff.some(s=>Math.hypot(s.position.x-character.root.position.x,s.position.z-character.root.position.z)<.5);character.animate(timeMs/1000,false,false,0,action);}
  this.steam.forEach((p,i)=>{const cycle=(timeMs/3200+i/5)%1;p.position.set(this.noodleOrigin.x+Math.sin(cycle*6+i)*.18,1.25+cycle*.65,this.noodleOrigin.z+Math.cos(cycle*5+i)*.10);p.scale.setScalar(.13+cycle*.24);p.material.opacity=Math.sin(cycle*Math.PI)*.32;});
  for(const {character,position}of this.supply){character.root.visible=!staff.some(s=>Math.hypot(s.position.x-position.x,s.position.z-position.z)<1.25);character.animate(timeMs/1000,false,false,0,'idle');character.leftArm.rotation.set(-.12,0,.05);character.rightArm.rotation.set(-.12,0,-.05);}
 }
}
