import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createPlateAssembly,createCarrierBrandMaterial} from './plate-model';
import {createFoodModel} from './food-models';
const canvas=document.querySelector<HTMLCanvasElement>('#detail')!,renderer=new T.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new T.Scene();scene.background=new T.Color(0xe9e5db);scene.add(new T.HemisphereLight(0xffffff,0x777d6f,3));
const light=new T.DirectionalLight(0xfff3da,3);light.position.set(-1,3,2);scene.add(light);
const camera=new T.PerspectiveCamera(34,1,.01,10);camera.position.set(.12,.49,1.2);const orbit=new OrbitControls(camera,canvas);orbit.target.set(0,.07,0);orbit.update();
const brand=createCarrierBrandMaterial(),models=[createPlateAssembly(.32,.08,'metal',brand),createPlateAssembly(.32,.08,'basket',brand)];
models.forEach((m,i)=>{m.root.position.x=i?.21:-.21;m.root.rotation.y=.2;m.foodAnchor.add(createFoodModel({dishId:'preview-only',visual:{shape:i?'strawberry':'slice',color:i?0xd94b49:0xcd8580,variant:1}}));scene.add(m.root);});
const belt=new T.Mesh(new T.BoxGeometry(.88,.016,.36),new T.MeshStandardMaterial({color:0xaaa494}));belt.position.y=-.008;scene.add(belt);
let lifted=false;document.querySelector('#lift')!.addEventListener('click',e=>{lifted=!lifted;models.forEach(m=>m.bowl.position.y=lifted?.18:0);(e.target as HTMLButtonElement).textContent=lifted?'放回并嵌合':'抬起上层碗';});
function render(){const w=canvas.clientWidth,h=canvas.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.render(scene,camera);}
orbit.addEventListener('change',render);new ResizeObserver(render).observe(canvas);document.querySelector('#lift')!.addEventListener('click',render);render();
