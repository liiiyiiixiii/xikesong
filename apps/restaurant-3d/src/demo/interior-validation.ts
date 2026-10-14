import { kitchenChefs, kitchenFixtures, wallPlanters, mixedCounterStaff } from './interior-layout';
import { distance, segmentDistance, type SceneManifest } from './layout';
import { countertopWidth, polygonDistance, polygonsOverlap, PolygonIndex, rectangle, ribbonTriangles } from './dining';

export function validateInterior(m:SceneManifest):string[]{
 const errors:string[]=[];
 const fixtures=kitchenFixtures.map(f=>({id:f.id,polygon:rectangle(f,0,f.width+.06,f.depth+.06)}));
 const counters=new PolygonIndex(m.tracks.flatMap(t=>ribbonTriangles(t,p=>countertopWidth(m,p))));
 const walls=m.walls.map(w=>rectangle({x:(w.from.x+w.to.x)/2,z:(w.from.z+w.to.z)/2},-Math.atan2(w.to.z-w.from.z,w.to.x-w.from.x),distance(w.from,w.to),w.thicknessM));
 for(const [i,f]of fixtures.entries()){
  if(f.polygon.some(p=>p.x<m.kitchen.min.x||p.x>m.kitchen.max.x||p.z<m.kitchen.min.z||p.z>m.kitchen.max.z))errors.push(`${f.id}: outside kitchen`);
  if(counters.overlaps(f.polygon)||walls.some(w=>polygonsOverlap(w,f.polygon)))errors.push(`${f.id}: equipment overlaps counter or wall`);
  for(const other of fixtures.slice(i+1))if(polygonsOverlap(f.polygon,other.polygon))errors.push(`${f.id}/${other.id}: equipment overlap`);
 }
 const workers=[...kitchenChefs,mixedCounterStaff,...m.servingWindows.map(w=>({...w.staffPosition!,id:w.windowId}))];
 for(const w of workers){
  if(fixtures.some(f=>polygonDistance(w,f.polygon)<.29)||counters.within(w,.29)||m.walls.some(wall=>segmentDistance(w,wall.from,wall.to)<.29+wall.thicknessM/2))errors.push(`${w.id}: worker collision`);
 }
 for(let i=0;i<workers.length;i++)for(const other of workers.slice(i+1))if(distance(workers[i],other)<.65)errors.push(`${workers[i].id}/${other.id}: workers overlap`);
 const guestObstacles=[...fixtures,...wallPlanters.map(f=>({id:f.id,polygon:rectangle(f,0,f.width,f.depth)}))];
 // Check complete guest routes against equipment and low wall planters, not just waypoints.
 for(const seat of m.seats){let blocked=false;for(let i=1;i<seat.approachPath.length&&!blocked;i++){
  const a=seat.approachPath[i-1],b=seat.approachPath[i],steps=Math.ceil(distance(a,b)/.05);
  for(let k=0;k<=steps;k++){const p={x:a.x+(b.x-a.x)*k/Math.max(1,steps),z:a.z+(b.z-a.z)*k/Math.max(1,steps)};
   if(guestObstacles.some(f=>polygonDistance(p,f.polygon)<m.navigation.radiusM)){blocked=true;break;}
  }
 }if(blocked)errors.push(`${seat.seatId}: furniture obstructs approach`);}
 return errors;
}
