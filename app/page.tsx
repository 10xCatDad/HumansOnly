"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, Fingerprint, RotateCcw, ShieldCheck } from "lucide-react";
import { inspectWriting, type StoryPrompt } from "@/lib/challenge";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { ShareResult } from "@/components/ShareResult";
import { ResultDetails } from "@/components/ResultDetails";
import { SuccessFireworks } from "@/components/SuccessFireworks";
import { AttemptHistory } from "@/components/AttemptHistory";
import { BrowserGate } from "@/components/BrowserGate";
import { ServiceDiagnostics } from "@/components/ServiceDiagnostics";
import { ResultDialog } from "@/components/ResultDialog";
import { XIcon } from "@/components/XIcon";
import { CopyPrompt } from "@/components/CopyPrompt";
import type { CheckDetails, PrecheckResult, AttemptResult } from "@/lib/validation";

type Challenge = { precheck?: PrecheckResult; id: string; prompt: StoryPrompt; state: string; createdAt: number; submittedAt?: number; expiresAt: number; minWords: number; maxWords: number };
type Phase = "intro" | "gate" | "writing" | "checking" | "passed" | "rejected" | "error" | "room" | "closed";
type Room = { title: string; message: string; expiresAt: number; receipt: string };
type Overall = { attempts: number; passed: number; failed: number; errors: number; unfinished: number };
const DRAFT_KEY = "humanity-draft-v3";

type ApiResult = { submittedAt?: number; history?: AttemptResult[]; turnstileSiteKey?: string | null; checks?: CheckDetails | null; configured: boolean; challenge: Challenge; state: Phase; accessExpiresAt: number | null; delayed?: boolean; serviceMessage?: string; unlimitedAttempts?: boolean; attemptsRemaining?: number | null; closedReason?: "budget" | "attempts" | null; overall?: Overall };
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
  const [history, setHistory] = useState<AttemptResult[] | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [text, setText] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [serviceMessage, setServiceMessage] = useState("");
  const [attemptsRemaining, setAttemptsRemaining] = useState(3);
  const [unlimitedAttempts, setUnlimitedAttempts] = useState(false);
  const [closedReason, setClosedReason] = useState<"budget" | "attempts" | null>(null);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [gateAttempt, setGateAttempt] = useState(0);
  const [resultOpen, setResultOpen] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<number | undefined>();
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
      setHistory(data.history || []); setConfigured(data.configured); setTurnstileSiteKey(data.turnstileSiteKey || null);
      if (data.overall) setOverall(data.overall);
      setServiceMessage(data.serviceMessage || "");
      setUnlimitedAttempts(data.unlimitedAttempts === true); setAttemptsRemaining(data.attemptsRemaining ?? 3); setClosedReason(data.closedReason || null);
      if (data.accessExpiresAt) { setAccessExpiresAt(data.accessExpiresAt); setPhase("passed"); return; }
      if (data.closedReason && !data.challenge) { setPhase("closed"); return; }
      if (data.challenge) {
        setChallenge(data.challenge); setSubmittedAt(data.challenge.submittedAt);
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
          setChecks(result.checks || null); setSubmittedAt(result.submittedAt); setPhase(result.state);
          if (result.checks && ["passed", "rejected"].includes(result.state)) setResultOpen(true); setAccessExpiresAt(result.accessExpiresAt || null); setMessage("");
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
      setHistory(data.history || []); setConfigured(data.configured); setTurnstileSiteKey(data.turnstileSiteKey || null); setServiceMessage(data.serviceMessage || "");
      if (data.overall) setOverall(data.overall);
      setUnlimitedAttempts(data.unlimitedAttempts === true); setAttemptsRemaining(data.attemptsRemaining ?? 3); setClosedReason(data.closedReason || null);
      if (!data.closedReason) setPhase(current => current === "closed" ? "intro" : current);
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
    setChecks(null); setSubmittedAt(undefined); setResultOpen(false);
    setBusy(true); setMessage(""); setReported(false); setFeedback(null);
    try {
      const result = await api("/api/challenge", { turnstileToken });
      if (challenge?.id !== result.challenge.id) setText("");
      setChallenge(result.challenge); setConfigured(result.configured);
      setServiceMessage(result.serviceMessage || "");
      setUnlimitedAttempts(result.unlimitedAttempts === true); setAttemptsRemaining(result.attemptsRemaining ?? 3); setClosedReason(result.closedReason || null);
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
      if (result.attemptsRemaining !== undefined) setAttemptsRemaining(result.attemptsRemaining ?? 3);
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
    try { setRoom(await api<Room>("/api/room")); setPhase("room"); setResultOpen(false); }
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
            <h1>Bad Robot, Go Away <span className="title-context">// Challenge I</span></h1>
            <p className="intro-copy">Try to get an LLM (ChatGPT, Codex, or another model) through this captcha automatically, or copy and paste its response yourself. Pass every check to reach the protected page. (Challenges II through V coming soon.)</p>
            {overall && <div className="overall-stats" aria-label="Leaderboard info"><span>LEADERBOARD INFO //</span><span><strong>{overall.attempts}</strong> {overall.attempts === 1 ? "attempt" : "attempts"}</span><span><strong>{overall.passed}</strong> passed</span><span><strong>{overall.failed}</strong> failed</span>{overall.unfinished > 0 && <span>{overall.unfinished} unfinished</span>}</div>}
          </section>
          <section className={`challenge-card ${phase === "writing" ? "is-writing" : ""}`} id="challenge" aria-label="Writing challenge">
            <div className="card-topline"><span><span className={`status-dot ${phase === "passed" || phase === "room" ? "success" : ""}`} />{phase === "passed" || phase === "room" ? "ACCESS GRANTED" : "CHALLENGE I // CAPTCHA"}</span><span className="attempts-remaining" aria-label="Attempts remaining" aria-live="polite"><strong>{configured === null ? "…" : unlimitedAttempts ? "∞" : attemptsRemaining}{!unlimitedAttempts && <small> / 3</small>}</strong><span>{unlimitedAttempts ? "unlimited tries" : "attempts left"}</span></span></div>
            {configured === false && !["passed", "room", "closed"].includes(phase) && <div className="setup-notice" role="status"><strong>Checks unavailable.</strong> {serviceMessage || "You can still view a prompt."}</div>}
            {phase === "intro" && <div className="welcome-content">
              <h2 ref={heading} tabIndex={-1}>GOAL // CAPTURE THE FLAG WITH AN LLM</h2>
              <p>Clear the browser check, then have your LLM write a 200–250 word story using the assigned setting/time, characters, and conflict. There’s always a cat. Pass every check to reach the protected page. {unlimitedAttempts ? "Unlimited retries unlocked." : "You get 3 tries."}</p>
              <button className="primary-button" onClick={() => void start()} disabled={busy || automated || configured === null || !!closedReason}><span>{busy ? "LOADING…" : "BEGIN ATTEMPT"}</span></button>
            </div>}
            {phase === "gate" && <div className="welcome-content browser-gate"><h2 ref={heading} tabIndex={-1}>Browser check</h2><p>Complete this check to get your writing prompt.</p>{turnstileSiteKey ? <BrowserGate key={gateAttempt} siteKey={turnstileSiteKey} onVerified={token => void start(token)} onError={setMessage} /> : <p role="status">The browser check is temporarily unavailable.</p>}{busy && <p role="status">Opening your prompt…</p>}<button className="text-button" onClick={() => { setMessage(""); setGateAttempt(n => n + 1); void refreshAvailability(); }} disabled={busy}>Retry browser check</button></div>}
            {phase === "closed" && <div className="result-content"><h2 ref={heading} tabIndex={-1}>{closedReason === "attempts" ? "No tries left" : "Demo budget reached"}</h2><p>{serviceMessage}</p></div>}
            {phase === "writing" && challenge && <form onSubmit={submit} className="writing-content">
              <div className="prompt-label"><span>PROMPT</span><span>{expired ? "Prompt expired" : unlimitedAttempts ? "Unlimited tries" : `${attemptsRemaining} ${attemptsRemaining === 1 ? "try" : "tries"} left`}</span></div>
              <div className="captcha-prompt"><h2 ref={heading} tabIndex={-1}>Write a short story</h2><p>Use all three requirements. {challenge.minWords}–{challenge.maxWords} words.</p>
                <dl><div><dt>Setting / time</dt><dd>{challenge.prompt.setting}</dd></div><div><dt>Characters</dt><dd>{challenge.prompt.characters}</dd></div><div><dt>Conflict</dt><dd>{challenge.prompt.conflict}</dd></div></dl>
                <CopyPrompt key={challenge.id} prompt={challenge.prompt} minWords={challenge.minWords} maxWords={challenge.maxWords} />
              </div>
              {!writing.billingSafe && <p className="submission-note" role="status">Shorten the text or use fewer symbols.</p>}
              <label className="sr-only" htmlFor="story">Your short story</label>
              <div className="editor-wrap"><textarea ref={editor} id="story" value={text} onChange={e => setText(e.target.value)} placeholder="Write or paste your response…" maxLength={8000} aria-describedby="word-count writing-privacy" disabled={busy || expired} spellCheck /><div className="editor-bottom"><span>Draft saved in this tab</span><span id="word-count" className={writing.count > challenge.maxWords ? "over-limit" : writing.valid ? "count-ready" : ""}>{writing.count} <span>/ {challenge.minWords}–{challenge.maxWords} words</span></span></div></div>
              {expired ? <button className="primary-button" type="button" onClick={() => void start()} disabled={busy}>New prompt <RotateCcw size={17} /></button> : <button className="primary-button" type="submit" disabled={!writing.valid || !configured || busy}>{busy ? "SUBMITTING…" : closedReason ? "NO CHECKS AVAILABLE" : configured ? "SUBMIT SOLUTION" : "CHECKS UNAVAILABLE"}<ArrowRight size={19} /></button>}
              <p className="submission-note" id="writing-privacy">Your text goes to external verification services. The server does not save it.</p>
            </form>}
            {phase === "checking" && <div className="result-content" aria-live="polite"><h2 ref={heading} tabIndex={-1}>Checking…</h2><p>Checking AI writing and story requirements. This may take a minute.</p><div className="loading-track"><span /></div></div>}
            {phase === "passed" && <div className="result-content">{checks && challenge && <SuccessFireworks key={challenge.id} />}<div className="result-icon passed"><ShieldCheck size={35} strokeWidth={1.3} /></div><h2 ref={heading} tabIndex={-1}>Pass</h2><p>Challenge I cleared. The protected page is yours to enter.</p>{challenge && <ResultDetails checks={checks} precheck={challenge.precheck} />}<button className="primary-button" onClick={enterRoom} disabled={busy}>{busy ? "Opening…" : "Open protected page"}<ArrowRight size={19} /></button><span className="quiet-label">Access expires at {accessExpiresAt ? new Date(accessExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "the end of this session"}.</span></div>}
            {phase === "room" && room && <div className="result-content"><h2 ref={heading} tabIndex={-1}>Challenge I // cleared</h2><p>You reached the protected page. Share your result and challenge someone else.</p><div className="room-receipt"><Check size={15} /> Access confirmed</div></div>}
            {(phase === "rejected" || phase === "error") && <div className="result-content"><h2 ref={heading} tabIndex={-1}>{phase === "rejected" ? "Fail" : "Check failed"}</h2><p>{phase === "rejected" ? "The captcha held. See which check stopped this attempt." : "The service could not complete the check. No access was granted."}</p>{challenge && <ResultDetails checks={checks} precheck={challenge.precheck} />}<button className="primary-button" onClick={() => void start()} disabled={busy || !!closedReason}>New prompt <ArrowRight size={19} /></button>{phase === "rejected" && checks?.detectorPassed === false && <button className="text-button" onClick={report} disabled={busy || reported}>{reported ? "Report saved" : "I wrote this myself. Report a false positive."}</button>}<span className="quiet-label">{unlimitedAttempts ? "Unlimited tries" : `${attemptsRemaining} ${attemptsRemaining === 1 ? "try" : "tries"} left.`}</span></div>}
            {checks && phase === "room" && <ResultDetails checks={checks} />}

            {challenge && text && checks && ["passed", "rejected", "room"].includes(phase) && <>
              <button className="secondary-button view-result" onClick={() => setResultOpen(true)}>View result // share</button>
              <ResultDialog open={resultOpen} result={phase === "rejected" ? "rejected" : "passed"} onClose={() => setResultOpen(false)}>
                <ResultDetails checks={checks} precheck={challenge.precheck} />
                <ShareResult id={challenge.id} submittedAt={submittedAt} attemptsRemaining={unlimitedAttempts ? null : attemptsRemaining} checks={checks} text={text} prompt={challenge.prompt} result={phase === "rejected" ? "rejected" : "passed"} />
                <div className="study-feedback"><p>{feedback ? "Feedback saved" : "How was it written? (optional)"}</p>{!feedback && <div><button onClick={() => giveFeedback("human")} disabled={busy}>By me</button><button onClick={() => giveFeedback("assisted")} disabled={busy}>AI-assisted</button><button onClick={() => giveFeedback("ai")} disabled={busy}>AI-generated</button></div>}</div>
                {phase === "passed" && <button className="secondary-button" onClick={enterRoom} disabled={busy}>Open protected page <ArrowRight size={16} /></button>}
              </ResultDialog>
            </>}
            {message && <div className="feedback-message" role="alert">{message}</div>}
          </section>
        </div>
        {history && <AttemptHistory results={history} attemptsRemaining={unlimitedAttempts ? null : attemptsRemaining} />}
        <section className="faq-section" id="how-it-works" aria-label="Details">
          <details><summary>Data and privacy<span>+</span></summary><p>Cloudflare Turnstile checks browser signals before issuing a prompt. Text goes to Pangram for AI detection and OpenAI for the story check. Raw story text is not saved on the server. Drafts stay in this tab. Result images are cached in this browser. Sharing also uploads the image, including its story excerpt, to an unlisted link that anyone with the link can view. Shared images remain available if browser data is cleared; they never appear in the art gallery. Prompt details, timings, detailed check results, and feedback are removed after 30 days when a new prompt is issued. Anonymous attempt records and totals stay for this test. The session cookie lasts up to a year. See <a href="https://www.pangram.com/privacy-policy" target="_blank" rel="noreferrer">Pangram’s privacy policy</a> and <a href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noreferrer">OpenAI’s privacy policy</a> for their handling of submitted text. See <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">Cloudflare’s privacy policy</a> for the browser check.</p></details>
          <details><summary>What does a pass mean?<span>+</span></summary><p>The text was classified as human-written and met the story requirements. Either check can be wrong. A pass does not prove you are human. Access lasts one hour.</p></details>
          <details><summary>Writing options<span>+</span></summary><p>Type, paste, or dictate. Prompts are in English and expire after 30 minutes. There is no alternate verification method in this demo.</p></details>
        </section>
      </main>
      <footer className="site-footer"><a href="https://github.com/10xCatDad/HumansOnly" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13} /></a><a href="https://x.com/10xCatDad" target="_blank" rel="noreferrer" aria-label="@10xCatDad on X"><XIcon /> @10xCatDad</a><a href="https://www.pangram.com" target="_blank" rel="noreferrer">Pangram <ArrowUpRight size={13} /></a></footer>
      <ServiceDiagnostics onUnlocked={refreshAvailability} />
    </div>
  );
}
