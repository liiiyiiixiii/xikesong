import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { menuDishFilter,scopeMinuteQuery } from '../lib/scales/menu.ts';

test('retired dishes leave the menu, but another enabled bowl keeps the dish active',()=>{
 const allowed=menuDishFilter([{dishId:'retired',enabled:false},{dishId:'active',enabled:false},{dishId:'active',enabled:true}]);
 assert(!allowed('retired'));assert(allowed('active'));assert(allowed('historical-import'));
});
test('aggregate scope excludes retired minutes before summing and retains unconfigured history',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE scale_configs(source TEXT,payload TEXT); CREATE TABLE scale_minutes(source TEXT,dish_id TEXT,grams REAL);');
  for(const [dishId,enabled] of [['retired',false],['active',false],['active',true]] as const)db.prepare('INSERT INTO scale_configs VALUES (?,?)').run('live',JSON.stringify({dishId,enabled}));
  for(const [id,grams] of [['retired',100],['active',20],['imported',30]] as const)db.prepare('INSERT INTO scale_minutes VALUES (?,?,?)').run('live',id,grams);
  assert.equal((db.prepare(scopeMinuteQuery("SELECT SUM(grams) AS total FROM scale_minutes WHERE source='live'")).get() as {total:number}).total,50);
 }finally{db.close();}
});

test('old forecasts show current menu gaps as unknown without rewriting historical predictions',async()=>{
 const {menuForecast}=await import('../lib/scales/menu.ts');
 const configs=Array.from({length:42},(_,i)=>({id:`scale-${i}`,dishId:`dish-${i}`,dishName:`菜品${i}`,enabled:true,tareG:300,fullG:1000,noiseG:3,updatedAt:''}));
 const old:{lines:import("../lib/preferences/types.ts").ForecastLine[]}={lines:[]};const view=menuForecast(old,configs);
 assert.equal(view.lines.length,42);assert.equal(old.lines.length,0);
 assert(view.lines.every(l=>l.suggested===null&&l.demand===null&&l.samples===0));
 assert.equal(menuForecast(view,configs).lines.length,42);
});

test('forecast and export views retain configured menu position',async()=>{
 const {menuForecast}=await import('../lib/scales/menu.ts');const configs=[{id:'b',dishId:'b',dishName:'乙',position:2,enabled:true,tareG:300,fullG:1000,noiseG:3,updatedAt:''},{id:'a',dishId:'a',dishName:'甲',position:1,enabled:true,tareG:300,fullG:1000,noiseG:3,updatedAt:''}];
 assert.deepEqual(menuForecast({lines:[] as import('../lib/preferences/types.ts').ForecastLine[]},configs).lines.map(l=>l.dishId),['a','b']);
});
