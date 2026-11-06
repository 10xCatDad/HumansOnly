import { conceptsPass, percent, type CheckDetails, type PrecheckResult } from "./validation";
import { CHALLENGE_LEVEL, PUBLIC_URL } from "./share";
import { X_LOGO_PATH } from "./brand";

export type ResultImageInput = { id: string; result: "passed" | "rejected" | "error"; checks: CheckDetails | null; precheck?: PrecheckResult | null; submittedAt?: number };

// Match the light result dialog, independent of the visitor's selected theme.
export async function renderResultImage({ result, checks, precheck, submittedAt }: ResultImageInput): Promise<Blob> {
  await Promise.all([400, 600, 700].map(weight => document.fonts.load(`${weight} 14px "Space Grotesk"`))).catch(() => {});
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const width = 400, scale = 3, padding = 20, inset = 16, cardWidth = width - padding * 2;
  const contentWidth = cardWidth - inset * 2;
  const colors = { ink: "#202733", muted: "#596579", line: "#d4dbe7", pass: "#28734b", fail: "#aa3434" };
  const font = (size: number, weight = 400) => { ctx.font = `${weight} ${size}px "Space Grotesk", Arial, sans-serif`; };
  const wrap = (value: string, maxWidth: number) => {
    const lines: string[] = []; let line = "";
    for (const word of value.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  type Item = { text: string; weight?: number };
  const layoutItems = (items: Item[], size: number, gap: number, lineHeight: number) => {
    let x = 0, y = 0;
    return items.map(item => {
      font(size, item.weight);
      const itemWidth = ctx.measureText(item.text).width;
      if (x && x + itemWidth > contentWidth) { x = 0; y += lineHeight; }
      const positioned = { ...item, x, y };
      x += itemWidth + gap;
      return positioned;
    });
  };
  const concepts = checks ? layoutItems([
    { text: `${checks.concepts.setting ? "✓" : "✗"} Setting / time` },
    { text: `${checks.concepts.characters ? "✓" : "✗"} Characters` },
    { text: `${checks.concepts.conflict ? "✓" : "✗"} Conflict` },
    { text: `${checks.concepts.story ? "✓" : "✗"} Coherent story` },
  ], 13, 16, 29) : [];
  const scores = checks ? layoutItems([
    { text: `${percent(checks.pangram.ai)} AI`, weight: 700 },
    { text: `${percent(checks.pangram.assisted)} AI-assisted` },
    { text: `${percent(checks.pangram.human)} human` },
  ], 13, 16, 25) : [];
  const browserCheck = checks?.precheck ?? precheck;
  const rows = [
    { title: "CLOUDFLARE PRECHECK", status: browserCheck === "passed" ? "Pass" : browserCheck === "not-run" ? "Not run" : "Unavailable" },
    { title: "STORY CONTENT & SUBJECT VALIDATION", status: checks ? conceptsPass(checks.concepts) ? "Pass" : "Fail" : "Unavailable" },
    { title: "STORY AUTHOR VALIDATION", status: checks ? checks.detectorPassed ? "Pass" : "Fail" : "Unavailable" },
  ].map((row, index) => {
    font(14); const statusWidth = ctx.measureText(row.status).width;
    font(13, 600); const titleLines = wrap(row.title, contentWidth - statusWidth - 12);
    const detailsHeight = index === 1 && checks ? 16 + concepts.at(-1)!.y + 18
      : index === 2 && checks ? 16 + scores.at(-1)!.y + 18 + 12 + 12 : 0;
    return { ...row, titleLines, height: 36 + titleLines.length * 18 + detailsHeight };
  });
  const cardTop = 174, cardHeight = rows.reduce((sum, row) => sum + row.height, 0);
  const footerTop = cardTop + cardHeight + 28, height = footerTop + 29;
  canvas.width = width * scale; canvas.height = height * scale;
  ctx.scale(scale, scale); ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = colors.muted; font(10, 600); ctx.textAlign = "center";
  ctx.fillText(new URL(PUBLIC_URL).hostname, width / 2, 14);
  ctx.textAlign = "left"; font(12);
  ctx.fillText(`LEVEL ${CHALLENGE_LEVEL} // RESULT`, padding, 46);
  ctx.fillStyle = result === "passed" ? colors.pass : result === "rejected" ? colors.fail : colors.ink;
  font(result === "error" ? 28 : 34, 600);
  ctx.fillText(result === "passed" ? "Pass" : result === "rejected" ? "Fail" : "Check unavailable", padding, 88);
  ctx.fillStyle = colors.muted; font(14);
  const description = result === "passed" ? "Challenge I cleared." : result === "rejected" ? "The captcha held." : "The service could not complete the check.";
  ctx.fillText(description, padding, 139);

  ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(padding, cardTop, cardWidth, cardHeight, 4); ctx.stroke();
  let y = cardTop;
  rows.forEach((row, index) => {
    if (index) { ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke(); }
    ctx.fillStyle = colors.ink; font(13, 600);
    row.titleLines.forEach((line, i) => ctx.fillText(line, padding + inset, y + 18 + i * 18));
    ctx.fillStyle = row.status === "Pass" ? colors.pass : row.status === "Fail" ? colors.fail : colors.muted;
    font(14); ctx.textAlign = "right";
    ctx.fillText(row.status, width - padding - inset, y + 18); ctx.textAlign = "left";
    const detailsTop = y + 18 + row.titleLines.length * 18 + 16;
    if (index === 1) {
      ctx.fillStyle = colors.muted; font(13);
      concepts.forEach(item => ctx.fillText(item.text, padding + inset + item.x, detailsTop + item.y));
    }
    if (index === 2 && checks) {
      ctx.fillStyle = colors.ink;
      scores.forEach(item => { font(13, item.weight); ctx.fillText(item.text, padding + inset + item.x, detailsTop + item.y); });
      ctx.fillStyle = colors.muted; font(10.5);
      ctx.fillText("Share of text classified in each category.", padding + inset, detailsTop + scores.at(-1)!.y + 30);
    }
    y += row.height;
  });

  ctx.fillStyle = colors.muted; font(8.5);
  const timestamp = Number.isFinite(submittedAt) ? new Date(submittedAt!).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "Time unavailable";
  ctx.fillText(timestamp, padding, footerTop);
  const handle = "@10xCatDad", handleWidth = ctx.measureText(handle).width;
  const iconSize = 9, iconX = width - padding - handleWidth - iconSize - 5;
  ctx.save(); ctx.translate(iconX, footerTop); ctx.scale(iconSize / 24, iconSize / 24); ctx.fill(new Path2D(X_LOGO_PATH)); ctx.restore();
  ctx.fillText(handle, width - padding - handleWidth, footerTop);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image unavailable")), "image/png"));
}
