import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { buildPortrait,hourlyPortraitQuery } from "../lib/analysis/portrait.ts";
import type { Dataset,DishDay } from "../lib/preferences/types.ts";

const catalog:Dataset["catalog"]=[{id:"a",name:"青菜",category:"蔬菜",unit:"g",pieceWeightG:null,launchDate:"2026-01-01"},{id:"b",name:"牛肉",category:"肉类",unit:"g",pieceWeightG:null,launchDate:"2026-01-01"}];
function row(dishId:string,takeFinal:number|null,extra:Partial<DishDay>={}):DishDay{return {date:"2026-10-01",dishId,status:"complete",take20:null,takeFinal,takeG:takeFinal,opening:null,replenished:null,waste:null,closing:null,supply:"adequate",stockoutMinutes:0,snapshotAt:"2026-10-01T20:00:00+08:00",finalAt:"2026-10-01T23:00:00+08:00",...extra};}
const now="2026-10-04T00:00:00+08:00";
test("portrait computes weight shares, category mix and quality without guest claims",()=>{
  const data:Dataset={catalog,stores:[],days:[row("a",300),row("b",100,{supply:"stockout",stockoutMinutes:40})]};
  const p=buildPortrait(data,"2026-10-01","2026-10-02",now);
  assert.equal(p.totalTakeG,400);assert.equal(p.categories[0].share,.75);assert.equal(p.stockoutDishCount,1);
  assert.equal(p.comparableRecords,1);assert.equal(p.expectedRecords,4);assert.equal(p.completeDays,0);
  assert.equal(p.trend[1].takeG,null);assert.equal(p.peakHour,null);
  assert(p.hourly.every(h=>h.takeG===null));assert(p.notes.some(n=>n.includes("供应约束")));
  assert(!("guestCount" in p));assert(!("gender" in p));
});
test("no data, unknown quantity and true zero stay distinguishable",()=>{
  const data:Dataset={catalog,stores:[],days:[]};
  assert.equal(buildPortrait(data,"2026-10-01","2026-10-01",now).totalTakeG,null);
  data.days=[row("a",null)];assert.equal(buildPortrait(data,"2026-10-01","2026-10-01",now).totalTakeG,null);
  data.days=[row("a",0)];const p=buildPortrait(data,"2026-10-01","2026-10-01",now);
  assert.equal(p.totalTakeG,0);assert.equal(p.categories[0].share,null);assert.equal(p.completeDays,0);
});
test("portrait excludes unavailable records and prelaunch days from expected coverage",()=>{
  const data:Dataset={catalog:[{...catalog[0],launchDate:"2026-10-02"}],stores:[],days:[row("a",400,{date:"2026-10-03",finalAt:"2026-10-05T00:00:00+08:00"})]};
  const p=buildPortrait(data,"2026-10-01","2026-10-03",now);
  assert.equal(p.expectedRecords,2);assert.equal(p.totalTakeG,null);
});
test("hour SQL combines device records by Shanghai hour with coverage dates and excludes future minutes",()=>{
  const db=new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE scale_minutes(source TEXT, minute TEXT, payload TEXT)");
    const insert=db.prepare("INSERT INTO scale_minutes VALUES(?,?,?)");
    for(const [minute,take,source] of [["2026-10-01T09:00:00.000Z",10,"live"],["2026-10-02T09:00:00.000Z",20,"live"],["2026-10-02T10:00:00.000Z",1000,"live"],["2026-10-01T09:00:00.000Z",900,"demo"]] as const) insert.run(source,minute,JSON.stringify({takeG:take}));
    const rows=db.prepare(hourlyPortraitQuery).all("2026-09-30T16:00:00.000Z","2026-10-02T16:00:00.000Z","2026-10-02T10:00:00.000Z");
    assert.equal(rows.length,1);assert.equal(rows[0].hour,17);assert.equal(rows[0].takeG,30);assert.equal(rows[0].days,2);
    const p=buildPortrait({catalog:[],stores:[],days:[]},"2026-10-01","2026-10-02",now,[{hour:17,takeG:30,days:2,recordedMinutes:2}]);
    assert.equal(p.hourly[17].takeG,30);assert.equal(p.hourly[18].takeG,null);assert.equal(p.peakHour,17);
  } finally { db.close(); }
});
