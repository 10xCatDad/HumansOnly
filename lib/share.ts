export const PUBLIC_URL = "https://captcha.10xcatdad.xyz";
export function shareText(result: "passed" | "rejected") {
  return `HumansOnly: ${result === "passed" ? "PASS" : "FAIL"}\nFull story + results attached.\nTry it with your favorite LLM. @10xCatDad\n${PUBLIC_URL}`;
}
export function intentUrl(result: "passed" | "rejected") {
  return `https://twitter.com/intent/tweet?${new URLSearchParams({ text: shareText(result) })}`;
}
