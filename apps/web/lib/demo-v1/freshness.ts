import type {Dataset,SceneManifest} from '@zhishan/contracts/demo-v1';
export function demoFreshness(rules:Pick<Dataset['rules'],'displayWarnAfterMs'|'displayExpireAfterMs'>,time:number,startedAtMs:number|null=null,batchId:string|null=null){
 const warning=rules.displayWarnAfterMs??null,expiry=rules.displayExpireAfterMs??null;
 const configured=startedAtMs!==null&&warning!==null&&expiry!==null&&warning<expiry;
 const warningAtMs=configured?startedAtMs+warning:null,expiresAtMs=configured?startedAtMs+expiry:null;
 return {state:!configured?'unconfigured' as const:time>=expiresAtMs!?'expired' as const:time>=warningAtMs!?'warning' as const:'fresh' as const,batchId,startedAtMs,warningAtMs,expiresAtMs};
}
export function plateFreshness(scene:SceneManifest,dataset:Dataset,plateId:string,time:number){
 const plate=scene.plates.find(p=>p.plateId===plateId),slot=scene.slots.find(s=>s.slotId===plate?.slotId);
 if(!scene.tracks.some(t=>t.trackId===slot?.trackId&&t.enabled))return demoFreshness(dataset.rules,time);
 const batch=dataset.servingBatches?.find(b=>b.plateId===plateId&&b.startedAtMs<=time&&(b.endedAtMs===null||time<b.endedAtMs));
 // Refill/weight samples do not replace a batch. Intervals are half-open so a
 // removal and replacement at the same instant cannot count as two active batches.
 return demoFreshness(batch??dataset.rules,time,batch?.startedAtMs??null,batch?.batchId??null);
}
/** Explicit synthetic pre-opening loading log, aligned with each plate's supply-window pass.
 * This is scenario generation, never a runtime fallback for missing batch evidence.
 */
export function initialServingBatches(scene:SceneManifest):NonNullable<Dataset['servingBatches']>{
 return scene.plates.flatMap((plate,index)=>{
  const slot=scene.slots.find(s=>s.slotId===plate.slotId)!,track=scene.tracks.find(t=>t.trackId===slot.trackId)!;
  const window=scene.servingWindows.find(w=>w.trackId===track.trackId);
  if(!track.enabled||!window||track.speedMps<=0)return [];
  const distance=((slot.s0M-window.centerSM)*track.direction%track.lengthM+track.lengthM)%track.lengthM;
  const age=Math.round((distance+(index%4)*track.lengthM)/track.speedMps*1000);
  return [{batchId:`opening:${plate.plateId}`,plateId:plate.plateId,startedAtMs:-age,endedAtMs:null,displayWarnAfterMs:20*60000,displayExpireAfterMs:30*60000}];
 });
}
