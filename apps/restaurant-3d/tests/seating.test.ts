import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildGeometry, distance, nearest, pointAt, segmentDistance, type Point, type SceneManifest, type Seat} from '../src/demo/layout';
import {validateSeating} from '../src/demo/validation';

const baseline=JSON.parse(readFileSync('tests/fixtures/seating-v1-baseline.json','utf8')) as {
  layoutParameters:SceneManifest['layoutParameters'];
  tracks:{trackId:string;svgPath:string;lengthM:number}[];
  walls:SceneManifest['walls'];
  sauce:SceneManifest['sauce'];
  servingWindows:SceneManifest['servingWindows'];
  seats:Pick<Seat,'seatId'|'trackId'|'position'|'angle'|'grill'>[];
};
const scene=buildGeometry();
let alternateScene:SceneManifest|undefined;
const alternateGeometry=()=>alternateScene??=buildGeometry({seatPitchM:1.4,plateGapM:.55});
const inBox=(p:Point,minX:number,maxX:number,minZ:number,maxZ:number)=>p.x>=minX&&p.x<=maxX&&p.z>=minZ&&p.z<=maxZ;
const mainSeats=scene.seats.filter(s=>s.trackId==='track-main');
const seatsWithin=(minX:number,maxX:number,minZ:number,maxZ:number)=>mainSeats.filter(s=>inBox(s.position,minX,maxX,minZ,maxZ));
function assertStraightRow(seats:Seat[],towardsZ:1|-1,label:string){
  const sorted=[...seats].sort((a,b)=>a.position.x-b.position.x);
  for(const seat of sorted){
    assert.ok(Math.abs(seat.position.z-sorted[0].position.z)<.002,`${label}: chair centers must form a straight row`);
    assert.ok(Math.abs(Math.sin(seat.angle))<.001&&Math.cos(seat.angle)*towardsZ>.999,`${label}: chairs must face the straight counter`);
  }
  for(let i=1;i<sorted.length;i++)assert.ok(Math.abs(distance(sorted[i-1].position,sorted[i].position)-scene.config.seatPitchM)<.025,`${label}: regular chair pitch`);
}

test('longer dining runs preserve kitchen geometry, walls, sauce station and actual supply locations',()=>{
  assert.equal(scene.layoutVersion,'hongkaola-confirmed-65-180-v6');
  assert.deepEqual(scene.layoutParameters,baseline.layoutParameters);
  assert.deepEqual(scene.kitchen.min,{x:0,y:0,z:0});
  assert.deepEqual(scene.kitchen.max,{x:13.1,y:0,z:4.9});
  assert.deepEqual(scene.walls,baseline.walls.filter(w=>!['wall-9','wall-10'].includes(w.wallId)));
  assert.ok(!scene.walls.some(w=>['wall-9','wall-10'].includes(w.wallId)), 'central kitchen partition removed');
  assert.deepEqual(scene.sauce,baseline.sauce);
  assert.equal(scene.servingWindows.length,baseline.servingWindows.length);
  for(const old of baseline.servingWindows){
    const current=scene.servingWindows.find(w=>w.windowId===old.windowId)!;
    assert.ok(current,`${old.windowId}: kitchen supply window removed`);
    assert.equal(current.trackId,old.trackId);
    assert.ok(distance(current.position,old.position)<1e-5,`${old.windowId}: actual serving point moved`);
    assert.equal(current.position.y,old.position.y);
    assert.deepEqual(current.staffPosition,old.staffPosition);
    assert.equal(current.halfWidthM,old.halfWidthM);
    const track=scene.tracks.find(t=>t.trackId===current.trackId)!;
    assert.ok(distance(pointAt(track,current.centerSM),current.position)<1e-5,'updated arc length must locate the fixed supply point');
  }
  assert.equal(scene.navigation.gridM,.10);
});

test('adjustable dining runs retain both closed-loop routes and the kitchen and left-leg anchors',()=>{
  assert.deepEqual(scene.tracks.map(t=>t.trackId),baseline.tracks.map(t=>t.trackId));
  for(const track of scene.tracks){
    assert.ok(distance(track.arcLengthLut[0],track.arcLengthLut.at(-1)!)<1e-5);
    assert.equal(track.arcLengthLut.at(-1)!.sM,track.lengthM);
    const geometricLength=track.arcLengthLut.slice(1).reduce((sum,p,i)=>sum+distance(track.arcLengthLut[i],p),0);
    assert.ok(Math.abs(geometricLength-track.lengthM)<1e-5,'declared length must follow the revised LUT');
    assert.deepEqual(track.path,track.arcLengthLut.map(({x,y,z})=>({x,y,z})));
  }
  const main=scene.tracks.find(t=>t.trackId==='track-main')!,backup=scene.tracks.find(t=>t.trackId==='track-backup')!;
  for(const anchor of [{x:2.258,z:4.8},{x:2.258,z:13.4},{x:2.898,z:13.4},{x:2.898,z:9.56},{x:3.858,z:8.6},{x:2.898,z:7}])assert.ok(nearest(main,anchor).d<.011,'main left-leg topology must be retained');
  for(const anchor of [{x:11.7,z:1.68},{x:11.7,z:2.32},{x:13.1,z:1.68},{x:13.1,z:2.32}])assert.ok(nearest(backup,anchor).d<.011,'standby loop must retain its kitchen passage');
});

test('all earlier marked regions remain seated after the dining runs are extended',()=>{
  // World-space checks are independent of the generator's zone definitions.
  assert.equal(seatsWithin(3.4,4.6,5.4,7.3).length,2,'two circles below the kitchen');
  const northRow=seatsWithin(4.8,14.7,6.5,7.2).filter(s=>Math.abs(Math.sin(s.angle))<.001&&Math.cos(s.angle)>0);
  assert.ok(northRow.length>=9,'original eight northern seats plus the new straight upper-right seat');
  assert.ok(northRow.some(s=>s.position.x<5.5),'left shoulder of the long circled row');
  northRow.sort((a,b)=>a.position.x-b.position.x);
  for(let i=1;i<northRow.length;i++)assert.ok(Math.abs(distance(northRow[i-1].position,northRow[i].position)-scene.config.seatPitchM)<.025,'north row preserves the regular chair pitch');
  assert.ok(seatsWithin(3.4,4.7,9.4,10.5).length>=1,'missing inner seat below the left elbow');
  assert.ok(seatsWithin(13.2,14.5,9.0,11.5).length>=2,'inner side of the right return');
  assert.ok(seatsWithin(15.2,17.2,7.2,13.6).length>=4,'outer side and shoulders of the right return');
  assert.equal(seatsWithin(.8,1.8,12.8,13.8).length,1,'outer shoulder of the bottom-left U-turn');
  assert.equal(seatsWithin(3.4,4.7,12.8,13.8).length,1,'inner shoulder of the bottom-left U-turn');
  assert.ok(seatsWithin(8.8,11.0,11.4,13.5).length>=1,'left tip of the extended short return');
  const cornerSeats=scene.seats.filter(s=>s.trackId==='track-backup'&&inBox(s.position,25.5,28,1.3,3.5));
  assert.ok(cornerSeats.length>=1,'standby track upper-right corner');
  assert.ok(cornerSeats.some(s=>Math.abs(Math.sin(s.angle)*Math.cos(s.angle))>.1),'the corner chair follows the curved counter rather than a straight-run orientation');
});

test('unaffected main-left chairs retain identities and positions while revised dining runs can be reseated',()=>{
  const movedSeatId='track-main-seat-54460-L';
  const retained=baseline.seats.filter(s=>s.trackId==='track-main'&&(s.position.x<12.1&&s.position.z<12.3&&s.position.z>8.8||s.position.x<4.7));
  for(const old of retained){
    const current=scene.seats.find(s=>s.seatId===old.seatId);
    assert.ok(current,`${old.seatId}: existing identity lost`);
    assert.equal(current.trackId,old.trackId);
    if(old.seatId===movedSeatId){
      assert.ok(distance(current.position,old.position)>.1,'incorrectly placed kitchen-side chair must move');
      assert.ok(inBox(current.position,3.4,4.6,5.4,6.0));
    }else{
      assert.deepEqual(current.position,old.position,`${old.seatId}: chair outside the adjustment must stay in place`);
      assert.equal(current.angle,old.angle,`${old.seatId}: chair orientation changed`);
    }
  }
  assert.ok(scene.seats.length>baseline.seats.length,'new chairs must increase usable capacity');
  assert.equal(new Set(scene.seats.map(s=>s.seatId)).size,scene.seats.length);
});

test('new marked areas contain a complete upper standby row and straight seats at all three missing ends',()=>{
  const upperBackup=scene.seats.filter(s=>s.trackId==='track-backup'&&inBox(s.position,16,25.5,1.1,1.7));
  assert.ok(upperBackup.length>=7,'standby upper counter must have a full row of chairs');
  assertStraightRow(upperBackup,1,'standby upper row');
  const mainUpper=seatsWithin(13.7,14.5,6.5,7.2);
  assert.ok(mainUpper.length>=1,'main upper-right corner must have a straight seat');
  assertStraightRow(mainUpper,1,'main upper-right extension');
  for(const {minZ,maxZ,direction,label} of [
    {minZ:10.6,maxZ:11.3,direction:1 as const,label:'short return upper row'},
    {minZ:13.4,maxZ:14.2,direction:-1 as const,label:'short return lower row'},
  ]){
    const added=seatsWithin(10.8,11.7,minZ,maxZ);
    assert.ok(added.length>=1,`${label}: missing left seat must be present`);
    assertStraightRow(added,direction,label);
    const row=seatsWithin(10.8,15.2,minZ,maxZ).filter(s=>Math.abs(Math.sin(s.angle))<.001);
    assert.ok(row.length>=2,`${label}: the added chair joins a regular row`);
    assertStraightRow(row,direction,label);
  }
});

test('both pitch configurations seat the actual main upper-right arc, independently of the north-row endpoint',()=>{
  for(const m of [scene,alternateGeometry()]){
    const track=m.tracks.find(t=>t.trackId==='track-main')!,center={x:14.10+m.config.mainRightExtensionM,z:8.92};
    const arcSeats=m.seats.filter(seat=>{
      if(seat.trackId!==track.trackId)return false;
      const at=pointAt(track,seat.takeWindow.centerSM);
      return at.x>center.x+.10&&at.z<center.z-.10&&Math.abs(distance(at,center)-.96)<.015;
    });
    assert.ok(arcSeats.length>=2,`pitch ${m.config.seatPitchM}: both actual bend positions need chairs; a straight-row endpoint is insufficient`);
    for(const seat of arcSeats){
      const at=pointAt(track,seat.takeWindow.centerSM),before=pointAt(track,seat.takeWindow.centerSM-.12),after=pointAt(track,seat.takeWindow.centerSM+.12);
      assert.ok(Math.cos(after.angle-before.angle)<Math.cos(.10),`${seat.seatId}: pickup must lie on a curved portion of the LUT`);
      assert.ok(seat.position.x>at.x+.2&&seat.position.z<at.z-.2,`${seat.seatId}: chair must occupy the outside of the actual bend`);
      assert.ok(Math.sin(seat.angle)<-.2&&Math.cos(seat.angle)>.2,`${seat.seatId}: bend chair must face its counter rather than remain axis-aligned`);
      assert.ok(seat.approachPath.length>=3,`${seat.seatId}: bend chair needs an entrance route`);
    }
    assert.deepEqual(validateSeating(m),[],`pitch ${m.config.seatPitchM}: complete footprint and route validation`);
  }
});

test('both inner-right row ends have real new seats rather than counting the adjacent vertical pair',()=>{
  let expectedIds:string[]|undefined;
  for(const m of [scene,alternateGeometry()]){
    const track=m.tracks.find(t=>t.trackId==='track-main')!,ids:string[]=[];
    for(const {z,windowZ,direction,label} of [
      {z:9.70,windowZ:8.60,direction:-1,label:'middle horizontal row right end'},
      {z:10.98,windowZ:12.08,direction:1,label:'short horizontal row right end'},
    ]){
      const matches=m.seats.filter(s=>s.trackId===track.trackId&&inBox(s.position,12.9,13.3,z-.15,z+.15));
      assert.equal(matches.length,1,`pitch ${m.config.seatPitchM}: ${label} must contain its own seat`);
      const seat=matches[0],at=pointAt(track,seat.takeWindow.centerSM);ids.push(seat.seatId);
      assert.ok(!baseline.seats.some(old=>old.seatId===seat.seatId),`${label}: must have a new stable identity`);
      assert.ok(Math.abs(Math.sin(seat.angle))<.001&&Math.cos(seat.angle)*direction>.999,`${label}: adjacent vertical seating cannot substitute for the horizontal endpoint`);
      assert.ok(Math.abs(at.z-windowZ)<1e-5&&Math.abs(at.x-seat.position.x)<1e-5,`${label}: pickup must belong to the correct horizontal run`);
      const row=m.seats.filter(s=>s.trackId===track.trackId&&Math.abs(s.position.z-z)<.002&&Math.cos(s.angle)*direction>.999).sort((a,b)=>a.position.x-b.position.x);
      assert.equal(row.at(-1)!.seatId,seat.seatId,`${label}: the new chair must close the right end of the row`);
      assert.ok(row.length>=2);
      assert.ok(Math.abs(distance(row.at(-2)!.position,seat.position)-m.config.seatPitchM)<.03,`${label}: end spacing must match its row`);
      assert.ok(seat.approachPath.length>=3&&distance(seat.approachPath.at(-1)!,seat.position)<1e-5,`${label}: new chair must have its own valid approach`);
    }
    if(expectedIds)assert.deepEqual(ids,expectedIds,'the two authored endpoints retain their identities across pitch configurations');else expectedIds=ids;
  }
});

test('the bottom outer straight run has its own right-end chair in both pitch configurations',()=>{
  let endpointId:string|undefined;
  for(const m of [scene,alternateGeometry()]){
    const track=m.tracks.find(t=>t.trackId==='track-main')!;
    const matches=m.seats.filter(s=>s.trackId===track.trackId&&inBox(s.position,14.4,14.85,13.65,14.0));
    assert.equal(matches.length,1,`pitch ${m.config.seatPitchM}: the bottom row needs a separate chair before the right bend`);
    const seat=matches[0],at=pointAt(track,seat.takeWindow.centerSM);
    assert.ok(Math.abs(Math.sin(seat.angle))<.001&&Math.cos(seat.angle)<-.999,'the diagonal bend chair cannot substitute for the missing straight-row chair');
    assert.ok(Math.abs(at.x-seat.position.x)<1e-5&&Math.abs(at.z-12.72)<1e-5,'pickup must belong to the bottom outer horizontal run');
    const before=pointAt(track,seat.takeWindow.centerSM-.03),after=pointAt(track,seat.takeWindow.centerSM+.03);
    assert.ok(Math.abs(before.z-12.72)<1e-5&&Math.abs(after.z-12.72)<1e-5&&after.x>before.x,'the pickup anchor must be on the straight segment before the turn');
    const row=m.seats.filter(s=>s.trackId===track.trackId&&inBox(s.position,10.8,15.0,13.80,13.84)).sort((a,b)=>a.position.x-b.position.x);
    if(m===scene)assert.equal(row.length,4,'the default bottom row must contain its missing fourth chair');else assert.ok(row.length>=3);
    assert.equal(row.at(-1)!.seatId,seat.seatId);
    for(let i=1;i<row.length;i++)assert.ok(Math.abs(distance(row[i-1].position,row[i].position)-m.config.seatPitchM)<.025,'the new endpoint must keep the row regularly spaced');
    assert.ok(seat.approachPath.length>=3&&distance(seat.approachPath.at(-1)!,seat.position)<1e-5,'the new endpoint needs an entrance-connected approach');
    if(endpointId)assert.equal(seat.seatId,endpointId,'the endpoint retains its authored identity across pitch changes');else endpointId=seat.seatId;
  }
});

test('standby upper chairs have a continuous clear aisle behind them and entrance-connected approaches',()=>{
  const row=scene.seats.filter(s=>s.trackId==='track-backup'&&inBox(s.position,16,25.5,1.1,1.7)).sort((a,b)=>a.position.x-b.position.x);
  assert.ok(row.length>=7);
  const aisle=row.map(s=>({x:s.position.x,z:s.position.z-.65}));
  const clear=(p:Point)=>{
    const radius=scene.config.walkingRadiusM;
    assert.ok(scene.walls.every(w=>segmentDistance(p,w.from,w.to)>=radius+w.thicknessM/2), 'upper aisle must clear walls');
    assert.ok(scene.tracks.every(t=>nearest(t,p).d>=radius+scene.config.counterWidthM/2),'upper aisle must clear counters');
    assert.ok(scene.seats.every(s=>distance(p,s.position)>=radius+scene.config.chairRadiusM),'upper aisle must clear all chairs');
  };
  for(let i=1;i<aisle.length;i++){
    const a=aisle[i-1],b=aisle[i],steps=Math.ceil(distance(a,b)/.05);
    for(let k=0;k<=steps;k++)clear({x:a.x+(b.x-a.x)*k/steps,z:a.z+(b.z-a.z)*k/steps});
  }
  for(const seat of row){
    assert.ok(seat.approachPath.length>=3,'each upper-row chair needs its own connected route');
    assert.ok(distance(seat.approachPath[0],scene.entry)<=scene.navigation.gridM*Math.SQRT2);
    assert.ok(distance(seat.approachPath.at(-1)!,seat.position)<1e-5);
  }
});

test('every usable chair faces its own paired grill and pickup window',()=>{
  for(const seat of scene.seats){
    const track=scene.tracks.find(t=>t.trackId===seat.trackId)!;
    const at=pointAt(track,seat.takeWindow.centerSM);
    assert.ok(seat.usable,`${seat.seatId}: discarded candidate leaked into capacity`);
    assert.equal(seat.takeWindow.trackId,seat.trackId);
    assert.ok(distance(at,seat.takeWindow.position)<1e-5,`${seat.seatId}: stale pickup position`);
    const facing={x:Math.sin(seat.angle),z:Math.cos(seat.angle)};
    for(const target of [seat.grill,seat.takeWindow.position]){
      const dx=target.x-seat.position.x,dz=target.z-seat.position.z;
      assert.ok(dx*facing.x+dz*facing.z>0,`${seat.seatId}: faces away from dining setting`);
      assert.ok(Math.abs(dx*facing.z-dz*facing.x)<.002,`${seat.seatId}: chair and dining setting are misaligned`);
    }
    assert.ok(distance(seat.position,seat.grill)<distance(seat.position,seat.takeWindow.position),`${seat.seatId}: grill beyond conveyor`);
  }
  assert.deepEqual(validateSeating(scene),[]);
});

test('seating validation rejects overlapping chairs and misplaced grill footprints',()=>{
  const overlapping=structuredClone(scene);
  overlapping.seats[1].position={...overlapping.seats[0].position};
  assert.ok(validateSeating(overlapping).some(error=>error.endsWith(': chairs overlap')),'overlapping chairs must not be admitted');
  const offCounter=structuredClone(scene);
  offCounter.seats[0].grill={x:scene.entry.x,z:scene.entry.z};
  assert.ok(validateSeating(offCounter).includes(`${offCounter.seats[0].seatId}: grill unsupported by counter`),'a grill outside the counter must not be admitted');
});

test('grill support checks the complete footprint, even when its center remains on the counter',()=>{
  const overhang=structuredClone(scene),seat=overhang.seats.find(s=>s.zoneId==='main-north-row')!;
  const track=overhang.tracks.find(t=>t.trackId===seat.trackId)!,at=pointAt(track,seat.takeWindow.centerSM);
  seat.grill={x:at.x-Math.sin(seat.angle)*.60,z:at.z-Math.cos(seat.angle)*.60};
  assert.ok(nearest(track,seat.grill).d<overhang.config.counterWidthM/2,'test center must remain supported');
  assert.ok(validateSeating(overhang).includes(`${seat.seatId}: grill unsupported by counter`),'the unsupported edge must fail even though the center is on the counter');
});

test('seating validation rejects missing routes and paths crossing a conveyor',()=>{
  const missing=structuredClone(scene);
  missing.seats[0].approachPath=[];
  assert.ok(validateSeating(missing).includes(`${missing.seats[0].seatId}: no valid approach route`),'a seat without an entrance route must not be admitted');
  const crossing=structuredClone(scene),seat=crossing.seats[0];
  const track=crossing.tracks.find(t=>t.trackId===seat.trackId)!;
  seat.approachPath=[{...crossing.entry},pointAt(track,seat.takeWindow.centerSM),{...seat.position}];
  assert.ok(validateSeating(crossing).some(error=>error.startsWith(`${seat.seatId}: approach route collides with `)),'a route with valid endpoints but a counter crossing must be rejected');
});

test('publication coverage is checked against real seats even when summary metadata is stale',()=>{
  const missingCircle=structuredClone(scene);
  const removed=missingCircle.seats.filter(s=>s.zoneId==='main-return-end');
  assert.equal(removed.length,1,'the short-return circle starts with one valid seat');
  // Keep the generated per-zone actualSeats untouched to simulate stale publication metadata.
  missingCircle.seats=missingCircle.seats.filter(s=>s.zoneId!=='main-return-end');
  assert.equal(missingCircle.seatingZones.find(z=>z.zoneId==='main-return-end')!.actualSeats,1,'stale summary intentionally still claims the seat exists');
  assert.ok(validateSeating(missingCircle).some(error=>error.includes('main-return-end')),'removing a required circle seat must fail regardless of cached zone counts');
});
