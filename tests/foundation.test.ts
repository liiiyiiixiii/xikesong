import { test } from "node:test";
import assert from "node:assert/strict";
import { dateSchema, validateDataset } from "../src/domain/dataset.ts";
import { csvRows, value } from "../src/adapters/csv.ts";
import { parseFiles } from "../src/adapters/history-csv.ts";
import { menuDishFilter } from "../src/domain/menu.ts";
import { analyze } from "../src/application/analyze.ts";
import { unavailableForecast } from "../src/adapters/unavailable-forecast.ts";
import { fixture } from "../examples/fixture.ts";
test("valid synthetic dataset satisfies stock conservation", () => {
    assert.doesNotThrow(() => validateDataset(fixture()));
});
test("invalid calendar dates and unknown fields are rejected", async () => {
    assert.equal(dateSchema.safeParse("2026-02-30").success, false);
    await assert.rejects(analyze({ ...fixture(), hidden: true }, unavailableForecast));
});
test("reject duplicate keys, missing references, inconsistent stock and premature data", () => {
    const mutations = [
        (d: ReturnType<typeof fixture>) => { d.days.push({ ...d.days[0] }); },
        (d: ReturnType<typeof fixture>) => { d.days[0].dishId = "unknown"; },
        (d: ReturnType<typeof fixture>) => { d.days[0].closing = 999; },
        (d: ReturnType<typeof fixture>) => { d.days[0].snapshotAt = "2026-01-01T19:00:00+08:00"; },
        (d: ReturnType<typeof fixture>) => { d.days[0].take20 = 400; },
        (d: ReturnType<typeof fixture>) => { d.days[0].takeFinal = null; },
    ];
    for (const mutate of mutations) {
        const data = fixture();
        mutate(data);
        assert.throws(() => validateDataset(data));
    }
});
test("unknown values remain null and invalid data never reaches provider", async () => {
    assert.equal(value("NA"), null);
    assert.equal(value("0"), 0);
    assert.throws(() => value("-1"));
    let called = false;
    await assert.rejects(analyze({}, { async predict() { called = true; throw new Error("unexpected"); } }));
    assert.equal(called, false);
    const result = await analyze(fixture(), unavailableForecast);
    assert.equal(result.implementation, "unavailable");
    assert.equal(result.lines[0].suggestedG, null);
});
test("CSV handles BOM, CRLF, embedded commas, quoted newline and escaped quotes", () => {
    assert.deepEqual(csvRows('\uFEFFid,name\r\na,"hello,\n""world"""\r\n'), [{ id: "a", name: 'hello,\n"world"' }]);
    assert.throws(() => csvRows('id,name\na,"bad'));
    assert.throws(() => csvRows('id,id\na,b'));
    assert.throws(() => csvRows('id,name\na,b,c'));
});
test("CSV adapter validates complete history end to end", () => {
    const parsed = parseFiles({
        "dishes.csv": "dish_id,name,category,unit,launch_date\nexample-dish,演示菜品,演示,g,2026-01-01",
        "store_days.csv": "date,business_status,snapshot_available_at,final_available_at\n2026-01-01,open,2026-01-01T20:00:00+08:00,2026-01-01T22:00:00+08:00",
        "dish_days.csv": "date,dish_id,data_status,taken_20,taken_final,taken_weight_g,opening_stock,replenished,waste,closing_stock,supply_status,stockout_minutes,snapshot_available_at,final_available_at\n2026-01-01,example-dish,complete,200,300,300,500,100,50,250,adequate,0,2026-01-01T20:00:00+08:00,2026-01-01T22:00:00+08:00",
    });
    assert.equal(parsed.days[0].takeG, 300);
    assert.throws(() => parseFiles({}));
});
test("multiple bowls preserve active dish and unmapped history", () => {
    const allowed = menuDishFilter([{ dishId: "a", enabled: false }, { dishId: "a", enabled: true }, { dishId: "b", enabled: false }]);
    assert.equal(allowed("a"), true);
    assert.equal(allowed("b"), false);
    assert.equal(allowed("historical"), true);
});
