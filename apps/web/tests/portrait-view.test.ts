import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PortraitCache,portraitFingerprint,tileWeights,analysisSummary } from '../lib/analysis/view-model.ts';
import { buildWeeklyPortrait } from '../lib/analysis/weeks.ts';
test('treemap retains every positive dish with proportional nonoverlapping bounded area',()=>{
 const rows=Array.from({length:42},(_,i)=>({dishId:`d${i}`,grams:i+1}));const tiles=tileWeights([...rows,{dishId:'zero',grams:0}]);assert.equal(tiles.length,42);
 for(const t of tiles){assert(t.x>=0&&t.y>=0&&t.x+t.width<=100.000001&&t.y+t.height<=100.000001);const grams=rows.find(d=>d.dishId===t.dishId)!.grams;assert(Math.abs(t.width*t.height/10000-grams/903)<1e-10);}
 for(let i=0;i<tiles.length;i++)for(let j=i+1;j<tiles.length;j++){const a=tiles[i],b=tiles[j];assert(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)<1e-9||Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)<1e-9);}
 assert.deepEqual(tileWeights([]),[]);assert.deepEqual(tileWeights([{dishId:'zero',grams:0}]),[]);
});
test('portrait cache reuses data for thirty minutes and evicts least recently read beyond twelve',()=>{
 const c=new PortraitCache<string>();for(let i=0;i<12;i++)c.set(String(i),String(i),0);assert.equal(c.get('0',100),'0');c.set('12','12',100);assert.equal(c.get('1',100),undefined);assert.equal(c.get('0',1799999),'0');assert.equal(c.get('0',1800000),undefined);
});
test('fingerprint ignores poll timestamps but detects statistical, missingness and scope changes',()=>{
 const a=buildWeeklyPortrait({catalog:[],days:[],stores:[]},'2026-09-28','2026-10-04T01:00:00Z');const b=structuredClone(a);b.asOf='2026-10-04T02:00:00Z';assert.equal(portraitFingerprint(a),portraitFingerprint(b));b.current.validSamples=1;assert.notEqual(portraitFingerprint(a),portraitFingerprint(b));
});

test('AI preview skips Markdown and bold section headings to show actual conclusions',()=>{
 assert.equal(analysisSummary('## 结论\n\n实际结论[E1]'),'实际结论[E1]');assert.equal(analysisSummary('**结论**\n\n实际结论[E1]'),'实际结论[E1]');assert.equal(analysisSummary('直接结论[E1]'),'直接结论[E1]');
});
