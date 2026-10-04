import type { Source } from "../scales/types.ts";
export interface Catalog { id:string; name:string; category:string; unit:"g"; pieceWeightG:number|null; launchDate:string; }
export interface StoreDay { date:string; status:"open"|"closed"; snapshotAt:string; finalAt:string; }
export interface DishDay { date:string; dishId:string; status:"complete"|"partial"|"missing"|"not_launched"|"closed"; take20:number|null; takeFinal:number|null; takeG:number|null; opening:number|null; replenished:number|null; waste:number|null; closing:number|null; supply:"adequate"|"stockout"|"unknown"|"not_launched"|"closed"; stockoutMinutes:number|null; snapshotAt:string; finalAt:string; ageWaste?:number|null; closingWaste?:number|null; retainedKitchen?:number|null; }
export interface Dataset { catalog:Catalog[]; stores:StoreDay[]; days:DishDay[]; }
export interface Model { algorithm:"weighted-ridge-log1p-grams-v2"; dishId:string; lambda:number; samples:number; coefficients:number[]; residualSD:number; trainedThrough:string|null; featureNames:string[]; }
export interface ForecastLine { dishId:string; name:string; unit:"g"; demand:number|null; low:number|null; high:number|null; suggested:number|null; samples:number; confidence:"observing"|"limited"|"reference"; explanation:string; model:Model|null; }
export interface Forecast { provenance?:"historical-replay"; datasetId?:string; id:string; source:Source; originDate:string; targetDate:string; cutoff:string; generatedAt:string; late:boolean; buffer:number; lines:ForecastLine[]; }
export interface Confirmation { forecastId:string; date:string; at:string; lines:{dishId:string; quantity:number; reason:string}[]; }
export interface Execution { date:string; dishId:string; prepared:number; added:number; kitchenRetained:number; ageWaste:number; closingWaste:number; otherWaste:number; note:string; at:string; }
export interface Profile { dishId:string; name:string; unit:"g"; weightedTake:number|null; takeG:number; share:number|null; status:string; samples:number; history:{date:string;quantity:number|null;supply:string}[]; }
export const featureNames=["截距","周一","周二","周三","周四","周五","周六","当日20点取用重量log1p","前一完整日取用重量log1p","上周同星期取用重量log1p","20点取用缺失","前日取用缺失","上周取用缺失"];
export function shiftDate(date:string,n:number){return new Date(Date.parse(`${date}T00:00:00Z`)+n*86400000).toISOString().slice(0,10);}
export function localDate(at:string){return new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);}
export function cutoffAt(date:string){return `${date}T20:00:00+08:00`;}
