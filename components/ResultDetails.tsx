import { conceptsPass, percent, type CheckDetails, type PrecheckResult } from "@/lib/validation";

function Status({ passed }: { passed: boolean | undefined }) {
  return <span className={passed === undefined ? "" : passed ? "check-pass" : "check-fail"}>{passed === undefined ? "Unavailable" : passed ? "Pass" : "Fail"}</span>;
}

export function ResultDetails({ checks, precheck }: { checks: CheckDetails | null; precheck?: PrecheckResult }) {
  const browserPassed = (checks?.precheck ?? precheck) === "passed";
  return <div className="check-details" aria-label="Check results">
    <div><h3>Cloudflare precheck<span className={browserPassed ? "check-pass" : ""}>{browserPassed ? "Pass" : "Not run"}</span></h3></div>
    <div><h3>Story validation<Status passed={checks ? conceptsPass(checks.concepts) : undefined} /></h3>
      {checks && <ul>{([['setting', 'Setting / time'], ['characters', 'Characters'], ['conflict', 'Conflict'], ['story', 'Coherent story']] as const).map(([key, label]) => <li key={key}><span aria-label={checks.concepts[key] ? "Met:" : "Missing:"}>{checks.concepts[key] ? "✓" : "✗"}</span> {label}</li>)}</ul>}
      <small>Checked with Codex.</small>
    </div>
    <div><h3>AI detection<Status passed={checks?.detectorPassed} /></h3>
      {checks && <><p><strong>{percent(checks.pangram.ai)} AI</strong><span>{percent(checks.pangram.assisted)} AI-assisted</span><span>{percent(checks.pangram.human)} human</span></p><small>Share of text classified in each category.</small></>}
    </div>
  </div>;
}
