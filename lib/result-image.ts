import type { StoryPrompt } from "./challenge";
import { conceptsPass, percent, type CheckDetails, type PrecheckResult } from "./validation";
import { CHALLENGE_LEVEL } from "./share";
import { X_LOGO_PATH } from "./brand";

export type ResultImageInput = { id: string; result: "passed" | "rejected" | "error"; checks: CheckDetails | null; precheck?: PrecheckResult | null; text?: string; prompt?: StoryPrompt; submittedAt?: number };

export async function renderResultImage({ result, checks, precheck, text, prompt, submittedAt }: ResultImageInput): Promise<Blob> {
  await Promise.all([document.fonts.load('400 24px "Space Grotesk"'), document.fonts.load('700 38px "Space Grotesk"')]).catch(() => {});
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const width = 1080, padding = 56, inset = 22, contentWidth = width - 2 * (padding + inset), lineHeight = 34;
  const font = (size: number, weight = 400) => { ctx.font = `${weight} ${size}px "Space Grotesk", Arial`; };
  font(24);
  function wrap(value: string) {
    const lines: string[] = []; let line = "";
    for (const word of value.replace(/\s+/g, " ").trim().split(" ")) {
      if (ctx!.measureText(`${line} ${word}`.trim()).width <= contentWidth) { line = `${line} ${word}`.trim(); continue; }
      if (line) lines.push(line); line = "";
      for (const character of word) {
        if (ctx!.measureText(line + character).width > contentWidth) { lines.push(line); line = ""; }
        line += character;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  function fit(value: string) {
    if (ctx!.measureText(value).width <= contentWidth) return value;
    while (ctx!.measureText(`${value}…`).width > contentWidth) value = value.slice(0, -1);
    return `${value.trimEnd()}…`;
  }
  const browserCheck = checks?.precheck ?? precheck;
  const sections = [
    [`Step 1 // CLOUDFLARE PRECHECK // ${browserCheck === "passed" ? "PASS" : browserCheck === "not-run" ? "NOT RUN" : "UNAVAILABLE"}`],
    checks ? [`Step 2 // STORY CONTENT & SUBJECT VALIDATION // ${conceptsPass(checks.concepts) ? "PASS" : "FAIL"}`, `Setting ${checks.concepts.setting ? "✓" : "✗"} · Characters ${checks.concepts.characters ? "✓" : "✗"} · Conflict ${checks.concepts.conflict ? "✓" : "✗"} · Story ${checks.concepts.story ? "✓" : "✗"}`] : ["Step 2 // STORY CONTENT & SUBJECT VALIDATION // UNAVAILABLE"],
    checks ? [`Step 3 // STORY AUTHOR VALIDATION // ${checks.detectorPassed ? "PASS" : "FAIL"}`, `${percent(checks.pangram.human)} human · ${percent(checks.pangram.ai)} AI · ${percent(checks.pangram.assisted)} AI-assisted`, "Share of text classified in each category."] : ["Step 3 // STORY AUTHOR VALIDATION // UNAVAILABLE"],
  ];
  const allLines = wrap(text || "Original story not available in this browser."), excerpt = allLines.slice(0, 4);
  if (allLines.length > 4) excerpt[3] = fit(`${excerpt[3]}…`);
  const checkHeights = sections.map(lines => lines.length * lineHeight + 24);
  const promptHeight = prompt ? 126 : 0, storyHeight = 66 + excerpt.length * lineHeight;
  canvas.width = width;
  canvas.height = 174 + checkHeights.reduce((sum, height) => sum + height + 12, 0) + (prompt ? promptHeight + 16 : 0) + storyHeight + 96;
  ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, width, canvas.height);
  ctx.fillStyle = "#54ff81"; font(28, 700); ctx.textAlign = "center";
  ctx.fillText("captcha.10xCatDad.xyz", width / 2, 54);
  ctx.textAlign = "left";
  ctx.fillStyle = result === "passed" ? "#54ff81" : result === "rejected" ? "#ff9696" : "#93b69e";
  font(38, 700);
  ctx.fillText(`HumansOnly // Level ${CHALLENGE_LEVEL} // ${result === "passed" ? "PASS" : result === "rejected" ? "FAIL" : "CHECK UNAVAILABLE"}`, padding, 124, width - 2 * padding);
  const checkPasses = [browserCheck === "passed" ? true : null, checks ? conceptsPass(checks.concepts) : null, checks?.detectorPassed ?? null];
  function box(y: number, height: number) {
    ctx!.fillStyle = "#0c1810"; ctx!.fillRect(padding, y, width - 2 * padding, height);
    ctx!.strokeStyle = "#254830"; ctx!.lineWidth = 1; ctx!.strokeRect(padding, y, width - 2 * padding, height);
  }
  let y = 164;
  sections.forEach((lines, index) => {
    box(y, checkHeights[index]);
    ctx.fillStyle = checkPasses[index] === true ? "#54ff81" : checkPasses[index] === false ? "#ff9696" : "#93b69e";
    ctx.fillRect(padding, y, 4, checkHeights[index]);
    lines.forEach((line, i) => { font(i === 2 ? 19 : 24, i === 0 ? 700 : 400); ctx.fillStyle = i === 0 ? "#dcffe5" : "#93b69e"; ctx.fillText(line, padding + inset, y + 34 + i * lineHeight, contentWidth); });
    y += checkHeights[index] + 12;
  });
  if (prompt) {
    box(y, promptHeight);
    [`Setting // ${prompt.setting}`, `Characters // ${prompt.characters}`, `Conflict // ${prompt.conflict}`].forEach((line, i) => {
      font(21); let size = 21;
      while (ctx.measureText(line).width > contentWidth && size > 18) font(--size);
      ctx.fillStyle = "#93b69e"; ctx.fillText(fit(line), padding + inset, y + 34 + i * 32);
    });
    y += promptHeight + 16;
  }
  box(y, storyHeight); font(18, 700); ctx.fillStyle = "#93b69e";
  ctx.fillText("STORY EXCERPT", padding + inset, y + 30);
  font(24); ctx.fillStyle = "#dcffe5";
  excerpt.forEach((line, i) => ctx.fillText(line, padding + inset, y + 66 + i * lineHeight, contentWidth));
  ctx.fillStyle = "#93b69e"; font(21);
  const timestamp = Number.isFinite(submittedAt) ? new Date(submittedAt!).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "Time unavailable";
  ctx.fillText(timestamp, padding, canvas.height - 40);
  const handle = "@10xCatDad", handleWidth = ctx.measureText(handle).width, iconX = width - padding - handleWidth - 36;
  ctx.save(); ctx.translate(iconX, canvas.height - 59); ctx.scale(22 / 24, 22 / 24); ctx.fill(new Path2D(X_LOGO_PATH)); ctx.restore();
  ctx.fillText(handle, width - padding - handleWidth, canvas.height - 40);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image unavailable")), "image/png"));
}
