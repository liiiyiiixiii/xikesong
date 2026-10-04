import type { Dataset } from "../domain/types.ts";
/** The private implementation lives outside this repository. */
export interface ForecastProvider {
    predict(dataset: Dataset): Promise<ForecastResult>;
}
export interface ForecastResult {
    implementation: "unavailable" | "private-service";
    lines: Array<{
        dishId: string;
        suggestedG: number | null;
    }>;
    explanation: string;
}
