import * as T from 'three';
import {CSS3DObject, CSS3DRenderer} from 'three/addons/renderers/CSS3DRenderer.js';
import {box} from './graphics';

/** Live HTML display recessed into the kitchen side of wall-8. */
export class KitchenWallScreen {
 private readonly renderer = new CSS3DRenderer();
 private readonly htmlScene = new T.Scene();
 private readonly display: CSS3DObject;
 private readonly position = new T.Vector3(4.45, 1.06, 4.709);
 constructor(scene:T.Scene, canvas:HTMLCanvasElement, url:URL) {
  const width=1.9, height=width*9/16;
  const frame=new T.Group();frame.position.copy(this.position);frame.rotation.y=Math.PI;
  // The case sits inside the wall; only the slim front rim projects from the plaster.
  box(frame,width+.10,height+.10,.045,0x26312f,0,0,-.026,.018);
  scene.add(frame);
  const element=document.createElement('div');
  Object.assign(element.style,{width:'1280px',height:'720px',background:'#f4f5f1',overflow:'hidden',backfaceVisibility:'hidden',pointerEvents:'none'});
  const iframe=document.createElement('iframe');
  iframe.src=url.href;iframe.title='后厨主供餐口实时显示屏';iframe.tabIndex=-1;
  Object.assign(iframe.style,{width:'100%',height:'100%',border:'0',pointerEvents:'none'});
  element.append(iframe);
  this.display=new CSS3DObject(element);this.display.position.copy(this.position);this.display.rotation.y=Math.PI;this.display.scale.setScalar(width/1280);this.htmlScene.add(this.display);
  // Punch an alpha aperture in the WebGL wall. Depth testing preserves occlusion
  // by people and equipment in front of the screen instead of floating HTML over them.
  const aperture=new T.Mesh(new T.PlaneGeometry(width,height),new T.MeshBasicMaterial({color:0x000000,opacity:0,blending:T.NoBlending,side:T.FrontSide}));
  aperture.position.copy(this.position);aperture.rotation.y=Math.PI;aperture.renderOrder=1;scene.add(aperture);
  Object.assign(this.renderer.domElement.style,{position:'absolute',inset:'0',pointerEvents:'none',zIndex:'0'});
  canvas.parentElement!.prepend(this.renderer.domElement);
  Object.assign(canvas.style,{position:'relative',zIndex:'1'});
 }
 resize(width:number,height:number){this.renderer.setSize(width,height);}
 render(camera:T.Camera){
  this.display.visible=camera.position.z<this.position.z;
  this.renderer.render(this.htmlScene,camera);
 }
}
