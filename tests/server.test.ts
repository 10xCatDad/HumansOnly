import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handleApi, type AppEnv } from "../lib/server.ts";
import { createPrompt, inspectWriting, CHALLENGE_MS, ACCESS_MS } from "../lib/challenge.ts";
import { interpretResult, submitText } from "../lib/pangram.ts";
import { initializeBudget, reserveScan, budgetState } from "../lib/budget.ts";
import type { AttemptResult } from "../lib/validation.ts";

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
  const env: AppEnv = { DB: db, PANGRAM_API_KEY: "unit-test-key", RATE_LIMIT_SECRET: "unit-test-rate-secret", ADMIN_TOKEN: "unit-test-admin", VALIDATOR_TOKEN: "unit-test-validator", TURNSTILE_SITE_KEY: "unit-test-site", TURNSTILE_SECRET_KEY: "unit-test-turnstile" };
  sql.exec("INSERT INTO rate_buckets (id,count,expires_at) VALUES ('validator-heartbeat',1,9999999999999)");
  let now = 1_800_000_000_000, cookie = "", calls = 0;
  let providerResult: Record<string, unknown> = { stage: "STAGE_SUCCESS", prediction_short: "Human", fraction_human: 1, fraction_ai: 0, fraction_ai_assisted: 0, version: "test-fixture" };
  let failSubmit = false, submitStatus = 200;
  const redeemed = new Set<string>();
  let gateResult: Record<string,unknown> = {success:true,hostname:"localhost",action:"writing_prompt"};
  let gateOffline = false;
  const fetcher: typeof fetch = async (_url, options) => {
    if(String(_url).includes('challenges.cloudflare.com')) {
      if(gateOffline) throw new Error('network unavailable');
      const token=JSON.parse(options?.body as string).response;
      if(redeemed.has(token)) return Response.json({success:false,'error-codes':['timeout-or-duplicate']});
      if(gateResult.success)redeemed.add(token);
      return Response.json(gateResult);
    }
    if (options?.method === "POST") { calls++; if (failSubmit) throw new Error("network failure"); return submitStatus === 200 ? Response.json({ task_id: "test-task" }) : Response.json({ detail: "private provider diagnostic" }, { status: submitStatus }); }
    return Response.json(providerResult);
  };
  async function request(path: string, body?: unknown, extra: Record<string, string> = {}) {
    const response = await handleApi(new Request(`http://localhost${path}`, { method: body === undefined ? "GET" : "POST", headers: { cookie, origin: "http://localhost", "content-type": "application/json", ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { now, fetcher });
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie")!.split(";")[0];
    return response;
  }
  async function start() { const r = await request("/api/challenge", {turnstileToken:crypto.randomUUID()}); assert.equal(r.status, 201); return (await r.json() as { challenge: { id: string; prompt: ReturnType<typeof createPrompt> } }).challenge; }
  const writing = () => Array(200).fill("story").join(" ");
  async function complete(id: string, concepts = {setting:true,characters:true,conflict:true,story:true}) {
    const next = await request('/api/validator/next', {}, {authorization:'Bearer unit-test-validator'});
    const {job} = await next.json() as {job:{id:string;lease:string}|null};
    if (job) { assert.equal(job.id,id); return request('/api/validator/complete',{id,lease:job.lease,concepts},{authorization:'Bearer unit-test-validator'}); }
  }
  async function result(id: string) { await complete(id); return request(`/api/result?id=${id}`); }
  return { env, sql, db, request, start, writing, complete, result, setGateResult:(v:Record<string,unknown>)=>{gateResult=v;}, gateOffline:()=>{gateOffline=true;}, get cookie() { return cookie; }, set cookie(v) { cookie = v; }, get calls() { return calls; }, tick: (ms: number) => { now += ms; }, setResult: (v: Record<string, unknown>) => { providerResult = v; }, setSubmitStatus: (v: number) => { submitStatus = v; }, failSubmit: () => { failSubmit = true; } };
}

test("anonymous and unverified sessions cannot read protected content", async () => {
  const f = fixture(); assert.equal((await f.request("/api/room")).status, 401);
  await f.start(); assert.equal((await f.request("/api/room")).status, 403);
  assert.equal((await f.request("/api/admin/metrics")).status, 401);
});
test("owner reset clears history and quotas while preserving billing, then ignores a replay", async () => {
  const f = fixture(), resetId = crypto.randomUUID();
  for (let i = 0; i < 3; i++) {
    const c = await f.start();
    await f.request("/api/submit", { challengeId: c.id, text: f.writing() });
    await f.result(c.id);
  }
  f.sql.prepare("UPDATE demo_budget SET prior_reserved_cents = 60").run();
  f.sql.prepare("INSERT INTO result_shares (challenge_id,share_id,created_at) SELECT id, id, created_at FROM challenges LIMIT 1").run();
  f.sql.prepare("INSERT INTO rate_buckets (id,count,expires_at) VALUES ('provider-cooldown',1,1)").run();
  assert.equal((await budgetState(f.db)).reservedCents, 105);
  assert.equal((await (await f.request('/api/status')).json() as {attemptsRemaining:number}).attemptsRemaining, 0);
  await f.request('/api/diagnostics/unlock', {code:'uuddlrlrba'});
  const body = { resetId, confirm: 'clear-attempts-and-usage' };
  assert.equal((await f.request('/api/admin/reset-attempts', body)).status, 401);
  assert.equal((await f.request('/api/admin/reset-attempts', body, {authorization:'Bearer unit-test-validator'})).status, 401);
  assert.equal((await f.request('/api/admin/reset-attempts', {resetId}, {authorization:'Bearer unit-test-admin'})).status, 400);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM challenges').get()!.n, 3);
  const reset = await f.request('/api/admin/reset-attempts', body, {authorization:'Bearer unit-test-admin'});
  assert.equal(reset.status, 200);
  const status = await (await f.request('/api/status')).json() as {history:unknown[];overall:Record<string,number>;attemptsRemaining:number;accessExpiresAt:number|null};
  assert.deepEqual(status.history, []);
  assert.deepEqual(status.overall, {attempts:0,passed:0,failed:0,errors:0,unfinished:0});
  assert.equal(status.attemptsRemaining, 3); assert.equal(status.accessExpiresAt, null);
  for (const table of ['challenges','demo_results','demo_reservations','result_shares']) assert.equal(f.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM rate_buckets').get()!.n, 2);
  assert.equal((await budgetState(f.db)).reservedCents, 105);
  assert.equal((await budgetState(f.db)).remainingCents, 395);
  const fresh = await f.start(); await f.request('/api/submit', {challengeId:fresh.id,text:f.writing()});
  const replay = await f.request('/api/admin/reset-attempts', body, {authorization:'Bearer unit-test-admin'});
  assert.equal(replay.status, 200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM challenges').get()!.n, 1);
  assert.equal((await budgetState(f.db)).reservedCents, 120);
  assert.equal((await (await f.request('/api/status')).json() as {attemptsRemaining:number}).attemptsRemaining, 2);
  assert.equal((await f.request(`/api/result?id=${fresh.id}`)).status, 202);
});
test("temporary reset credentials are scoped and active checks finish before reset", async () => {
  const f = fixture(), resetId = crypto.randomUUID(), auth = {authorization:'Bearer temporary-reset'};
  f.env.ATTEMPT_RESET_TOKEN = 'temporary-reset'; f.env.ATTEMPT_RESET_ID = resetId;
  const c = await f.start(); await f.request('/api/submit', {challengeId:c.id,text:f.writing()});
  assert.equal((await f.request('/api/admin/reset-attempts', {resetId:crypto.randomUUID(),confirm:'clear-attempts-and-usage'}, auth)).status, 403);
  const body = {resetId,confirm:'clear-attempts-and-usage'};
  assert.equal((await f.request('/api/admin/reset-attempts', body, auth)).status, 409);
  assert.equal((await budgetState(f.db)).reservedCents, 15);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM attempt_resets').get()!.n, 0);
  await f.result(c.id);
  const response = await f.request('/api/admin/reset-attempts', body, auth); assert.equal(response.status, 200);
  delete f.env.ATTEMPT_RESET_TOKEN; delete f.env.ATTEMPT_RESET_ID;
  assert.equal((await f.request('/api/admin/reset-attempts', body, auth)).status, 401);
  assert.equal((await budgetState(f.db)).reservedCents, 15);
});
test("a failed reset rolls back both the deletion and its billing transfer", async () => {
  const f = fixture(), c = await f.start();
  await f.request('/api/submit',{challengeId:c.id,text:f.writing()}); await f.result(c.id);
  f.sql.exec("CREATE TRIGGER fail_reset BEFORE DELETE ON challenges BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  const body={resetId:crypto.randomUUID(),confirm:'clear-attempts-and-usage'}, auth={authorization:'Bearer unit-test-admin'};
  assert.equal((await f.request('/api/admin/reset-attempts',body,auth)).status,503);
  assert.equal((await budgetState(f.db)).reservedCents,15);
  assert.equal(f.sql.prepare('SELECT prior_reserved_cents FROM demo_budget').get()!.prior_reserved_cents,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM challenges').get()!.n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM demo_results').get()!.n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM attempt_resets').get()!.n,0);
  f.sql.exec('DROP TRIGGER fail_reset');
  assert.equal((await f.request('/api/admin/reset-attempts',body,auth)).status,200);
  assert.equal((await budgetState(f.db)).reservedCents,15);
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
  for(const extra of ['! '.repeat(301),'漢'.repeat(301),' word'+'!'.repeat(500),' word'+'🐈'.repeat(301)]){
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

test('Turnstile is required before a prompt or paid task exists',async()=>{
  const f=fixture();
  for(const token of [undefined,'','x'.repeat(2049)]) {
    const response=await f.request('/api/challenge',{turnstileToken:token});assert.equal(response.status,400);
  }
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM challenges').get()?.n,0);assert.equal(f.calls,0);
  assert.equal((await budgetState(f.db)).reservedCents,0);
  assert.equal((await f.request('/api/submit',{challengeId:'invented',text:f.writing()})).status,401);
});
test('Turnstile rejects wrong hostname, action, and failed provider decisions',async()=>{
  for(const decision of [{success:false},{success:true,hostname:'elsewhere.example',action:'writing_prompt'},{success:true,hostname:'localhost',action:'different'},{success:'true',hostname:'localhost',action:'writing_prompt'}]) {
    const f=fixture();f.setGateResult(decision);
    assert.equal((await f.request('/api/challenge',{turnstileToken:'token'})).status,400);assert.equal(f.calls,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM challenges').get()?.n,0);
  }
});
test('Turnstile outage and missing or dummy keys fail closed without charging',async()=>{
  const offline=fixture();offline.gateOffline();assert.equal((await offline.request('/api/challenge',{turnstileToken:'token'})).status,503);assert.equal(offline.calls,0);
  for(const value of ['', '1x00000000000000000000AA']) {
    const f=fixture();f.env.TURNSTILE_SITE_KEY=value;
    assert.equal((await f.request('/api/challenge',{turnstileToken:'token'})).status,503);
    const status=await (await f.request('/api/status')).json() as {configured:boolean;turnstileSiteKey:unknown};
    assert.equal(status.configured,false);assert.equal(status.turnstileSiteKey,null);assert.equal(f.calls,0);
  }
});
test('a Turnstile token cannot issue a second prompt in another session',async()=>{
  const f=fixture();assert.equal((await f.request('/api/challenge',{turnstileToken:'same-token'})).status,201);
  f.cookie='';assert.equal((await f.request('/api/challenge',{turnstileToken:'same-token'})).status,400);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM challenges').get()?.n,1);assert.equal(f.calls,0);
});
test('pre-Turnstile paid checks can finish but unpaid old prompts cannot submit',async()=>{
  const f=fixture(),c=await f.start();await f.request('/api/submit',{challengeId:c.id,text:f.writing()});
  f.sql.prepare("UPDATE challenges SET policy_version='writing-concepts-v3' WHERE id=?").run(c.id);
  const status=await (await f.request('/api/status')).json() as {challenge:{id:string}};assert.equal(status.challenge.id,c.id);
  await f.complete(c.id);assert.equal((await f.request('/api/room')).status,200);
  const oldResult=await (await f.request(`/api/result?id=${c.id}`)).json() as {checks:{precheck:string}};assert.equal(oldResult.checks.precheck,'not-run');
  const next=await f.start();f.sql.prepare("UPDATE challenges SET policy_version='writing-concepts-v3' WHERE id=?").run(next.id);
  assert.equal((await f.request('/api/submit',{challengeId:next.id,text:f.writing()})).status,410);assert.equal(f.calls,1);
});

test('result records the server-verified precheck',async()=>{
  const f=fixture(), c=await f.start();
  await f.request('/api/submit',{challengeId:c.id,text:f.writing()});
  const result=await (await f.result(c.id)).json() as {checks:{precheck:string}};
  assert.equal(result.checks.precheck,'passed');
});

test('story word limits are 200 through 250 without charging invalid attempts',async()=>{
  const f=fixture(), c=await f.start();
  for(const count of [199,251]) assert.equal((await f.request('/api/submit',{challengeId:c.id,text:Array(count).fill('story').join(' ')})).status,422);
  assert.equal(f.calls,0);
  assert.equal(inspectWriting(Array(200).fill('story').join(' ')).valid,true);
  assert.equal(inspectWriting(Array(250).fill('story').join(' ')).valid,true);
});

test('previous results survive refresh and stay private to their owning session',async()=>{
  const f=fixture(), first=await f.start();
  assert.deepEqual((await (await f.request('/api/status')).json() as {history:AttemptResult[]}).history,[]);
  await f.request('/api/submit',{challengeId:first.id,text:f.writing()});await f.complete(first.id);
  const firstCookie=f.cookie;
  for(let i=0;i<2;i++) {
    const response=await f.request('/api/status');
    const data=await response.json() as {history:AttemptResult[];attemptsRemaining:number};
    assert.equal(response.headers.get('cache-control'),'no-store, private');
    assert.equal(data.attemptsRemaining,2);assert.equal(data.history.length,1);
    assert.equal(data.history[0].id,first.id);assert.equal(data.history[0].state,'passed');
    assert.equal(data.history[0].checks?.precheck,'passed');
    assert.deepEqual(Object.keys(data.history[0]).sort(),['checks','id','precheck','state','submittedAt']);
  }
  f.cookie='';f.tick(1000);const second=await f.start();
  await f.request('/api/submit',{challengeId:second.id,text:f.writing()});await f.complete(second.id,{setting:false,characters:true,conflict:true,story:true});
  const own=await (await f.request('/api/status')).json() as {history:AttemptResult[]};
  assert.deepEqual(own.history.map(r=>r.id),[second.id]);assert.equal(own.history[0].state,'rejected');
  f.cookie=firstCookie;
  assert.deepEqual((await (await f.request(`/api/status?session_id=${second.id}`)).json() as {history:AttemptResult[]}).history.map(r=>r.id),[first.id]);
  f.cookie='';assert.deepEqual((await (await f.request('/api/status')).json() as {history:AttemptResult[]}).history,[]);
});

test('history retains outcomes after detail cleanup without resetting attempts',async()=>{
  const f=fixture(), c=await f.start();await f.request('/api/submit',{challengeId:c.id,text:f.writing()});await f.complete(c.id);
  f.sql.prepare('DELETE FROM challenges WHERE id=?').run(c.id);
  const data=await (await f.request('/api/status')).json() as {history:AttemptResult[];attemptsRemaining:number};
  assert.equal(data.attemptsRemaining,2);assert.equal(data.history.length,1);
  assert.equal(data.history[0].id,c.id);assert.equal(data.history[0].state,'passed');
  assert.equal(data.history[0].checks,null);assert.equal(data.history[0].precheck,null);
});

test('history includes service errors without labeling them failed checks',async()=>{
  const f=fixture(), c=await f.start();f.failSubmit();await f.request('/api/submit',{challengeId:c.id,text:f.writing()});
  const data=await (await f.request('/api/status')).json() as {history:AttemptResult[];attemptsRemaining:number};
  assert.equal(data.attemptsRemaining,2);assert.equal(data.history[0].state,'error');
  assert.equal(data.history[0].precheck,'passed');assert.equal(data.history[0].checks,null);
});

test('diagnostics publish only aggregated allowlisted error reasons',async()=>{
  const f=fixture(), c=await f.start();f.setSubmitStatus(402);
  await f.request('/api/submit',{challengeId:c.id,text:f.writing()});
  f.sql.prepare("INSERT INTO challenges (id,session_id,prompt,state,created_at,expires_at,submitted_at,finished_at,outcome,policy_version) VALUES ('private-id','private-session','private-prompt','error',1,2,1,2,?,'old')").run('secret diagnostic /private/path');
  const response=await f.request('/api/diagnostics');assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store, private');
  const data=await response.json() as {totalErrors:number;detailsUnavailable:number;services:{validatorOnline:boolean;detectorPausedUntil:number|null};errors:{code:string;count:number;description:string}[]};
  assert.equal(data.totalErrors,2);assert.equal(data.detailsUnavailable,0);assert.equal(data.services.validatorOnline,true);assert.ok(data.services.detectorPausedUntil);
  assert.deepEqual(data.errors.map(x=>x.code).sort(),['provider_billing','unknown']);
  const serialized=JSON.stringify(data);
  for(const value of ['private-id','private-session','private-prompt','secret diagnostic','/private/path','unit-test','task_id','session_id','check_details'])assert.ok(!serialized.includes(value));
  f.sql.prepare('DELETE FROM challenges').run();
  const cleared=await (await f.request('/api/diagnostics')).json() as typeof data;
  assert.equal(cleared.totalErrors,2);assert.equal(cleared.detailsUnavailable,2);assert.deepEqual(cleared.errors,[]);
});

test('shortcut grants retries only to its server session and preserves verification gates',async()=>{
  const f=fixture();
  assert.equal((await f.request('/api/diagnostics/unlock',{code:'wrong'})).status,400);
  assert.equal(f.cookie,'');
  assert.equal((await f.request('/api/diagnostics/unlock',{code:'uuddlrlrba'},{origin:'https://elsewhere.example'})).status,403);
  assert.equal((await f.request('/api/diagnostics/unlock',{code:'uuddlrlrba'})).status,200);
  const unlockedCookie=f.cookie;
  assert.equal((await f.request('/api/room')).status,403);
  assert.equal((await f.request('/api/challenge',{})).status,400,'the shortcut never replaces Turnstile');
  for(let i=0;i<7;i++) {
    const c=await f.start();
    assert.equal((await f.request('/api/submit',{challengeId:c.id,text:f.writing()})).status,202);
    await f.complete(c.id,{setting:true,characters:true,conflict:true,story:false});
  }
  const status=await (await f.request('/api/status')).json() as {unlimitedAttempts:boolean;attemptsRemaining:number|null;history:AttemptResult[]};
  assert.equal(status.unlimitedAttempts,true);assert.equal(status.attemptsRemaining,null);assert.equal(status.history.length,7);
  f.cookie='';
  const other=await (await f.request('/api/status?unlimitedAttempts=true')).json() as typeof status;
  assert.equal(other.unlimitedAttempts,false);assert.equal(other.attemptsRemaining,0);assert.deepEqual(other.history,[]);
  f.cookie=unlockedCookie;
  f.sql.prepare("UPDATE demo_budget SET prior_reserved_cents=limit_cents-105").run();
  assert.equal((await f.request('/api/challenge',{turnstileToken:'fresh'})).status,503,'the shared budget still closes the test');
  assert.equal(f.calls,7);
});

test('ordinary quoted dialogue and contractions fit the 200–250 word submission limit',async()=>{
  for(const sentence of ['“Don’t worry,” Mara said. “The cat’s safely inside tonight.”','“Don’t worry,” Mara said. “The cat’s safely inside tonight, promise.”']) {
    const f=fixture(), c=await f.start();
    const text=Array(25).fill(sentence).join('\n\n');
    const inspected=inspectWriting(text);
    assert.ok([225,250].includes(inspected.count));assert.equal(inspected.billingSafe,true);assert.equal(inspected.valid,true);
    assert.equal((await f.request('/api/submit',{challengeId:c.id,text})).status,202);
    assert.equal(f.calls,1);assert.equal((await budgetState(f.db)).reservedCents,15);
  }
});

test("result image sharing requires its completed result owner and remains idempotent after cleanup", async () => {
  const f = fixture(), c = await f.start();
  f.env.RESULT_IMAGE_TOKEN = "test-image-upload-secret-with-32-characters";
  const png = new Uint8Array(33); png.set([137,80,78,71,13,10,26,10]);
  let uploads = 0;
  const fetcher: typeof fetch = async (url, options) => {
    uploads++;
    assert.match(String(url), /^https:\/\/art\.10xcatdad\.xyz\/api\/captcha-results\/[a-f0-9]{64}$/);
    assert.equal(options?.redirect, 'manual');
    assert.equal(new Headers(options?.headers).get('authorization'), `Bearer ${f.env.RESULT_IMAGE_TOKEN}`);
    assert.equal(new Headers(options?.headers).get('x-result-state'), 'passed');
    return Response.json({ saved:true });
  };
  const share = (method = 'POST', cookie = f.cookie, origin = 'http://localhost', body: Uint8Array | null = png, extra: Record<string,string> = {}) => handleApi(new Request(`http://localhost/api/result-image?id=${c.id}&v=4`, {method,headers:{cookie,origin,'content-type':'image/png',...extra},body:method==='POST'&&body?body.buffer as ArrayBuffer:null}),f.env,{now:1_800_000_000_001,fetcher});
  assert.equal((await share('POST','')).status,401);
  assert.equal((await share()).status,404, 'unfinished results cannot upload');
  await f.request('/api/submit',{challengeId:c.id,text:f.writing()}); await f.result(c.id);
  assert.equal((await share('POST',f.cookie,'https://elsewhere.test')).status,403);
  assert.equal((await share('POST',f.cookie,'http://localhost',png,{'content-type':'text/html'})).status,415);
  assert.equal((await share('POST',f.cookie,'http://localhost',png,{'content-length':String(3*1024*1024)})).status,413);
  assert.equal((await share('POST',f.cookie,'http://localhost',new Uint8Array(2*1024*1024+1))).status,413);
  assert.equal((await share('POST',f.cookie,'http://localhost',new Uint8Array(40))).status,400);
  const owner = f.cookie; f.cookie = ''; await f.start(); const other = f.cookie; f.cookie = owner;
  assert.equal((await share('GET',other)).status,404); assert.equal((await share('POST',other)).status,404);
  assert.equal(uploads,0);
  const uploaded = await share(); assert.equal(uploaded.status,200);
  const info = await uploaded.json() as {shareUrl:string;imageUrl:string};
  assert.match(info.shareUrl,/^https:\/\/art\.10xcatdad\.xyz\/r\/[a-f0-9]{64}$/);
  assert.equal(info.imageUrl,`${info.shareUrl}/image.png`); assert.ok(!info.shareUrl.includes(c.id));
  assert.deepEqual(await (await share()).json(),info); assert.equal(uploads,1);
  f.sql.exec('DELETE FROM challenges');
  assert.deepEqual(await (await share('GET')).json(),info);
  assert.equal((await share('GET',other)).status,404);
  assert.ok(!JSON.stringify(info).includes(f.env.RESULT_IMAGE_TOKEN));
});

test("uncertain result uploads retry the same opaque key and serialize simultaneous uploads", async () => {
  const f = fixture(), c = await f.start(); f.env.RESULT_IMAGE_TOKEN = 'test-dedicated-result-image-token';
  await f.request('/api/submit',{challengeId:c.id,text:f.writing()}); await f.result(c.id);
  const png = new Uint8Array(33); png.set([137,80,78,71,13,10,26,10]);
  const urls: string[] = []; let fail = true, release: (() => void) | undefined;
  const upload = () => handleApi(new Request(`http://localhost/api/result-image?id=${c.id}&v=4`,{method:'POST',headers:{cookie:f.cookie,origin:'http://localhost','content-type':'image/png'},body:png}),f.env,{now:1_800_000_000_001,fetcher:async url=>{urls.push(String(url));if(fail)throw new Error('unavailable');await new Promise<void>(r=>{release=r;});return Response.json({saved:true});}});
  assert.equal((await upload()).status,503); fail=false;
  const first = upload();
  while (!release) await new Promise(r=>setTimeout(r,1));
  assert.equal((await upload()).status,409); release(); assert.equal((await first).status,200);
  assert.equal(urls.length,2); assert.equal(urls[0],urls[1]);
});

test("sharing an old result rotates its image URL once and rejects stale renderer uploads", async () => {
  const f = fixture(), c = await f.start(); f.env.RESULT_IMAGE_TOKEN = 'test-image-secret';
  await f.request('/api/submit', {challengeId:c.id,text:f.writing()}); await f.result(c.id);
  const oldId = 'a'.repeat(64), now = 1_800_000_000_001;
  f.sql.prepare('INSERT INTO result_shares (challenge_id,share_id,created_at,uploaded_at) VALUES (?,?,?,?)').run(c.id,oldId,now-1000,now-500);
  assert.deepEqual(await (await f.request(`/api/result-image?id=${c.id}&v=4`)).json(), {shareUrl:null,imageUrl:null});
  const png = new Uint8Array(33); png.set([137,80,78,71,13,10,26,10]);
  const uploaded: string[] = [];
  const post = (version:string) => handleApi(new Request(`http://localhost/api/result-image?id=${c.id}&v=${version}`, {method:'POST',headers:{cookie:f.cookie,origin:'http://localhost','content-type':'image/png'},body:png}), f.env, {now,fetcher:async url=>{uploaded.push(String(url));return Response.json({saved:true});}});
  assert.equal((await post('2')).status,409);
  assert.equal((await post('')).status,409);
  assert.equal(f.sql.prepare('SELECT share_id FROM result_shares WHERE challenge_id=?').get(c.id)?.share_id,oldId);
  const response = await post('4'); assert.equal(response.status,200);
  const current = await response.json() as {shareUrl:string;imageVersion:number};
  assert.equal(current.imageVersion,4); assert.ok(!current.shareUrl.endsWith(oldId));
  assert.deepEqual(await (await post('4')).json(),current); assert.equal(uploaded.length,1);
  assert.deepEqual(await (await f.request(`/api/result-image?id=${c.id}&v=4`)).json(),current);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS total FROM result_shares WHERE challenge_id=?').get(c.id)?.total,1);
});

test("an open tab's unversioned upload still works and cannot downgrade a newer image", async () => {
  const f = fixture(), c = await f.start(); f.env.RESULT_IMAGE_TOKEN = 'test-image-secret';
  await f.request('/api/submit', {challengeId:c.id,text:f.writing()}); await f.result(c.id);
  const png = new Uint8Array(33); png.set([137,80,78,71,13,10,26,10]);
  const uploaded: string[] = [];
  const post = (query='') => handleApi(new Request(`http://localhost/api/result-image?id=${c.id}${query}`, {method:'POST',headers:{cookie:f.cookie,origin:'http://localhost','content-type':'image/png'},body:png}),f.env,{now:1_800_000_000_001,fetcher:async url=>{uploaded.push(String(url));return Response.json({saved:true});}});
  const legacyResponse = await post(); assert.equal(legacyResponse.status,200);
  const legacy = await legacyResponse.json() as {shareUrl:string;imageVersion:number};
  assert.equal(legacy.imageVersion,2); assert.equal(uploaded.length,1);
  assert.deepEqual(await (await post()).json(),legacy); assert.equal(uploaded.length,1);
  assert.deepEqual(await (await f.request(`/api/result-image?id=${c.id}&v=4`)).json(),{shareUrl:null,imageUrl:null});
  const current = await (await post('&v=4')).json() as {shareUrl:string;imageVersion:number};
  assert.equal(current.imageVersion,4); assert.notEqual(current.shareUrl,legacy.shareUrl); assert.equal(uploaded.length,2);
  assert.deepEqual(await (await post()).json(),current); assert.equal(uploaded.length,2);
  assert.deepEqual(await (await f.request(`/api/result-image?id=${c.id}`)).json(),current);
});

test("a legacy upload cannot acquire a newer image's pending upload slot", async () => {
  const f = fixture(), c = await f.start(); f.env.RESULT_IMAGE_TOKEN = 'test-image-secret';
  await f.request('/api/submit', {challengeId:c.id,text:f.writing()}); await f.result(c.id);
  f.sql.prepare('INSERT INTO result_shares (challenge_id,share_id,created_at,image_version) VALUES (?,?,?,4)').run(c.id,'a'.repeat(64),1_800_000_000_000);
  const png = new Uint8Array(33); png.set([137,80,78,71,13,10,26,10]);
  let uploads=0;
  const response=await handleApi(new Request(`http://localhost/api/result-image?id=${c.id}`,{method:'POST',headers:{cookie:f.cookie,origin:'http://localhost','content-type':'image/png'},body:png}),f.env,{now:1_800_000_000_001,fetcher:async()=>{uploads++;return Response.json({saved:true});}});
  assert.equal(response.status,409); assert.equal(uploads,0);
  assert.equal(f.sql.prepare('SELECT image_version FROM result_shares WHERE challenge_id=?').get(c.id)?.image_version,4);
});
