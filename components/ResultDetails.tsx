import { conceptsPass, percent, type CheckDetails, type PrecheckResult } from "@/lib/validation";

function Status({ passed }: { passed: boolean | undefined }) {
  return <span className={passed === undefined ? "" : passed ? "check-pass" : "check-fail"}>{passed === undefined ? "Unavailable" : passed ? "Pass" : "Fail"}</span>;
}

export function ResultDetails({ checks, precheck, numbered = false }: { checks: CheckDetails | null; precheck?: PrecheckResult; numbered?: boolean }) {
  const browserResult = checks?.precheck ?? precheck;
  const browserPassed = browserResult === "passed";
  return <div className="check-details" aria-label="Check results">
    <div><h3>{numbered ? "Step 1 // CLOUDFLARE PRECHECK" : "CLOUDFLARE PRECHECK"}<span className={browserPassed ? "check-pass" : ""}>{browserPassed ? "Pass" : browserResult === "not-run" ? "Not run" : "Unavailable"}</span></h3>
      {numbered && <small>{browserPassed ? "The browser passed the Cloudflare check." : browserResult === "not-run" ? "The browser check was not completed." : "Browser-check details are unavailable for this attempt."}</small>}
    </div>
    <div><h3>{numbered ? "Step 2 // STORY CONTENT & SUBJECT VALIDATION" : "STORY CONTENT & SUBJECT VALIDATION"}<Status passed={checks ? conceptsPass(checks.concepts) : undefined} /></h3>
      {checks && <ul>{([['setting', 'Setting / time'], ['characters', 'Characters'], ['conflict', 'Conflict'], ['story', 'Coherent story']] as const).map(([key, label]) => <li key={key}><span aria-label={checks.concepts[key] ? "Met:" : "Missing:"}>{checks.concepts[key] ? "✓" : "✗"}</span> {label}</li>)}</ul>}
      {numbered && <small>{checks ? conceptsPass(checks.concepts) ? "All story requirements were met." : "Missing story requirements are marked above." : "Story-check details are unavailable for this attempt." }</small>}
    </div>
    <div><h3>{numbered ? "Step 3 // STORY AUTHOR VALIDATION" : "STORY AUTHOR VALIDATION"}<Status passed={checks?.detectorPassed} /></h3>
      {numbered && <small>{checks ? checks.detectorPassed ? "The detector classified the story as human-written." : "The detector flagged AI-written or AI-assisted text." : "AI-detection details are unavailable for this attempt."}</small>}
      {checks && <><p><strong>{percent(checks.pangram.ai)} AI</strong><span>{percent(checks.pangram.assisted)} AI-assisted</span><span>{percent(checks.pangram.human)} human</span></p><small>Share of text classified in each category.</small></>}
    </div>
  </div>;
}
