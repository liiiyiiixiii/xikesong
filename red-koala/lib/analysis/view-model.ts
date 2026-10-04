
export function portraitFingerprint(report:unknown) {
  return JSON.stringify(report, (key,value)=>['asOf','generatedAt','snapshotAt','finalAt'].includes(key)?undefined:value);
}
export class PortraitCache<T> {
  private entries=new Map<string,{value:T;at:number}>();
  get(key:string,now=Date.now()) {const entry=this.entries.get(key);if(!entry)return; if(now-entry.at>=1800000){this.entries.delete(key);return;}this.entries.delete(key);this.entries.set(key,entry);return entry.value;}
  set(key:string,value:T,now=Date.now()){this.entries.delete(key);this.entries.set(key,{value,at:now});while(this.entries.size>12)this.entries.delete(this.entries.keys().next().value!);}
}
// Balanced binary treemap. Every positive weight retains proportional area.
export function tileWeights(items:{dishId:string;grams:number}[],x=0,y=0,width=100,height=100):{dishId:string;x:number;y:number;width:number;height:number}[] {
  const positive=items.filter(d=>d.grams>0);
  if(!positive.length)return [];
  if(positive.length===1)return [{dishId:positive[0].dishId,x,y,width,height}];
  const total=positive.reduce((s,d)=>s+d.grams,0);let left=positive[0].grams,index=1;
  while(index<positive.length-1&&left<total/2){left+=positive[index].grams;index++;}
  const ratio=left/total;
  return width>=height?[...tileWeights(positive.slice(0,index),x,y,width*ratio,height),...tileWeights(positive.slice(index),x+width*ratio,y,width*(1-ratio),height)]:[...tileWeights(positive.slice(0,index),x,y,width,height*ratio),...tileWeights(positive.slice(index),x,y+height*ratio,width,height*(1-ratio))];
}

export function analysisSummary(answer:string) {
 return answer.split(/\n\s*\n/).map(p=>p.trim().replace(/[*`]/g,'')).find(p=>p&&!/^#{1,6}\s/.test(p)&&!/^(结论|数据依据|限制与缺口|建议)[:：]?$/.test(p))??'';
}
