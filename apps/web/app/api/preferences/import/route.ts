import { historyImport } from "@/lib/preferences/history-import";
import { historyGuard } from "@/lib/preferences/history-state";
import { z } from "zod";
import { failure } from "@/lib/http";
import { authenticate } from "@/lib/scales/credentials";
import { catalogSchema, storeSchema, daySchema } from "@/lib/preferences/contract";
import { saveDataset } from "@/lib/preferences/repository";
const schema=z.object({version:z.literal(1),dataset:z.object({catalog:z.array(catalogSchema).max(100),stores:z.array(storeSchema).max(365),days:z.array(daySchema).max(36500)}).strict()}).strict();
export async function POST(req:Request){try{
 const source=await authenticate(req);if(!source)return Response.json({error:"设备凭证无效"},{status:401});
 const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>2000000)throw new Error("数据超过2MB，请按日期拆分上传");
 const parsed=JSON.parse(raw);if(parsed.version===2){if(["begin","reset"].includes(parsed.action)&&!["127.0.0.1","localhost","[::1]"].includes(new URL(req.url).hostname))throw new Error("维护控制仅允许本地使用");return Response.json(await historyImport(parsed));}const blocked=await historyGuard(true,"0000-00-00");if(blocked)return blocked;const input=schema.parse(parsed);return Response.json({success:true,version:1,...await saveDataset(source,input.dataset)});
}catch(e){return failure(e);}}
