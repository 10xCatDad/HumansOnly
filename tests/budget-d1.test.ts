import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { initializeBudget, reserveScan, budgetState } from "../lib/budget.ts";

test("real D1 atomically enforces the lifetime budget and three-try quotas", async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('test'); } };",
    compatibilityDate: "2026-05-15",
    d1Databases: ["BUDGET", "QUOTAS"],
  }));
  try {
    const databases = await Promise.all(["BUDGET", "QUOTAS"].map(async name => {
      const db = await mf.getD1Database(name) as unknown as D1Database;
      for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) {
        const statements = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8")
          .split("--> statement-breakpoint").filter(s => s.trim());
        await db.batch(statements.map(sql => db.prepare(sql)));
      }
      await initializeBudget(db, Date.now());
      return db;
    }));
    const [budgetDb, quotaDb] = databases;
    const claims = await Promise.all(Array.from({ length: 45 }, (_, i) =>
      reserveScan(budgetDb, `challenge-${i}`, `session-${i}`, `network-${i}`, Date.now())));
    assert.equal(claims.filter(Boolean).length, 33);
    assert.equal((await budgetState(budgetDb)).reservedCents, 495);
    await initializeBudget(budgetDb, Date.now() + 86_400_000);
    assert.equal(await reserveScan(budgetDb, "later", "fresh", "fresh", Date.now()), null);
    const networkClaims = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      reserveScan(quotaDb, `network-challenge-${i}`, `session-${i}`, "shared-network", Date.now())));
    assert.equal(networkClaims.filter(Boolean).length, 3);
    const browserClaims = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      reserveScan(quotaDb, `browser-challenge-${i}`, "shared-browser", `network-${i}`, Date.now())));
    assert.equal(browserClaims.filter(Boolean).length, 3);
    assert.equal((await budgetState(quotaDb, "fresh-browser", "shared-network")).attemptsRemaining, 0);
    assert.equal((await budgetState(quotaDb, "shared-browser", "fresh-network")).attemptsRemaining, 0);
  } finally { await mf.dispose(); }
});

test('real D1 keeps the global budget atomic for an unlimited session',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:"export default {fetch(){return new Response('test')}}",compatibilityDate:'2026-05-15',d1Databases:['DB']}));
  try {
    const db=await mf.getD1Database('DB') as unknown as D1Database;
    for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()) {
      const sql=readFileSync(new URL(`../drizzle/${file}`,import.meta.url),'utf8').split('--> statement-breakpoint').filter(s=>s.trim());
      await db.batch(sql.map(s=>db.prepare(s)));
    }
    const now=Date.now();await initializeBudget(db,now);
    await db.prepare("INSERT INTO rate_buckets(id,count,expires_at) VALUES('demo-unlimited:unlocked',1,?)").bind(now+60000).run();
    const claims=await Promise.all(Array.from({length:45},(_,i)=>reserveScan(db,`unlimited-${i}`,'unlocked','same-network',now)));
    assert.equal(claims.filter(Boolean).length,33);assert.equal((await budgetState(db,'unlocked','same-network',now)).reservedCents,495);
    assert.equal(await reserveScan(db,'extra','unlocked','same-network',now),null);
    assert.equal((await budgetState(db,'other','same-network',now)).unlimitedAttempts,false);
    assert.equal((await budgetState(db,'unlocked','same-network',now+60001)).unlimitedAttempts,false);
  } finally {await mf.dispose();}
});
