import { env } from 'cloudflare:workers';
import rawScene from '../../data/demo-v1/scene-manifest.v1.json';
import rawDataset from '../../data/demo-v1/dataset.json';
import { controlSchema, type ErrorCode } from '@zhishan/contracts/demo-v1';
import { DemoError, digest, validatePackage } from './core.ts';
import { d1Store } from './session.ts';
import { view } from './service.ts';
// Only immutable validated data are cached. Playback authority lives in D1.
let loaded:Awaited<ReturnType<typeof load>>|undefined;
async function load(){
  if(!rawScene||!rawDataset)throw new DemoError('SCENE_NOT_READY','正式场景及数据包尚未生成，请先运行 npm run demo:generate');
  const bundle=await validatePackage(rawScene,rawDataset);for(const e of bundle.dataset.events)Object.freeze(e);Object.freeze(bundle.dataset.events);return {...bundle,fingerprint:await digest(rawDataset)};
}
const statuses:Partial<Record<ErrorCode,number>>={INVALID_REQUEST:400,SCHEMA_INVALID:400,CURSOR_INVALID:400,CURSOR_EXPIRED:410,SCENE_NOT_READY:503,STORAGE_UNAVAILABLE:503,NOT_FOUND:404,METHOD_NOT_ALLOWED:405,LEGACY_RETIRED:410,INTERNAL_ERROR:500};
export function errorResponse(e:unknown,requestId=crypto.randomUUID()){
  const error=e instanceof DemoError?e:new DemoError('INTERNAL_ERROR','演示服务执行失败');
  if(!(e instanceof DemoError))console.error('[demo-v1]',e);
  return Response.json({error:{code:error.code,message:error.message,...(error.details?{details:error.details}:{}),requestId}},{status:statuses[error.code]??409,headers:{'Cache-Control':'no-store'}});
}
export async function demoRoute(req:Request,path:string){
  let requestId=crypto.randomUUID();
  try{
    const isControl=path==='control';
    if(!['state','events','manifest','reports','control'].includes(path))throw new DemoError('NOT_FOUND','演示接口不存在');
    if(req.method!==(isControl?'POST':'GET'))throw new DemoError('METHOD_NOT_ALLOWED','请求方法不支持');
    const url=new URL(req.url);
    if([...url.searchParams.keys()].some(k=>path!=='events'||k!=='after')||url.searchParams.getAll('after').length>1)throw new DemoError('INVALID_REQUEST','无效查询参数');
    let input;
    if(isControl){
      if(req.headers.get('content-type')?.split(';')[0]!=='application/json')throw new DemoError('INVALID_REQUEST','需要 application/json');
      const text=await req.text();if(text.length>4096)throw new DemoError('INVALID_REQUEST','控制请求过大');
      let json;try{json=JSON.parse(text);}catch{throw new DemoError('INVALID_REQUEST','JSON 格式无效');}
      const parsed=controlSchema.safeParse(json);if(!parsed.success)throw new DemoError('INVALID_REQUEST','控制请求格式无效',{issues:parsed.error.issues});input=parsed.data;requestId=input.requestId;
    }
    const bundle=loaded??await load();loaded=bundle;
    if(!env.DB)throw new DemoError('STORAGE_UNAVAILABLE','D1 未连接，无法共享播放会话');
    const db=env.DB.withSession('first-primary');
    // D1 session enforces primary/causal reads for multi-client control consistency.
    const store=d1Store(db as unknown as D1Database,bundle.dataset.datasetId,bundle.fingerprint,bundle.dataset.durationMs);
    let session;try{session=input?await store.control(input):await store.read();}catch(e){if(e instanceof DemoError)throw e;throw new DemoError('STORAGE_UNAVAILABLE','会话存储暂时不可用');}
    const current=view(bundle.scene,bundle.dataset,session,Date.now(),bundle.result);
    return Response.json(path==='events'?current.events(url.searchParams.get('after')??undefined):path==='manifest'?current.manifest:path==='reports'?current.reports:current.state,{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e,requestId);}
}
