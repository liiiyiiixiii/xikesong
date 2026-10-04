import type { Dataset } from "../src/domain/types.ts";
/** Handwritten synthetic fixture; not exported from any production database. */
export function fixture(): Dataset {
    return {
        catalog: [{ id: "example-dish", name: "演示菜品", category: "演示", unit: "g", pieceWeightG: null, launchDate: "2026-01-01" }],
        stores: [{ date: "2026-01-01", status: "open", snapshotAt: "2026-01-01T20:00:00+08:00", finalAt: "2026-01-01T22:00:00+08:00" }],
        days: [{ date: "2026-01-01", dishId: "example-dish", status: "complete", take20: 200, takeFinal: 300, takeG: 300, opening: 500, replenished: 100, waste: 50, closing: 250, supply: "adequate", stockoutMinutes: 0, snapshotAt: "2026-01-01T20:00:00+08:00", finalAt: "2026-01-01T22:00:00+08:00" }],
    };
}
