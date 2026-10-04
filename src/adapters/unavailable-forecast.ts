import type { ForecastProvider } from "../application/ports.ts";
/** No invented predictions: the public package exposes an explicit unavailable state. */
export const unavailableForecast: ForecastProvider = {
    async predict(dataset) {
        return {
            implementation: "unavailable",
            lines: dataset.catalog.map(({ id }) => ({ dishId: id, suggestedG: null })),
            explanation: "公开版不包含核心预测模型；此结果仅用于验证接口集成。",
        };
    },
};
