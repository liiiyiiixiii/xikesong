import { z } from 'zod';
import { dateSchema } from '../preferences/contract.ts';
export function freshnessWindow(params:URLSearchParams,now=new Date().toISOString()){
  const date=params.get('date'),start=params.get('startDate'),end=params.get('endDate');
  if(date&&(start||end))throw new Error('日期与日期范围不能同时使用');
  const mode=z.enum(['timers','feedback']).optional().parse(params.get('mode')??undefined);
  if(!date&&!start&&!end)return {mode,now,from:undefined,to:undefined};
  const first=dateSchema.parse(date??start),last=dateSchema.parse(date??end);
  const from=new Date(first+'T00:00:00+08:00').toISOString(),lastMs=Date.parse(last+'T23:59:59.999+08:00');
  if(last<first||(Date.parse(last)-Date.parse(first))/86400000>30)throw new Error('日期范围应为1至31天');
  if(Date.parse(from)>Date.parse(now))throw new Error('不能查询未来日期');
  return {mode,now:new Date(Math.min(Date.parse(now),lastMs)).toISOString(),from,to:new Date(Math.min(Date.parse(now),lastMs)).toISOString()};
}
