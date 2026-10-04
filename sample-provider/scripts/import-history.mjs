import { readFile } from "node:fs/promises";
import { parseFiles } from "../lib/contract.ts";
import { post } from "../lib/client.mjs";
const folder=process.argv[2]?new URL(process.argv[2].replace(/\/?$/,"/"),`file://${process.cwd()}/`):new URL("../data/",import.meta.url);
const files={};for(const name of ["dishes.csv","store_days.csv","dish_days.csv"])files[name]=await readFile(new URL(name,folder),"utf8");
const dataset=parseFiles(files);
// Conversion and hidden simulation truth stay here; the application receives gram records.
for(const item of dataset.catalog)item.pieceWeightG=null;
console.log(JSON.stringify(await post("/api/preferences/import",{version:1,dataset}),null,2));
