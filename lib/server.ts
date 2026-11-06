import { ACCESS_MS, CHALLENGE_MS, createPrompt, inspectWriting, MAX_WORDS, MIN_WORDS, POLICY_VERSION, type StoryPrompt } from "./challenge.ts";
import { getResult, submitText, ProviderError, type Fetcher } from "./pangram.ts";
import { initializeBudget, budgetState, reserveScan, DEMO_ID, SCAN_RESERVATION_CENTS, PANGRAM_MODEL } from "./budget.ts";
import { captureCompletedResults, overallStats } from "./stats.ts";
import { serviceDiagnostics } from "./diagnostics.ts";
import { parseConcepts, conceptsPass, type CheckDetails, type AttemptResult } from "./validation.ts";
import { turnstileReady, verifyTurnstile, TurnstileUnavailable, type TurnstileEnv } from "./turnstile.ts";

export type AppEnv = TurnstileEnv & { DB?: D1Database; PANGRAM_API_KEY?: string; PANGRAM_MODEL?: string; RATE_LIMIT_SECRET?: string; ADMIN_TOKEN?: string; VALIDATOR_TOKEN?: string };
type Session = { id: string; expires_at: number; grant_expires_at: number };
type Challenge = { id: string; session_id: string; prompt: string; state: string; created_at: number; expires_at: number; submitted_at: number | null; task_id: string | null; next_poll_at: number; outcome: string | null; policy_version?: string; check_details?: string | null; validation_started_at?: number | null; validation_lease?: string | null };
const HOUR = 60 * 60_000, DAY = 24 * HOUR, COOKIE = "humanity_session";
const headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };
const json = (value: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(value, { status, headers: { ...headers, ...extra } });
class GateError extends Error {
  status: number; code: string; retryAfter?: number;
  constructor(status: number, code: string, message: string, retryAfter?: number) { super(message); this.status = status; this.code = code; this.retryAfter = retryAfter; }
}
async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), n => n.toString(16).padStart(2, "0")).join(""); }
async function pseudonym(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))), n => n.toString(16).padStart(2, "0")).join("");
}
function token() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join(""); }
function ready(env: AppEnv) { return turnstileReady(env) && !!(env.PANGRAM_API_KEY?.trim() && env.RATE_LIMIT_SECRET && env.VALIDATOR_TOKEN && env.DB); }
async function availability(env: AppEnv, db: D1Database, now: number, sessionId?: string, network?: string) {
  const paused = await db.prepare("SELECT id FROM rate_buckets WHERE id = 'provider-cooldown' AND expires_at > ?").bind(now).first();
  const validator = await db.prepare("SELECT id FROM rate_buckets WHERE id = 'validator-heartbeat' AND expires_at > ?").bind(now).first();
  const budget = await budgetState(db, sessionId, network, now);
  const budgetExhausted = budget.remainingCents < SCAN_RESERVATION_CENTS;
  const attemptLimit = budget.attemptsRemaining === 0;
  return { turnstileSiteKey: turnstileReady(env) ? env.TURNSTILE_SITE_KEY : null, configured: ready(env) && !!validator && !paused && !budgetExhausted && !attemptLimit,
    attemptsRemaining: budget.attemptsRemaining,
    unlimitedAttempts: budget.unlimitedAttempts,
    closedReason: budgetExhausted ? "budget" : attemptLimit ? "attempts" : null,
    serviceMessage: budgetExhausted ? "The demo’s API budget has been used up."
      : attemptLimit ? "You’ve used all 3 tries."
      : paused || !validator || !turnstileReady(env) ? "Checks are temporarily unavailable. Please try again later." : undefined };
}
function enforceLimits(state: Awaited<ReturnType<typeof budgetState>>) {
  if (state.remainingCents < SCAN_RESERVATION_CENTS) throw new GateError(503, "budget_exhausted", "The demo’s API budget has been used up.");
  if (state.attemptsRemaining === 0) throw new GateError(429, "attempt_limit", "You’ve used all 3 tries.");
}
function dbFor(env: AppEnv) { if (!env.DB) throw new GateError(503, "unavailable", "The writing challenge is temporarily unavailable."); return env.DB; }
async function sessionFor(request: Request, db: D1Database, now: number): Promise<Session | null> {
  const raw = request.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  return db.prepare("SELECT id, expires_at, grant_expires_at FROM sessions WHERE id = ? AND expires_at > ?").bind(await hash(raw), now).first<Session>();
}
async function createSession(request: Request, db: D1Database, now: number) {
  const raw = token(), session: Session = { id: await hash(raw), expires_at: now + 365 * DAY, grant_expires_at: 0 };
  await db.prepare("INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?)").bind(session.id, now, session.expires_at).run();
  return { session, cookie: `${COOKIE}=${raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}` };
}
function assertOrigin(request: Request) {
  if (request.method === "GET") return;
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new GateError(403, "origin", "Please submit this form from this website.");
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new GateError(415, "content_type", "Please send a JSON request.");
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > 12_000) throw new GateError(413, "too_large", "That response is too long.");
  const reader = request.body?.getReader();
  if (!reader) throw new GateError(400, "body", "A response is required.");
  const parts: Uint8Array[] = []; let total = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > 12_000) { await reader.cancel(); throw new GateError(413, "too_large", "That response is too long."); }
    parts.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0; for (const p of parts) { bytes.set(p, offset); offset += p.length; }
  try { const body: unknown = JSON.parse(new TextDecoder().decode(bytes)); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); return body as Record<string, unknown>; }
  catch { throw new GateError(400, "body", "The response could not be read."); }
}
async function reserve(db: D1Database, name: string, limit: number, period: number, now: number) {
  const window = Math.floor(now / period), end = (window + 1) * period;
  const result = await db.prepare("INSERT INTO rate_buckets (id, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count").bind(`${name}:${window}`, end, limit).first();
  if (!result) throw new GateError(429, "rate_limit", "The attempt limit has been reached. Please try again later.", Math.ceil((end - now) / 1000));
}
async function networkKey(request: Request, env: AppEnv) {
  // The hosting edge must overwrite this header. Local requests share a single bucket.
  const host = new URL(request.url).hostname, local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  const ip = local ? "local" : request.headers.get("cf-connecting-ip");
  if (!ip || !env.RATE_LIMIT_SECRET) throw new GateError(503, "unavailable", "The writing challenge is temporarily unavailable.");
  const network = ip.includes(":") ? ipv6Prefix(ip) : ip;
  return pseudonym(`${DEMO_ID}:${network}`, env.RATE_LIMIT_SECRET);
}
function ipv6Prefix(ip: string) {
  const [left, right = ""] = ip.toLowerCase().split("::"), a = left ? left.split(":") : [], b = right ? right.split(":") : [];
  const expanded = ip.includes("::") ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  return expanded.slice(0, 4).map(x => x.padStart(4, "0")).join(":");
}
function publicChallenge(c: Challenge) {
  return { id: c.id, prompt: JSON.parse(c.prompt) as StoryPrompt, precheck: c.policy_version === POLICY_VERSION ? "passed" : "not-run", state: c.state, createdAt: c.created_at, expiresAt: c.expires_at, minWords: MIN_WORDS, maxWords: MAX_WORDS };
}
async function authorized(request: Request, secret?: string) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return !!secret && !!supplied && await hash(supplied) === await hash(secret);
}
function details(c: Challenge): CheckDetails | null { return c.check_details ? JSON.parse(c.check_details) : null; }
async function attemptHistory(db: D1Database, sessionId?: string): Promise<AttemptResult[]> {
  if (!sessionId) return [];
  const rows = await db.prepare(`
    SELECT id, state, submitted_at, check_details, policy_version FROM challenges
    WHERE session_id = ? AND submitted_at IS NOT NULL AND state IN ('passed', 'rejected', 'error')
    UNION ALL
    SELECT r.challenge_id AS id, d.outcome AS state, r.created_at AS submitted_at, NULL AS check_details, NULL AS policy_version
    FROM demo_reservations r JOIN demo_results d ON d.challenge_id = r.challenge_id AND d.demo_id = r.budget_id
    WHERE r.session_id = ? AND r.budget_id = ? AND NOT EXISTS (SELECT 1 FROM challenges c WHERE c.id = r.challenge_id)
    ORDER BY submitted_at DESC, id DESC LIMIT 50
  `).bind(sessionId, sessionId, DEMO_ID).all<{ id: string; state: AttemptResult["state"]; submitted_at: number; check_details: string | null; policy_version: string | null }>();
  return rows.results.map(row => ({ id: row.id, state: row.state, submittedAt: row.submitted_at,
    precheck: row.policy_version ? row.policy_version === POLICY_VERSION ? "passed" : "not-run" : null,
    checks: row.check_details ? JSON.parse(row.check_details) : null }));
}
async function finish(db: D1Database, c: Challenge, result: CheckDetails, version: string, now: number) {
  const passed = result.detectorPassed && conceptsPass(result.concepts);
  const state = passed ? "passed" : "rejected";
  await db.batch([
    db.prepare("UPDATE sessions SET grant_expires_at = MAX(grant_expires_at, ?) WHERE id = ? AND ? = 'passed' AND EXISTS (SELECT 1 FROM challenges WHERE id = ? AND state = 'checking')").bind(now + ACCESS_MS, c.session_id, state, c.id),
    db.prepare("UPDATE challenges SET state = ?, outcome = ?, provider_version = ?, check_details = ?, finished_at = ? WHERE id = ? AND state = 'checking'").bind(state, state, version, JSON.stringify({ ...result, precheck: c.policy_version === POLICY_VERSION ? "passed" : "not-run" }), now, c.id),
  ]);
  await captureCompletedResults(db);
}
async function validatorApi(request: Request, env: AppEnv, db: D1Database, now: number, fetcher?: Fetcher) {
  if (!await authorized(request, env.VALIDATOR_TOKEN)) throw new GateError(401, "unauthorized", "Worker authentication required.");
  if (request.method !== "POST") throw new GateError(405, "method", "Use POST.");
  const path = new URL(request.url).pathname;
  if (path === "/api/validator/heartbeat" || path === "/api/validator/next") {
    await db.prepare("INSERT INTO rate_buckets (id, count, expires_at) VALUES ('validator-heartbeat', 1, ?) ON CONFLICT(id) DO UPDATE SET expires_at = excluded.expires_at").bind(now + 90_000).run();
    if (path.endsWith("heartbeat")) return json({ ok: true });
    const lease = token();
    const job = await db.prepare("UPDATE challenges SET validation_started_at = ?, validation_lease = ? WHERE id = (SELECT c.id FROM challenges c JOIN demo_reservations r ON r.challenge_id = c.id WHERE c.state = 'checking' AND c.task_id IS NOT NULL AND c.policy_version IN (?, 'writing-concepts-v3') AND c.validation_started_at IS NULL AND c.submitted_at > ? ORDER BY c.submitted_at LIMIT 1) AND validation_started_at IS NULL RETURNING id, task_id, prompt").bind(now, lease, POLICY_VERSION, now - 300_000).first<{id:string;task_id:string;prompt:string}>();
    return json({ job: job ? { id: job.id, taskId: job.task_id, prompt: JSON.parse(job.prompt), lease } : null });
  }
  if (path === "/api/validator/complete") {
    const body = await readBody(request);
    if (typeof body.id !== "string" || typeof body.lease !== "string") throw new GateError(400, "job", "Invalid job.");
    const c = await db.prepare("SELECT * FROM challenges WHERE id = ? AND validation_lease = ?").bind(body.id, body.lease).first<Challenge>();
    if (!c) throw new GateError(404, "job", "Unknown job.");
    if (c.state !== "checking") return json({ accepted: true });
    if (!c.submitted_at || now - c.submitted_at > 300_000 || body.error === true) {
      await db.prepare("UPDATE challenges SET state = 'error', outcome = 'validation_unavailable', finished_at = ? WHERE id = ? AND state = 'checking'").bind(now, c.id).run();
      return json({ accepted: true });
    }
    let concepts;
    try { concepts = parseConcepts(body.concepts); } catch { throw new GateError(422, "result", "Invalid concept result."); }
    const result = await getResult(c.task_id!, env.PANGRAM_API_KEY!, fetcher);
    if (result.status === "pending") throw new GateError(409, "pending", "Detector result pending.");
    await finish(db, c, { pangram: result.score, detectorPassed: result.status === "passed", concepts }, result.version, now);
    return json({ accepted: true });
  }
  throw new GateError(404, "route", "Unknown worker route.");
}
async function getChallenge(db: D1Database, id: unknown, session: Session) {
  if (typeof id !== "string" || id.length > 80) throw new GateError(400, "challenge", "Choose a writing prompt first.");
  const row = await db.prepare("SELECT * FROM challenges WHERE id = ? AND session_id = ?").bind(id, session.id).first<Challenge>();
  if (!row) throw new GateError(404, "challenge", "That writing prompt is unavailable.");
  return row;
}
export async function handleApi(request: Request, env: AppEnv, options: { fetcher?: Fetcher; now?: number } = {}): Promise<Response> {
  const now = options.now ?? Date.now(), path = new URL(request.url).pathname;
  try {
    const db = dbFor(env);
    if (path.startsWith("/api/validator/")) return await validatorApi(request, env, db, now, options.fetcher);
    assertOrigin(request);
    if (["/api/challenge", "/api/submit"].includes(path) && /HeadlessChrome|Playwright|Puppeteer|Selenium|GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|anthropic-ai|PerplexityBot|Google-Extended|Bytespider|CCBot/i.test(request.headers.get("user-agent") || "")) throw new GateError(403, "automation", "Automated interaction is not allowed.");
    await db.prepare("UPDATE challenges SET state = 'error', outcome = 'validation_timeout', finished_at = ? WHERE state = 'checking' AND submitted_at < ?").bind(now, now - 300_000).run();
    await initializeBudget(db, now);
    await captureCompletedResults(db);
    if (path === "/api/diagnostics" && request.method === "GET") {
      return json(await serviceDiagnostics(db, now, { browserConfigured: turnstileReady(env), detectorConfigured: !!env.PANGRAM_API_KEY?.trim() }));
    }
    if (path === "/api/diagnostics/unlock" && request.method === "POST") {
      const body = await readBody(request);
      if (body.code !== "uuddlrlrba") throw new GateError(400, "code", "Code not recognized.");
      let session = await sessionFor(request, db, now), cookie: string | null = null;
      if (!session) ({ session, cookie } = await createSession(request, db, now));
      await db.prepare("INSERT INTO rate_buckets (id, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET expires_at = excluded.expires_at").bind(`demo-unlimited:${session.id}`, session.expires_at).run();
      return json({ unlocked: true, unlimitedAttempts: true }, 200, cookie ? { "Set-Cookie": cookie } : {});
    }
    if (path === "/api/status" && request.method === "GET") {
      const session = await sessionFor(request, db, now);
      const current = session ? await db.prepare("SELECT * FROM challenges WHERE session_id = ? AND ((policy_version = ? AND state = 'open' AND expires_at > ?) OR (state = 'checking' AND policy_version IN ('writing-turnstile-v4', 'writing-concepts-v3'))) ORDER BY created_at DESC LIMIT 1").bind(session.id, POLICY_VERSION, now).first<Challenge>() : null;
      return json({ ...await availability(env, db, now, session?.id, await networkKey(request, env)), history: await attemptHistory(db, session?.id), overall: await overallStats(db), accessExpiresAt: session && session.grant_expires_at > now ? session.grant_expires_at : null, challenge: current ? publicChallenge(current) : null });
    }
    if (path === "/api/challenge" && request.method === "POST") {
      const network = await networkKey(request, env);
      let session = await sessionFor(request, db, now), cookie: string | null = null;
      const limits = await budgetState(db, session?.id, network, now);
      enforceLimits(limits);
      if (session) {
        const current = await db.prepare("SELECT * FROM challenges WHERE session_id = ? AND ((policy_version = ? AND state = 'open' AND expires_at > ?) OR (state = 'checking' AND policy_version IN ('writing-turnstile-v4', 'writing-concepts-v3'))) ORDER BY created_at DESC LIMIT 1").bind(session.id, POLICY_VERSION, now).first<Challenge>();
        if (current) return json({ challenge: publicChallenge(current), ...await availability(env, db, now, session.id, network) });
      }
      if (!turnstileReady(env)) throw new GateError(503, "browser_check_unavailable", "The browser check is temporarily unavailable.");
      const gateBody = await readBody(request);
      await reserve(db, `browser-check:${network}`, limits.unlimitedAttempts ? 120 : 30, HOUR, now);
      try {
        const verified = await verifyTurnstile(gateBody.turnstileToken, env.TURNSTILE_SECRET_KEY!, new URL(request.url).hostname, request.headers.get("cf-connecting-ip"), options.fetcher);
        if (!verified) throw new GateError(400, "browser_check", "The browser check failed or expired. Please retry it.");
      } catch (error) {
        if (error instanceof TurnstileUnavailable) throw new GateError(503, "browser_check_unavailable", "The browser check is temporarily unavailable. Please retry it.");
        throw error;
      }
      if (!limits.unlimitedAttempts) await reserve(db, `issue-network:${network}`, 12, HOUR, now);
      if (!session) {
        ({ session, cookie } = await createSession(request, db, now));
      }
      if (!limits.unlimitedAttempts) await reserve(db, `issue-session:${session.id}`, 6, HOUR, now);
      const c: Challenge = { id: crypto.randomUUID(), session_id: session.id, prompt: JSON.stringify(createPrompt()), state: "open", created_at: now, expires_at: now + CHALLENGE_MS, submitted_at: null, task_id: null, next_poll_at: 0, outcome: null };
      await db.prepare("INSERT INTO challenges (id, session_id, prompt, state, created_at, expires_at, policy_version) VALUES (?, ?, ?, 'open', ?, ?, ?)").bind(c.id, c.session_id, c.prompt, now, c.expires_at, POLICY_VERSION).run();
      await db.batch([db.prepare("DELETE FROM rate_buckets WHERE expires_at < ?").bind(now - DAY), db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now - DAY), db.prepare("DELETE FROM challenges WHERE created_at < ?").bind(now - 30 * DAY)]);
      return json({ challenge: publicChallenge(c), ...await availability(env, db, now, session.id, network) }, 201, cookie ? { "Set-Cookie": cookie } : {});
    }
    if (path === "/api/admin/metrics" && request.method === "GET") {
      const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      if (!env.ADMIN_TOKEN || !supplied || await hash(supplied) !== await hash(env.ADMIN_TOKEN)) throw new GateError(401, "unauthorized", "Administrator access is required.");
      const summary = await db.prepare("SELECT COUNT(*) AS started, SUM(submitted_at IS NOT NULL) AS submitted, SUM(state = 'passed') AS passed, SUM(state = 'rejected') AS rejected, SUM(state = 'error') AS errors, SUM(state = 'open' AND expires_at < ?) AS abandoned, SUM(reported_human) AS reported_human_rejections, SUM(CASE WHEN submitted_at IS NOT NULL THEN (word_count + 99) / 100 ELSE 0 END) AS reserved_100_word_units FROM challenges WHERE created_at > ?").bind(now, now - 30 * DAY).first();
      const timings = await db.prepare("SELECT (submitted_at - created_at) AS writing_ms, (finished_at - submitted_at) AS verification_ms, provider_version, outcome, policy_version FROM challenges WHERE submitted_at IS NOT NULL AND created_at > ? ORDER BY created_at DESC LIMIT 1000").bind(now - 30 * DAY).all();
      const feedback = await db.prepare("SELECT reported_source, state, COUNT(*) AS count FROM challenges WHERE reported_source IS NOT NULL GROUP BY reported_source, state").all();
      return json({ summary, overall: await overallStats(db), budget: await budgetState(db), feedback: feedback.results, samples: timings.results, note: "Self-reports are unverified. Abandonment means an expired prompt with no accepted submission. Reserved units include provider failures and can overestimate billing." });
    }
    const session = await sessionFor(request, db, now);
    if (!session) throw new GateError(401, "session", "Your session has expired. Please start again.");
    if (path === "/api/room" && request.method === "GET") {
      if (session.grant_expires_at <= now) throw new GateError(403, "access", "Complete the writing challenge to enter.");
      return json({ title: "Protected page", message: "The server accepted your access pass.", expiresAt: session.grant_expires_at, receipt: crypto.randomUUID() });
    }
    if (path === "/api/submit" && request.method === "POST") {
      if (!ready(env)) throw new GateError(503, "not_configured", "Live verification is not connected yet. Your writing has not been sent anywhere.");
      const body = await readBody(request), c = await getChallenge(db, body.challengeId, session);
      if (c.state !== "open") return json({ state: c.state, challengeId: c.id }, c.state === "checking" ? 202 : 409);
      const network = await networkKey(request, env);
      enforceLimits(await budgetState(db, session.id, network, now));
      if (!(await availability(env, db, now, session.id, network)).configured) throw new GateError(503, "provider", "Live checks are temporarily unavailable. Please try again in a few minutes.");
      if (c.policy_version !== POLICY_VERSION) throw new GateError(410, "expired", "This prompt has changed. Please get a new prompt.");
      if (c.expires_at <= now) throw new GateError(410, "expired", "This prompt has expired. Please start a new challenge.");
      if (typeof body.text !== "string") throw new GateError(400, "writing", "Please write a response.");
      const writing = inspectWriting(body.text, JSON.parse(c.prompt));
      if (!writing.valid) return json({ code: "writing", message: !writing.billingSafe ? "Please shorten the response or use fewer symbols. This small demo accepts plain prose only." : `Please write ${MIN_WORDS}–${MAX_WORDS} words.`, wordCount: writing.count }, 422);
      const claimed = await db.prepare("UPDATE challenges SET state = 'checking', submitted_at = ?, word_count = ? WHERE id = ? AND state = 'open' RETURNING id").bind(now, writing.count, c.id).first();
      if (!claimed) return json({ state: "checking", challengeId: c.id }, 202);
      try {
        const reserved = await reserveScan(db, c.id, session.id, network, now);
        if (!reserved) {
          enforceLimits(await budgetState(db, session.id, network, now));
          throw new GateError(409, "already_submitted", "This challenge has already reserved a check. Please start a new prompt.");
        }
      } catch (error) {
        await db.prepare("UPDATE challenges SET state = 'open', submitted_at = NULL, word_count = NULL WHERE id = ?").bind(c.id).run();
        throw error;
      }
      try {
        const taskId = await submitText(body.text, env.PANGRAM_API_KEY!, PANGRAM_MODEL, options.fetcher);
        await db.prepare("UPDATE challenges SET task_id = ? WHERE id = ? AND state = 'checking'").bind(taskId, c.id).run();
        return json({ state: "checking", challengeId: c.id, attemptsRemaining: (await budgetState(db, session.id, network, now)).attemptsRemaining }, 202);
      } catch (error) {
        // An ambiguous POST failure may already have been billed. Never retry it automatically.
        const code = error instanceof ProviderError ? error.code : "unavailable";
        if (["billing", "configuration"].includes(code)) await db.prepare("INSERT INTO rate_buckets (id, count, expires_at) VALUES ('provider-cooldown', 1, ?) ON CONFLICT(id) DO UPDATE SET expires_at = excluded.expires_at").bind(now + 300_000).run();
        await db.prepare("UPDATE challenges SET state = 'error', outcome = ?, finished_at = ? WHERE id = ?").bind(`provider_${code}`, now, c.id).run();
        throw new GateError(503, "provider", "The verification service could not complete this check.");
      }
    }
    if (path === "/api/result" && request.method === "GET") {
      const c = await getChallenge(db, new URL(request.url).searchParams.get("id"), session);
      if (c.state !== "checking") return json({ state: c.state, checks: details(c), accessExpiresAt: session.grant_expires_at > now ? session.grant_expires_at : null });
      return json({ state: "checking" }, 202);
    }
    if (path === "/api/feedback" && request.method === "POST") {
      const body = await readBody(request), c = await getChallenge(db, body.challengeId, session);
      if (!["passed", "rejected"].includes(c.state) || !["human", "assisted", "ai"].includes(String(body.source))) throw new GateError(422, "feedback", "Choose how the writing was produced after a completed check.");
      await db.prepare("UPDATE challenges SET reported_source = ? WHERE id = ? AND session_id = ? AND reported_source IS NULL").bind(body.source, c.id, session.id).run();
      return json({ recorded: true });
    }
    if (path === "/api/report" && request.method === "POST") {
      const body = await readBody(request), c = await getChallenge(db, body.challengeId, session);
      if (c.state !== "rejected") throw new GateError(409, "report", "Only an unsuccessful writing check can be reported.");
      await db.prepare("UPDATE challenges SET reported_human = 1 WHERE id = ? AND session_id = ?").bind(c.id, session.id).run();
      return json({ recorded: true });
    }
    return json({ code: "not_found", message: "This endpoint does not exist." }, 404);
  } catch (error) {
    if (error instanceof GateError) return json({ code: error.code, message: error.message }, error.status, error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {});
    return json({ code: "unavailable", message: "The writing challenge is temporarily unavailable. Please try again shortly." }, 503);
  }
}
