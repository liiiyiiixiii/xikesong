import {lunchState} from '@/lib/demo/lunch';
export async function GET(){return Response.json(lunchState(),{headers:{'Cache-Control':'no-store'}});}
