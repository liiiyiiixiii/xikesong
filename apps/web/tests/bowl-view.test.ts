import test from 'node:test';
import assert from 'node:assert/strict';
import { bowlCards } from '../components/scales/bowl-view.ts';
import type { DishRealtime } from '../lib/scales/types.ts';
test('duplicate dishes produce distinct physical cards with independent remaining weights',()=>{
 const dish: DishRealtime={id:'tofu',name:'豆腐',remainingG:600,fullG:2000,percent:30,rateGPerMinute:null,coverage:1,status:'okay',overfull:false,trend:[],scales:[{id:'s1',dishId:'tofu',dishName:'豆腐',tareG:300,fullG:1000,noiseG:3,enabled:true,position:1,updatedAt:'',netG:0,percent:0,status:'empty',lastAt:null},{id:'s2',dishId:'tofu',dishName:'豆腐',tareG:300,fullG:1000,noiseG:3,enabled:true,position:20,updatedAt:'',netG:600,percent:60,status:'active',lastAt:null}]};
 const cards=bowlCards([dish]);assert.deepEqual(cards.map(c=>c.id),['s1','s2']);assert.deepEqual(cards.map(c=>c.status),['empty','okay']);assert.deepEqual(cards.map(c=>c.remainingG),[0,600]);assert(cards.every(c=>c.scales[0].dishId==='tofu'));assert.equal(dish.scales.length,2);
});
