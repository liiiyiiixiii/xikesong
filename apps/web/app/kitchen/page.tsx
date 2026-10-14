import type {Metadata} from 'next';
import Kitchen from '@/components/scales/kitchen';
import DemoConsole from '@/components/demo-v1/console';
export const metadata:Metadata={title:'厨房供餐 · 红考拉'};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const q=await searchParams;return q.mode==='live'?<Kitchen/>:<DemoConsole mode="kitchen"/>;}
