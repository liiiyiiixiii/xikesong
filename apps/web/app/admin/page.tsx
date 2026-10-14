import type {Metadata} from 'next';
import Link from 'next/link';
import Admin from '@/components/scales/admin';
import DemoConsole from '@/components/demo-v1/console';
export const metadata:Metadata={title:'门店运行 · 红考拉'};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const q=await searchParams;if(q.view==='daily'||q.view==='intelligence'||q.mode==='live')return <><div style={{padding:'10px 24px',background:'#f4f6ef',color:'#65745d',fontSize:12}}>原有统计 / 设备数据，来源独立于本次模拟短演示。<Link href="/admin" style={{marginLeft:12}}>返回演示总览</Link></div><Admin initialView={q.view==='daily'?'daily':q.view==='intelligence'?'intelligence':'live'}/></>;return <DemoConsole mode="admin"/>;}
