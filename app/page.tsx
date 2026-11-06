"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, Fingerprint, RotateCcw, ShieldCheck } from "lucide-react";
import { inspectWriting, type StoryPrompt } from "@/lib/challenge";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { ShareResult } from "@/components/ShareResult";
import { ResultDetails } from "@/components/ResultDetails";
import { SuccessFireworks } from "@/components/SuccessFireworks";
import { BrowserGate } from "@/components/BrowserGate";
import type { CheckDetails, PrecheckResult } from "@/lib/validation";

type Challenge = { precheck?: PrecheckResult; id: string; prompt: StoryPrompt; state: string; createdAt: number; expiresAt: number; minWords: number; maxWords: number };
type Phase = "intro" | "gate" | "writing" | "checking" | "passed" | "rejected" | "error" | "room" | "closed";
type Room = { title: string; message: string; expiresAt: number; receipt: string };
type Overall = { attempts: number; passed: number; failed: number; errors: number; unfinished: number };
const DRAFT_KEY = "humanity-draft-v3";

type ApiResult = { turnstileSiteKey?: string | null; checks?: CheckDetails | null; configured: boolean; challenge: Challenge; state: Phase; accessExpiresAt: number | null; delayed?: boolean; serviceMessage?: string; attemptsRemaining?: number; closedReason?: "budget" | "attempts" | null; overall?: Overall };
class ApiError extends Error { status: number; code?: string; constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code; } }

async function api<T = ApiResult>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const result = await response.json() as T & { message?: string; code?: string };
  if (!response.ok) {
    const wait = Number(response.headers.get("retry-after"));
    throw new ApiError((result.message || "This request could not be completed.") + (wait ? ` Try again in about ${Math.ceil(wait / 60)} minutes.` : ""), response.status, result.code);
  }
  return result;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [text, setText] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [serviceMessage, setServiceMessage] = useState("");
  const [attemptsRemaining, setAttemptsRemaining] = useState(3);
  const [closedReason, setClosedReason] = useState<"budget" | "attempts" | null>(null);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [gateAttempt, setGateAttempt] = useState(0);
  const [checks, setChecks] = useState<CheckDetails | null>(null);
  const [automated, setAutomated] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [overall, setOverall] = useState<Overall | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reported, setReported] = useState(false);
  const [accessExpiresAt, setAccessExpiresAt] = useState<number | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [now, setNow] = useState(Date.now());
  const editor = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const writing = challenge ? inspectWriting(text, challenge.prompt) : { count: 0, valid: false, billingSafe: true };
  const expired = challenge ? challenge.expiresAt <= now : false;

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-only automation state is unavailable during SSR.
    if (navigator.webdriver) { setAutomated(true); setConfigured(false); setServiceMessage("Automated interaction is not allowed."); return; }
    api("/api/status").then(data => {
      if (!alive) return;
      setConfigured(data.configured); setTurnstileSiteKey(data.turnstileSiteKey || null);
      if (data.overall) setOverall(data.overall);
      setServiceMessage(data.serviceMessage || "");
      setAttemptsRemaining(data.attemptsRemaining ?? 3); setClosedReason(data.closedReason || null);
      if (data.accessExpiresAt) { setAccessExpiresAt(data.accessExpiresAt); setPhase("passed"); return; }
      if (data.closedReason && !data.challenge) { setPhase("closed"); return; }
      if (data.challenge) {
        setChallenge(data.challenge);
        setPhase(data.challenge.state === "checking" ? "checking" : "writing");
        try {
          const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
          if (draft?.id === data.challenge.id && draft.expiresAt > Date.now()) setText(draft.text);
          else sessionStorage.removeItem(DRAFT_KEY);
        } catch { /* Storage is optional, including in private browsing. */ }
      }
    }).catch(error => { if (alive) setMessage(error.message); });
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (phase !== "writing" || !challenge) return;
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ id: challenge.id, text, expiresAt: challenge.expiresAt })); } catch { /* Storage is optional. */ }
  }, [text, challenge, phase]);

  useEffect(() => {
    if (expired) { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* Optional storage. */ } }
  }, [expired]);

  useEffect(() => {
    if (phase === "writing") editor.current?.focus();
    else if (phase !== "intro") heading.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (phase !== "checking" || !challenge) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api(`/api/result?id=${encodeURIComponent(challenge!.id)}`);
        if (!alive) return;
        if (["passed", "rejected", "error"].includes(result.state)) {
          setChecks(result.checks || null); setPhase(result.state); setAccessExpiresAt(result.accessExpiresAt || null); setMessage("");
          await refreshAvailability();
          try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* Optional storage. */ }
          return;
        }
        if (result.delayed) setMessage("Still waiting. Refreshing will resume this check.");
      } catch { if (alive) setMessage("Connection interrupted. Retrying the result check."); }
      if (alive) timer = setTimeout(poll, 2500);
    }
    timer = setTimeout(poll, 1000);
    return () => { alive = false; clearTimeout(timer); };
  }, [phase, challenge]);

  async function refreshAvailability() {
    try {
      const data = await api("/api/status");
      setConfigured(data.configured); setTurnstileSiteKey(data.turnstileSiteKey || null); setServiceMessage(data.serviceMessage || "");
      if (data.overall) setOverall(data.overall);
      setAttemptsRemaining(data.attemptsRemaining ?? 3); setClosedReason(data.closedReason || null);
    } catch { /* A failed status refresh never grants access or increases attempts. */ }
  }
  async function giveFeedback(source: string) {
    if (!challenge) return;
    setBusy(true);
    try { await api("/api/feedback", { challengeId: challenge.id, source }); setFeedback(source); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function start(turnstileToken?: string) {
    if (navigator.webdriver || busy) return;
    if (!turnstileToken) { setMessage(""); setGateAttempt(n => n + 1); setPhase("gate"); return; }
    setChecks(null);
    setBusy(true); setMessage(""); setReported(false); setFeedback(null);
    try {
      const result = await api("/api/challenge", { turnstileToken });
      if (challenge?.id !== result.challenge.id) setText("");
      setChallenge(result.challenge); setConfigured(result.configured);
      setServiceMessage(result.serviceMessage || "");
      setAttemptsRemaining(result.attemptsRemaining ?? 3); setClosedReason(result.closedReason || null);
      setPhase(result.challenge.state === "checking" ? "checking" : "writing");
    } catch (error) {
      setMessage((error as Error).message);
      if (error instanceof ApiError && ["budget_exhausted", "attempt_limit"].includes(error.code || "")) { await refreshAvailability(); setPhase("closed"); }
    }
    finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (navigator.webdriver || !challenge || !writing.valid || !configured || busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await api("/api/submit", { challengeId: challenge.id, text });
      setPhase(result.state === "checking" ? "checking" : result.state);
      if (result.attemptsRemaining !== undefined) setAttemptsRemaining(result.attemptsRemaining);
    } catch (error) {
      setMessage((error as Error).message);
      if (error instanceof ApiError && ["budget_exhausted", "attempt_limit"].includes(error.code || "")) await refreshAvailability();
      else if (error instanceof ApiError && [503, 409].includes(error.status)) { await refreshAvailability(); setPhase("error"); }
      if (error instanceof ApiError && error.status === 410) setNow(challenge.expiresAt + 1);
    }
    finally { setBusy(false); }
  }
  async function enterRoom() {
    setBusy(true); setMessage("");
    try { setRoom(await api<Room>("/api/room")); setPhase("room"); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function report() {
    setBusy(true);
    try { await api("/api/report", { challengeId: challenge?.id }); await api("/api/feedback", { challengeId: challenge?.id, source: "human" }); setReported(true); setFeedback("human"); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="site-shell">
      <a className="skip-link" href="#challenge">Skip to prompt</a>
      <header className="site-header">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Returning home reloads the server-backed session state. */}
        <a className="brand" href="/" aria-label="HumansOnly home"><span className="brand-symbol"><Fingerprint size={24} strokeWidth={1.6} /></span>HumansOnly</a>
        <ThemeSwitch />
      </header>
      <main>
        <div className="main-grid">
          <section className="introduction">
            <h1>Bad Robot, Go Away <span className="title-context">(Challenge I)</span></h1>
            <p className="intro-copy">See if your favorite LLM can get past the defenses. Good luck! (challenges II through V coming soon)</p>
            {overall && <div className="overall-stats" aria-label="Stats (Since Launch)"><span>Stats (Since Launch):</span><span><strong>{overall.attempts}</strong> {overall.attempts === 1 ? "attempt" : "attempts"}</span><span><strong>{overall.passed}</strong> passed</span><span><strong>{overall.failed}</strong> failed</span>{overall.errors > 0 && <span>{overall.errors} service {overall.errors === 1 ? "error" : "errors"}</span>}{overall.unfinished > 0 && <span>{overall.unfinished} unfinished</span>}</div>}
          </section>
          <section className={`challenge-card ${phase === "writing" ? "is-writing" : ""}`} id="challenge" aria-label="Writing challenge">
            <div className="card-topline"><span><span className={`status-dot ${phase === "passed" || phase === "room" ? "success" : ""}`} />{phase === "passed" || phase === "room" ? "ACCESS GRANTED" : "WRITING CHECK"}</span><span>3 tries</span></div>
            {configured === false && !["passed", "room", "closed"].includes(phase) && <div className="setup-notice" role="status"><strong>Checks unavailable.</strong> {serviceMessage || "You can still view a prompt."}</div>}
            {phase === "intro" && <div className="welcome-content">
              <h2 ref={heading} tabIndex={-1}>Get a random prompt</h2>
              <p>Write 200–250 words using the setting and time, characters, and conflict you’re given. There’s always a cat involved. Your story is checked for AI writing and the prompt requirements. You get 3 tries.</p>
              <button className="primary-button" onClick={() => void start()} disabled={busy || automated || configured === null || !!closedReason}>{busy ? "Loading…" : "begin captcha attempt // prove your humanity"}<ArrowRight size={19} /></button>
            </div>}
            {phase === "gate" && <div className="welcome-content browser-gate"><h2 ref={heading} tabIndex={-1}>Browser check</h2><p>Complete this check to get your writing prompt.</p>{turnstileSiteKey ? <BrowserGate key={gateAttempt} siteKey={turnstileSiteKey} onVerified={token => void start(token)} onError={setMessage} /> : <p role="status">The browser check is temporarily unavailable.</p>}{busy && <p role="status">Opening your prompt…</p>}<button className="text-button" onClick={() => { setMessage(""); setGateAttempt(n => n + 1); void refreshAvailability(); }} disabled={busy}>Retry browser check</button></div>}
            {phase === "closed" && <div className="result-content"><h2 ref={heading} tabIndex={-1}>{closedReason === "attempts" ? "No tries left" : "Demo budget reached"}</h2><p>{serviceMessage}</p></div>}
            {phase === "writing" && challenge && <form onSubmit={submit} className="writing-content">
              <div className="prompt-label"><span>PROMPT</span><span>{expired ? "Prompt expired" : `${attemptsRemaining} ${attemptsRemaining === 1 ? "try" : "tries"} left`}</span></div>
              <div className="captcha-prompt"><h2 ref={heading} tabIndex={-1}>Write a short story</h2><p>Use all three requirements. {challenge.minWords}–{challenge.maxWords} words.</p>
                <dl><div><dt>Setting / time</dt><dd>{challenge.prompt.setting}</dd></div><div><dt>Characters</dt><dd>{challenge.prompt.characters}</dd></div><div><dt>Conflict</dt><dd>{challenge.prompt.conflict}</dd></div></dl>
              </div>
              {!writing.billingSafe && <p className="submission-note" role="status">Shorten the text or use fewer symbols.</p>}
              <label className="sr-only" htmlFor="story">Your short story</label>
              <div className="editor-wrap"><textarea ref={editor} id="story" value={text} onChange={e => setText(e.target.value)} placeholder="Write or paste your response…" maxLength={8000} aria-describedby="word-count writing-privacy" disabled={busy || expired} spellCheck /><div className="editor-bottom"><span>Draft saved in this tab</span><span id="word-count" className={writing.count > challenge.maxWords ? "over-limit" : writing.valid ? "count-ready" : ""}>{writing.count} <span>/ {challenge.minWords}–{challenge.maxWords} words</span></span></div></div>
              {expired ? <button className="primary-button" type="button" onClick={() => void start()} disabled={busy}>New prompt <RotateCcw size={17} /></button> : <button className="primary-button" type="submit" disabled={!writing.valid || !configured || busy}>{busy ? "Submitting…" : closedReason ? "No checks available" : configured ? "Check writing" : "Checks unavailable"}<ArrowRight size={19} /></button>}
              <p className="submission-note" id="writing-privacy">Your text goes to external verification services. This site does not save it.</p>
            </form>}
            {phase === "checking" && <div className="result-content" aria-live="polite"><h2 ref={heading} tabIndex={-1}>Checking…</h2><p>Checking AI writing and story requirements. This may take a minute.</p><div className="loading-track"><span /></div></div>}
            {phase === "passed" && <div className="result-content">{checks && challenge && <SuccessFireworks key={challenge.id} />}<div className="result-icon passed"><ShieldCheck size={35} strokeWidth={1.3} /></div><h2 ref={heading} tabIndex={-1}>Pass</h2>{challenge && <ResultDetails checks={checks} precheck={challenge.precheck} />}<button className="primary-button" onClick={enterRoom} disabled={busy}>{busy ? "Opening…" : "Open protected page"}<ArrowRight size={19} /></button><span className="quiet-label">Access expires at {accessExpiresAt ? new Date(accessExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "the end of this session"}.</span></div>}
            {phase === "room" && room && <div className="result-content"><h2 ref={heading} tabIndex={-1}>Protected page</h2><p>{room.message}</p><div className="room-receipt"><Check size={15} /> Access confirmed</div></div>}
            {(phase === "rejected" || phase === "error") && <div className="result-content"><h2 ref={heading} tabIndex={-1}>{phase === "rejected" ? "Fail" : "Check failed"}</h2><p>{phase === "rejected" ? "" : "The service could not complete the check. No access was granted."}</p>{challenge && <ResultDetails checks={checks} precheck={challenge.precheck} />}<button className="primary-button" onClick={() => void start()} disabled={busy || !!closedReason}>New prompt <ArrowRight size={19} /></button>{phase === "rejected" && checks?.detectorPassed === false && <button className="text-button" onClick={report} disabled={busy || reported}>{reported ? "Report saved" : "I wrote this myself. Report a false positive."}</button>}<span className="quiet-label">{attemptsRemaining} {attemptsRemaining === 1 ? "try" : "tries"} left.</span></div>}
            {checks && phase === "room" && <ResultDetails checks={checks} />}
            {challenge && ["passed", "rejected", "room"].includes(phase) && <div className="study-feedback"><p>{feedback ? "Feedback saved" : "How was it written? (optional)"}</p>{!feedback && <div><button onClick={() => giveFeedback("human")} disabled={busy}>By me</button><button onClick={() => giveFeedback("assisted")} disabled={busy}>AI-assisted</button><button onClick={() => giveFeedback("ai")} disabled={busy}>AI-generated</button></div>}</div>}
            {challenge && text && checks && ["passed", "rejected", "room"].includes(phase) && <ShareResult checks={checks} text={text} prompt={challenge.prompt} result={phase === "rejected" ? "rejected" : "passed"} />}
            {message && <div className="feedback-message" role="alert">{message}</div>}
          </section>
        </div>
        <section className="faq-section" id="how-it-works" aria-label="Details">
          <details><summary>Data and privacy<span>+</span></summary><p>Cloudflare Turnstile checks browser signals before issuing a prompt. Text goes to Pangram for AI detection and OpenAI for the story check. This site does not save the text. Drafts stay in this tab. Prompt details, counts, timings, results, and feedback are removed after 30 days when a new prompt is issued. Anonymous attempt records and totals stay for this test. The session cookie lasts up to a year. See <a href="https://www.pangram.com/privacy-policy" target="_blank" rel="noreferrer">Pangram’s privacy policy</a> and <a href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noreferrer">OpenAI’s privacy policy</a> for their handling of submitted text. See <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">Cloudflare’s privacy policy</a> for the browser check.</p></details>
          <details><summary>What does a pass mean?<span>+</span></summary><p>The text was classified as human-written and met the story requirements. Either check can be wrong. A pass does not prove you are human. Access lasts one hour.</p></details>
          <details><summary>Writing options<span>+</span></summary><p>Type, paste, or dictate. Prompts are in English and expire after 30 minutes. There is no alternate verification method in this demo.</p></details>
        </section>
      </main>
      <footer className="site-footer"><a href="https://github.com/10xCatDad/HumansOnly" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13} /></a><a href="https://x.com/10xCatDad" target="_blank" rel="noreferrer">@10xCatDad <ArrowUpRight size={13} /></a><a href="https://www.pangram.com" target="_blank" rel="noreferrer">Pangram <ArrowUpRight size={13} /></a></footer>
    </div>
  );
}
