import { z } from "zod";
import { catalogSchema, storeSchema, daySchema, validateDataset } from "../domain/dataset.ts";
import type { ForecastProvider } from "./ports.ts";
const datasetSchema = z.object({
    catalog: z.array(catalogSchema).max(10000),
    stores: z.array(storeSchema).max(3660),
    days: z.array(daySchema).max(100000),
}).strict();
/** Validate untrusted data before handing a detached copy to a provider. */
export async function analyze(input: unknown, provider: ForecastProvider) {
    const dataset = datasetSchema.parse(input);
    validateDataset(dataset);
    return provider.predict(dataset);
}
