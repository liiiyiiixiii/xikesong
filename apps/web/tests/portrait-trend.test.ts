import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTrend,trendPoints,type TrendSnapshot } from '../lib/analysis/portrait-trend.ts';
const row=(date:string,share:number|null,cohort='a'):TrendSnapshot=>({date,version:'v1',cohort,dishes:[{dishId:'a',name:'同名菜',share}]});
test('one observation is not a trend; zero is a valid observation',()=>{
 assert.equal(summarizeTrend([{date:'2026-10-04',share:0}]).change,null);
 assert.equal(summarizeTrend([{date:'2026-10-03',share:0},{date:'2026-10-04',share:.02}]).change,2);
});
test('missing days and changed denominators stay gaps, future snapshots excluded',()=>{
 const points=trendPoints([row('2026-10-01',.1),row('2026-10-03',.2,'different'),row('2026-10-04',.3),row('2026-10-05',.8)],'2026-10-04',4,'a');
 assert.deepEqual(points.map(p=>p.share),[.1,null,null,.3]);
 assert.equal(points[2].reason,'模型版本或参与菜品不同');
 assert.equal(Math.round(summarizeTrend(points).change!),20);
});
test('changed model versions and absent dishes are not comparable',()=>{
 const old={...row('2026-10-03',.2),version:'v0'};
 assert.equal(trendPoints([old,row('2026-10-04',.3)],'2026-10-04',2,'a')[0].share,null);
 assert.equal(trendPoints([row('2026-10-04',.3)],'2026-10-04',1,'other')[0].share,null);
});
