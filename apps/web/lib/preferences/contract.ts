import { z } from "zod";
import type { Dataset } from "./types.ts";
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v+"T00:00:00Z"))&&new Date(v+"T00:00:00Z").toISOString().slice(0,10)===v,"无效日期");
const num=z.number().finite().nonnegative().nullable(), timestamp=z.string().datetime({offset:true});
export const catalogSchema=z.object({id:z.string().min(1).max(120),name:z.string().min(1).max(100),category:z.string().max(100),unit:z.literal("g"),pieceWeightG:z.null(),launchDate:dateSchema}).strict();
export const storeSchema=z.object({date:dateSchema,status:z.enum(["open","closed"]),snapshotAt:timestamp,finalAt:timestamp}).strict();
export const daySchema=z.object({date:dateSchema,dishId:z.string().min(1).max(120),status:z.enum(["complete","partial","missing","not_launched","closed"]),take20:num,takeFinal:num,takeG:num,opening:num,replenished:num,waste:num,closing:num,supply:z.enum(["adequate","stockout","unknown","not_launched","closed"]),stockoutMinutes:num,snapshotAt:timestamp,finalAt:timestamp,ageWaste:num.optional(),closingWaste:num.optional(),retainedKitchen:num.optional()}).strict();
export function validateDataset(data:Dataset){
 const ids=new Set<string>();for(const c of data.catalog){catalogSchema.parse(c);if(ids.has(c.id))throw new Error(`重复菜品 ${c.id}`);ids.add(c.id);}
 const storeKeys=new Set<string>();for(const s of data.stores){storeSchema.parse(s);if(storeKeys.has(s.date))throw new Error(`重复日期 ${s.date}`);storeKeys.add(s.date);checkTimes(s.date,s.snapshotAt,s.finalAt);}
 const keys=new Set<string>();for(const d of data.days){daySchema.parse(d);const c=data.catalog.find(c=>c.id===d.dishId);if(!c||!storeKeys.has(d.date))throw new Error(`菜品或门店日期不存在 ${d.date}/${d.dishId}`);const key=d.date+":"+d.dishId;if(keys.has(key))throw new Error(`重复日记录 ${key}`);keys.add(key);checkTimes(d.date,d.snapshotAt,d.finalAt);
 if(d.take20!==null&&d.takeFinal!==null&&d.take20>d.takeFinal)throw new Error(`20点取用超过全天 ${key}`);
 const quantities=[d.take20,d.takeFinal,d.opening,d.replenished,d.waste,d.closing];
 if(d.status==="complete"&&quantities.slice(1).some(v=>v===null))throw new Error(`完整记录字段缺失 ${key}`);
 if([d.opening,d.replenished,d.takeFinal,d.waste,d.closing].every(v=>v!==null)&&Math.abs(d.opening!+d.replenished!-d.takeFinal!-d.waste!-(d.retainedKitchen??0)-d.closing!)>0.1)throw new Error(`库存不守恒 ${key}`);
 if(d.takeFinal!==null&&d.takeG!==null&&Math.abs(d.takeFinal-d.takeG)>.1)throw new Error(`取用重量单位不符 ${key}`);
 if(d.date<c.launchDate&&(d.status!=="not_launched"||quantities.some(v=>v!==null&&v!==0)))throw new Error(`上市前有供餐 ${key}`);
 if(d.status==="closed"&&quantities.slice(0,2).some(v=>v!==null&&v!==0))throw new Error(`停业仍有取用 ${key}`);
 if(d.ageWaste!=null&&d.closingWaste!=null&&d.waste!==null&&d.ageWaste+d.closingWaste>d.waste+.1)throw new Error(`分类报损重复或超出总量 ${key}`);
 }
}
function checkTimes(date:string,snapshot:string,final:string){if(Date.parse(snapshot)<Date.parse(`${date}T20:00:00+08:00`)||Date.parse(final)<Date.parse(snapshot))throw new Error(`数据可获得时间错误 ${date}`);}
