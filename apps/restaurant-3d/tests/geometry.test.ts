import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildGeometry,positionAt,pointAt,distance,nearest,segmentDistance, type SceneManifest} from '../src/demo/layout';
import {validateGeometry} from '../src/demo/validation';
import {canonicalManifest} from '../src/demo/digest';
import {sceneSchema} from '@zhishan/contracts/demo-v1';
const scene=JSON.parse(readFileSync('public/data/scene-manifest.v1.json','utf8')) as SceneManifest;
test('export passes the main system official sceneSchema and canonical digest',()=>{
 assert.equal(sceneSchema.safeParse(scene).success,true);
 assert.equal('sha256:'+createHash('sha256').update(canonicalManifest(scene)).digest('hex'),scene.contentDigest);
 assert.equal(scene.layoutParameters.leftGapPercent,65);assert.equal(scene.layoutParameters.sauceLengthPercent,180);
 assert.equal(scene.sauce.max.z,14.4);assert.equal(scene.sauce.min.z,5.76);
});
test('geometry deterministic and capacity varies with configuration (no 42/14 limit)',()=>{
 const a=buildGeometry(),b=buildGeometry(),c=buildGeometry({seatPitchM:1.4,plateGapM:.55});
 assert.deepEqual(a,b);assert.notEqual(a.slots.length,c.slots.length);assert.notEqual(a.seats.length,c.seats.length);
 for(const m of [a,c])assert.deepEqual(validateGeometry(m).errors,[]);
 assert.equal(scene.plates.length,new Set(scene.plates.map(p=>p.plateId)).size);
 assert.equal(scene.slots.filter(s=>s.usable).length,scene.plates.length);assert.ok(scene.seats.length>14);
});
test('both closed tracks have continuous LUT, complete kitchen windows and separated carriers through every turn',()=>{
 const report=validateGeometry(scene);assert.deepEqual(report.errors,[]);assert.ok(report.conservativePlateClearanceM>.1);
 for(const t of scene.tracks){assert.equal(t.arcLengthLut[0].sM,0);assert.equal(t.arcLengthLut.at(-1)!.sM,t.lengthM);assert.ok(distance(pointAt(t,-.00001),pointAt(t,.00001))<.00003);}
 assert.equal(scene.servingWindows.length,2);assert.equal(scene.tracks.find(t=>t.trackId==='track-backup')!.enabled,false);
});
test('all seat approach routes preserve pedestrian clearance, except final approach to own chair',()=>{
 for(const seat of scene.seats)for(let i=1;i<seat.approachPath.length;i++){
  const a=seat.approachPath[i-1],b=seat.approachPath[i],n=Math.ceil(distance(a,b)/.05);
  for(let k=0;k<=n;k++){const p={x:a.x+(b.x-a.x)*k/n,z:a.z+(b.z-a.z)*k/n};
   assert.ok(scene.walls.every(w=>segmentDistance(p,w.from,w.to)>=scene.config.walkingRadiusM+w.thicknessM/2-.015),`${seat.seatId} path-wall collision`);
   assert.ok(scene.tracks.every(t=>nearest(t,p).d>=scene.config.counterWidthM/2+scene.config.walkingRadiusM-.015),`${seat.seatId} path-counter collision`);
   assert.ok(scene.seats.filter(s=>s.seatId!==seat.seatId).every(s=>distance(p,s.position)>=scene.config.chairRadiusM+scene.config.walkingRadiusM-.02),`${seat.seatId} path-other-chair collision`);
  }
 }
});
test('main track constant speed follows shared milliseconds; disabled track never extrapolates',()=>{
 const main=scene.tracks[0],backup=scene.tracks[1];
 for(const time of [0,1,12345,1000000])assert.deepEqual(positionAt(main,2,time),pointAt(main,2+main.speedMps*time/1000));
 assert.deepEqual(positionAt(backup,2,0),positionAt(backup,2,999999));
});
test('confirmed 65/180 proportions cannot silently fall back to old defaults',()=>{
 assert.throws(()=>buildGeometry({leftGapPercent:50}),/65\/180/);assert.throws(()=>buildGeometry({sauceLengthPercent:140}),/65\/180/);
});
