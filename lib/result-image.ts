import type { StoryPrompt } from "./challenge";
import { conceptsPass, percent, type CheckDetails, type PrecheckResult } from "./validation";
import { CHALLENGE_LEVEL, PUBLIC_URL } from "./share";
import { X_LOGO_PATH } from "./brand";

export type ResultImageInput = { id: string; result: "passed" | "rejected" | "error"; checks: CheckDetails | null; precheck?: PrecheckResult | null; text?: string; prompt?: StoryPrompt };

export async function renderResultImage({ result, checks, precheck, text, prompt }: ResultImageInput): Promise<Blob> {
  await Promise.all([document.fonts.load('400 24px "Space Grotesk"'), document.fonts.load('700 38px "Space Grotesk"')]).catch(() => {});
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const width = 1080, padding = 64, lineHeight = 36;
  ctx.font = '400 24px "Space Grotesk", Arial';
  function wrap(value: string) {
    const lines: string[] = [];
    for (const paragraph of value.split(/\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (!word) continue;
        if (ctx!.measureText(`${line} ${word}`.trim()).width <= width - 2 * padding) { line = `${line} ${word}`.trim(); continue; }
        if (line) lines.push(line); line = "";
        for (const character of word) {
          if (ctx!.measureText(line + character).width > width - 2 * padding) { lines.push(line); line = ""; }
          line += character;
        }
      }
      lines.push(line);
    }
    return lines;
  }
  const browserCheck = checks?.precheck ?? precheck;
  const sections = [
    `Cloudflare precheck // ${browserCheck === "passed" ? "PASS" : browserCheck === "not-run" ? "NOT RUN" : "UNAVAILABLE"}`,
    checks ? `Story validation (Codex) // ${conceptsPass(checks.concepts) ? "PASS" : "FAIL"}\nSetting ${checks.concepts.setting ? "yes" : "no"} · Characters ${checks.concepts.characters ? "yes" : "no"} · Conflict ${checks.concepts.conflict ? "yes" : "no"} · Coherent story ${checks.concepts.story ? "yes" : "no"}` : "Story validation (Codex) // UNAVAILABLE",
    checks ? `AI detection // ${checks.detectorPassed ? "PASS" : "FAIL"}\n${percent(checks.pangram.human)} human · ${percent(checks.pangram.ai)} AI · ${percent(checks.pangram.assisted)} AI-assisted\nShare of text classified in each category.` : "AI detection // UNAVAILABLE",
    ...(prompt ? [`Setting + time // ${prompt.setting}`, `Characters // ${prompt.characters}`, `Conflict // ${prompt.conflict}`] : []),
  ].map(wrap);
  const storyLines = wrap(text ? text.replace(/\s+/g, " ").trim() : "Original story not available in this browser.");
  const excerpt = storyLines.slice(0, 4);
  if (storyLines.length > 4) {
    let last = excerpt[3];
    while (ctx.measureText(`${last}…`).width > width - 2 * padding) last = last.slice(0, -1);
    excerpt[3] = `${last.trimEnd()}…`;
  }
  sections.push(excerpt);
  canvas.width = width;
  canvas.height = 270 + sections.reduce((sum, lines) => sum + lines.length * lineHeight + 28, 0);
  ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = result === "passed" ? "#54ff81" : result === "rejected" ? "#ff9696" : "#93b69e";
  ctx.font = '700 38px "Space Grotesk", Arial';
  ctx.fillText(`HumansOnly // Level ${CHALLENGE_LEVEL} // ${result === "passed" ? "PASS" : result === "rejected" ? "FAIL" : "CHECK UNAVAILABLE"}`, padding, 86, width - 2 * padding);
  ctx.font = '400 24px "Space Grotesk", Arial';
  let y = 142;
  const checkPasses = [browserCheck === "passed" ? true : null, checks ? conceptsPass(checks.concepts) : null, checks?.detectorPassed ?? null];
  sections.forEach((lines, index) => {
    if (index < 3) {
      ctx.fillStyle = "#0c1810"; ctx.fillRect(padding - 20, y - 28, width - 2 * padding + 40, lines.length * lineHeight + 12);
      ctx.fillStyle = checkPasses[index] === true ? "#54ff81" : checkPasses[index] === false ? "#ff9696" : "#93b69e";
      ctx.fillRect(padding - 20, y - 28, 4, lines.length * lineHeight + 12);
    }
    ctx.fillStyle = index === sections.length - 1 ? "#dcffe5" : "#93b69e";
    lines.forEach(line => { ctx.fillText(line, padding, y, width - 2 * padding); y += lineHeight; }); y += 28;
  });
  ctx.fillStyle = "#93b69e"; ctx.font = '400 22px "Space Grotesk", Arial';
  ctx.fillText(new URL(PUBLIC_URL).host, padding, canvas.height - 58);
  const handle = "@10xCatDad", handleWidth = ctx.measureText(handle).width;
  const iconX = width - padding - handleWidth - 36;
  ctx.save(); ctx.translate(iconX, canvas.height - 77); ctx.scale(22 / 24, 22 / 24); ctx.fill(new Path2D(X_LOGO_PATH)); ctx.restore();
  ctx.fillText(handle, width - padding - handleWidth, canvas.height - 58);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image unavailable")), "image/png"));
}
