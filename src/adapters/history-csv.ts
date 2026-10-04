import type { Dataset, Catalog, DishDay, StoreDay } from "../domain/types.ts";
import { catalogSchema, storeSchema, daySchema, validateDataset } from "../domain/dataset.ts";
import { csvRows, value } from "./csv.ts";
export function parseFiles(files: Record<string, string>): Dataset {
    for (const f of ["dishes.csv", "store_days.csv", "dish_days.csv"])
        if (!files[f])
            throw new Error(`缺少 ${f}`);
    const original = csvRows(files["dishes.csv"]);
    const catalog: Catalog[] = original.map(r => { if (r.unit !== "g" && r.unit !== "件")
        throw new Error(`CSV单位仅接受克或有明确模拟单件重量的件数：${r.dish_id}`); const piece = value(r.synthetic_piece_weight_g); if (r.unit === "件" && !piece)
        throw new Error(`合成计件数据须提供明确 synthetic_piece_weight_g：${r.dish_id}`); return catalogSchema.parse({ id: r.dish_id, name: r.name, category: r.category, unit: "g", pieceWeightG: r.unit === "件" ? piece : null, launchDate: r.launch_date }); });
    const stores: StoreDay[] = csvRows(files["store_days.csv"]).map(r => storeSchema.parse({ date: r.date, status: r.business_status, snapshotAt: r.snapshot_available_at ?? r.people_20_available_at, finalAt: r.final_available_at ?? r.people_final_available_at }));
    const days: DishDay[] = csvRows(files["dish_days.csv"]).map(r => { const c = catalog.find(c => c.id === r.dish_id); if (!c)
        throw new Error(`未知菜品 ${r.dish_id}`); const factor = c.pieceWeightG ?? 1; const quantity = (field: string) => { const v = value(r[field]); if (c.pieceWeightG && v !== null && !Number.isInteger(v))
        throw new Error(`合成件数必须为整数 ${r.date}/${r.dish_id}/${field}`); return v === null ? null : v * factor; }; return daySchema.parse({ date: r.date, dishId: r.dish_id, status: r.data_status, take20: quantity("taken_20"), takeFinal: quantity("taken_final"), takeG: value(r.taken_weight_g), opening: quantity("opening_stock"), replenished: quantity("replenished"), waste: quantity("waste"), closing: quantity("closing_stock"), supply: r.supply_status, stockoutMinutes: value(r.stockout_minutes), snapshotAt: r.snapshot_available_at, finalAt: r.final_available_at, ageWaste: quantity("age_waste"), closingWaste: quantity("closing_waste"), retainedKitchen: quantity("kitchen_retained") }); });
    const dataset = { catalog, stores, days };
    validateDataset(dataset);
    return dataset;
}
