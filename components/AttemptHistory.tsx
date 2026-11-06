"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AttemptResult } from "@/lib/validation";
import { ResultDetails } from "./ResultDetails";
import { ShareResult } from "./ShareResult";

function PreviousAttempt({ result, number, attemptsRemaining }: { result: AttemptResult; number: number; attemptsRemaining: number | null }) {
  const [expanded, setExpanded] = useState(false);
  const label = result.state === "passed" ? "Pass" : result.state === "rejected" ? "Fail" : "Check unavailable";
  return <li>
    <button className="history-toggle" aria-expanded={expanded} aria-controls={`history-${result.id}`} onClick={() => setExpanded(value => !value)}>
      <span>Attempt {number}<time dateTime={new Date(result.submittedAt).toISOString()}>{new Date(result.submittedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></span>
      <span><strong className={`history-${result.state}`}>{label}</strong><ChevronDown size={16} aria-hidden="true" /></span>
    </button>
    <div id={`history-${result.id}`} hidden={!expanded}>{expanded && <>
      <ResultDetails checks={result.checks} precheck={result.precheck || undefined} numbered />
      <ShareResult id={result.id} result={result.state} checks={result.checks} precheck={result.precheck} submittedAt={result.submittedAt} attemptsRemaining={attemptsRemaining} />
    </>}</div>
  </li>;
}

export function AttemptHistory({ results, attemptsRemaining }: { results: AttemptResult[]; attemptsRemaining: number | null }) {
  return <section className="attempt-history" aria-labelledby="history-heading">
    <h2 id="history-heading">Previous Results</h2>
    {results.length > 0 && <p className="history-intro">Open an attempt to review its three checks and result image.</p>}
    {results.length ? <ol>{results.map((result, index) => <PreviousAttempt key={result.id} result={result} number={results.length - index} attemptsRemaining={attemptsRemaining} />)}</ol> : <p className="history-empty">Your completed attempts will appear here.</p>}
  </section>;
}
