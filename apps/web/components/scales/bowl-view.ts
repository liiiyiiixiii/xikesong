import type { DishRealtime } from '../../lib/scales/types.ts';
/** Physical belt cards stay distinct; summaries and forecasts retain dish identity. */
export function bowlCards(dishes:DishRealtime[]):DishRealtime[]{
 return dishes.flatMap(dish=>dish.scales.map(scale=>{
  const net=scale.netG,status:DishRealtime['status']=scale.status==='offline'?'offline':scale.status==='anomaly'?'anomaly':net===null?'partial':net<=3?'empty':net/scale.fullG<.2?'low':'okay';
  return {...dish,id:scale.id,name:dish.scales.length>1?`${dish.name} · ${scale.position??scale.id}`:dish.name,remainingG:net,fullG:scale.fullG,percent:scale.percent,status,overfull:net!==null&&net>scale.fullG,scales:[scale],trend:[],rateGPerMinute:null};
 })).sort((a,b)=>(a.scales[0].position??Infinity)-(b.scales[0].position??Infinity));
}
