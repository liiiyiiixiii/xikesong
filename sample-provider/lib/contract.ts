import { z } from "zod";
import type { Dataset, Catalog, DishDay, StoreDay } from "./types.ts";
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v+"T00:00:00Z"))&&new Date(v+"T00:00:00Z").toISOString().slice(0,10)===v,"无效日期");
const num=z.number().finite().nonnegative().nullable(), timestamp=z.string().datetime({offset:true});
export const catalogSchema=z.object({id:z.string().min(1).max(120),name:z.string().min(1).max(100),category:z.string().max(100),unit:z.literal("g"),pieceWeightG:z.number().positive().nullable(),launchDate:dateSchema}).strict();
export const storeSchema=z.object({date:dateSchema,status:z.enum(["open","closed"]),snapshotAt:timestamp,finalAt:timestamp}).strict();
export const daySchema=z.object({date:dateSchema,dishId:z.string().min(1).max(120),status:z.enum(["complete","partial","missing","not_launched","closed"]),take20:num,takeFinal:num,takeG:num,opening:num,replenished:num,waste:num,closing:num,supply:z.enum(["adequate","stockout","unknown","not_launched","closed"]),stockoutMinutes:num,snapshotAt:timestamp,finalAt:timestamp,ageWaste:num.optional(),closingWaste:num.optional(),retainedKitchen:num.optional()}).strict();
// RFC4180 quoted commas/newlines, escaped quotes, BOM and CRLF are supported.
export function csvRows(text:string):Record<string,string>[] {
 const rows:string[][]=[];let row:string[]=[],cell="",quoted=false;text=text.replace(/^\uFEFF/,"");
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell="";}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell="";}else cell+=c;}
 if(quoted)throw new Error("CSV引号未闭合");if(cell||row.length){row.push(cell);rows.push(row);}const header=rows.shift()?.map(h=>h.trim());if(!header?.length||new Set(header).size!==header.length)throw new Error("CSV表头缺失或重复");
 return rows.map((r,i)=>{if(r.length!==header.length)throw new Error(`CSV第${i+2}行列数不匹配`);return Object.fromEntries(header.map((k,j)=>[k,r[j].trim()]));});
}
export function value(s:string|undefined):number|null {if(s===undefined||s===""||s==="NA")return null;const n=Number(s);if(!Number.isFinite(n)||n<0)throw new Error(`无效非负数：${s}`);return n;}
export function parseFiles(files:Record<string,string>):Dataset {
 for(const f of ["dishes.csv","store_days.csv","dish_days.csv"])if(!files[f])throw new Error(`缺少 ${f}`);
 const original=csvRows(files["dishes.csv"]);
 const catalog:Catalog[]=original.map(r=>{if(r.unit!=="g"&&r.unit!=="件")throw new Error(`CSV单位仅接受克或有明确模拟单件重量的件数：${r.dish_id}`);const piece=value(r.synthetic_piece_weight_g);if(r.unit==="件"&&!piece)throw new Error(`合成计件数据须提供明确 synthetic_piece_weight_g：${r.dish_id}`);return catalogSchema.parse({id:r.dish_id,name:r.name,category:r.category,unit:"g",pieceWeightG:r.unit==="件"?piece:null,launchDate:r.launch_date});});
 const stores:StoreDay[]=csvRows(files["store_days.csv"]).map(r=>storeSchema.parse({date:r.date,status:r.business_status,snapshotAt:r.snapshot_available_at??r.people_20_available_at,finalAt:r.final_available_at??r.people_final_available_at}));
 const days:DishDay[]=csvRows(files["dish_days.csv"]).map(r=>{const c=catalog.find(c=>c.id===r.dish_id);if(!c)throw new Error(`未知菜品 ${r.dish_id}`);const factor=c.pieceWeightG??1;const quantity=(field:string)=>{const v=value(r[field]);if(c.pieceWeightG&&v!==null&&!Number.isInteger(v))throw new Error(`合成件数必须为整数 ${r.date}/${r.dish_id}/${field}`);return v===null?null:v*factor;};return daySchema.parse({date:r.date,dishId:r.dish_id,status:r.data_status,take20:quantity("taken_20"),takeFinal:quantity("taken_final"),takeG:value(r.taken_weight_g),opening:quantity("opening_stock"),replenished:quantity("replenished"),waste:quantity("waste"),closing:quantity("closing_stock"),supply:r.supply_status,stockoutMinutes:value(r.stockout_minutes),snapshotAt:r.snapshot_available_at,finalAt:r.final_available_at,ageWaste:quantity("age_waste"),closingWaste:quantity("closing_waste"),retainedKitchen:quantity("kitchen_retained")});});
 const dataset={catalog,stores,days};validateDataset(dataset);return dataset;
}
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
