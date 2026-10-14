import * as T from 'three';

export type BowlStyle = 'metal' | 'basket';
const cream=new T.MeshStandardMaterial({color:0xf4efdd,roughness:.55});
const steel=new T.MeshStandardMaterial({color:0xb7beb4,metalness:.55,roughness:.3});
const bamboo=new T.MeshStandardMaterial({color:0xa7804d,roughness:.85});
const dark=new T.MeshStandardMaterial({color:0x444b3e,roughness:.65});
const cache=new Map<string,T.BufferGeometry>();
function geometry(key:string,make:()=>T.BufferGeometry){if(!cache.has(key))cache.set(key,make());return cache.get(key)!;}
function turned(key:string,profile:number[][]){return geometry(key,()=>new T.LatheGeometry(profile.map(([x,y])=>new T.Vector2(x,y)),40));}

/** Printed on the carrier itself, never a floating scene annotation. Shared by all carriers. */
export function createCarrierBrandMaterial(){
 const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=256;
 const c=canvas.getContext('2d')!;c.fillStyle='#f4efdd';c.fillRect(0,0,1536,256);
 for(let i=0;i<3;i++){
  const x=i*512;c.fillStyle='#344c3b';
  // Small koala emblem, keeping the sidewall print readable at close range.
  for(const [dx,dy,r]of [[64,109,29],[122,109,29],[93,132,37]]){c.beginPath();c.arc(x+dx,dy,r,0,Math.PI*2);c.fill();}
  c.fillStyle='#f4efdd';for(const dx of [79,107]){c.beginPath();c.arc(x+dx,126,5,0,Math.PI*2);c.fill();}
  c.beginPath();c.ellipse(x+93,142,9,13,0,0,Math.PI*2);c.fill();
  c.fillStyle='#344c3b';c.font='bold 42px sans-serif';c.fillText('红考拉农场',x+154,130);
  c.font='23px sans-serif';c.fillText('旋 转 自 助 烤 肉',x+157,170);
 }
 const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;
 return new T.MeshStandardMaterial({map,roughness:.65});
}

/** Local origin is the belt mounting surface. Hollow carrier and removable insert are independent. */
export function createPlateAssembly(diameter:number,height:number,style:BowlStyle='metal',brandMaterial:T.Material=cream){
 const root=new T.Group(),carrier=new T.Group(),bowl=new T.Group();
 root.name='conveyor-plate-assembly';carrier.name='fixed-branded-carrier';bowl.name='removable-bowl';
 carrier.userData.mount='fixed-to-conveyor';bowl.userData.removable=true;root.add(carrier,bowl);
 const r=diameter/2,base=height*.08,lip=height*.86,inner=r*.87;
 const add=(parent:T.Group,g:T.BufferGeometry,m:T.Material,name:string)=>{const mesh=new T.Mesh(g,m);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
 // Annular wall: inner return leaves a real through opening, not a solid cylinder cap.
 add(carrier,turned(`carrier:${diameter}:${height}`,[[r*.95,base],[r,base],[r,lip],[inner,lip],[inner,base],[r*.95,base]]),cream,'hollow-carrier-wall');
 const print=add(carrier,geometry(`print:${diameter}:${height}`,()=>new T.CylinderGeometry(r+.0002,r+.0002,lip-base,40,1,true)),brandMaterial,'printed-brand-wrap');print.position.y=(lip+base)/2;
 add(carrier,turned(`foot:${diameter}:${height}`,[[r*.77,0],[r*.88,0],[r*.88,base],[r*.77,base],[r*.77,0]]),dark,'belt-mounting-ring');
 // Insert nests inside the opening. Its flange rests directly on the carrier lip.
 const bottom=height*.72,top=height;
 add(bowl,turned(`insert:${diameter}:${height}`,[[0,bottom],[r*.71,bottom],[inner-.001,lip],[r*.975,lip],[r*.975,top],[inner-.005,top],[r*.72,bottom+.006],[0,bottom+.006]]),style==='basket'?bamboo:steel,'removable-insert-shell');
 if(style==='basket'){
  // Fine woven rim stays within the validated outer diameter.
  const g=geometry(`weave:${diameter}`,()=>new T.BoxGeometry(.005,.003,.016));
  const weave=new T.InstancedMesh(g,bamboo,64),o=new T.Object3D();
  for(let i=0;i<64;i++){const a=i*Math.PI/32;o.position.set(Math.cos(a)*r*.935,top+.001,Math.sin(a)*r*.935);o.rotation.y=-a;o.updateMatrix();weave.setMatrixAt(i,o.matrix);}bowl.add(weave);
 }
 const foodAnchor=new T.Group();foodAnchor.name='insert-food-anchor';foodAnchor.position.y=bottom+.006;bowl.add(foodAnchor);
 const ring=new T.Mesh(geometry(`status:${diameter}`,()=>new T.TorusGeometry(r*.83,.0025,4,32)),new T.MeshBasicMaterial({color:0xaab98b}));ring.name='carrier-status-ring';ring.rotation.x=Math.PI/2;ring.position.y=base+.001;carrier.add(ring);
 return {root,carrier,bowl,foodAnchor,ring};
}
