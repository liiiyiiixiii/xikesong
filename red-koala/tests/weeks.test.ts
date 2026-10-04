import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mondayOf,buildWeeklyPortrait,compareWeeks,compareDays,mealQuery } from "../lib/analysis/weeks.ts";
import { shiftDate } from "../lib/preferences/types.ts";
import type { Dataset,DishDay } from "../lib/preferences/types.ts";
import { encryptModelKey,decryptModelKey } from "../lib/analysis/key-crypto.ts";
const catalog:Dataset["catalog"]=[{id:"v",name:"白菜",category:"蔬菜",unit:"g",pieceWeightG:null,launchDate:"2025-01-01"},{id:"m",name:"肥牛",category:"肉类",unit:"g",pieceWeightG:null,launchDate:"2025-01-01"}];
function row(date:string,dishId:string,take:number,extra:Partial<DishDay>={}):DishDay{return {date,dishId,status:"complete",take20:0,takeFinal:take,takeG:take,opening:0,replenished:take,waste:0,closing:0,supply:"adequate",stockoutMinutes:0,snapshotAt:`${date}T20:00:00+08:00`,finalAt:`${date}T23:00:00+08:00`,...extra};}
function fixture():Dataset{const days:DishDay[]=[];for(let i=0;i<28;i++){const date=shiftDate("2026-09-07",i);days.push(row(date,"v",i>=21?70:40),row(date,"m",i>=21?30:60));}return {catalog:structuredClone(catalog),stores:[],days};}
const asOf="2026-10-05T00:00:00+08:00";
test("weeks align to Monday-Sunday including Sunday and year boundaries",()=>{
 assert.equal(mondayOf("2026-10-04"),"2026-09-28");assert.equal(mondayOf("2026-10-05"),"2026-10-05");assert.equal(mondayOf("2027-01-01"),"2026-12-28");
 const report=buildWeeklyPortrait(fixture(),"2026-10-02",asOf);
 assert.equal(report.weekEnd,"2026-10-04");assert.equal(report.daily.length,7);assert.equal(report.fourWeeks.length,4);assert.equal(report.fourWeeks[0].start,"2026-09-07");
});
test("portrait infers dominant type, percentage and stable tendency from eligible samples",()=>{
 const r=buildWeeklyPortrait(fixture(),"2026-09-28",asOf);
 assert.equal(r.current.type,"群体取用画像");assert.equal(r.current.distribution[0].share,.7);assert.equal(r.current.leaderDays,7);assert.match(r.current.conclusion,/取用构成/);assert.match(r.current.suggestion,/每道菜/);
 assert.doesNotMatch(r.daily[0].conclusion,/呈现较持续/);
 assert.equal(r.comparisons[2].comparable,true);assert(Math.abs(r.comparisons[2].changes.find(c=>c.dishId==="v")!.deltaPoints!-30)<1e-9);
});
test("unfinished week comparison pairs same weekdays and never compares full total",()=>{
 const d=fixture(),r=buildWeeklyPortrait(d,"2026-09-28","2026-10-01T10:00:00+08:00");
 assert.equal(r.comparisons[2].pairedDays,3);assert.equal(r.daily[3].inProgress,true);assert.equal(r.daily[4].future,true);assert.equal(r.daily[4].portrait.totalTakeG,null);assert.equal(r.current.validSamples,6);
 const no=compareWeeks(d,"2026-09-28","2026-09-21","2026-09-29T23:30:00+08:00");assert.equal(no.comparable,false);assert(no.changes.every(c=>c.deltaPoints===null));
});
test("stockouts and missing quantities never determine the valid profile or cohort",()=>{
 const d=fixture();d.days=d.days.map(r=>r.date>="2026-09-28"&&r.dishId==="v"?{...r,supply:"stockout",takeFinal:999999,stockoutMinutes:80}:r);
 const r=buildWeeklyPortrait(d,"2026-09-28",asOf);
 assert.equal(r.current.leader,"肥牛");assert.equal(r.current.confidence,"初步观察");assert.equal(r.comparisons[2].pairedSamples,7);assert.equal(r.comparisons[2].changes.find(c=>c.dishId==="m")?.deltaPoints,0);
});
test("period dish percentages are local to the meal and missing periods remain unknown",()=>{
 const r=buildWeeklyPortrait(fixture(),"2026-09-28",asOf,[{date:"2026-09-28",dishId:"v",period:1,takeG:20,observedSeconds:60},{date:"2026-09-28",dishId:"m",period:1,takeG:80,observedSeconds:60},{date:"2026-09-28",dishId:"v",period:3,takeG:90,observedSeconds:60}]);
 assert.equal(r.periods[1].top[0].name,"肥牛");assert.equal(r.periods[1].top[0].share,.8);assert.equal(r.daily[0].periods[3].top[0].share,1);assert.equal(r.daily[1].periods[1].totalG,null);assert.equal(r.periods[0].top.length,0);
});
test("SQL meal grouping uses Shanghai day and exact hour boundaries",()=>{
 const db=new DatabaseSync(":memory:");try{db.exec("CREATE TABLE scale_minutes(source TEXT,minute TEXT,dish_id TEXT,payload TEXT)");const insert=db.prepare("INSERT INTO scale_minutes VALUES(?,?,?,?)");
 for(const [time,value,source] of [["2026-09-28T02:59:00.000Z",1,"live"],["2026-09-28T03:00:00.000Z",2,"live"],["2026-09-28T06:00:00.000Z",3,"live"],["2026-09-28T09:00:00.000Z",4,"live"],["2026-09-28T13:00:00.000Z",5,"live"],["2026-09-28T09:00:00.000Z",999,"demo"]] as const)insert.run(source,time,"v",JSON.stringify({takeG:value,observedSeconds:60}));
 const rows=db.prepare(mealQuery).all("2026-09-27T16:00:00.000Z","2026-10-04T16:00:00.000Z","2026-09-28T14:00:00.000Z");assert.deepEqual(rows.map(r=>r.period),[0,1,2,3,4]);assert.deepEqual(rows.map(r=>r.takeG),[1,2,3,4,5]);assert(rows.every(r=>r.date==="2026-09-28"));
 }finally{db.close();}
});
test("API keys encrypt with random nonce and reject wrong keys and tampering",async()=>{
 const secret="a".repeat(64),plain=JSON.stringify({apiKey:"sensitive-key",model:"deepseek-flash"});
 const a=await encryptModelKey(plain,secret),b=await encryptModelKey(plain,secret);assert.notEqual(a,b);assert(!a.includes("sensitive-key"));assert.equal(await decryptModelKey(a,secret),plain);
 await assert.rejects(decryptModelKey(a,"b".repeat(64)),/无法解密/);const damaged=JSON.parse(a);damaged.data=(damaged.data[0]==="A"?"B":"A")+damaged.data.slice(1);await assert.rejects(decryptModelKey(JSON.stringify(damaged),secret),/无法解密/);await assert.rejects(encryptModelKey(plain,""),/加密配置/);
});

test("daily change uses common valid dishes and does not infer persistent change",()=>{
 const result=compareDays(fixture(),"2026-09-28",asOf);assert.equal(result.pairedDishes,2);assert(Math.abs(result.changes.find(c=>c.dishId==="v")!.deltaPoints-30)<1e-9);assert.match(result.conclusion,/不能单独证明/);
 const missing=compareDays({catalog,stores:[],days:[row("2026-09-28","v",20)]},"2026-09-28",asOf);assert.equal(missing.changes.length,0);assert.match(missing.conclusion,/缺少/);
});

test("zero-take days cannot inflate persistent preference evidence",()=>{
 const d=fixture();d.days=d.days.map(r=>r.date>="2026-09-28"&&r.date!=="2026-09-28"?{...r,takeFinal:0,takeG:0}:r);
 const report=buildWeeklyPortrait(d,"2026-09-28",asOf);assert.equal(report.current.leaderDays,1);assert.doesNotMatch(report.current.conclusion,/呈现较持续/);
});


test("same category and duplicate dish names are analyzed by dish ID independently",()=>{
 const d=fixture();d.catalog=d.catalog.map(c=>({...c,category:"同一类",name:"同名菜"}));
 const r=buildWeeklyPortrait(d,"2026-09-28",asOf);
 assert.equal(r.current.distribution.length,2);assert.equal(r.current.distribution.find(c=>c.dishId==="v")?.share,.7);assert.equal(r.current.distribution.find(c=>c.dishId==="m")?.share,.3);
 assert.equal(r.current.leaderId,"v");assert.equal(r.current.dishInsights.find(c=>c.dishId==="v")?.leadingDays,7);assert.equal(r.current.dishInsights.find(c=>c.dishId==="m")?.leadingDays,0);
 assert(Math.abs(r.comparisons[2].changes.find(c=>c.dishId==="v")!.deltaPoints!-30)<1e-9);
 assert(Math.abs(r.comparisons[2].changes.find(c=>c.dishId==="m")!.deltaPoints!+30)<1e-9);
});
test("all dishes remain inspectable, including missing, stockout-only and zero dishes",()=>{
 const d=fixture();d.catalog.push({...catalog[0],id:"new",name:"新菜"});
 const r=buildWeeklyPortrait(d,"2026-09-28",asOf);const missing=r.current.dishInsights.find(c=>c.dishId==="new")!;
 assert.equal(missing.share,null);assert.equal(missing.grams,null);assert.equal(missing.status,"缺少有效样本");assert.equal(r.current.dishInsights.length,3);
 assert.equal(r.comparisons[2].changes.find(c=>c.dishId==="new")?.deltaPoints,null);
 d.days=d.days.map(v=>v.dishId==="v"?{...v,takeFinal:0,takeG:0}:v);
 const zero=buildWeeklyPortrait(d,"2026-09-28",asOf).current.dishInsights.find(c=>c.dishId==="v")!;assert.equal(zero.share,0);assert.equal(zero.status,"有效样本零取用");
});
test("a dish with only one paired date cannot borrow other dishes' weekly sample count",()=>{
 const d=fixture();d.days=d.days.map(v=>v.dishId==="v"&&v.date>"2026-09-28"?{...v,status:"partial"}:v);
 const change=compareWeeks(d,"2026-09-28","2026-09-21",asOf);assert.equal(change.pairedDays,7);assert.equal(change.changes.find(c=>c.dishId==="v")?.pairedDays,1);assert.equal(change.changes.find(c=>c.dishId==="v")?.deltaPoints,null);
});
test("meal results expose all dishes beyond the leading three",()=>{
 const d=fixture();for(let i=0;i<5;i++)d.catalog.push({...catalog[0],id:`x${i}`,name:`菜${i}`});
 const r=buildWeeklyPortrait(d,"2026-09-28",asOf,d.catalog.map((c,i)=>({date:"2026-09-28",dishId:c.id,period:1,takeG:i+1,observedSeconds:60})));
 assert.equal(r.periods[1].top.length,3);assert.equal(r.periods[1].dishes.length,7);assert(Math.abs(r.periods[1].dishes.reduce((sum,v)=>sum+(v.share??0),0)-1)<1e-10);
});
