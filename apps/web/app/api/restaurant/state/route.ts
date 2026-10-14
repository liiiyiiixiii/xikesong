import { historyGuard } from "@/lib/preferences/history-state";
import { failure } from "@/lib/http";
import { currentRealtime } from "@/lib/scales/current";
import { restaurantState } from "@/lib/scales/provenance";

export async function GET() {
 const blocked=await historyGuard(false);if(blocked)return blocked;
 try {
  const state=await currentRealtime();
  const generatedAt=new Date().toISOString();
  return Response.json(restaurantState(state,generatedAt),{headers:{"Cache-Control":"no-store"}});
 } catch(e) { return failure(e,503); }
}
