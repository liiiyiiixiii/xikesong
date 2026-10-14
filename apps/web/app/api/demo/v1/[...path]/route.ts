import { demoRoute } from '@/lib/demo-v1/route';
async function handle(req:Request,context:{params:Promise<{path:string[]}>}){const {path}=await context.params;return demoRoute(req,path.join('/'));}
export const GET=handle;
export const POST=handle;
export const PUT=handle;
export const DELETE=handle;
