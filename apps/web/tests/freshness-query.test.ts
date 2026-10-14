import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshnessWindow } from '../lib/freshness/query.ts';
const now='2026-10-04T09:00:00.000Z';
test('day and week feedback scopes use Shanghai dates and never include future records',()=>{
 assert.deepEqual(freshnessWindow(new URLSearchParams('date=2026-10-03'),now),{mode:undefined,now:'2026-10-03T15:59:59.999Z',from:'2026-10-02T16:00:00.000Z',to:'2026-10-03T15:59:59.999Z'});
 const current=freshnessWindow(new URLSearchParams('startDate=2026-09-28&endDate=2026-10-04'),now);assert.equal(current.to,now);
 for(const query of ['date=2026-10-05','date=2026-02-30','startDate=2026-09-01&endDate=2026-10-04','date=2026-10-03&startDate=2026-10-01','startDate=2026-10-01','mode=unknown'])assert.throws(()=>freshnessWindow(new URLSearchParams(query),now));
});
