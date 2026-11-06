import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handleApi, type AppEnv } from "../lib/server.ts";
import { createPrompt, inspectWriting, CHALLENGE_MS, ACCESS_MS } from "../lib/challenge.ts";
import { interpretResult, submitText } from "../lib/pangram.ts";
import { initializeBudget, reserveScan, budgetState } from "../lib/budget.ts";

class Statement {
  sql: string; values: unknown[] = []; db: DatabaseSync;
  constructor(db: DatabaseSync, sql: string) { this.db = db; this.sql = sql; }
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.values as never[]) ?? null) as T | null; }
  async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.values as never[]) }; }
  async run() { return { success: true, meta: this.db.prepare(this.sql).run(...this.values as never[]) }; }
}
function fixture() {
  const sql = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  const db = { prepare: (q: string) => new Statement(sql, q), batch: async (statements: Statement[]) => { sql.exec("BEGIN"); try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec("COMMIT"); return results; } catch (e) { sql.exec("ROLLBACK"); throw e; } } } as unknown as D1Database;
  const env: AppEnv = { DB: db, PANGRAM_API_KEY: "unit-test-key", RATE_LIMIT_SECRET: "unit-test-rate-secret", ADMIN_TOKEN: "unit-test-admin", VALIDATOR_TOKEN: "unit-test-validator" };
  sql.exec("INSERT INTO rate_buckets (id,count,expires_at) VALUES ('validator-heartbeat',1,9999999999999)");
  let now = 1_800_000_000_000, cookie = "", calls = 0;
  let providerResult: Record<string, unknown> = { stage: "STAGE_SUCCESS", prediction_short: "Human", fraction_human: 1, fraction_ai: 0, fraction_ai_assisted: 0, version: "test-fixture" };
  let failSubmit = false, submitStatus = 200;
  const fetcher: typeof fetch = async (_url, options) => {
    if (options?.method === "POST") { calls++; if (failSubmit) throw new Error("network failure"); return submitStatus === 200 ? Response.json({ task_id: "test-task" }) : Response.json({ detail: "private provider diagnostic" }, { status: submitStatus }); }
    return Response.json(providerResult);
  };
  async function request(path: string, body?: unknown, extra: Record<string, string> = {}) {
    const response = await handleApi(new Request(`http://localhost${path}`, { method: body === undefined ? "GET" : "POST", headers: { cookie, origin: "http://localhost", "content-type": "application/json", ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { now, fetcher });
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie")!.split(";")[0];
    return response;
  }
  async function start() { const r = await request("/api/challenge", {}); assert.equal(r.status, 201); return (await r.json() as { challenge: { id: string; prompt: ReturnType<typeof createPrompt> } }).challenge; }
  const writing = () => Array(200).fill("story").join(" ");
  async function complete(id: string, concepts = {setting:true,characters:true,conflict:true,story:true}) {
    const next = await request('/api/validator/next', {}, {authorization:'Bearer unit-test-validator'});
    const {job} = await next.json() as {job:{id:string;lease:string}|null};
    if (job) { assert.equal(job.id,id); return request('/api/validator/complete',{id,lease:job.lease,concepts},{authorization:'Bearer unit-test-validator'}); }
  }
  async function result(id: string) { await complete(id); return request(`/api/result?id=${id}`); }
  return { env, sql, db, request, start, writing, complete, result, get cookie() { return cookie; }, set cookie(v) { cookie = v; }, get calls() { return calls; }, tick: (ms: number) => { now += ms; }, setResult: (v: Record<string, unknown>) => { providerResult = v; }, setSubmitStatus: (v: number) => { submitStatus = v; }, failSubmit: () => { failSubmit = true; } };
}

test("anonymous and unverified sessions cannot read protected content", async () => {
  const f = fixture(); assert.equal((await f.request("/api/room")).status, 401);
  await f.start(); assert.equal((await f.request("/api/room")).status, 403);
  assert.equal((await f.request("/api/admin/metrics")).status, 401);
});
test("server grants access only after its own provider result; grants expire", async () => {
  const f = fixture(), c = await f.start();
  assert.equal((await f.request("/api/submit", { challengeId: c.id, text: f.writing(), passed: true })).status, 202);
  assert.equal((await f.request("/api/room")).status, 403);
  assert.equal((await f.request(`/api/result?id=${c.id}`)).status, 202);
  const result = await f.result(c.id); assert.equal((await result.json() as {state:string}).state, "passed");
  assert.equal((await f.request("/api/room")).status, 200);
  f.tick(ACCESS_MS + 1); assert.equal((await f.request("/api/room")).status, 403);
  assert.equal((await f.result(c.id)).status, 200);
  assert.equal((await f.request("/api/room")).status, 403, "replaying success must not renew access");
});
test("duplicate and concurrent submissions start exactly one paid task", async () => {
  const f = fixture(), c = await f.start(), body = { challengeId: c.id, text: f.writing() };
  const responses = await Promise.all([f.request("/api/submit", body), f.request("/api/submit", body)]);
  assert.ok(responses.every(r => r.status === 202)); assert.equal(f.calls, 1);
  await f.request("/api/submit", body); assert.equal(f.calls, 1);
});
test("challenge IDs cannot be used by another browser session", async () => {
  const f = fixture(), c = await f.start(), firstCookie = f.cookie;
  f.cookie = ""; await f.start(); assert.notEqual(f.cookie, firstCookie);
  assert.equal((await f.request("/api/submit", { challengeId: c.id, text: f.writing() })).status, 404);
  assert.equal((await f.request(`/api/result?id=${c.id}`)).status, 404); assert.equal(f.calls, 0);
});
test("cross-origin requests, oversized text and short responses fail before billing", async () => {
  const f = fixture(); assert.equal((await f.request("/api/challenge", {}, { origin: "https://elsewhere.example" })).status, 403);
  const c = await f.start();
  assert.equal((await f.request("/api/submit", { challengeId: c.id, text: "a".repeat(13000) })).status, 413);
  assert.equal((await f.request("/api/submit", { challengeId: c.id, text: Array(100).fill("hello").join(" ") })).status, 422);
  assert.equal(f.calls, 0);
});
test("expired prompts fail before billing", async () => {
  const f = fixture(), c = await f.start(); f.tick(CHALLENGE_MS + 1);
  assert.equal((await f.request("/api/submit", { challengeId: c.id, text: f.writing() })).status, 410); assert.equal(f.calls, 0);
});
test("missing credentials never turn on a demo pass", async () => {
  const f = fixture(); f.env.PANGRAM_API_KEY = ""; const c = await f.start();
  assert.equal((await f.request("/api/submit", { challengeId: c.id, text: f.writing() })).status, 503);
  assert.equal((await f.request("/api/room")).status, 403); assert.equal(f.calls, 0);
});
test("provider POST failures never grant access or automatically resubmit", async () => {
  const f = fixture(), c = await f.start(); f.failSubmit();
  assert.equal((await f.request("/api/submit", { challengeId: c.id, text: f.writing() })).status, 503);
  assert.equal((await f.request("/api/submit", { challengeId: c.id, text: f.writing() })).status, 409);
  assert.equal((await f.request("/api/room")).status, 403); assert.equal(f.calls, 1);
});
test("invalid provider data stays closed and eventually times out", async () => {
  const f = fixture(), c = await f.start(); f.setResult({ stage: "STAGE_SUCCESS", prediction_short: "Human" });
  await f.request("/api/submit", { challengeId: c.id, text: f.writing() });
  assert.equal((await f.result(c.id)).status, 202);
  assert.equal((await f.request("/api/room")).status, 403);
  f.tick(300_001); assert.equal((await (await f.result(c.id)).json() as {state:string}).state, "error");
});
test("three attempts persist across new prompts, a day change, and cookie resets", async () => {
  const f = fixture(); f.setResult({ stage: "STAGE_SUCCESS", prediction_short: "AI", fraction_human: 0, fraction_ai: 1, fraction_ai_assisted: 0, version: "test-fixture" });
  for (let i = 0; i < 3; i++) {
    const c = await f.start(); await f.request("/api/submit", { challengeId: c.id, text: f.writing() });
    await f.result(c.id); f.tick(3000);
  }
  assert.equal((await f.request("/api/challenge", {})).status, 429);
  f.tick(86400000); f.cookie = "";
  assert.equal((await f.request("/api/challenge", {})).status, 429);
  assert.equal(f.calls, 3);
});
test("one-time money budget survives new sessions and date changes", async () => {
  const f = fixture(); await f.request('/api/status');
  f.sql.prepare('UPDATE demo_budget SET limit_cents = 15').run();
  const first = await f.start(); await f.request("/api/submit", { challengeId: first.id, text: f.writing() });
  f.cookie = ""; f.tick(86400000);
  assert.equal((await f.request("/api/challenge", {})).status, 503); assert.equal(f.calls, 1);
  assert.equal((await (await f.request('/api/status')).json() as {closedReason:string}).closedReason,'budget');
});
test("billing failures temporarily pause new checks without exposing provider diagnostics", async () => {
  const f = fixture(), c = await f.start(); f.setSubmitStatus(402);
  const response = await f.request("/api/submit", {challengeId:c.id,text:f.writing()});
  assert.equal(response.status,503); assert.ok(!(await response.text()).includes("private provider diagnostic"));
  assert.equal((await (await f.request("/api/status")).json() as {configured:boolean}).configured,false);
  f.cookie=""; const next=await f.start();
  assert.equal((await f.request("/api/submit",{challengeId:next.id,text:f.writing()})).status,503); assert.equal(f.calls,1);
  f.tick(300001); assert.equal((await (await f.request("/api/status")).json() as {configured:boolean}).configured,true);
});
test("network quota survives clearing cookies",async()=>{
  const f=fixture();
  for(let i=0;i<3;i++) { f.cookie="";const c=await f.start();assert.equal((await f.request("/api/submit",{challengeId:c.id,text:f.writing()})).status,202); }
  f.cookie="";assert.equal((await f.request("/api/challenge",{})).status,429);assert.equal(f.calls,3);
});
test("no story, raw session token, or raw network address is retained in metrics", async () => {
  const f = fixture(), c = await f.start(), story = f.writing();
  await f.request("/api/submit", { challengeId: c.id, text: story });
  const serialized = JSON.stringify(f.sql.prepare("SELECT * FROM challenges").all());
  assert.ok(!serialized.includes(story)); assert.ok(!serialized.includes(f.cookie.split("=")[1]));
  const metrics = await f.request("/api/admin/metrics", undefined, { authorization: "Bearer unit-test-admin" });
  assert.equal(metrics.status, 200); assert.ok(!(await metrics.text()).includes("unit-test-key"));
});
test("every prompt has three concepts including a cat, without requiring literal keywords", () => {
  for(let i=0;i<100;i++) {
    const p=createPrompt(); assert.deepEqual(Object.keys(p), ['setting','characters','conflict']);
    assert.match(p.characters,/cat/); assert.ok(p.setting.length>10 && p.conflict.length>20);
    assert.equal(inspectWriting(Array(200).fill('story').join(' '),p).valid,true);
  }
  assert.equal(inspectWriting("café don't it’s").count,3);
});
test("Pangram task contract keeps keys server-side, disables public reports and rejects redirects", async () => {
  await submitText("sample", "test-secret", "pangram-4", async (url, options) => {
    assert.equal(url, "https://text.external-api.pangram.com/task");
    assert.equal((options?.headers as Record<string,string>)["x-api-key"], "test-secret");
    assert.equal(options?.redirect, "manual"); assert.equal(JSON.parse(options?.body as string).public_dashboard_link, false);
    return Response.json({ task_id: "abc123" });
  });
  assert.throws(() => interpretResult({ stage: "STAGE_SUCCESS", prediction_short: "Human", fraction_human: 1, fraction_ai: 0.5, fraction_ai_assisted: 0, version: "4" }));
});

test("simultaneous reservations cannot overspend the last slot",async()=>{
  const f=fixture();await initializeBudget(f.db,Date.now());
  f.sql.prepare('UPDATE demo_budget SET prior_reserved_cents = 480').run();
  const results=await Promise.all(Array.from({length:30},(_,i)=>reserveScan(f.db,`challenge-${i}`,`browser-${i}`,`network-${i}`,Date.now())));
  assert.equal(results.filter(Boolean).length,1);
  assert.equal((await budgetState(f.db)).reservedCents,495);
});
test("simultaneous reservations enforce each browser and network limit",async()=>{
  for(const dimension of ['browser','network']) {
    const f=fixture();await initializeBudget(f.db,Date.now());
    const results=await Promise.all(Array.from({length:10},(_,i)=>reserveScan(f.db,`challenge-${i}`,dimension==='browser'?'same':`browser-${i}`,dimension==='network'?'same':`network-${i}`,Date.now())));
    assert.equal(results.filter(Boolean).length,3);
    assert.equal((await budgetState(f.db)).reservedCents,45);
  }
});
test("paid reservations survive provider errors and telemetry cleanup",async()=>{
  const f=fixture(),c=await f.start();f.failSubmit();
  await f.request('/api/submit',{challengeId:c.id,text:f.writing()});
  assert.equal((await budgetState(f.db)).reservedCents,15);
  f.sql.prepare('DELETE FROM challenges').run(); f.sql.prepare('DELETE FROM rate_buckets').run();
  await initializeBudget(f.db,Date.now()+86400000);
  assert.equal((await budgetState(f.db)).reservedCents,15);
});
test("prior submitted scans seed the budget exactly once",async()=>{
  const f=fixture();
  f.sql.prepare("INSERT INTO challenges (id,session_id,prompt,state,created_at,expires_at,submitted_at,policy_version) VALUES ('old','old','{}','error',1,2,1,'writing-v1')").run();
  await initializeBudget(f.db,100);
  assert.equal((await budgetState(f.db)).reservedCents,15);
  f.sql.prepare('DELETE FROM challenges').run();await initializeBudget(f.db,200);
  assert.equal((await budgetState(f.db)).reservedCents,15);
  assert.throws(()=>f.sql.prepare('UPDATE demo_budget SET limit_cents = 501').run());
});
test("symbol stuffing and non-Latin blocks cannot evade the billing bound",async()=>{
  const f=fixture(),c=await f.start();
  for(const extra of ['! '.repeat(301),'漢'.repeat(301)]){
    const r=await f.request('/api/submit',{challengeId:c.id,text:f.writing()+extra});
    assert.equal(r.status,422);
  }
  assert.equal(f.calls,0);assert.equal((await budgetState(f.db)).reservedCents,0);
});
test("self-reported authorship is session-scoped and never grants access",async()=>{
  const f=fixture(),c=await f.start();
  assert.equal((await f.request('/api/feedback',{challengeId:c.id,source:'human'})).status,422);
  f.setResult({stage:'STAGE_SUCCESS',prediction_short:'AI',fraction_human:0,fraction_ai:1,fraction_ai_assisted:0,version:'test'});
  await f.request('/api/submit',{challengeId:c.id,text:f.writing()});await f.result(c.id);
  assert.equal((await f.request('/api/feedback',{challengeId:c.id,source:'human'})).status,200);
  assert.equal((await f.request('/api/room')).status,403);
  await f.request('/api/feedback',{challengeId:c.id,source:'ai'});
  assert.equal(f.sql.prepare('SELECT reported_source FROM challenges WHERE id=?').get(c.id)?.reported_source,'human');
  f.cookie='';await f.start();assert.equal((await f.request('/api/feedback',{challengeId:c.id,source:'ai'})).status,404);
});

test("public overall counts distinguish failures and errors and survive cleanup",async()=>{
  const f=fixture();
  const stats=async()=> (await (await f.request('/api/status')).json() as {overall:unknown}).overall;
  assert.deepEqual(await stats(),{attempts:0,passed:0,failed:0,errors:0,unfinished:0});
  const first=await f.start();
  await f.request('/api/submit',{challengeId:first.id,text:'Too short.'});
  assert.deepEqual(await stats(),{attempts:0,passed:0,failed:0,errors:0,unfinished:0});
  await f.request('/api/submit',{challengeId:first.id,text:f.writing()});
  assert.deepEqual(await stats(),{attempts:1,passed:0,failed:0,errors:0,unfinished:1});
  await f.result(first.id);
  const second=await f.start();
  f.setResult({stage:'STAGE_SUCCESS',prediction_short:'AI',fraction_human:0,fraction_ai:1,fraction_ai_assisted:0,version:'test'});
  await f.request('/api/submit',{challengeId:second.id,text:f.writing()});
  await f.result(second.id);
  const third=await f.start();f.failSubmit();
  await f.request('/api/submit',{challengeId:third.id,text:f.writing()});
  const expected={attempts:3,passed:1,failed:1,errors:1,unfinished:0};
  f.cookie='';assert.deepEqual(await stats(),expected);
  assert.deepEqual(await stats(),expected,'reading totals must not count outcomes again');
  f.sql.prepare('DELETE FROM challenges').run();f.tick(31*86400000);
  assert.deepEqual(await stats(),expected,'overall totals outlive detailed telemetry');
});

test("overall totals include earlier checks exactly once",async()=>{
  const f=fixture();
  for(const [id,state] of [['old-pass','passed'],['old-error','error']])f.sql.prepare("INSERT INTO challenges (id,session_id,prompt,state,created_at,expires_at,submitted_at,policy_version) VALUES (?,'old','{}',?,1,2,1,'writing-v1')").run(id,state);
  for(let i=0;i<2;i++){
    const data=await (await f.request('/api/status')).json() as {overall:unknown};
    assert.deepEqual(data.overall,{attempts:2,passed:1,failed:0,errors:1,unfinished:0});
  }
});

test('human text still fails if the story concepts fail; both results are exposed',async()=>{
  const f=fixture(),c=await f.start();
  await f.request('/api/submit',{challengeId:c.id,text:f.writing(),concepts:{setting:true,characters:true,conflict:true,story:true}});
  const completed=await f.complete(c.id,{setting:true,characters:false,conflict:false,story:true});assert.equal(completed?.status,200);
  const result=await (await f.request(`/api/result?id=${c.id}`)).json() as {state:string;checks:{pangram:unknown;concepts:unknown}};
  assert.equal(result.state,'rejected');assert.deepEqual(result.checks.pangram,{human:1,ai:0,assisted:0});
  assert.deepEqual(result.checks.concepts,{setting:true,characters:false,conflict:false,story:true});
  assert.equal((await f.request('/api/room')).status,403);
});
test('worker endpoints require their own token and claim each paid job once',async()=>{
  const f=fixture(),c=await f.start();
  assert.equal((await f.request('/api/validator/next',{})).status,401);
  assert.equal((await f.request('/api/validator/next',{},{authorization:'Bearer unit-test-admin'})).status,401);
  await f.request('/api/submit',{challengeId:c.id,text:f.writing()});
  const claims=await Promise.all([f.request('/api/validator/next',{},{authorization:'Bearer unit-test-validator'}),f.request('/api/validator/next',{},{authorization:'Bearer unit-test-validator'})]);
  const jobs=await Promise.all(claims.map(r=>r.json())) as {job:{id:string;lease:string}|null}[];
  assert.equal(jobs.filter(j=>j.job).length,1);
  assert.equal((await f.request('/api/validator/complete',{id:c.id,lease:'wrong',concepts:{}},{authorization:'Bearer unit-test-validator'})).status,404);
  const job=jobs.find(j=>j.job)!.job!;
  assert.equal((await f.request('/api/validator/complete',{...job,concepts:{setting:'yes'}},{authorization:'Bearer unit-test-validator'})).status,422);
});
test('offline validator prevents paid scans and expired jobs count as service errors',async()=>{
  const f=fixture(),c=await f.start();f.sql.prepare("DELETE FROM rate_buckets WHERE id='validator-heartbeat'").run();
  assert.equal((await (await f.request('/api/status')).json() as {configured:boolean}).configured,false);
  assert.equal((await f.request('/api/submit',{challengeId:c.id,text:f.writing()})).status,503);assert.equal(f.calls,0);
  await f.request('/api/validator/heartbeat',{},{authorization:'Bearer unit-test-validator'});
  await f.request('/api/submit',{challengeId:c.id,text:f.writing()});f.tick(300001);
  const status=await (await f.request('/api/status')).json() as {overall:{errors:number}};
  assert.equal(status.overall.errors,1);assert.equal((await f.request('/api/room')).status,403);
});
test('known automation agents cannot start or submit challenges',async()=>{
  const f=fixture();
  for(const ua of ['ChatGPT-User','HeadlessChrome','ClaudeBot','Playwright']) assert.equal((await f.request('/api/challenge',{},{'user-agent':ua})).status,403);
  assert.equal(f.calls,0);
});
test('old word-based prompts cannot be resumed or submitted under the concept policy',async()=>{
  const f=fixture(),old=await f.start();f.sql.prepare("UPDATE challenges SET policy_version='writing-public-v2' WHERE id=?").run(old.id);
  assert.equal((await f.request('/api/submit',{challengeId:old.id,text:f.writing()})).status,410);
  assert.equal((await (await f.request('/api/status')).json() as {challenge:unknown}).challenge,null);
  assert.notEqual((await f.start()).id,old.id);assert.equal(f.calls,0);
});
