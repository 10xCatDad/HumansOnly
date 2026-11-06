import type { PangramScore } from "./validation.ts";

export type PangramPassage = {
  text: string | null;
  label: "AI-Generated" | "AI-Assisted" | "Human Written" | null;
  confidence: "High" | "Medium" | "Low" | null;
  assistanceScore: number | null;
  humanized: boolean | null;
  humanizerScore: number | null;
  probabilities: PangramScore | null;
  start: number | null;
  end: number | null;
  words: number | null;
  tokens: number | null;
};
export type PangramBreakdown = {
  version: string | null;
  verdict: string;
  fractions: PangramScore;
  segments: { human: number | null; assisted: number | null; ai: number | null };
  passages: PangramPassage[];
  truncated: boolean;
};

const fraction = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
function choice<T extends string>(value: unknown, choices: readonly T[]): T | null {
  return typeof value === "string" && choices.includes(value as T) ? value as T : null;
}

// Called only after the required overall result has passed interpretResult.
// Allowlist optional fields; never relay provider identifiers, URLs or arbitrary payloads.
export function parseBreakdown(result: Record<string, unknown>, fractions: PangramScore): PangramBreakdown {
  const windows = Array.isArray(result.windows) ? result.windows : [];
  let remainingText = 24_000, truncated = windows.length > 128;
  const passages: PangramPassage[] = [];
  for (const window of windows.slice(0, 128)) {
    if (!window || typeof window !== "object" || Array.isArray(window)) continue;
    const w = window as Record<string, unknown>;
    let text: string | null = null;
    if (typeof w.text === "string" && w.text.length) {
      text = remainingText > 0 ? w.text.slice(0, remainingText) : null;
      if (w.text.length > remainingText) truncated = true;
      remainingText -= text?.length ?? 0;
    }
    const p = w.class_probabilities;
    // Pangram 4.1 order: Human, AI-Assisted, AI-Generated.
    const probabilities = Array.isArray(p) && p.length === 3 && p.every(value => fraction(value) !== null)
      && Math.abs(p.reduce((sum: number, value: number) => sum + value, 0) - 1) <= 0.001
      ? { human: p[0] as number, assisted: p[1] as number, ai: p[2] as number } : null;
    let start = count(w.start_index), end = count(w.end_index);
    if (start !== null && end !== null && end < start) { start = null; end = null; }
    passages.push({
      text, label: choice(w.label, ["AI-Generated", "AI-Assisted", "Human Written"]),
      confidence: choice(w.confidence, ["High", "Medium", "Low"]),
      assistanceScore: fraction(w.ai_assistance_score),
      humanized: typeof w.is_humanized === "boolean" ? w.is_humanized : null,
      humanizerScore: fraction(w.humanizer_score), probabilities,
      start, end, words: count(w.word_count), tokens: count(w.token_length),
    });
  }
  return {
    version: typeof result.version === "string" && /^[\w .+/-]{1,80}$/.test(result.version) ? result.version : null,
    verdict: choice(result.prediction_short, ["Human", "AI", "AI-Assisted", "Mixed"]) ?? "Not supplied",
    fractions,
    segments: { human: count(result.num_human_segments), assisted: count(result.num_ai_assisted_segments), ai: count(result.num_ai_segments) },
    passages, truncated,
  };
}
