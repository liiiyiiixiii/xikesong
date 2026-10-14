import { dateSchema } from '../preferences/contract.ts';
import { localDate, shiftDate, type Dataset } from '../preferences/types.ts';

export interface DateRange { startDate: string; endDate: string }

/** Bound reports by records available at the analysis clock, not the server's calendar date. */
export function availableDateRange(data: Dataset, asOf: string): DateRange | null {
  const dates = [...new Set(data.days.filter(day => day.date <= localDate(asOf) && Date.parse(day.finalAt) <= Date.parse(asOf)).map(day => day.date))].sort();
  return dates.length ? { startDate: dates[0], endDate: dates[dates.length - 1] } : null;
}

export function reportDateRange(requested: Partial<DateRange>, available: DateRange, maxDays = 7): DateRange {
  if (!!requested.startDate !== !!requested.endDate) throw new Error('请同时提供开始和结束日期');
  const endDate = dateSchema.parse(requested.endDate ?? available.endDate);
  const startDate = dateSchema.parse(requested.startDate ?? [available.startDate, shiftDate(endDate, 1 - maxDays)].sort().at(-1)!);
  if (startDate > endDate) throw new Error('结束日期不能早于开始日期');
  if (startDate < available.startDate || endDate > available.endDate) throw new Error('所选范围超出当前数据可用日期');
  if ((Date.parse(endDate) - Date.parse(startDate)) / 86400000 >= maxDays) throw new Error(`每次最多分析${maxDays}天，请缩小日期范围`);
  return { startDate, endDate };
}

export function archiveSnapshotAt(date: string, asOf: string, available: DateRange | null): string {
  dateSchema.parse(date);
  if (!available || date < available.startDate || date > available.endDate) throw new Error('该日期尚无可用的日记录');
  return new Date(Math.min(Date.parse(`${date}T23:59:59+08:00`), Date.parse(asOf))).toISOString();
}

export function validateDateFilter(startDate?: string, endDate?: string): Partial<DateRange> {
  if (startDate) dateSchema.parse(startDate);
  if (endDate) dateSchema.parse(endDate);
  if (startDate && endDate && startDate > endDate) throw new Error('结束日期不能早于开始日期');
  return { startDate, endDate };
}
