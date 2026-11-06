export const PUBLIC_URL = "https://captcha.10xcatdad.xyz";
export const CHALLENGE_LEVEL = 1;
export function shareText(result: "passed" | "rejected", attemptsRemaining: number | null) {
  const remaining = attemptsRemaining === null ? null : Number.isFinite(attemptsRemaining) ? Math.max(0, Math.min(3, Math.trunc(attemptsRemaining))) : 0;
  return result === "passed"
    ? `@10xCatDad I just beat Level ${CHALLENGE_LEVEL} of HumansOnly! :D`
    : `@10xCatDad I failed Level ${CHALLENGE_LEVEL} of HumansOnly! :( (${remaining === null ? "unlimited" : `${remaining}/3`} tries remaining)`;
}
export function intentUrl(result: "passed" | "rejected", attemptsRemaining: number | null) {
  return `https://twitter.com/intent/tweet?${new URLSearchParams({ text: shareText(result, attemptsRemaining) })}`;
}
