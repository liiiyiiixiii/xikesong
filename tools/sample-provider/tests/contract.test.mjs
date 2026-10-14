import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { csvRows,parseFiles } from "../lib/contract.ts";
const files=Object.fromEntries(["dishes.csv","store_days.csv","dish_days.csv"].map(n=>[n,readFileSync(new URL(`./fixtures/legacy-v1/${n}`,import.meta.url),"utf8")]));
test("CSV quoted fields and embedded newlines",()=>{assert.deepEqual(csvRows('\uFEFFid,notes\r\na,"x,""y""\nz"\r\n'),[{id:"a",notes:'x,"y"\nz'}]);assert.throws(()=>csvRows('a,b\n1'));});
test("legacy v1 fixture converts 90 days / 12 dishes to grams",()=>{const data=parseFiles(files);assert.equal(data.days.length,1080);assert.equal(data.stores.length,90);const raw=csvRows(files["dish_days.csv"]).find(d=>d.dish_id==="shrimp"&&d.data_status==="complete"),day=data.days.find(d=>d.dishId==="shrimp"&&d.date===raw.date);assert.equal(day.takeFinal,Number(raw.taken_final)*25);assert.equal(day.opening,Number(raw.opening_stock)*25);assert.equal(day.waste,Number(raw.waste)*25);});
test("count conversion requires explicit piece weight",()=>{const rows=csvRows(files["dishes.csv"]);const csv=Object.keys(rows[0]).join(",")+"\n"+rows.map(r=>Object.values({...r,synthetic_piece_weight_g:r.dish_id==="shrimp"?"NA":r.synthetic_piece_weight_g}).join(",")).join("\n");assert.throws(()=>parseFiles({...files,"dishes.csv":csv}),/synthetic_piece_weight_g/);});
