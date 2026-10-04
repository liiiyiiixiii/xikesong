import { cutoffAt, featureNames, localDate, shiftDate } from "./types.ts";
import type { Dataset, DishDay, ForecastLine, Model, Profile } from "./types.ts";
const available=(at:string,cutoff:string)=>Date.parse(at)<=Date.parse(cutoff);
const log=(v:number|null)=>Math.log1p(v??0);
export function features(data:Dataset,dishId:string,origin:string):number[]{
 const cutoff=cutoffAt(origin),target=shiftDate(origin,1);
 const today=data.days.find(d=>d.dishId===dishId&&d.date===origin);
 const lookup=(date:string)=>{const d=data.days.find(d=>d.dishId===dishId&&d.date===date);return d&&available(d.finalAt,cutoff)&&d.status==="complete"&&d.supply==="adequate"&&!(d.stockoutMinutes??0)?d.takeFinal:null;};
 const current=today&&available(today.snapshotAt,cutoff)?today.take20:null;
 const previous=lookup(shiftDate(origin,-1)),weekly=lookup(shiftDate(target,-7));
 const dow=new Date(target+"T00:00:00Z").getUTCDay();
 // No current-day final status, stockout, waste, or hidden truth enters these features.
 return [1,...Array.from({length:6},(_,i)=>dow===i+1?1:0),log(current??null),log(previous),log(weekly),current==null?1:0,previous===null?1:0,weekly===null?1:0];
}
function eligible(d:DishDay){return d.status==="complete"&&d.takeFinal!==null&&d.supply==="adequate"&&d.stockoutMinutes===0;}
export function trainingRows(data:Dataset,dishId:string,cutoff:string){
 return data.days.filter(d=>d.dishId===dishId&&eligible(d)&&available(d.finalAt,cutoff)&&data.stores.some(s=>s.date===d.date&&s.status==="open"&&available(s.finalAt,cutoff))).sort((a,b)=>a.date.localeCompare(b.date)).flatMap(d=>{const origin=shiftDate(d.date,-1);if(!data.days.some(p=>p.date===origin&&p.dishId===dishId))return [];return [{date:d.date,x:features(data,dishId,origin),y:log(d.takeFinal)}];});
}
// Solve symmetric positive-definite ridge system via Cholesky, no explicit inverse.
export function solveSPD(a:number[][],b:number[]):number[]{const n=b.length,l=Array.from({length:n},()=>Array(n).fill(0) as number[]);for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let sum=a[i][j];for(let k=0;k<j;k++)sum-=l[i][k]*l[j][k];if(i===j){if(sum<=0||!Number.isFinite(sum))throw new Error("模型矩阵无法分解");l[i][j]=Math.sqrt(sum);}else l[i][j]=sum/l[j][j];}const y=Array(n).fill(0) as number[],x=[...y];for(let i=0;i<n;i++){let v=b[i];for(let j=0;j<i;j++)v-=l[i][j]*y[j];y[i]=v/l[i][i];}for(let i=n-1;i>=0;i--){let v=y[i];for(let j=i+1;j<n;j++)v-=l[j][i]*x[j];x[i]=v/l[i][i];}return x;}
const dot=(a:number[],b:number[])=>a.reduce((n,v,i)=>n+v*b[i],0);
export function fit(data:Dataset,dishId:string,cutoff:string,lambda=1):Model|null{
 const rows=trainingRows(data,dishId,cutoff);if(rows.length<21)return null;
 const origin=cutoff.slice(0,10),n=featureNames.length;
 const matrix=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?(i===0?1e-6:lambda):0)),rhs=Array(n).fill(0) as number[];
 const weights=rows.map(r=>Math.pow(2,-(Date.parse(origin)-Date.parse(r.date))/86400000/7));
 rows.forEach((r,k)=>{const w=weights[k];for(let i=0;i<n;i++){rhs[i]+=w*r.x[i]*r.y;for(let j=0;j<n;j++)matrix[i][j]+=w*r.x[i]*r.x[j];}});
 const coefficients=solveSPD(matrix,rhs);const total=weights.reduce((a,b)=>a+b,0);
 const variance=rows.reduce((n,r,i)=>n+weights[i]*Math.pow(r.y-dot(r.x,coefficients),2),0)/total;
 return {algorithm:"weighted-ridge-log1p-grams-v2",dishId,lambda,samples:rows.length,coefficients,residualSD:Math.sqrt(Math.max(variance,0.0025)),trainedThrough:rows.at(-1)!.date,featureNames};
}
function inverse(v:number){return Math.max(0,Math.expm1(Math.min(v,Math.log1p(1e8))));}
export function predict(data:Dataset,origin:string,buffer=.1,lambdas:Record<string,number>={}):ForecastLine[]{
 return data.catalog.filter(c=>c.launchDate<=shiftDate(origin,1)).map(c=>{
 const model=fit(data,c.id,cutoffAt(origin),lambdas[c.id]??1),x=features(data,c.id,origin);
 const samples=trainingRows(data,c.id,cutoffAt(origin)).length;
 if(!model)return {dishId:c.id,name:c.name,unit:c.unit,demand:null,low:null,high:null,suggested:null,samples,confidence:"observing",explanation:`观察中：${samples}个可用训练样本，至少需要21个；可人工填写试供量。`,model:null};
 const y=dot(x,model.coefficients),round=(v:number)=>Math.ceil(v/10)*10;
 const demand=round(inverse(y+model.residualSD**2/2));
 const history=data.days.filter(d=>d.dishId===c.id&&d.date<origin&&d.date>=shiftDate(origin,-7));
 const confidence=model.samples<45||x.slice(10).some(v=>v>0)||history.some(d=>d.supply!=="adequate"||d.status!=="complete")?"limited":"reference";
 return {dishId:c.id,name:c.name,unit:c.unit,demand,low:round(inverse(y-1.645*model.residualSD)),high:round(inverse(y+1.645*model.residualSD)),suggested:round(demand*(1+buffer)),samples,confidence,explanation:`${samples}个已完成且供应充足样本；近期权重每7天减半，包含星期差异。范围为模型残差的近似参考范围，需回测验证。${confidence==="limited"?"近期供应或数据不完整，可信度有限。":""}`,model};
 });
}
export function profiles(data:Dataset,asOf:string):Profile[]{const cutoff=Date.parse(asOf),end=localDate(asOf),start=shiftDate(end,-6);
 const items=data.catalog.map<Profile>(c=>{const rows=data.days.filter(d=>d.dishId===c.id&&d.date>=start&&d.date<=end&&Date.parse(d.finalAt)<=cutoff).sort((a,b)=>a.date.localeCompare(b.date));const good=rows.filter(d=>eligible(d));const weighted=(f:(d:DishDay)=>number|null)=>{let sum=0,weight=0;for(const d of good){const v=f(d);if(v===null)continue;const w=2**(-(Date.parse(end)-Date.parse(d.date))/86400000/7);sum+=v*w;weight+=w;}return weight?sum/weight:null;};
 let status="数据不足";if(c.launchDate>end)status="未上市";else if(Date.parse(end)-Date.parse(c.launchDate)<7*86400000)status="新菜观察";else if(rows.some(d=>d.supply==="stockout"))status="存在缺菜，不宜判定低偏好";else if(rows.some(d=>d.supply==="unknown"||d.status==="partial"||d.status==="missing"))status="数据不足，供应或称重记录不完整";else if(good.length>=5)status=good.every(d=>d.takeFinal===0)?"持续零取用，人工评估减量/下架":"供应充足，可观察趋势";
 return {dishId:c.id,name:c.name,unit:c.unit,weightedTake:weighted(d=>d.takeFinal),takeG:rows.reduce((n,d)=>n+(d.takeG??0),0),share:null,status,samples:good.length,history:rows.map(d=>({date:d.date,quantity:d.takeFinal,supply:d.supply}))};});const total=items.reduce((n,p)=>n+p.takeG,0);for(const p of items){p.share=total?p.takeG/total:null;const complete=data.days.filter(d=>d.dishId===p.dishId&&d.date>=shiftDate(end,-27)&&d.date<=end&&Date.parse(d.finalAt)<=cutoff&&eligible(d));if(p.status==="供应充足，可观察趋势"&&complete.length>=14&&p.share!==null&&p.share<.01)p.status="长期低取用，人工评估减量/下架（重量占比<1%）";}return items;}
export function backtest(data:Dataset){const dates=[...new Set(data.stores.map(s=>s.date))].sort();if(dates.length<90)throw new Error("60/15/15时间回测至少需要90天数据");const window=dates.slice(0,90),lambdas:Record<string,number>={};if(window.some((d,i)=>i>0&&shiftDate(window[i-1],1)!==d))throw new Error("时间回测需连续90个日历日，缺失日请显式标注");
 for(const c of data.catalog){let best=Infinity;for(const lambda of [.1,1,10]){let sum=0,count=0;for(const target of window.slice(60,75)){const origin=shiftDate(target,-1),m=fit(data,c.id,cutoffAt(origin),lambda),actual=data.days.find(d=>d.dishId===c.id&&d.date===target);if(!m||!actual||!eligible(actual))continue;sum+=Math.abs(inverse(dot(features(data,c.id,origin),m.coefficients)+m.residualSD**2/2)-actual.takeFinal!);count++;}if(count&&sum/count<best){best=sum/count;lambdas[c.id]=lambda;}}}
 const results:{date:string;dishId:string;actual:number;forecast:number;low:number;high:number;suggested:number;adequate:boolean;weightG:number;observedWaste:number|null;stockoutMinutes:number|null}[]=[];
 for(const target of window.slice(75)){const predictions=predict(data,shiftDate(target,-1),.1,lambdas);for(const p of predictions){const d=data.days.find(d=>d.date===target&&d.dishId===p.dishId);if(p.demand===null||!d||d.takeFinal===null||d.status!=="complete")continue;results.push({date:target,dishId:p.dishId,actual:d.takeFinal,forecast:p.demand,low:p.low!,high:p.high!,suggested:p.suggested!,adequate:eligible(d),weightG:1,observedWaste:d.waste,stockoutMinutes:d.stockoutMinutes});}}
 const valid=results.filter(r=>r.adequate),denom=valid.reduce((s,r)=>s+r.actual*r.weightG,0),error=valid.reduce((s,r)=>s+Math.abs(r.actual-r.forecast)*r.weightG,0);
 return {label:"合成数据时间回测，不代表真实预测准确度",split:{training:window.slice(0,60),validation:window.slice(60,75),test:window.slice(75)},lambdas,rows:results,metrics:{evaluated:valid.length,wape:denom?error/denom:null,coverage:valid.length?valid.filter(r=>r.actual>=r.low&&r.actual<=r.high).length/valid.length:null,perDish:data.catalog.map(c=>{const r=valid.filter(r=>r.dishId===c.id);return {dishId:c.id,unit:c.unit,samples:r.length,mae:r.length?r.reduce((s,v)=>s+Math.abs(v.actual-v.forecast),0)/r.length:null};})},note:"所有菜品以克评估误差。缺菜日不作完整需求误差评估；模拟缺口/剩余是计划与需求的对照，不等同于实际报损。"};
}
