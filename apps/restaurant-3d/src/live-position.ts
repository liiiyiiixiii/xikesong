import {conveyorStateSchema} from '@zhishan/contracts/v2/kitchen';
/** Schematic circular tracks. No demo geometry or scale/binding substitution. */
export function livePositions(snapshot:ReturnType<typeof conveyorStateSchema.parse>|null,elapsedMs:number){
 const points=new Map<string,{x:number;z:number}>();
 if(!snapshot||elapsedMs<0)return points;
 snapshot.tracks.forEach((track,i)=>{
  if(track.quality!=='estimated'||!track.validUntil||Date.parse(snapshot.serverAt)+elapsedMs>Date.parse(track.validUntil))return;
  const radius=Math.max(.6,Math.min(2,track.lengthM/(2*Math.PI))),center=(i-(snapshot.tracks.length-1)/2)*4.8;
  for(const p of track.positions){const angle=2*Math.PI*(p.positionM+track.direction*(track.speedMps??0)*elapsedMs/1000)/track.lengthM;points.set(p.scaleId,{x:center+radius*Math.cos(angle),z:2.2+radius*Math.sin(angle)});}
 });return points;
}
