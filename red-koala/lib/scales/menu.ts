import type { ScaleConfig } from "./types.ts";

// A dish stays on the menu while any of its devices is enabled. Historical
// imports without a device mapping remain available. Retirement never deletes
// the underlying events, snapshots or confirmed plans.
export function menuDishFilter(configs: Pick<ScaleConfig, "dishId" | "enabled">[]) {
  const configured = new Set(configs.map(c => c.dishId));
  const active = new Set(configs.filter(c => c.enabled).map(c => c.dishId));
  return (dishId: string) => !configured.has(dishId) || active.has(dishId);
}

// Aggregated minute queries must apply the same menu scope BEFORE calculating
// their totals. Unmapped historical records are intentionally retained.
export function scopeMinuteQuery(query: string) {
  return query.replace(/source\s*=\s*'live'/, `source='live' AND dish_id NOT IN (
    SELECT json_extract(payload,'$.dishId') FROM scale_configs WHERE source='live'
    GROUP BY json_extract(payload,'$.dishId')
    HAVING MAX(CASE WHEN json_extract(payload,'$.enabled')=1 THEN 1 ELSE 0 END)=0
  )`);
}

export function menuForecast<T extends { lines: import("../preferences/types.ts").ForecastLine[] }>(forecast: T, configs: ScaleConfig[]): T {
  const allowed = menuDishFilter(configs);
  const lines = forecast.lines.filter(line => allowed(line.dishId));
  for (const config of configs.filter(c => c.enabled)) {
    if (lines.some(line => line.dishId === config.dishId)) continue;
    lines.push({ dishId: config.dishId, name: config.dishName, unit: "g", demand: null, low: null, high: null, suggested: null, samples: 0, confidence: "observing", model: null,
      explanation: "当前菜单中的该菜品未包含在原始预测中，没有历史建议值；可填写试供量及理由。" });
  }
  const order=new Map<string,number>();for(const [i,c] of configs.filter(c=>c.enabled).entries())order.set(c.dishId,Math.min(order.get(c.dishId)??Infinity,c.position??i+1));
  lines.sort((a,b)=>(order.get(a.dishId)??Infinity)-(order.get(b.dishId)??Infinity));
  return { ...forecast, lines };
}
