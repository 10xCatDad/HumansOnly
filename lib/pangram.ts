import type { PangramScore } from "./validation.ts";
const BASE = "https://text.external-api.pangram.com";
export type Fetcher = typeof fetch;
export class ProviderError extends Error {
  code: "unavailable" | "configuration" | "billing" | "invalid_response";
  constructor(code: "unavailable" | "configuration" | "billing" | "invalid_response") { super(code); this.code = code; }
}
async function request(path: string, key: string, init: RequestInit, fetcher: Fetcher) {
  let response: Response;
  try {
    response = await fetcher(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", "x-api-key": key }, redirect: "manual", signal: AbortSignal.timeout(12_000) });
  } catch { throw new ProviderError("unavailable"); }
  if (!response.ok) throw new ProviderError(response.status === 402 ? "billing" : [401, 403].includes(response.status) ? "configuration" : "unavailable");
  try { return await response.json() as Record<string, unknown>; } catch { throw new ProviderError("invalid_response"); }
}
export async function submitText(text: string, key: string, model: string, fetcher: Fetcher = fetch) {
  const result = await request("/task", key, { method: "POST", body: JSON.stringify({ text, model, public_dashboard_link: false }) }, fetcher);
  if (typeof result.task_id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(result.task_id)) throw new ProviderError("invalid_response");
  return result.task_id;
}
export function interpretResult(result: Record<string, unknown>): { status: "pending" } | { status: "passed" | "rejected"; version: string; score: PangramScore } {
  if (["STAGE_CREATED", "STAGE_PENDING", "STAGE_PROCESSING", "STAGE_QUEUED", "STAGE_RUNNING"].includes(String(result.stage))) return { status: "pending" };
  if (result.stage === "STAGE_FAILED") throw new ProviderError("unavailable");
  if (result.stage !== "STAGE_SUCCESS") throw new ProviderError("invalid_response");
  const fractions = [result.fraction_human, result.fraction_ai, result.fraction_ai_assisted];
  if (fractions.some(v => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)
      || Math.abs((fractions as number[]).reduce((sum, v) => sum + v, 0) - 1) > 0.001
      || typeof result.version !== "string" || result.version.length > 80
      || !["Human", "AI", "AI-Assisted", "Mixed"].includes(String(result.prediction_short))) throw new ProviderError("invalid_response");
  // These fractions describe text, not the probability that the visitor is human.
  const passed = result.prediction_short === "Human" && result.fraction_human === 1 && result.fraction_ai === 0 && result.fraction_ai_assisted === 0;
  return { status: passed ? "passed" : "rejected", version: result.version, score: { human: result.fraction_human as number, ai: result.fraction_ai as number, assisted: result.fraction_ai_assisted as number } };
}
export async function getResult(taskId: string, key: string, fetcher: Fetcher = fetch) {
  return interpretResult(await request(`/task/${encodeURIComponent(taskId)}`, key, { method: "GET" }, fetcher));
}
