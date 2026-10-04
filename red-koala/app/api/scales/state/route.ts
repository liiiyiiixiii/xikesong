import { historyGuard } from "@/lib/preferences/history-state";
import { failure, sourceSchema } from "@/lib/http";
import { currentRealtime } from "@/lib/scales/current";
export async function GET(req: Request) {
 const blocked=await historyGuard(false);if(blocked)return blocked;
 try {
  sourceSchema.parse(new URL(req.url).searchParams.get("source")??"live");
  return Response.json(await currentRealtime(),{headers:{"Cache-Control":"no-store"}});
 } catch(e) { return failure(e,503); }
}
