"use client";

import { useEffect, useRef, useState } from "react";
import type { PangramBreakdown as Breakdown } from "@/lib/pangram-details";
import { percent, type AttemptResult, type PangramScore } from "@/lib/validation";

const missing = "Not supplied";
const score = (value: number | null) => value === null ? missing : percent(value);
function Scores({ values }: { values: PangramScore }) {
  return <dl className="pangram-scores">
    <div><dt>Human</dt><dd>{percent(values.human)}</dd></div>
    <div><dt>AI-assisted</dt><dd>{percent(values.assisted)}</dd></div>
    <div><dt>AI-generated</dt><dd>{percent(values.ai)}</dd></div>
  </dl>;
}

export function PangramBreakdown({ attempts }: { attempts: AttemptResult[] }) {
  const [selected, setSelected] = useState("");
  const id = attempts.find(attempt => attempt.id === selected)?.id ?? attempts[0]?.id ?? "";
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<{ id: string; data?: Breakdown; error?: string } | null>(null);
  // Keep private report text in memory only; hiding diagnostics unmounts this cache.
  const cache = useRef(new Map<string, Breakdown>());
  useEffect(() => {
    if (!id) return;
    const existing = cache.current.get(id);
    if (existing) { setReport({ id, data: existing }); return; }
    const controller = new AbortController();
    setReport(null);
    async function load() {
      const response = await fetch(`/api/diagnostics/pangram?id=${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json() as { breakdown?: Breakdown; message?: string };
      if (!response.ok || !body.breakdown) {
        if (!controller.signal.aborted) setReport({ id, error: body.message || "Could not load this report. Try refreshing." });
        return;
      }
      if (controller.signal.aborted) return;
      cache.current.set(id, body.breakdown);
      setReport({ id, data: body.breakdown });
    }
    void load().catch(() => {
      if (!controller.signal.aborted) setReport({ id, error: "Could not load this report. Try refreshing." });
    });
    return () => controller.abort();
  }, [id, refresh]);

  const current = report?.id === id ? report : null;
  const data = current?.data;
  return <section className="pangram-breakdown" aria-labelledby="pangram-heading">
    <h3 id="pangram-heading">PANGRAM // DETAILED BREAKDOWN</h3>
    <p>Your attempts only. Reads the existing report; no new scan.</p>
    {!id ? <p>No completed attempts in this browser yet.</p> : <>
      <div className="pangram-attempt"><label htmlFor="pangram-attempt">Attempt</label>
        <select id="pangram-attempt" value={id} onChange={event => setSelected(event.target.value)}>
          {attempts.map((attempt, index) => <option key={attempt.id} value={attempt.id}>
            {`Attempt ${attempts.length - index} // ${attempt.state === "passed" ? "Pass" : attempt.state === "rejected" ? "Fail" : "Service error"} // ${new Date(attempt.submittedAt).toLocaleString()}`}
          </option>)}
        </select>
      </div>
      {!current && <p role="status">Loading Pangram report…</p>}
      {current?.error && <p role="alert">{current.error}</p>}
      {data && <div className="pangram-report">
        <dl className="diagnostics-services">
          <div><dt>Overall label</dt><dd>{data.verdict}</dd></div>
          <div><dt>Model</dt><dd>{data.version ?? missing}</dd></div>
        </dl>
        <h4>Text breakdown</h4>
        <Scores values={data.fractions} />
        <small>Shares of the text, not probabilities that the author is human.</small>
        <dl className="diagnostics-services">
          <div><dt>Human segments</dt><dd>{data.segments.human ?? missing}</dd></div>
          <div><dt>AI-assisted segments</dt><dd>{data.segments.assisted ?? missing}</dd></div>
          <div><dt>AI-generated segments</dt><dd>{data.segments.ai ?? missing}</dd></div>
        </dl>
        <h4>Passages // {data.passages.length}</h4>
        {data.passages.length === 0 && <p>Pangram did not supply passage details for this report.</p>}
        {data.passages.map((passage, index) => <details className="pangram-passage" key={`${id}:${index}`} open={index === 0}>
          <summary>{`Passage ${index + 1} // ${passage.label ?? "Label not supplied"}`}</summary>
          {passage.text ? <blockquote>{passage.text}</blockquote> : <p>Passage text not supplied.</p>}
          <dl className="diagnostics-services">
            <div><dt>Confidence</dt><dd>{passage.confidence ?? missing}</dd></div>
            <div><dt>AI-assistance score</dt><dd>{score(passage.assistanceScore)}</dd></div>
            <div><dt>Humanizer detected</dt><dd>{passage.humanized === null ? missing : passage.humanized ? "Yes" : "No"}</dd></div>
            <div><dt>Humanizer score</dt><dd>{score(passage.humanizerScore)}</dd></div>
          </dl>
          <h4>Class probabilities</h4>
          {passage.probabilities ? <Scores values={passage.probabilities} /> : <p>{missing} for this passage.</p>}
          <dl className="diagnostics-services">
            <div><dt>Words // tokens</dt><dd>{passage.words ?? missing}{" // "}{passage.tokens ?? missing}</dd></div>
            <div><dt>Character range</dt><dd>{passage.start !== null && passage.end !== null ? `${passage.start}–${passage.end}` : missing}</dd></div>
          </dl>
          <small>Character positions refer to Pangram’s normalized text; the end position is excluded.</small>
        </details>)}
        {data.truncated && <p>Some report content was omitted to keep this view within its size limit.</p>}
        <small>Missing fields mean Pangram did not supply a usable value. Scores are model estimates.</small>
      </div>}
      <button className="secondary-button" disabled={!current} onClick={() => { cache.current.delete(id); setRefresh(value => value + 1); }}>REFRESH REPORT</button>
    </>}
  </section>;
}
