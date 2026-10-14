import type {PlateAlert} from '@zhishan/contracts/kitchen-display';
export type LabelPoint={id:string;text:string;alert:PlateAlert;selected?:boolean;x:number;y:number};
export function arrangeLabels(points:LabelPoint[],width:number,height:number){
 const occupied:{x:number;y:number;w:number;h:number}[]=[],placed:(LabelPoint&{left:number;top:number})[]=[],hidden:string[]=[];
 const rank:Record<PlateAlert,number>={expired:0,empty:1,refill:2,warning:3,none:4,unknown:5};
 for(const p of [...points].sort((a,b)=>Number(!!b.selected)-Number(!!a.selected)||rank[a.alert]-rank[b.alert]||a.id.localeCompare(b.id))){
  if(placed.length>=3||(!p.selected&&!['empty','expired'].includes(p.alert))){hidden.push(p.id);continue;}
  const w=Math.min(84,Math.max(0,width-16)),h=30;let choice:{x:number;y:number;w:number;h:number}|null=null;
  for(let ring=0;ring<8&&!choice;ring++)for(const sign of [1,-1]){const x=Math.max(8,Math.min(width-w-8,p.x+(sign===1?6:-w-6))),y=Math.max(8,Math.min(height-h-36,p.y-34+ring*36*(ring%2?-1:1)));const r={x,y,w,h};if(!occupied.some(o=>r.x<o.x+o.w+6&&r.x+r.w+6>o.x&&r.y<o.y+o.h+6&&r.y+r.h+6>o.y)){choice=r;break;}}
  if(choice){occupied.push(choice);placed.push({...p,left:choice.x,top:choice.y});}else hidden.push(p.id);
 }
 return {placed,hidden};
}
