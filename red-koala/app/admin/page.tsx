import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Admin from "@/components/scales/admin";
export const metadata:Metadata={title:"管理端 · 红考拉"};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {const query=await searchParams;if(query.view==='freshness')redirect("/admin?view=live");return <Admin initialView={query.view==='intelligence'?'intelligence':query.view==='daily'?'daily':'live'}/>;}
