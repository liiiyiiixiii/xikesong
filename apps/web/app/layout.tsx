import type { Metadata } from "next";
import "./globals.css";
import "@/components/scales/freshness.css";
import "@/components/scales/realtime.css";
import "@/components/scales/scales.css";
import "@/components/scales/intelligence.css";
import "@/components/scales/kitchen-board.css";
export const metadata:Metadata={title:"红考拉菜品管理",description:"联网秤实时监测菜品余量、取用趋势与每日备料",icons:{icon:"/brand/koala-farm.png",shortcut:"/brand/koala-farm.png"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
