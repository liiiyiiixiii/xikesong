import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analysisRequestSchema } from "../lib/analysis/contract.ts";
import { runAgent, validateToolArgs, toolDefinitions, type Complete, type Message } from "../lib/analysis/agent.ts";
import { createCompletion, modelConfig } from "../lib/analysis/provider.ts";
import { summarizeDays } from "../lib/analysis/statistics.ts";
import type { Dataset } from "../lib/preferences/types.ts";
import { DatabaseSync } from "node:sqlite";
import { periodQuery, periodWindow } from "../lib/analysis/period.ts";

const input={question:"哪些菜取用多？",startDate:"2026-07-06",endDate:"2026-07-07"};
const signal=()=>new AbortController().signal;
const call=(name="daily_statistics",args="{}")=>({role:"assistant",content:null,tool_calls:[{id:"call1",type:"function",function:{name,arguments:args}}]});
const answer={role:"assistant",content:"结论：当前证据不足。[E1]\n数据依据：查询结果为空。\n限制与缺口：缺少统计。\n建议：先补充数据。"};
const execute=async()=>({title:"日统计",data:{dishes:[]}});

test("date scopes reject malformed, reversed, future and excessive ranges",()=>{
  assert(analysisRequestSchema.safeParse(input).success);
  for(const change of [{startDate:"2026-02-30"},{endDate:"2099-01-01"},{endDate:"2026-07-05"},{endDate:"2026-09-01"},{question:" "}]) assert(!analysisRequestSchema.safeParse({...input,...change}).success);
});
test("daily facts retain unknowns, partial days and stockout rather than claiming complete demand",()=>{
  const data=JSON.parse(readFileSync(new URL("./fixtures/history.json",import.meta.url),"utf8")) as Dataset;
  data.catalog=data.catalog.slice(0,1);
  const dish=data.catalog[0].id;
  const base=data.days.find(d=>d.dishId===dish)!;
  data.days=[{...base,date:input.startDate,status:"partial",supply:"stockout",takeFinal:0,waste:null,stockoutMinutes:60,finalAt:input.startDate+"T23:00:00+08:00"}];
  const stats=summarizeDays(data,input.startDate,input.endDate,"2026-07-08T00:00:00+08:00");
  assert.equal(stats.dishes[0].observedTakeG,0);
  assert.equal(stats.dishes[0].observedWasteG,null);
  assert.equal(stats.dishes[0].missingDays,1);
  assert.equal(stats.dishes[0].comparableDays,0);
  assert.equal(stats.dishes[0].comparableMeanTakeG,null);
  assert.equal(stats.dishes[0].stockoutDays,1);
  data.days[0].takeFinal=null;
  assert.equal(summarizeDays(data,input.startDate,input.endDate,"2026-07-08T00:00:00+08:00").dishes[0].observedTakeG,null);
  assert.equal(summarizeDays(data,input.startDate,input.endDate,"2026-07-06T10:00:00+08:00").dishes[0].recordedDays,0);
});
test("tool allowlist rejects writes, injected parameters and inverted periods",()=>{
  assert.throws(()=>validateToolArgs("confirm",{}));
  assert.throws(()=>validateToolArgs("daily_statistics",{source:"test",sql:"DELETE"}));
  assert.throws(()=>validateToolArgs("period_statistics",{startHour:21,endHour:17}));
  assert.deepEqual(validateToolArgs("period_statistics",{startHour:17,endHour:21}),{startHour:17,endHour:21});
});
test("real agent loop forwards tool results and exposes evidence with explicit scope",async()=>{
  let count=0;
  const complete:Complete=async messages=>{
    count++;
    if(count===1)return call();
    assert.equal(messages.at(-1)?.role,"tool");
    assert.match(messages.at(-1)?.content??"",/E1/);
    return answer;
  };
  const result=await runAgent(input,"test",complete,execute,signal());
  assert.equal(count,2);assert.equal(result.evidence.length,1);assert.deepEqual(result.scope,{startDate:input.startDate,endDate:input.endDate});
});
test("invalid tool arguments are returned as errors and never executed",async()=>{
  let count=0,executions=0;
  const complete:Complete=async messages=>{
    count++;
    if(count===1)return call("daily_statistics",'{"sql":"delete"}');
    if(count===2){assert.match(messages.at(-1)?.content??"",/error/);return call();}
    return answer;
  };
  await runAgent(input,"test",complete,async()=>{executions++;return execute();},signal());
  assert.equal(executions,1);
});
test("no tool evidence, fabricated citations, empty output and endless loops fail visibly",async()=>{
  await assert.rejects(runAgent(input,"test",async()=>answer,execute,signal()),/未查询/);
  let count=0;
  await assert.rejects(runAgent(input,"test",async()=>++count===1?call():{...answer,content:"利润增长20% [E9]"},execute,signal()),/证据引用/);
  count=0;
  await assert.rejects(runAgent(input,"test",async()=>++count===1?call():{role:"assistant",content:""},execute,signal()),/未返回/);
  let executions=0;
  await assert.rejects(runAgent(input,"test",async()=>call(),async()=>{executions++;return execute();},signal()),/轮数/);
  assert.equal(executions,1,"duplicate queries cached within this request");
});
test("abort stops the agent before any model request",async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(runAgent(input,"test",async()=>{throw new Error("should not call");},execute,controller.signal),{name:"AbortError"});
});
test("provider keeps credentials in authorization and follows no redirects",async()=>{
  const config=modelConfig({ANALYSIS_API_KEY:"server-secret"});
  const fetcher:typeof fetch=async(url,options)=>{
    assert.equal(url,"https://api.deepseek.com/chat/completions");
    assert.equal(options?.redirect,"manual");
    assert.equal((options?.headers as Record<string,string>).Authorization,"Bearer server-secret");
    assert(!String(options?.body).includes("server-secret"));
    return Response.json({choices:[{message:answer}]});
  };
  const complete=createCompletion(config,fetcher);
  assert.deepEqual(await complete([] as Message[],toolDefinitions,signal()),answer);
});
test("provider errors never echo upstream bodies or secrets",async()=>{
  const complete=createCompletion(modelConfig({ANALYSIS_API_KEY:"secret"}),async()=>new Response("secret business details",{status:401}));
  await assert.rejects(complete([],toolDefinitions,signal()),error=>error instanceof Error && error.message.includes("鉴权")&&!error.message.includes("secret"));
});
test("legacy model config supported, new provider never inherits old key",()=>{
  assert.equal(modelConfig({DEEPSEEK_API_KEY:"old"}).apiKey,"old");
  assert.equal(modelConfig({DEEPSEEK_API_KEY:"old",ANALYSIS_BASE_URL:"https://example.com/v1"}).apiKey,"");
  assert.throws(()=>modelConfig({ANALYSIS_BASE_URL:"http://example.com"}));
  assert.throws(()=>modelConfig({ANALYSIS_BASE_URL:"https://user:password@example.com"}));
});

test("period SQL respects Shanghai hours, complete minutes, source and exclusive end",()=>{
  const db=new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE scale_minutes (source TEXT, scale_id TEXT, dish_id TEXT, minute TEXT, payload TEXT)");
    const insert=db.prepare("INSERT INTO scale_minutes VALUES (?,?,?,?,?)");
    for(const [at,take,source] of [["2026-10-03T08:59:00.000Z",100,"live"],["2026-10-03T09:00:00.000Z",10,"live"],["2026-10-03T12:59:00.000Z",20,"live"],["2026-10-03T13:00:00.000Z",500,"live"],["2026-10-03T09:00:00.000Z",900,"demo"]] as const)
      insert.run(source,"s1","d1",at,JSON.stringify({takeG:take,refillG:0,observedSeconds:60,emptySeconds:0}));
    const w=periodWindow("2026-10-03","2026-10-03","2026-10-03T22:00:00+08:00");
    const rows=db.prepare(periodQuery).all(w.from,w.to,w.completeBefore,17,21);
    assert.equal(rows.length,1);assert.equal(rows[0].observedTakeG,30);assert.equal(rows[0].date,"2026-10-03");
    const current=periodWindow("2026-10-03","2026-10-03","2026-10-03T20:59:30+08:00");
    assert.equal(db.prepare(periodQuery).all(current.from,current.to,current.completeBefore,17,21)[0].observedTakeG,10);
    assert.equal(db.prepare(periodQuery).all(w.from,w.to,w.completeBefore,1,2).length,0,"missing period returns no invented zero row");
  } finally { db.close(); }
});
test("period history and range bounds are enforced before database access",()=>{
  assert.throws(()=>periodWindow("2026-01-01","2026-01-02","2026-10-03T00:00:00Z"),/90/);
  assert.throws(()=>periodWindow("2026-09-01","2026-09-08","2026-10-03T00:00:00Z"),/7天/);
});

test("provider rejects redirects without following or exposing their destination",async()=>{
  let calls=0;
  const complete=createCompletion(modelConfig({ANALYSIS_API_KEY:"secret"}),async(_url,options)=>{
    calls++;
    assert.equal(options?.redirect,"manual");
    return new Response(null,{status:307,headers:{Location:"https://example.com/secret"}});
  });
  await assert.rejects(complete([],toolDefinitions,signal()),error=>error instanceof Error && error.message.includes("重定向")&&!error.message.includes("secret"));
  assert.equal(calls,1);
});
