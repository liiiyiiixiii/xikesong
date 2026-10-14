import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateDay } from '../lib/history/generate.mjs';
import { validateBundle } from '../lib/history/validate.mjs';
test('fixed seed reproduces whole event stream and twenty-seat conservation',()=>{
 const a=simulateDay(0),b=simulateDay(0);assert.deepEqual(a,b);assert.equal(a.bundles.length,36);assert(a.report.maxSeats<=20);a.bundles.forEach(validateBundle);
});
test('device interruption retains null observations and does not leak guest targets',()=>{
 const a=simulateDay(5),b=a.bundles.find(b=>b.daily.status==='partial');assert(b);validateBundle(b);assert.equal(b.minutes.filter(m=>m.observedSeconds===0).length,12);assert(!JSON.stringify(b).includes('targetG'));assert.equal(b.daily.takeFinal,null);
});
test('tampered minute totals and kitchen balance are rejected',()=>{const b=simulateDay(0).bundles[0];b.minutes[0].takeG++;assert.throws(()=>validateBundle(b));});
