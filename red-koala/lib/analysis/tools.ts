import {scenarioContext,scenarioRealtime} from "../preferences/scenario";
import { freshnessView } from "../freshness/repository.ts";
import { scopeMinuteQuery } from "../scales/menu.ts";
import { loadWeeklyPortrait } from "./weekly-repository.ts";
import { env } from "cloudflare:workers";
import { readDataset } from "../preferences/repository.ts";
import { predict } from "../preferences/model.ts";
import { cutoffAt, localDate, shiftDate } from "../preferences/types.ts";
import { dailySummary, realtime, readConfigs } from "../scales/repository.ts";
import type { AnalysisRequest } from "./contract.ts";
import type { Execute } from "./agent.ts";
import { summarizeDays } from "./statistics.ts";
import { periodQuery, periodWindow } from "./period.ts";

export function createTools(input:AnalysisRequest,asOf:string):Execute {
  // Lazy request-local cache; never share business data between requests.
  let dataset:ReturnType<typeof readDataset>|undefined;
  const data=()=>dataset??=readDataset("live");
  return async(name,args)=>{
    if(name==="weekly_portrait") {
      const weekly=await loadWeeklyPortrait(input.endDate,asOf);
      const compact=(w:Omit<typeof weekly.current,"start"|"end">)=>({type:w.type,conclusion:w.conclusion,confidence:w.confidence,coverage:w.coverage,validSamples:w.validSamples,distribution:w.distribution,suggestion:w.suggestion});
      return {title:"自然周画像与四周配对分析",data:{weekStart:weekly.weekStart,weekEnd:weekly.weekEnd,asOf,method:weekly.method,current:compact(weekly.current),daily:weekly.daily.map(d=>({date:d.date,future:d.future,inProgress:d.inProgress,...compact(d),dailyChange:d.dailyChange,periods:d.periods.map(p=>({id:p.id,name:p.name,hours:p.hours,totalG:p.totalG,top:p.top}))})),fourWeeks:weekly.fourWeeks.map(w=>({start:w.start,end:w.end,...compact(w)})),periods:weekly.periods,periodError:weekly.periodError,comparisons:weekly.comparisons}};
    }
    if(name==="freshness_feedback") {
      const result=await freshnessView(asOf,new Date(input.startDate+"T00:00:00+08:00").toISOString(),new Date(Math.min(Date.parse(asOf),Date.parse(input.endDate+"T23:59:59.999+08:00"))).toISOString());
      return {title:"菜品超时撤下与供应调整反馈",data:{asOf,startDate:input.startDate,endDate:input.endDate,note:"按撤下日期筛选，以批次上台时段分组。观测不完整不能作为完整需求；阈值为可解释首版规则，非经验证预测。一次超时不代表无人需要。结合日统计和时段取用再建议，缺客流不能归因。决策是人工执行记录，不代表已自动修改计划或菜单。",feedback:result.feedback,suggestions:result.suggestions,decisions:result.decisions.filter(d=>d.at<=asOf)}};
    }
    if(name==="daily_statistics") return {title:"菜品日统计与供应质量",data:summarizeDays(await data(),input.startDate,input.endDate,asOf)};
    if(name==="current_state") {
      const [state,summary]=await Promise.all([(await scenarioContext())?scenarioRealtime():realtime("live",asOf),dailySummary("live",localDate(asOf),asOf)]);
      return {title:"当前余量与今日观测",data:{asOf,note:"统一模拟模式下为数据集回放快照；覆盖不足时取用只是已观测量，不能作为完整需求。今日统计和已保存日统计不可相加。",dishes:state.dishes.map(d=>({dishId:d.id,name:d.name,remainingG:d.remainingG,status:d.status,coverage:d.coverage,rateGPerMinute:d.rateGPerMinute})),summary}};
    }
    if(name==="preparation_forecast") {
      const origin=Date.parse(cutoffAt(input.endDate))<=Date.parse(asOf)?input.endDate:shiftDate(input.endDate,-1);
      const records=await data();
      return {title:"只读明日全天备料预测",data:{originDate:origin,targetDate:shiftDate(origin,1),cutoff:cutoffAt(origin),calculatedAt:asOf,buffer:.1,
        note:"调用现有重量模型，默认正则化参数1、余量10%；这是本次只读试算，不是已保存或已确认计划，未复用历史回测调参。不能分摊为晚餐预测。少于21个有效样本不输出数值。",
        lines:predict(records,origin).map(line=>({dishId:line.dishId,name:line.name,unit:line.unit,demand:line.demand,low:line.low,high:line.high,suggested:line.suggested,samples:line.samples,confidence:line.confidence,explanation:line.explanation}))}};
    }
    if(name==="period_statistics") {
      if(!env.DB) throw new Error("数据库未连接");
      const {dates,from,to,completeBefore}=periodWindow(input.startDate,input.endDate,asOf);
      const startHour=args.startHour as number,endHour=args.endHour as number;
      // Aggregate in SQL to avoid loading millions of minute buckets into the Worker.
      const result=await env.DB.prepare(scopeMinuteQuery(periodQuery))
        .bind(from,to,completeBefore,startHour,endHour)
        .all<{dishId:string;date:string;observedTakeG:number;observedRefillG:number;observedDeviceSeconds:number;emptyDeviceSeconds:number;observedScaleCount:number;recordedMinutes:number}>();
      if(result.results.length>1000) throw new Error("时段结果过多，请缩小日期范围");
      const [records,configs]=await Promise.all([data(),readConfigs("live")]);
      const names=new Map([...records.catalog.map(c=>[c.id,c.name] as const),...configs.map(c=>[c.dishId,c.dishName] as const)]);
      return {title:`${startHour}:00–${endHour}:00 时段观测`,data:{startDate:input.startDate,endDate:input.endDate,startHour,endHour,timeZone:"Asia/Shanghai",asOf,unit:"g",
        note:"仅完整分钟、左闭右开。每行仅为已观测量，不代表完整需求。无记录的日期/菜品是缺失，不是零。设备观测秒数不是菜品供应时长；空盘设备秒数不能直接相加成菜品缺菜时长。没有历史设备配置，无法证明全时段完整覆盖。当前未到的时段无数据。",
        datesWithoutRecords:dates.filter(date=>!result.results.some(r=>r.date===date)),rows:result.results.map(r=>({...r,name:names.get(r.dishId)??r.dishId}))}};
    }
    throw new Error("工具不存在");
  };
}
