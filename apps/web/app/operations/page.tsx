import type {Metadata} from 'next';
import Workbench from '@/components/scales/operations-v2/workbench';
export const metadata:Metadata={title:'业务工作台 · 红考拉'};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const query=await searchParams;return <Workbench view={typeof query.view==='string'?query.view:'live'}/>;}
