import { analyze } from "../src/application/analyze.ts";
import { unavailableForecast } from "../src/adapters/unavailable-forecast.ts";
import { fixture } from "./fixture.ts";
console.log(JSON.stringify(await analyze(fixture(), unavailableForecast), null, 2));
