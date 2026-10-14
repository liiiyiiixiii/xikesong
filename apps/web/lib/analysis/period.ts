import { localDate, shiftDate } from "../preferences/types.ts";
import { datesBetween } from "./statistics.ts";

export const periodQuery=`SELECT dish_id AS dishId,
  date(minute,'+8 hours') AS date, SUM(json_extract(payload,'$.takeG')) AS observedTakeG,
  SUM(json_extract(payload,'$.refillG')) AS observedRefillG,
  SUM(json_extract(payload,'$.observedSeconds')) AS observedDeviceSeconds,
  SUM(json_extract(payload,'$.emptySeconds')) AS emptyDeviceSeconds,
  COUNT(DISTINCT scale_id) AS observedScaleCount, COUNT(*) AS recordedMinutes
  FROM scale_minutes WHERE source='live' AND minute>=? AND minute<? AND minute<?
  AND CAST(strftime('%H',minute,'+8 hours') AS INTEGER)>=?
  AND CAST(strftime('%H',minute,'+8 hours') AS INTEGER)<?
  GROUP BY dish_id,date(minute,'+8 hours') ORDER BY date,dish_id LIMIT 1001`;

export function periodWindow(startDate:string,endDate:string,asOf:string) {
  const dates=datesBetween(startDate,endDate);
  if(dates.length>7) throw new Error("分时段查询最多7天，请缩小日期范围");
  if(startDate<=shiftDate(localDate(asOf),-90)) throw new Error("分钟数据只保留最近90天，不能从日历史还原时段");
  return {dates,from:new Date(`${startDate}T00:00:00+08:00`).toISOString(),
    to:new Date(`${shiftDate(endDate,1)}T00:00:00+08:00`).toISOString(),
    completeBefore:new Date(Math.floor(Date.parse(asOf)/60000)*60000).toISOString()};
}
