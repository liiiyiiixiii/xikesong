import * as T from 'three';
import {plateAlertTone,type PlateAlert} from '@zhishan/contracts/kitchen-display';
import './plate-callouts.css';
import {arrangeLabels} from './label-layout';
export class PlateCallouts{
 readonly root=document.createElement('div');private nodes=new Map<string,HTMLDivElement>();private svg=document.createElementNS('http://www.w3.org/2000/svg','svg');private overflow=document.createElement('div');
 constructor(private canvas:HTMLCanvasElement){this.root.className='plate-callouts';this.root.setAttribute('aria-live','off');this.root.append(this.svg,this.overflow);this.overflow.className='plate-callout-overflow';canvas.parentElement!.append(this.root);}
 render(labels:{id:string;text:string;alert:PlateAlert;selected?:boolean;position:T.Vector3}[],camera:T.Camera){
  const w=this.canvas.clientWidth,h=this.canvas.clientHeight,points=labels.flatMap(l=>{const v=l.position.clone().project(camera);return v.z<-1||v.z>1||Math.abs(v.x)>1||Math.abs(v.y)>1?[]:[{...l,x:(v.x+1)*w/2,y:(1-v.y)*h/2}];});
  const layout=arrangeLabels(points,w,h),ids=new Set(layout.placed.map(l=>l.id));for(const[id,node]of this.nodes)if(!ids.has(id)){node.remove();this.nodes.delete(id);}this.svg.replaceChildren();this.svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  for(const p of points){if(p.alert==='none')continue;const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('cx',String(p.x));dot.setAttribute('cy',String(p.y));dot.setAttribute('r',p.selected?'4':'2.5');dot.setAttribute('fill',plateAlertTone[p.alert]==='red'?'#c44e40':plateAlertTone[p.alert]==='yellow'?'#c79516':'#66766a');dot.setAttribute('stroke','#fff');dot.setAttribute('stroke-width','1');this.svg.append(dot);}
  for(const l of layout.placed){let node=this.nodes.get(l.id);if(!node){node=document.createElement('div');node.dataset.plateId=l.id;this.nodes.set(l.id,node);this.root.append(node);}node.className='plate-callout tone-'+plateAlertTone[l.alert];if(node.textContent!==l.text){node.textContent=l.text;node.title=l.text;}node.style.transform=`translate(${l.left}px,${l.top}px)`;const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('x1',String(l.x));line.setAttribute('y1',String(l.y));line.setAttribute('x2',String(l.left+42));line.setAttribute('y2',String(l.top+28));this.svg.append(line);}
  this.overflow.hidden=!layout.hidden.length;this.overflow.textContent=`另有 ${layout.hidden.length} 盘标记 · 点击餐盘查看，完整列表见后厨屏`;
 }
}
