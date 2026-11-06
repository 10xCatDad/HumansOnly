"use client";
import { useEffect, useState } from "react";
import type { StoryPrompt } from "@/lib/challenge";
import { conceptsPass, percent, type CheckDetails } from "@/lib/validation";
import { intentUrl, PUBLIC_URL } from "@/lib/share";

type Props = { text: string; prompt: StoryPrompt; result: "passed" | "rejected"; checks: CheckDetails };
export function ShareResult({ text, prompt, result, checks }: Props) {
  const [download, setDownload] = useState<string | null>(null);
  useEffect(() => {
    let alive = true, url: string | undefined;
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = 1080, padding = 64, lineHeight = 36;
    ctx.font = "24px Arial";
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
    const conceptSummary = `Story validation (Codex): ${conceptsPass(checks.concepts) ? "PASS" : "FAIL"}\nSetting ${checks.concepts.setting ? "yes" : "no"} · Characters ${checks.concepts.characters ? "yes" : "no"} · Conflict ${checks.concepts.conflict ? "yes" : "no"} · Coherent story ${checks.concepts.story ? "yes" : "no"}`;
    const sections = [
      `Cloudflare precheck: ${checks.precheck === "passed" ? "PASS" : "not run"}`,
      conceptSummary,
      `AI detection: ${checks.detectorPassed ? "PASS" : "FAIL"}\n${percent(checks.pangram.human)} human · ${percent(checks.pangram.ai)} AI · ${percent(checks.pangram.assisted)} AI-assisted\nShare of text classified in each category.`,
      `Setting / time: ${prompt.setting}`, `Characters: ${prompt.characters}`, `Conflict: ${prompt.conflict}`, text,
    ].map(wrap);
    canvas.width = width;
    canvas.height = 270 + sections.reduce((sum, lines) => sum + lines.length * lineHeight + 28, 0);
    ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = result === "passed" ? "#54ff81" : "#ff9696"; ctx.font = "bold 38px Arial";
    ctx.fillText(`HumansOnly: ${result === "passed" ? "PASS" : "FAIL"}`, padding, 86);
    ctx.font = "24px Arial";
    let y = 142;
    sections.forEach((lines, index) => {
      if (index < 3) {
        const passed = [checks.precheck === "passed", conceptsPass(checks.concepts), checks.detectorPassed][index];
        ctx.fillStyle = "#0c1810"; ctx.fillRect(padding - 20, y - 28, width - 2 * padding + 40, lines.length * lineHeight + 12);
        ctx.fillStyle = passed ? "#54ff81" : "#ff9696"; ctx.fillRect(padding - 20, y - 28, 4, lines.length * lineHeight + 12);
      }
      ctx.fillStyle = index === sections.length - 1 ? "#dcffe5" : "#93b69e";
      lines.forEach(line => { ctx.fillText(line, padding, y); y += lineHeight; }); y += 28;
    });
    ctx.fillStyle = "#93b69e"; ctx.font = "22px Arial";
    ctx.fillText(`${PUBLIC_URL}  •  @10xCatDad`, padding, canvas.height - 58);
    canvas.toBlob(blob => { if (blob && alive) { url = URL.createObjectURL(blob); setDownload(url); } }, "image/png");
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [text, prompt, result, checks]);
  return <div className="share-result"><p>Share your result</p><div>
    <a className="secondary-button" href={download || undefined} download="humansonly-result.png" aria-disabled={!download}>1. Save result image</a>
    <a className="secondary-button" href={intentUrl(result)} target="_blank" rel="noopener noreferrer">2. Post on X ↗</a>
  </div><small>Attach the saved image in the composer. It includes your full story.</small></div>;
}
