import { dishEmptySeconds } from '../scales/engine.ts';
import { z } from 'zod';
import { daySchema, catalogSchema, validateDataset } from './contract.ts';
const grams=z.number().finite().nonnegative().max(1e8), stamp=z.string().datetime({offset:true}), id=z.string().min(1).max(120);
export function historyDayCount(m:{parameters:{start:string;end:string}}){return Math.round((Date.parse(m.parameters.end)-Date.parse(m.parameters.start))/86400000)+1;}
export const manifestSchema=z.object({datasetId:id,parameters:z.object({version:id,seed:z.number().int(),start:z.string().date(),end:z.string().date(),mode:z.literal('scenario').optional(),timezone:z.literal('Asia/Shanghai'),seats:z.literal(20),open:z.literal('11:00'),close:z.literal('22:00')}).passthrough(),catalog:z.array(catalogSchema).min(36).max(42),mapping:z.array(z.object({dishId:id,scaleId:id,position:z.number().int().min(1).max(42)})).length(42),expectedBatches:z.number().int().min(36).max(3780)}).strict().refine(m=>[36,42].includes(m.catalog.length)&&historyDayCount(m)>=1&&historyDayCount(m)<=90&&m.expectedBatches===m.catalog.length*historyDayCount(m),"菜品数或批次总数不符");
export type HistoryManifest=z.infer<typeof manifestSchema>;
const event=z.object({id,source:z.literal('live'),scaleId:id,dishId:id,at:stamp,receivedAt:stamp,kind:z.enum(['opening','take','refill','pending','waste','retain','correction']),weightG:grams,reason:z.enum(['display_age','closing','other']).optional(),resolvedAt:stamp.optional(),resolution:z.enum(['waste','retain','take','correction']).optional()}).strict();
export const bundleSchema=z.object({daily:daySchema,events:z.array(event).max(10000),minutes:z.array(z.object({source:z.literal('live'),scaleId:id,dishId:id,minute:stamp,takeG:grams,refillG:grams,observedSeconds:z.number().int().min(0).max(60),emptySeconds:z.number().int().min(0).max(60),remainingG:grams.nullable(),remainingAt:stamp,emptySpans:z.array(z.tuple([z.number().finite(),z.number().finite()])).max(60).optional()})).min(660).max(1320),execution:z.object({date:z.string(),dishId:id,prepared:grams,added:grams,kitchenRetained:grams,ageWaste:grams,closingWaste:grams,otherWaste:grams,note:z.string().max(500),at:stamp}).strict(),kitchen:z.array(z.object({id,scaleId:id.optional(),kind:z.enum(['prepare','kitchen_add','kitchen_waste','kitchen_retain','opening','refill']),at:stamp,weightG:grams})).max(10000)}).strict();
export type HistoryBundle=z.infer<typeof bundleSchema>;
export function validateHistoryBundle(raw:unknown,manifest:HistoryManifest){
 const b=bundleSchema.parse(raw),d=b.daily,mappings=manifest.mapping.filter(m=>m.dishId===d.dishId),scaleIds=mappings.map(m=>m.scaleId);if(!mappings.length||d.date<manifest.parameters.start||d.date>manifest.parameters.end)throw new Error('菜品或日期超出数据集');
 const start=Date.parse(d.date+'T11:00:00+08:00'),end=start+39600000,cutoff=start+32400000;
 if(Date.parse(d.snapshotAt)!==cutoff||Date.parse(d.finalAt)!==end)throw new Error('快照或闭店时间不一致');
 validateDataset({catalog:manifest.catalog,stores:[{date:d.date,status:'open',snapshotAt:d.snapshotAt,finalAt:d.finalAt}],days:[d]});
 const unique=new Set<string>();for(const e of b.events){if(unique.has(e.id)||e.dishId!==d.dishId||!scaleIds.includes(e.scaleId)||Date.parse(e.at)<start||Date.parse(e.at)>=end)throw new Error('事件重复、映射或时间不符');unique.add(e.id);if(e.kind==='pending'&&(!e.resolvedAt||!e.resolution||Date.parse(e.resolvedAt)<Date.parse(e.at)||!b.events.some(x=>x.kind===e.resolution&&x.at===e.at&&x.weightG===e.weightG)))throw new Error('撤碗确认缺少关联处置');}
 let coverage=0;
 if(b.minutes.length!==660*scaleIds.length)throw new Error('碗分钟数量不符');
 for(const scaleId of scaleIds){let previousRemaining:number|null=0;const minutes=b.minutes.filter(m=>m.scaleId===scaleId);if(minutes.length!==660)throw new Error('碗分钟覆盖不全');
 for(const [i,m] of minutes.entries()){
  const time=start+i*60000;if(Date.parse(m.minute)!==time||m.dishId!==d.dishId||m.emptySeconds>m.observedSeconds||Date.parse(m.remainingAt)!==time+59000)throw new Error('分钟覆盖或映射不合法');
  if(m.observedSeconds===0&&m.remainingG!==null)throw new Error('缺测不能填入真实余量');
  if(scaleIds.length>1&&!m.emptySpans)throw new Error('重复菜品必须提供空碗时间区间');
  if(m.emptySpans){let last=time,seconds=0;for(const [a,z] of m.emptySpans){if(a<last||z<=a||a<time||z>time+60000)throw new Error('空碗区间重叠或越界');seconds+=(z-a)/1000;last=z;}if(Math.abs(seconds-m.emptySeconds)>.0001)throw new Error('空碗区间与秒数不符');}
  const es=b.events.filter(e=>e.scaleId===scaleId&&Date.parse(e.at)>=time&&Date.parse(e.at)<time+60000),sum=(kind:string)=>es.filter(e=>e.kind===kind).reduce((s,e)=>s+e.weightG,0);
  if(m.observedSeconds===60 && previousRemaining!==null && m.remainingG!==previousRemaining+sum('opening')+sum('refill')-sum('take')-sum('waste')-sum('retain'))throw new Error('分钟余量与事件不守恒');previousRemaining=m.observedSeconds===60?m.remainingG:null;
  if(sum('take')!==m.takeG||sum('refill')!==m.refillG)throw new Error('事件和分钟不一致');coverage+=m.observedSeconds;
 }}
 const empty=dishEmptySeconds(b.minutes,scaleIds,start,end),closing=scaleIds.reduce((s,id)=>s+(b.minutes.filter(m=>m.scaleId===id).at(-1)?.remainingG??0),0);

 const sum=(kind:string,until=end)=>b.events.filter(e=>e.kind===kind&&Date.parse(e.at)<until).reduce((s,e)=>s+e.weightG,0);
 if(coverage===39600*scaleIds.length){if(d.status!=='complete'||d.takeFinal!==sum('take')||d.take20!==sum('take',cutoff)||d.opening!==sum('opening')||d.replenished!==sum('refill')||d.waste!==sum('waste')||d.retainedKitchen!==sum('retain')||Math.abs((d.stockoutMinutes??-1)-empty/60)>.00001||d.supply!==(empty?'stockout':'adequate')||d.closing!==closing)throw new Error('日汇总和观测不一致');}
 else if(d.status!=='partial'||d.takeFinal!==null||d.takeG!==null||d.take20!==null||d.supply!=='unknown'||d.stockoutMinutes!==null)throw new Error('缺测必须保留未知');
 const k=b.kitchen,ks=(kind:string)=>k.filter(e=>e.kind===kind).reduce((s,e)=>s+e.weightG,0),x=b.execution;
 if(new Set(k.map(e=>e.id)).size!==k.length||k.some(e=>Date.parse(e.at)<start||Date.parse(e.at)>=end))throw new Error('厨房流水重复或越界');
 if(x.date!==d.date||x.dishId!==d.dishId||Date.parse(x.at)!==end||ks('prepare')!==x.prepared||ks('kitchen_add')!==x.added||ks('kitchen_retain')!==x.kitchenRetained||ks('kitchen_waste')!==x.ageWaste+x.closingWaste+x.otherWaste||x.prepared+x.added!==ks('opening')+ks('refill')+x.kitchenRetained+x.ageWaste+x.closingWaste+x.otherWaste)throw new Error('厨房执行不守恒');
 for(const e of b.events.filter(e=>e.kind==='opening'||e.kind==='refill'))if(!k.some(v=>v.id===e.id&&v.kind===e.kind&&v.at===e.at&&v.weightG===e.weightG))throw new Error('上台缺少厨房转出关联');
 return b;
}
export async function checksum(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');}
