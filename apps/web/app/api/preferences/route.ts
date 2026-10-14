import {dataAsOf} from "@/lib/preferences/scenario";
import { freshnessView } from "@/lib/freshness/repository";
import { historyState, historyGuard } from "@/lib/preferences/history-state";
import { z } from "zod";
import { body, checkOrigin, failure, sourceSchema } from "@/lib/http";
import { dateSchema } from "@/lib/preferences/contract";
import { confirm, dashboard, execution, generate } from "@/lib/preferences/repository";
const quantity=z.number().finite().nonnegative().max(1e8),reason=z.string().max(500);
export async function GET(req:Request){ const historyBlocked=await historyGuard(false);if(historyBlocked)return historyBlocked; try{const q=new URL(req.url).searchParams,source=sourceSchema.parse(q.get("source")??"live");const asOf=q.get("asOf")?z.string().datetime({offset:true}).parse(q.get("asOf")):await dataAsOf();const [base,feedback,history]=await Promise.all([dashboard(source,asOf),freshnessView(asOf).then(data=>({data,error:undefined})).catch(()=>({data:undefined,error:"供应反馈暂不可用，备料结果仍可使用"})),historyState()]);return Response.json({...base,...(feedback.data?{supplyFeedback:{asOf,suggestions:feedback.data.suggestions,decisions:feedback.data.decisions}}:{supplyFeedbackError:feedback.error}),history},{headers:{"Cache-Control":"no-store"}});}catch(e){return failure(e,503);}}
export async function POST(req:Request){ const historyBlocked=await historyGuard(true);if(historyBlocked)return historyBlocked; try{checkOrigin(req);const raw=await body(req),{source}=z.object({source:sourceSchema}).parse(raw);const input=z.discriminatedUnion("action",[
 z.object({action:z.literal("generate"),origin:dateSchema,buffer:z.number().min(0).max(1).default(.1),force:z.boolean().default(false)}),
 z.object({action:z.literal("confirm"),forecastId:z.string().uuid(),date:dateSchema,lines:z.array(z.object({dishId:z.string(),quantity,reason})).min(1).max(100)}),
 z.object({action:z.literal("execution"),date:dateSchema,dishId:z.string(),prepared:quantity,added:quantity,kitchenRetained:quantity,ageWaste:quantity,closingWaste:quantity,otherWaste:quantity,note:reason})
 ]).parse(raw);const locked=await historyGuard(true,input.action==="generate"?input.origin:input.date);if(locked)return locked;const at=new Date().toISOString();
 switch(input.action){case "generate":return Response.json(await generate(source,input.origin,input.buffer,input.force));case "confirm":return Response.json(await confirm(source,{forecastId:input.forecastId,date:input.date,lines:input.lines,at}));case "execution":return Response.json(await execution(source,{date:input.date,dishId:input.dishId,prepared:input.prepared,added:input.added,kitchenRetained:input.kitchenRetained,ageWaste:input.ageWaste,closingWaste:input.closingWaste,otherWaste:input.otherWaste,note:input.note,at}));}
 }catch(e){return failure(e);}}
