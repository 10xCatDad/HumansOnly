import { conceptsPass, percent, type CheckDetails } from "./validation.ts";
export const PUBLIC_URL = "https://captcha.10xcatdad.xyz";
export function shareText(result: "passed" | "rejected", checks: CheckDetails) {
  return `Writing CAPTCHA: ${result === "passed" ? "PASS" : "FAIL"}\nPangram: ${percent(checks.pangram.ai)} AI, ${percent(checks.pangram.assisted)} AI-assisted\nCodex story check: ${conceptsPass(checks.concepts) ? "PASS" : "FAIL"}\nMy submission is attached. @10xCatDad\n${PUBLIC_URL}`;
}
export function intentUrl(result: "passed" | "rejected", checks: CheckDetails) {
  return `https://twitter.com/intent/tweet?${new URLSearchParams({ text: shareText(result, checks) })}`;
}
