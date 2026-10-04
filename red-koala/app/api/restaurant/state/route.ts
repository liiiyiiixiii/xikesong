import { historyGuard } from "@/lib/preferences/history-state";
import { failure } from "@/lib/http";
import { currentRealtime } from "@/lib/scales/current";

export async function GET() {
 const blocked=await historyGuard(false);if(blocked)return blocked;
 try {
  const state=await currentRealtime();
  const generatedAt=new Date().toISOString();
  return Response.json({
   schemaVersion:2, revision:Date.parse(generatedAt), generatedAt,
   observedAt:state.at,
   source:state.scenario?"dataset-replay":"live",
   datasetId:state.scenario?.datasetId??null,
   // The scale ledger does not observe customer occupancy.
   customers:null,
   plates:state.dishes.flatMap(dish=>dish.scales.filter(s=>s.enabled).map(s=>({
    slotId:s.position,scaleId:s.id,dishId:dish.id,dishName:dish.name,
    remainingG:s.netG,fullG:s.fullG,status:s.status,observedAt:s.lastAt,
   }))).sort((a,b)=>(a.slotId??Infinity)-(b.slotId??Infinity)),
  },{headers:{"Cache-Control":"no-store"}});
 } catch(e) { return failure(e,503); }
}
