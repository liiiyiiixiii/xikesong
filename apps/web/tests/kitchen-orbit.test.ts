import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrbit, dishSlots, orbitFrame } from '../components/scales/kitchen-orbit.ts';

function verifyCards(cards: {x:number;y:number;size:number}[], width:number, height:number) {
  for (const card of cards) {
    assert(card.x-card.size/2>=-.01 && card.x+card.size/2<=width+.01, 'horizontal clipping');
    assert(card.y-card.size/2>=-.01 && card.y+card.size/2<=height+.01, 'vertical clipping');
  }
  for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){
    const a=cards[i],b=cards[j];
    assert(Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y))>=(a.size+b.size)/2-.01, 'overlapping cards');
  }
}
test('one full cycle keeps 42 unique dishes, the next ten below the node, and a clockwise seam',()=>{
  const orbit=createOrbit(42,1872,910);
  for(let start=0;start<42;start++){
    const before=dishSlots(orbit,start),after=dishSlots(orbit,(start+1)%42);
    assert.equal(new Set(before.map(s=>s.distance)).size,42);
    assert.equal(before.filter(s=>s.featured).length,10);
    assert(before.filter(s=>s.featured && s.y>orbit.cy).length>=6, 'large cards occupy the lower arc and sides');
    assert(before[start].featured);
    assert(!after[start].featured,'dish passing the left node becomes compact');
    assert(after[(start+10)%42].featured,'next incoming dish becomes featured');
    const frame=orbitFrame(orbit,before[start],after[start],.5);
    assert(frame.x<orbit.cx,'outgoing dish travels around the left end, never across the centre');
  }
  assert.deepEqual(dishSlots(orbit,0),dishSlots(orbit,42));
});
for(const [width,height] of [[1872,910],[1318,599],[597,480],[660,550]]){
  test(`no clipping or collisions during forward and reverse transitions at ${width}×${height}`,()=>{
    const orbit=createOrbit(42,width,height),from=dishSlots(orbit,41);
    for(const direction of [1,-1]){
      const to=dishSlots(orbit,(41+direction+42)%42);
      for(let frame=0;frame<=240;frame++){
        const cards=from.map((slot,i)=>orbitFrame(orbit,slot,to[i],frame/240,direction));
        verifyCards(cards,width,height);
        for(const card of cards){
          const radius=((card.x-orbit.cx)/orbit.rx)**2+((card.y-orbit.cy)/orbit.ry)**2;
          assert(Math.abs(radius-1)<.000001,'motion stays on the ellipse');
        }
      }
    }
  });
}
test('empty and small menus have finite geometry and every available dish is featured',()=>{
  for(const count of [0,1,2,5,10,11]){
    const orbit=createOrbit(count,900,600);
    assert.equal(orbit.slots.length,count);
    assert.equal(orbit.slots.filter(s=>s.featured).length,Math.min(10,count));
    verifyCards(orbit.slots,900,600);
    if(count>1)for(let step=0;step<=120;step++){
      const to=dishSlots(orbit,1);
      verifyCards(orbit.slots.map((slot,i)=>orbitFrame(orbit,slot,to[i],step/120)),900,600);
    }
  }
});

test("featured cards remain substantially larger on the screenshot-sized view",()=>{assert(createOrbit(42,660,550).slots[0].size>=85);});
